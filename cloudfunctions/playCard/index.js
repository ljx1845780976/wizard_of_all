const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { createDeck, shuffle } = require('./card-utils');
const { aiPredict, aiPlayCard } = require('./ai-logic');

// ========== 工具函数 ==========

function determineWinner(cards, trumpSuit, leadSuit) {
  if (cards.length === 0) return null;
  var humanCards = cards.filter(function (c) { return c.suit === 'human'; });
  var antCards = cards.filter(function (c) { return c.suit === 'ant'; });
  if (humanCards.length === cards.length) return humanCards[0];
  if (antCards.length === cards.length) return antCards[antCards.length - 1];
  if (humanCards.length > 0) return humanCards[0];
  var fa = cards.findIndex(function (c) { return c.suit === 'ant'; });
  var ef = fa >= 0 ? cards.filter(function (c, i) { return i !== fa; }) : cards;
  if (ef.length === 0) return cards[fa];
  function cp(c) { if (c.suit === trumpSuit) return 3; if (c.suit === leadSuit) return 2; return 1; }
  var w = ef[0];
  for (var i = 1; i < ef.length; i++) {
    var wp = cp(w), ep = cp(ef[i]);
    if (ep > wp || (ep === wp && ef[i].rank > w.rank)) w = ef[i];
  }
  return w;
}

function getScore(pred, actual) {
  return pred === actual ? 20 + actual * 10 : -Math.abs(pred - actual) * 10;
}

/** 获取当前该出牌的玩家 */
function getCurrentPlayer(game, filled) {
  var trick = game.currentTrick;
  if (!trick) return null;
  var leadIdx = filled.findIndex(function (s) { return s.userId === trick.leadPlayer; });
  if (leadIdx < 0) return null;
  var played = (trick.cards || []).length;
  return filled[(leadIdx + played) % filled.length];
}

/** 检查跟色合法性 */
function canPlayCard(hand, trick, card) {
  if (card.suit === 'human' || card.suit === 'ant') return true;
  if (!trick || !trick.leadSuit) return true;
  var hasLead = hand.some(function (c) { return c.suit === trick.leadSuit && c.suit !== 'human' && c.suit !== 'ant'; });
  return !hasLead || card.suit === trick.leadSuit;
}

/** 从手牌中移除一张牌，返回新数组 */
function removeCard(hand, card) {
  var idx = hand.findIndex(function (c) { return c.suit === card.suit && c.rank === card.rank; });
  if (idx < 0) return hand;
  var h = hand.slice();
  h.splice(idx, 1);
  return h;
}

// ========== 处理一轮出牌（人类或AI通用）==========
function applyPlay(game, playerId, card, filled, updateData) {
  var trick = game.currentTrick;
  var hand = game.hands[playerId];

  // 手牌检查（已在人类路径中做过，AI 路径跳过）
  if (!hand.some(function (c) { return c.suit === card.suit && c.rank === card.rank; })) return false;

  game.hands[playerId] = removeCard(hand, card);
  updateData['game.hands.' + playerId] = game.hands[playerId];

  var newCards = (trick.cards || []).slice();
  newCards.push({ userId: playerId, suit: card.suit, rank: card.rank, playOrder: newCards.length });
  trick.cards = newCards;
  updateData['game.currentTrick.cards'] = newCards;

  if (!trick.leadSuit && card.suit !== 'human' && card.suit !== 'ant') {
    trick.leadSuit = card.suit;
    updateData['game.currentTrick.leadSuit'] = card.suit;
  }
  if (card.suit === 'human' && !trick.specialRule) {
    trick.specialRule = 'first_human';
    updateData['game.currentTrick.specialRule'] = 'first_human';
  }
  if (card.suit === 'ant' && !trick.specialRule) {
    trick.specialRule = 'first_ant';
    updateData['game.currentTrick.specialRule'] = 'first_ant';
  }
  return true;
}

