const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { createDeck, shuffle } = require('./card-utils');

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

  const deck = shuffle(createDeck());
  const trumpCard = deck.pop();
  let trumpSuit = null;
  if (trumpCard.suit === 'human') {
    const suits = ['sky', 'forest', 'grassland', 'ocean'];
    trumpSuit = suits[Math.floor(Math.random() * suits.length)];
  } else if (trumpCard.suit !== 'ant') {
    trumpSuit = trumpCard.suit;
  }

  const totalRounds = Math.floor(60 / filled.length);
  const hands = {};
  filled.forEach(s => { hands[s.userId] = []; });
  for (let i = 0; i < 1; i++) filled.forEach(s => { hands[s.userId].push(deck.pop()); });

  const playerIds = filled.map(s => s.userId);
  const predictionOrder = playerIds.slice(0, -1); 
  const lastPredictor = playerIds[playerIds.length - 1];

  await db.collection('rooms').doc(roomId).update({
    data: {
      status: 'playing',
      game: {
        trumpSuit: trumpSuit || null,
        trumpRevealedCard: trumpCard,
        totalRounds,
        currentRound: 1,
        phase: 'predicting',
        hands,
        predictions: {},
        predictionOrder,
        lastPredictor,
        forbiddenPrediction: 1,
        tricksWon: Object.fromEntries(filled.map(s => [s.userId, 0])),
        currentTrick: { leadPlayer: filled[0].userId, leadSuit: null, cards: [], specialRule: null },
        scores: Object.fromEntries(filled.map(s => [s.userId, 0])),
        roundHistory: [],
      },
      updatedAt: Date.now(),
    }
  });
  return { ok: true };
};