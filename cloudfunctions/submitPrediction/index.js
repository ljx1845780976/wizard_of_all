const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

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

  var predictions = {};
  Object.keys(game.predictions || {}).forEach(function (k) { predictions[k] = game.predictions[k]; });
  if (predictions[OPENID] !== undefined && predictions[OPENID] !== null) return { ok: false, msg: '已提交' };

  var handSize = (game.hands[OPENID] || []).length;
  if (prediction > handSize) return { ok: false, msg: '预测超出范围，最多' + handSize };

  // 提交顺序检查
  var predOrder = game.predictionOrder || [];
  var alreadySubmitted = Object.keys(predictions).filter(function (k) { return predictions[k] !== undefined && predictions[k] !== null; });
  var nextSubmitter = predOrder.find(function (p) { return !alreadySubmitted.includes(p); });
  if (OPENID !== game.lastPredictor && nextSubmitter && OPENID !== nextSubmitter) {
    return { ok: false, msg: '还没轮到你预测' };
  }

  // 最后预测者约束
  if (OPENID === game.lastPredictor) {
    if (prediction === game.forbiddenPrediction) {
      return { ok: false, msg: '预测值不能为' + game.forbiddenPrediction };
    }
  }

  predictions[OPENID] = prediction;

  var filled = (room.seats || []).filter(function (s) { return s; });
  var allPlayerIds = filled.map(function (s) { return s.userId; });
  var remaining = allPlayerIds.filter(function (k) { return predictions[k] === undefined || predictions[k] === null; });

  var updateData = { 'game.predictions': predictions };

  if (remaining.length === 0) {
    updateData['game.phase'] = 'playing';
    var firstIdx = (game.currentRound - 1) % filled.length;
    updateData['game.currentTrick'] = {
      leadPlayer: filled[firstIdx].userId,
      leadSuit: null, cards: [], specialRule: null,
    };
  }

  // 更新 forbiddenPrediction
  var sumAll = Object.values(predictions).reduce(function (s, v) { return s + (v !== undefined && v !== null ? v : 0); }, 0);
  if (predictions[game.lastPredictor] === undefined || predictions[game.lastPredictor] === null) {
    updateData['game.forbiddenPrediction'] = game.currentRound - sumAll;
  }

  await db.collection('rooms').doc(roomId).update({ data: updateData });
  return { ok: true };
};