// ========== 处理 AI：循环直到遇到真人 ==========
function processAI(game, filled, updateData) {
  var loopGuard = 0;
  while (loopGuard++ < 200) {
    // === 预测阶段 ===
    if (game.phase === 'predicting') {
      var preds = game.predictions || {};
      var predOrder = game.predictionOrder || [];
      var lastPred = game.lastPredictor;
      var submitted = Object.keys(preds).filter(function (k) { return preds[k] !== undefined && preds[k] !== null; });
      var allIds = filled.map(function (s) { return s.userId; });

      // 找下一个待预测者
      var next = predOrder.find(function (p) { return !submitted.includes(p); });
      if (!next && lastPred && !submitted.includes(lastPred)) {
        var allExceptLast = allIds.filter(function (id) { return id !== lastPred; });
        if (allExceptLast.every(function (id) { return preds[id] !== undefined && preds[id] !== null; })) {
          next = lastPred;
        }
      }
      if (!next) break;

      var seat = filled.find(function (s) { return s.userId === next; });
      if (!seat || !seat.isAI) break; // 真人，停

      var aiHand = game.hands[next] || [];
      var sum = Object.values(preds).reduce(function (s, v) { return s + (v !== undefined && v !== null ? v : 0); }, 0);
      var fb = (next === lastPred) ? game.currentRound - sum : null;

      var p = 0;
      try { p = aiPredict(aiHand, game.trumpSuit, fb); } catch (e) {}
      if (p < 0 || isNaN(p)) p = 0;
      if (fb !== null && p === fb) p = (p > 0) ? p - 1 : p + 1;

      preds[next] = p;
      game.predictions = preds;
      updateData['game.predictions'] = preds;

      var rem = allIds.filter(function (k) { return preds[k] === undefined || preds[k] === null; });
      if (rem.length === 0) {
        game.phase = 'playing';
        updateData['game.phase'] = 'playing';
        var fi = (game.currentRound - 1) % filled.length;
        game.currentTrick = { leadPlayer: filled[fi].userId, leadSuit: null, cards: [], specialRule: null };
        updateData['game.currentTrick'] = game.currentTrick;
      } else if (preds[lastPred] === undefined || preds[lastPred] === null) {
        var ns = Object.values(preds).reduce(function (s, v) { return s + (v !== undefined && v !== null ? v : 0); }, 0);
        updateData['game.forbiddenPrediction'] = game.currentRound - ns;
      }
      continue;
    }

    // === 出牌阶段 ===
    if (game.phase === 'playing') {
      var player = getCurrentPlayer(game, filled);
      if (!player) break;
      if (!player.isAI) break; // 真人，停

      var hand = game.hands[player.userId] || [];
      if (hand.length === 0) break;

      var trick = game.currentTrick;
      var chosen = null;
      try { chosen = aiPlayCard(hand, trick, game.trumpSuit); } catch (e) {}
      // fallback
      if (!chosen || !hand.some(function (c) { return c.suit === chosen.suit && c.rank === chosen.rank; })) {
        if (!trick.leadSuit) { chosen = hand[0]; }
        else {
          var hl = hand.some(function (c) { return c.suit === trick.leadSuit && c.suit !== 'human' && c.suit !== 'ant'; });
          chosen = hl
            ? (hand.find(function (c) { return c.suit === 'human' || c.suit === 'ant' || c.suit === trick.leadSuit; }) || hand[0])
            : hand[0];
        }
      }
      if (!chosen) break;

      applyPlay(game, player.userId, chosen, filled, updateData);

      // 本轮是否结束
      if (trick.cards.length >= filled.length) {
        var winner = determineWinner(trick.cards, game.trumpSuit, trick.leadSuit);
        var tricksWon = Object.assign({}, game.tricksWon);
        if (winner) tricksWon[winner.userId] = (tricksWon[winner.userId] || 0) + 1;
        game.tricksWon = tricksWon;
        updateData['game.tricksWon'] = tricksWon;

        var totalWon = filled.reduce(function (s, p2) { return s + (tricksWon[p2.userId] || 0); }, 0);
        var roundDone = totalWon >= game.currentRound;

        if (!roundDone) {
          game.currentTrick = { leadPlayer: winner ? winner.userId : trick.leadPlayer, leadSuit: null, cards: [], specialRule: null };
          updateData['game.currentTrick'] = game.currentTrick;
          continue;
        }

        // === 回合结束 ===
        var roundScores = {};
        filled.forEach(function (s) { roundScores[s.userId] = getScore((game.predictions && game.predictions[s.userId]) || 0, tricksWon[s.userId] || 0); });
        var scores = Object.assign({}, game.scores);
        filled.forEach(function (s) { scores[s.userId] = (scores[s.userId] || 0) + roundScores[s.userId]; });
        var rh = (game.roundHistory || []).slice();
        rh.push({ round: game.currentRound, predictions: game.predictions || {}, actual: tricksWon, scores: roundScores });

        game.scores = scores;
        game.roundHistory = rh;
        updateData['game.scores'] = scores;
        updateData['game.roundHistory'] = rh;

        if (game.currentRound >= game.totalRounds) {
          game.phase = 'game_over';
          updateData['game.phase'] = 'game_over';
          updateData['status'] = 'finished';
          break;
        }

        // 新回合
        var deck = shuffle(createDeck());
        var nr = game.currentRound + 1;
        var newHands = {};
        filled.forEach(function (s) { newHands[s.userId] = []; });
        for (var r = 0; r < nr; r++) filled.forEach(function (s) { newHands[s.userId].push(deck.pop()); });
        var pids = filled.map(function (s) { return s.userId; });
        var offset = (nr - 1) % pids.length;
        var rotated = pids.slice(offset).concat(pids.slice(0, offset));

        game.currentRound = nr;
        game.phase = 'predicting';
        game.hands = newHands;
        game.predictions = {};
        game.tricksWon = {};
        filled.forEach(function (s) { game.tricksWon[s.userId] = 0; });
        game.predictionOrder = rotated.slice(0, -1);
        game.lastPredictor = rotated[rotated.length - 1];
        game.currentTrick = { leadPlayer: filled[offset].userId, leadSuit: null, cards: [], specialRule: null };

        updateData['game.currentRound'] = nr;
        updateData['game.phase'] = 'predicting';
        updateData['game.hands'] = newHands;
        updateData['game.predictions'] = {};
        updateData['game.tricksWon'] = {};
        filled.forEach(function (s) { updateData['game.tricksWon'][s.userId] = 0; });
        updateData['game.predictionOrder'] = rotated.slice(0, -1);
        updateData['game.lastPredictor'] = rotated[rotated.length - 1];
        updateData['game.forbiddenPrediction'] = nr;
        updateData['game.currentTrick'] = game.currentTrick;
        // 继续循环，处理新回合的 AI 预测
        continue;
      }
      continue;
    }

    break;
  }
}

