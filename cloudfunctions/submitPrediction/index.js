const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { aiPredict } = require('./ai-logic');

exports.main = async function (event) {
  var ctx = cloud.getWXContext();
  var OPENID = ctx.OPENID;
  var roomId = event.roomId;
  var prediction = event.prediction;

  if (typeof prediction !== 'number' || prediction < 0) return { ok: false, msg: '预测值无效' };

  var res = await db.collection('rooms').doc(roomId).get();
  var room = res.data;
  if (!room || !room.game) return { ok: false, msg: '游戏不存在' };

  var game = room.game;
  if (game.phase !== 'predicting') return { ok: false, msg: '非预测阶段' };

  var filled = (room.seats || []).filter(function (s) { return s; });
  var predictions = {};
  Object.keys(game.predictions || {}).forEach(function (k) { predictions[k] = game.predictions[k]; });
  if (predictions[OPENID] !== undefined && predictions[OPENID] !== null) return { ok: false, msg: '已提交' };

  var handSize = (game.hands[OPENID] || []).length;
  if (prediction > handSize) return { ok: false, msg: '预测超出范围，最多' + handSize };

  // 顺序检查
  var predOrder = game.predictionOrder || [];
  var lastPred = game.lastPredictor;
  if (OPENID !== lastPred) {
    var nextInOrder = predOrder.find(function (p) { return predictions[p] === undefined || predictions[p] === null; });
    if (nextInOrder && OPENID !== nextInOrder) {
      return { ok: false, msg: '还没轮到你预测' };
    }
  }
  if (OPENID === lastPred && prediction === game.forbiddenPrediction) {
    return { ok: false, msg: '预测值不能为' + game.forbiddenPrediction };
  }

  // 人类预测
  predictions[OPENID] = prediction;

  // 循环处理所有 AI 预测
  var allPlayerIds = filled.map(function (s) { return s.userId; });
  var changed = true;
  while (changed) {
    changed = false;
    var submitted = Object.keys(predictions).filter(function (k) { return predictions[k] !== undefined && predictions[k] !== null; });

    // 找下一个待预测者
    var next = predOrder.find(function (p) { return !submitted.includes(p); });
    if (!next && lastPred && !submitted.includes(lastPred)) {
      var allExceptLast = allPlayerIds.filter(function (id) { return id !== lastPred; });
      if (allExceptLast.every(function (id) { return predictions[id] !== undefined && predictions[id] !== null; })) {
        next = lastPred;
      }
    }
    if (!next) break;

    var seat = filled.find(function (s) { return s.userId === next; });
    if (!seat || !seat.isAI) break;

    var aiHand = game.hands[next] || [];
    var sumSubmitted = Object.values(predictions).reduce(function (s, v) { return s + (v !== undefined && v !== null ? v : 0); }, 0);
    var fb = (next === lastPred) ? game.currentRound - sumSubmitted : null;

    var p = 0;
    try { p = aiPredict(aiHand, game.trumpSuit, fb); } catch (e) {}
    if (p < 0 || isNaN(p)) p = 0;
    if (fb !== null && p === fb) p = (p > 0) ? p - 1 : (p < handSize ? p + 1 : p);

    predictions[next] = p;
    changed = true;
  }

  // 一次性写库
  var remaining = allPlayerIds.filter(function (k) { return predictions[k] === undefined || predictions[k] === null; });
  var updateData = { 'game.predictions': predictions };

  if (remaining.length === 0) {
    updateData['game.phase'] = 'playing';
    var firstIdx = (game.currentRound - 1) % filled.length;
    updateData['game.currentTrick'] = {
      leadPlayer: filled[firstIdx].userId,
      leadSuit: null, cards: [], specialRule: null,
    };
  } else {
    var sumAll = Object.values(predictions).reduce(function (s, v) { return s + (v !== undefined && v !== null ? v : 0); }, 0);
    if (predictions[lastPred] === undefined || predictions[lastPred] === null) {
      updateData['game.forbiddenPrediction'] = game.currentRound - sumAll;
    }
  }

  await db.collection('rooms').doc(roomId).update({ data: updateData });
  return { ok: true };
};
