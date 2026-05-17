const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { createDeck, shuffle } = require('./card-utils');

function determineWinner(cards, trumpSuit, leadSuit) {
  if (cards.length === 0) return null;
  var humanCards = cards.filter(function (c) { return c.suit === 'human'; });
  var antCards = cards.filter(function (c) { return c.suit === 'ant'; });
  if (humanCards.length === cards.length) return humanCards[0];
  if (antCards.length === cards.length) return antCards[antCards.length - 1];
  if (humanCards.length > 0) return humanCards[0];
  var firstAntIdx = cards.findIndex(function (c) { return c.suit === 'ant'; });
  var effective = firstAntIdx >= 0 ? cards.filter(function (c, i) { return i !== firstAntIdx; }) : cards;
  if (effective.length === 0) return cards[firstAntIdx];

  function cardPower(c) {
    if (c.suit === trumpSuit) return 3;
    if (c.suit === leadSuit) return 2;
    return 1;
  }
  var winner = effective[0];
  for (var i = 1; i < effective.length; i++) {
    var wp = cardPower(winner), cp = cardPower(effective[i]);
    if (cp > wp || (cp === wp && effective[i].rank > winner.rank)) winner = effective[i];
  }
  return winner;
}

exports.main = async function (event) {
  var ctx = cloud.getWXContext();
  var OPENID = ctx.OPENID;
  var roomId = event.roomId;
  var card = event.card;

  if (!card || !card.suit) return { ok: false, msg: '出牌无效' };

  var res = await db.collection('rooms').doc(roomId).get();
  var room = res.data;
  if (!room || !room.game) return { ok: false, msg: '游戏不存在' };

  var game = room.game;
  if (game.phase !== 'playing') return { ok: false, msg: '非出牌阶段' };

  var seats = room.seats || [];
  var filled = seats.filter(function (s) { return s; });
  var trick = game.currentTrick;

  // 检查回合顺序
  var leadIdx = filled.findIndex(function (s) { return s.userId === trick.leadPlayer; });
  var played = (trick.cards || []).length;
  if (filled[(leadIdx + played) % filled.length].userId !== OPENID) return { ok: false, msg: '还没轮到你' };

  // 检查手牌
  var hand = (game.hands[OPENID] || []).slice();
  var cardIdx = hand.findIndex(function (c) { return c.suit === card.suit && c.rank === card.rank; });
  if (cardIdx < 0) return { ok: false, msg: '你没有这张牌' };

  // 跟色检查
  if (card.suit !== 'human' && card.suit !== 'ant' && trick.leadSuit) {
    var hasLead = hand.some(function (c) { return c.suit === trick.leadSuit && c.suit !== 'human' && c.suit !== 'ant'; });
    if (hasLead && card.suit !== trick.leadSuit) return { ok: false, msg: '必须跟出' + trick.leadSuit };
  }

  // 移除手牌
  hand.splice(cardIdx, 1);
  var updateData = {};
  updateData['game.hands.' + OPENID] = hand;

  // 更新 trick
  var newCards = (trick.cards || []).slice();
  newCards.push({ userId: OPENID, suit: card.suit, rank: card.rank, playOrder: newCards.length });
  updateData['game.currentTrick.cards'] = newCards;

  var newLeadSuit = trick.leadSuit;
  var newSpecialRule = trick.specialRule;
  if (!trick.leadSuit && card.suit !== 'human' && card.suit !== 'ant') newLeadSuit = card.suit;
  if (card.suit === 'human' && !trick.specialRule) newSpecialRule = 'first_human';
  if (card.suit === 'ant' && !trick.specialRule) newSpecialRule = 'first_ant';
  updateData['game.currentTrick.leadSuit'] = newLeadSuit;
  updateData['game.currentTrick.specialRule'] = newSpecialRule;

  var trickDone = newCards.length >= filled.length;

  if (!trickDone) {
    await db.collection('rooms').doc(roomId).update({ data: updateData });
    return { ok: true };
  }

  // 本轮结算
  var winner = determineWinner(newCards, game.trumpSuit, newLeadSuit);
  var tricksWon = {};
  Object.keys(game.tricksWon || {}).forEach(function (k) { tricksWon[k] = game.tricksWon[k]; });
  if (winner) tricksWon[winner.userId] = (tricksWon[winner.userId] || 0) + 1;
  updateData['game.tricksWon'] = tricksWon;

  var roundDone = filled.reduce(function (sum, s) { return sum + (tricksWon[s.userId] || 0); }, 0) >= game.currentRound;

  if (!roundDone) {
    updateData['game.currentTrick'] = {
      leadPlayer: winner ? winner.userId : trick.leadPlayer,
      leadSuit: null, cards: [], specialRule: null,
    };
    await db.collection('rooms').doc(roomId).update({ data: updateData });
    return { ok: true };
  }

  // 回合结算
  var roundScores = {};
  filled.forEach(function (s) {
    var pred = (game.predictions && game.predictions[s.userId]) || 0;
    var actual = tricksWon[s.userId] || 0;
    roundScores[s.userId] = pred === actual ? 20 + actual * 10 : -Math.abs(pred - actual) * 10;
  });
  var scores = {};
  Object.keys(game.scores || {}).forEach(function (k) { scores[k] = game.scores[k]; });
  filled.forEach(function (s) { scores[s.userId] = (scores[s.userId] || 0) + roundScores[s.userId]; });

  var roundHistory = (game.roundHistory || []).slice();
  roundHistory.push({ round: game.currentRound, predictions: game.predictions || {}, actual: tricksWon, scores: roundScores });
  updateData['game.roundHistory'] = roundHistory;
  updateData['game.scores'] = scores;

  if (game.currentRound >= game.totalRounds) {
    updateData['game.phase'] = 'game_over';
    updateData['status'] = 'finished';
    await db.collection('rooms').doc(roomId).update({ data: updateData });
    return { ok: true };
  }

  // 下一回合
  var deck2 = shuffle(createDeck());
  var nextRound2 = game.currentRound + 1;
  var newHands = {};
  filled.forEach(function (s) { newHands[s.userId] = []; });
  for (var r = 0; r < nextRound2; r++) filled.forEach(function (s) { newHands[s.userId].push(deck2.pop()); });

  var playerIds = filled.map(function (s) { return s.userId; });
  var rotated = playerIds.slice(nextRound2 - 1).concat(playerIds.slice(0, nextRound2 - 1));

  updateData['game.currentRound'] = nextRound2;
  updateData['game.phase'] = 'predicting';
  updateData['game.hands'] = newHands;
  updateData['game.predictions'] = {};
  updateData['game.predictionOrder'] = rotated.slice(0, -1);
  updateData['game.lastPredictor'] = rotated[rotated.length - 1];
  updateData['game.forbiddenPrediction'] = nextRound2;
  updateData['game.tricksWon'] = {};
  filled.forEach(function (s) { updateData['game.tricksWon'][s.userId] = 0; });
  updateData['game.currentTrick'] = {
    leadPlayer: filled[(nextRound2 - 1) % filled.length].userId,
    leadSuit: null, cards: [], specialRule: null,
  };

  await db.collection('rooms').doc(roomId).update({ data: updateData });
  return { ok: true };
};
