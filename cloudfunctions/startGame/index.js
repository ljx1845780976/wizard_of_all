const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { createDeck, shuffle } = require('./card-utils');
const { aiPredict } = require('./ai-logic');

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { roomId } = event;

  const res = await db.collection('rooms').doc(roomId).get();
  const room = res.data;
  if (!room) return { ok: false, msg: '房间不存在' };
  if (room.ownerId !== OPENID) return { ok: false, msg: '非房主' };
  if (room.status !== 'waiting') return { ok: false, msg: '状态错误' };

  const filled = (room.seats || []).filter(s => s);
  if (filled.length < 3) return { ok: false, msg: '至少需要3人' };
  if (!filled.every(s => s.isReady || s.isAI)) return { ok: false, msg: '有玩家未准备' };

  // 洗牌
  const deck = shuffle(createDeck());

  // 翻王牌
  const trumpCard = deck.pop();
  let trumpSuit = null;
  if (trumpCard.suit === 'human') {
    const suits = ['sky', 'forest', 'grassland', 'ocean'];
    trumpSuit = suits[Math.floor(Math.random() * suits.length)];
  } else if (trumpCard.suit !== 'ant') {
    trumpSuit = trumpCard.suit;
  }
  // ant → trumpSuit = null (无王牌)

  const totalRounds = Math.floor(60 / filled.length);

  // 第一轮发牌：每人1张
  const hands = {};
  filled.forEach(s => { hands[s.userId] = []; });
  // 第一回合每人 1 张牌
  for (let i = 0; i < 1; i++) {
    filled.forEach(s => { hands[s.userId].push(deck.pop()); });
  }

  // 设置预测顺序：除最后一人的其他玩家先预测
  const playerIds = filled.map(s => s.userId);
  const predictionOrder = playerIds.slice(0, -1); // 前 N-1 人
  const lastPredictor = playerIds[playerIds.length - 1];

  // AI 自动预测（按照预测顺序）
  const predictions = {};
  let fb = 0;
  const sortedPlayers = [...predictionOrder, lastPredictor];
  for (const pid of sortedPlayers) {
    const seat = filled.find(s => s.userId === pid);
    if (seat && seat.isAI) {
      const aiHand = hands[pid] || [];
      const totalSoFar = Object.values(predictions).reduce((s, v) => s + v, 0);
      const forbiddenVal = (pid === lastPredictor) ? sortedPlayers.length - totalSoFar : null;
      predictions[pid] = aiPredict(aiHand, trumpSuit || null, forbiddenVal);
    } else {
      break; // 遇到真人就停，等真人提交
    }
  }
  // forbiddenPrediction = currentRound - sum(已提交预测)
  const sumPred = Object.values(predictions).reduce((s, v) => s + v, 0);
  const allPredicted = Object.keys(predictions).length >= filled.length;

  // 首轮先出牌者 = 座位0（第一个玩家）
  const firstPlayer = filled[0].userId;

  await db.collection('rooms').doc(roomId).update({
    data: {
      status: 'playing',
      game: {
        trumpSuit: trumpSuit || null,
        trumpRevealedCard: trumpCard,
        totalRounds,
        currentRound: 1,
        phase: allPredicted ? 'playing' : 'predicting',
        phaseDeadline: Date.now() + 30000 + (allPredicted ? 1 * 5000 : 0),
        hands,
        predictions: predictions,
        predictionOrder,
        lastPredictor,
        forbiddenPrediction: allPredicted ? 0 : (1 - sumPred),
        tricksWon: Object.fromEntries(filled.map(s => [s.userId, 0])),
        currentTrick: allPredicted ? {
          leadPlayer: filled[0].userId,
          leadSuit: null,
          cards: [],
          specialRule: null,
        } : {
          leadPlayer: firstPlayer,
          leadSuit: null,
          cards: [],
          specialRule: null,
        },
        scores: Object.fromEntries(filled.map(s => [s.userId, 0])),
        roundHistory: [],
      },
      updatedAt: Date.now(),
    }
  });

  return { ok: true };
};
