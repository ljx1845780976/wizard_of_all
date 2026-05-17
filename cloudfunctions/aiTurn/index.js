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

function getScore(pred, actual) {
  return pred === actual ? 20 + actual * 10 : -Math.abs(pred - actual) * 10;
}

// ========== AI 处理主逻辑 ==========

function processAIPredictions(game, filled) {
  // 处理预测阶段的所有 AI
  var predOrder = game.predictionOrder || [];
  var lastPred = game.lastPredictor;
  var predictions = game.predictions || {};
  var changed = true;
  var anyChange = false;

  while (changed) {
    changed = false;

    // 先按 predictionOrder 处理
    var submitted = Object.keys(predictions).filter(function (k) { return predictions[k] !== undefined && predictions[k] !== null; });

    // 找 predictionOrder 中第一个未提交的
    var nextInOrder = predOrder.find(function (p) { return !submitted.includes(p); });

    if (nextInOrder) {
      var seat = filled.find(function (s) { return s.userId === nextInOrder; });
      if (seat && seat.isAI) {
        var aiHand = game.hands[nextInOrder] || [];
        var totalSoFar = Object.values(predictions).reduce(function (s, v) { return s + (v !== undefined && v !== null ? v : 0); }, 0);
        var fb = (nextInOrder === lastPred) ? game.currentRound - totalSoFar : null;
        predictions[nextInOrder] = aiPredict(aiHand, game.trumpSuit, fb);
        changed = true;
        anyChange = true;
        continue;
      } else if (seat && !seat.isAI) {
        // 遇到真人，停止
        break;
      }
    }

    // 如果 predictionOrder 走完了，检查 lastPredictor
    if (!changed) {
      if (lastPred && predictions[lastPred] === undefined || predictions[lastPred] === null) {
        var allExceptLast = filled.map(function (s) { return s.userId; })
          .filter(function (id) { return id !== lastPred; })
          .every(function (id) { return predictions[id] !== undefined && predictions[id] !== null; });
        if (allExceptLast) {
          var lastSeat = filled.find(function (s) { return s.userId === lastPred; });
          if (lastSeat && lastSeat.isAI) {
            var hand = game.hands[lastPred] || [];
            var sum = Object.values(predictions).reduce(function (s, v) { return s + (v !== undefined && v !== null ? v : 0); }, 0);
            predictions[lastPred] = aiPredict(hand, game.trumpSuit, game.currentRound - sum);
            changed = true;
            anyChange = true;
          }
        }
      }
    }
  }

  return { predictions: predictions, anyChange: anyChange };
}

function processAIPlays(game, filled) {
  // 处理出牌阶段的所有 AI
  var trick = game.currentTrick;
  var trumpSuit = game.trumpSuit;
  var tricksWon = game.tricksWon || {};
  var changes = {};
  var anyChange = false;

  while (true) {
    var currentCards = trick.cards || [];
    var leadIdx = filled.findIndex(function (s) { return s.userId === trick.leadPlayer; });
    var played = currentCards.length;

    // 当前应该出牌的玩家
    var currentSeatIdx = (leadIdx + played) % filled.length;
    var currentSeat = filled[currentSeatIdx];
    if (!currentSeat) break;

    // 如果不是 AI，停止
    if (!currentSeat.isAI) break;

    // AI 出牌
    var aiHand = (game.hands[currentSeat.userId] || []).slice();
    var chosenCard = aiPlayCard(aiHand, trick, trumpSuit);
    if (!chosenCard) break;

    // 从手牌移除
    var cardIdx = aiHand.findIndex(function (c) { return c.suit === chosenCard.suit && c.rank === chosenCard.rank; });
    if (cardIdx < 0) break;
    aiHand.splice(cardIdx, 1);
    changes['game.hands.' + currentSeat.userId] = aiHand;
    game.hands[currentSeat.userId] = aiHand;

    // 加到 trick
    currentCards = currentCards.slice();
    currentCards.push({ userId: currentSeat.userId, suit: chosenCard.suit, rank: chosenCard.rank, playOrder: currentCards.length });
    changes['game.currentTrick.cards'] = currentCards;

    // 更新引色
    if (!trick.leadSuit && chosenCard.suit !== 'human' && chosenCard.suit !== 'ant') {
      trick.leadSuit = chosenCard.suit;
      changes['game.currentTrick.leadSuit'] = chosenCard.suit;
    }
    if (chosenCard.suit === 'human' && !trick.specialRule) {
      trick.specialRule = 'first_human';
      changes['game.currentTrick.specialRule'] = 'first_human';
    }
    if (chosenCard.suit === 'ant' && !trick.specialRule) {
      trick.specialRule = 'first_ant';
      changes['game.currentTrick.specialRule'] = 'first_ant';
    }

    anyChange = true;

    // 检查本轮是否结束
    if (currentCards.length >= filled.length) {
      var winner = determineWinner(currentCards, trumpSuit, trick.leadSuit);
      if (winner) {
        tricksWon[winner.userId] = (tricksWon[winner.userId] || 0) + 1;
        changes['game.tricksWon'] = tricksWon;
      }

      // 检查回合是否结束
      var roundDone = filled.reduce(function (sum, s) { return sum + (tricksWon[s.userId] || 0); }, 0) >= game.currentRound;

      if (!roundDone) {
        // 下一轮
        trick = {
          leadPlayer: winner ? winner.userId : trick.leadPlayer,
          leadSuit: null, cards: [], specialRule: null,
        };
        changes['game.currentTrick'] = trick;
        // 继续循环，检查新引牌人是否是 AI
        continue;
      }

      // 回合结束
      handleRoundEnd(game, filled, tricksWon, changes);
      return { changes: changes, anyChange: anyChange, roundEnded: true };
    }

    // 本轮未完，继续循环下一位
    continue;
  }

  return { changes: changes, anyChange: anyChange, roundEnded: false };
}