// ========== 入口 ==========
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

  var filled = (room.seats || []).filter(function (s) { return s; });

  // === 验证人类出牌 ===
  var player = getCurrentPlayer(game, filled);
  if (!player || player.userId !== OPENID) return { ok: false, msg: '还没轮到你' };

  var hand = (game.hands[OPENID] || []).slice();
  var cardIdx = hand.findIndex(function (c) { return c.suit === card.suit && c.rank === card.rank; });
  if (cardIdx < 0) return { ok: false, msg: '你没有这张牌' };

  if (!canPlayCard(hand, game.currentTrick, card)) return { ok: false, msg: '必须跟出' + (game.currentTrick.leadSuit || '') };

  // === 在内存中操作（复制 game 避免污染原数据）===
  var updateData = {};

  // 深拷贝关键字段
  game = JSON.parse(JSON.stringify(game));
  filled = (room.seats || []).filter(function (s) { return s; });

  // 应用人类出牌
  applyPlay(game, OPENID, card, filled, updateData);

  // 本轮/回合结算（人类可能直接完成本轮或本回合）
  var trick = game.currentTrick;
  if (trick.cards.length >= filled.length) {
    var winner = determineWinner(trick.cards, game.trumpSuit, trick.leadSuit);
    var tricksWon = Object.assign({}, game.tricksWon);
    if (winner) tricksWon[winner.userId] = (tricksWon[winner.userId] || 0) + 1;
    game.tricksWon = tricksWon;
    updateData['game.tricksWon'] = tricksWon;

    var totalWon = filled.reduce(function (s, p2) { return s + (tricksWon[p2.userId] || 0); }, 0);
    var roundDone = totalWon >= game.currentRound;

    if (!roundDone) {
      game.currentTrick = { leadPlayer: winner ? winner.userId : trick.leadPlayer, leadSuit: null, cards: [], specialRule: null };
      updateData['game.currentTrick'] = game.currentTrick;
    } else {
      // 回合结束
      var roundScores = {};
      filled.forEach(function (s) { roundScores[s.userId] = getScore((game.predictions && game.predictions[s.userId]) || 0, tricksWon[s.userId] || 0); });
      var scores = Object.assign({}, game.scores);
      filled.forEach(function (s) { scores[s.userId] = (scores[s.userId] || 0) + roundScores[s.userId]; });
      var rh = (game.roundHistory || []).slice();
      rh.push({ round: game.currentRound, predictions: game.predictions || {}, actual: tricksWon, scores: roundScores });
      game.scores = scores;
      game.roundHistory = rh;
      updateData['game.scores'] = scores;
      updateData['game.roundHistory'] = rh;

      if (game.currentRound >= game.totalRounds) {
        game.phase = 'game_over';
        updateData['game.phase'] = 'game_over';
        updateData['status'] = 'finished';
      } else {
        var deck = shuffle(createDeck());
        var nr = game.currentRound + 1;
        var newHands = {};
        filled.forEach(function (s) { newHands[s.userId] = []; });
        for (var r = 0; r < nr; r++) filled.forEach(function (s) { newHands[s.userId].push(deck.pop()); });
        var pids = filled.map(function (s) { return s.userId; });
        var offset = (nr - 1) % pids.length;
        var rotated = pids.slice(offset).concat(pids.slice(0, offset));

        game.currentRound = nr;
        game.phase = 'predicting';
        game.hands = newHands;
        game.predictions = {};
        game.tricksWon = {};
        filled.forEach(function (s) { game.tricksWon[s.userId] = 0; });
        game.predictionOrder = rotated.slice(0, -1);
        game.lastPredictor = rotated[rotated.length - 1];
        game.currentTrick = { leadPlayer: filled[offset].userId, leadSuit: null, cards: [], specialRule: null };

        updateData['game.currentRound'] = nr;
        updateData['game.phase'] = 'predicting';
        updateData['game.hands'] = newHands;
        updateData['game.predictions'] = {};
        updateData['game.tricksWon'] = {};
        filled.forEach(function (s) { updateData['game.tricksWon'][s.userId] = 0; });
        updateData['game.predictionOrder'] = rotated.slice(0, -1);
        updateData['game.lastPredictor'] = rotated[rotated.length - 1];
        updateData['game.forbiddenPrediction'] = nr;
        updateData['game.currentTrick'] = game.currentTrick;
      }
    }
  }

  // === AI 循环：直到遇到真人 ===
  processAI(game, filled, updateData);

  // === 一次性写库 ===
  if (Object.keys(updateData).length > 0) {
    await db.collection('rooms').doc(roomId).update({ data: updateData });
  }
  return { ok: true };
};
