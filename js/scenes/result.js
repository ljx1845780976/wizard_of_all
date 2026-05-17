/** 结算场景 (Canvas 2D) */
const { screenWidth, screenHeight, colors, drawButton } = require('../config');

function ResultScene(rankings) {
  this._rankings = rankings || [];
  this._handlers = {};
  this._buttons = [];
}

ResultScene.prototype.init = function (rankings) {
  if (rankings) this._rankings = rankings;
};

ResultScene.prototype.destroy = function () {};

ResultScene.prototype.on = function (name, fn) {
  if (!this._handlers[name]) this._handlers[name] = [];
  this._handlers[name].push(fn);
};

ResultScene.prototype.emit = function (name, data) {
  var list = this._handlers[name];
  if (list) for (var i = 0; i < list.length; i++) list[i](data);
};

ResultScene.prototype.render = function (ctx) {
  var cx = screenWidth / 2;
  this._buttons = [];

  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, screenWidth, screenHeight);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 60px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('👑', cx, 40);

  ctx.font = 'bold 36px sans-serif';
  ctx.fillText('游戏结束', cx, 110);

  // 排名列表
  var medals = ['🥇', '🥈', '🥉'];
  var listY = 170;
  var itemH = 80;
  var pad = 30;

  for (var i = 0; i < this._rankings.length; i++) {
    var r = this._rankings[i];
    var y = listY + i * (itemH + 6);

    ctx.fillStyle = i === 0 ? 'rgba(255,255,255,0.1)' :
                    i === 1 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.03)';
    var { drawRoundRect } = require('../config');
    drawRoundRect(ctx, pad, y, screenWidth - pad * 2, itemH, 12);
    ctx.fill();

    if (r.isMe) {
      ctx.strokeStyle = '#667eea';
      ctx.lineWidth = 2;
      drawRoundRect(ctx, pad, y, screenWidth - pad * 2, itemH, 12);
      ctx.stroke();
    }

    // 排名
    var rankText = i < 3 ? medals[i] : (i + 1).toString();
    ctx.fillStyle = '#ffffff';
    ctx.font = i < 3 ? '32px sans-serif' : '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(rankText, pad + 32, y + itemH / 2);

    // 昵称
    ctx.textAlign = 'left';
    ctx.font = '22px sans-serif';
    ctx.fillText((r.nickname || '玩家') + (r.isMe ? ' (你)' : ''), pad + 60, y + itemH * 0.38);

    // 准确率
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '18px sans-serif';
    ctx.fillText('预测准确 ' + r.accurateRounds + '/' + r.totalRounds + ' 回合', pad + 60, y + itemH * 0.68);

    // 分数
    var scoreStr = r.totalScore >= 0 ? '+' + r.totalScore : r.totalScore.toString();
    ctx.fillStyle = r.totalScore >= 0 ? '#2ecc71' : '#e74c3c';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(scoreStr, screenWidth - pad - 10, y + itemH / 2 + 5);
  }

  // 按钮
  var btnY = screenHeight - 200;
  var btnW = Math.min(screenWidth * 0.7, 400);
  drawButton(ctx, cx - btnW / 2, btnY, btnW, 64, '再来一局', { bg: '#667eea', fontSize: 30 });
  this._buttons.push({ x: cx - btnW / 2, y: btnY, w: btnW, h: 64, action: 'playAgain' });

  btnY += 80;
  drawButton(ctx, cx - btnW / 2, btnY, btnW, 64, '返回大厅', { bg: '#2a2a4a', fontSize: 26 });
  this._buttons.push({ x: cx - btnW / 2, y: btnY, w: btnW, h: 64, action: 'backHome' });
};

ResultScene.prototype.onTouchEnd = function (e) {
  var t = e.changedTouches && e.changedTouches[0];
  if (!t) return;
  var x = t.clientX, y = t.clientY;
  for (var i = 0; i < this._buttons.length; i++) {
    var b = this._buttons[i];
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
      this.emit(b.action);
      return;
    }
  }
};

ResultScene.prototype.onTouchStart = function () {};

module.exports = ResultScene;