function handleRoundEnd(game, filled, tricksWon, changes) {
  // 计算分数
  var roundScores = {};
  filled.forEach(function (s) {
    var pred = (game.predictions && game.predictions[s.userId]) || 0;
    var actual = tricksWon[s.userId] || 0;
    roundScores[s.userId] = getScore(pred, actual);
  });

  var scores = game.scores || {};
  filled.forEach(function (s) { scores[s.userId] = (scores[s.userId] || 0) + roundScores[s.userId]; });

  var roundHistory = (game.roundHistory || []).slice();
  roundHistory.push({ round: game.currentRound, predictions: game.predictions || {}, actual: tricksWon, scores: roundScores });

  changes['game.roundHistory'] = roundHistory;
  changes['game.scores'] = scores;

  // 最后回合？
  if (game.currentRound >= game.totalRounds) {
    changes['game.phase'] = 'game_over';
    changes['status'] = 'finished';
    return;
  }

  // 下一回合：重新发牌
  var deck = shuffle(createDeck());
  var nextRound = game.currentRound + 1;
  var newHands = {};
  filled.forEach(function (s) { newHands[s.userId] = []; });
  for (var r = 0; r < nextRound; r++) filled.forEach(function (s) { newHands[s.userId].push(deck.pop()); });

  var playerIds = filled.map(function (s) { return s.userId; });
  var rotated = playerIds.slice(nextRound - 1).concat(playerIds.slice(0, nextRound - 1));

  changes['game.currentRound'] = nextRound;
  changes['game.phase'] = 'predicting';
  changes['game.hands'] = newHands;
  changes['game.predictions'] = {};
  changes['game.predictionOrder'] = rotated.slice(0, -1);
  changes['game.lastPredictor'] = rotated[rotated.length - 1];
  changes['game.forbiddenPrediction'] = nextRound;
  changes['game.tricksWon'] = {};
  filled.forEach(function (s) { changes['game.tricksWon'][s.userId] = 0; });
  changes['game.currentTrick'] = {
    leadPlayer: filled[(nextRound - 1) % filled.length].userId,
    leadSuit: null, cards: [], specialRule: null,
  };

  // 更新内存中的 game 状态
  game.currentRound = nextRound;
  game.phase = 'predicting';
  game.hands = newHands;
  game.predictions = {};
  game.predictionOrder = rotated.slice(0, -1);
  game.lastPredictor = rotated[rotated.length - 1];
  game.forbiddenPrediction = nextRound;
  game.tricksWon = {};
  filled.forEach(function (s) { game.tricksWon[s.userId] = 0; });
  game.currentTrick = changes['game.currentTrick'];
}

// ========== 入口 ==========

exports.main = async function () {
  // 从调用参数获取 roomId，或从数据库查找所有玩游戏中且有 AI 的房间
  // 简化：通过 event 参数传入 roomId
  var event = arguments[0] || {};
  var roomId = event.roomId;
  if (!roomId) return { ok: false, msg: '缺少 roomId' };

  var res = await db.collection('rooms').doc(roomId).get();
  var room = res.data;
  if (!room || !room.game) return { ok: true };

  var game = room.game;
  if (game.phase === 'game_over' || room.status === 'finished') return { ok: true };

  var filled = (room.seats || []).filter(function (s) { return s; });
  var hasAI = filled.some(function (s) { return s.isAI; });
  if (!hasAI) return { ok: true };

  var allChanges = {};

  // === 处理预测阶段 ===
  if (game.phase === 'predicting') {
    var predResult = processAIPredictions(game, filled);
    if (predResult.anyChange) {
      Object.assign(allChanges, { 'game.predictions': predResult.predictions });

      // 检查是否所有人都预测完了
      var remaining = filled.filter(function (s) { return predResult.predictions[s.userId] === undefined || predResult.predictions[s.userId] === null; });
      if (remaining.length === 0) {
        allChanges['game.phase'] = 'playing';
        game.phase = 'playing';
        game.predictions = predResult.predictions;

        var firstIdx = (game.currentRound - 1) % filled.length;
        allChanges['game.currentTrick'] = {
          leadPlayer: filled[firstIdx].userId,
          leadSuit: null, cards: [], specialRule: null,
        };
        game.currentTrick = allChanges['game.currentTrick'];
      } else {
        game.predictions = predResult.predictions;
        // 更新 forbiddenPrediction
        var sumAll = Object.values(predResult.predictions).reduce(function (s, v) { return s + (v !== undefined && v !== null ? v : 0); }, 0);
        if (predResult.predictions[game.lastPredictor] === undefined || predResult.predictions[game.lastPredictor] === null) {
          allChanges['game.forbiddenPrediction'] = game.currentRound - sumAll;
        }
        if (Object.keys(allChanges).length > 0) await db.collection("rooms").doc(roomId).update({ data: allChanges });
        return { ok: true };
      }
    }
  }

  // === 处理出牌阶段 ===
  if (game.phase === 'playing') {
    var playResult = processAIPlays(game, filled);
    if (playResult.anyChange) {
      Object.assign(allChanges, playResult.changes);

      // 如果回合结束且进入了新回合的预测阶段，继续处理
      if (playResult.roundEnded && game.phase === 'predicting') {
        if (Object.keys(allChanges).length > 0) await db.collection("rooms").doc(roomId).update({ data: allChanges });
        // 递归处理新回合的 AI 预测
        var newRes = await db.collection('rooms').doc(roomId).get();
        if (newRes.data && newRes.data.game) {
          var newGame = newRes.data.game;
          var newFilled = (newRes.data.seats || []).filter(function (s) { return s; });
          if (newGame.phase === 'predicting') {
            var predResult2 = processAIPredictions(newGame, newFilled);
            if (predResult2.anyChange) {
              var moreChanges = { 'game.predictions': predResult2.predictions };
              var remaining2 = newFilled.filter(function (s) { return predResult2.predictions[s.userId] === undefined || predResult2.predictions[s.userId] === null; });
              if (remaining2.length === 0) {
                moreChanges['game.phase'] = 'playing';
                var fi2 = (newGame.currentRound - 1) % newFilled.length;
                moreChanges['game.currentTrick'] = {
                  leadPlayer: newFilled[fi2].userId,
                  leadSuit: null, cards: [], specialRule: null,
                };
              } else {
                var sum2 = Object.values(predResult2.predictions).reduce(function (s, v) { return s + (v !== undefined && v !== null ? v : 0); }, 0);
                if (predResult2.predictions[newGame.lastPredictor] === undefined || predResult2.predictions[newGame.lastPredictor] === null) {
                  moreChanges['game.forbiddenPrediction'] = newGame.currentRound - sum2;
                }
              }
              if (Object.keys(moreChanges).length > 0) await db.collection("rooms").doc(roomId).update({ data: moreChanges });
            }
          }
        }
        return { ok: true };
      }
    }

    if (Object.keys(allChanges).length === 0) return { ok: true };
  }

  if (Object.keys(allChanges).length > 0) await db.collection("rooms").doc(roomId).update({ data: allChanges });
  return { ok: true };
};
