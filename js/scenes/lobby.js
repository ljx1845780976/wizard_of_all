/** 大厅场景 (Canvas 2D) */
const { screenWidth, screenHeight, colors, drawButton } = require('../config');

function LobbyScene() {
  this._userInfo = null;
  this._handlers = {};
  this._buttons = [];
}

LobbyScene.prototype.init = function () {};

LobbyScene.prototype.destroy = function () {};

LobbyScene.prototype.on = function (name, fn) {
  if (!this._handlers[name]) this._handlers[name] = [];
  this._handlers[name].push(fn);
};

LobbyScene.prototype.emit = function (name, data) {
  var list = this._handlers[name];
  if (list) for (var i = 0; i < list.length; i++) list[i](data);
};

LobbyScene.prototype.setUserInfo = function (info) {
  this._userInfo = info;
};

LobbyScene.prototype.render = function (ctx) {
  var cx = screenWidth / 2;
  this._buttons = [];

  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, screenWidth, screenHeight);

  // 调试：画十字准线确认坐标
  ctx.strokeStyle = 'red';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 50, 100); ctx.lineTo(cx + 50, 100);
  ctx.moveTo(cx, 80); ctx.lineTo(cx, 120);
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 48px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('自然巫师', cx, 100);

  ctx.font = '22px sans-serif';
  ctx.fillText('多人策略卡牌对战', cx, 170);

  var btnY = 280;
  drawButton(ctx, cx - 150, btnY, 300, 68, '创建房间', { bg: '#667eea' });
  this._buttons.push({ x: cx - 150, y: btnY, w: 300, h: 68, action: 'createRoom' });

  btnY += 90;
  drawButton(ctx, cx - 150, btnY, 300, 68, '加入房间', { bg: '#444488' });
  this._buttons.push({ x: cx - 150, y: btnY, w: 300, h: 68, action: 'joinRoom' });

  btnY += 90;
  drawButton(ctx, cx - 150, btnY, 300, 68, '快速匹配', { bg: '#333355' });
  this._buttons.push({ x: cx - 150, y: btnY, w: 300, h: 68, action: 'quickMatch' });

  if (this._userInfo) {
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '20px sans-serif';
    ctx.fillText(this._userInfo.nickName || '已登录', cx, btnY + 110);
  }
};

LobbyScene.prototype.onTouchEnd = function (e) {
  var t = e.changedTouches && e.changedTouches[0];
  if (!t) return;
  var x = t.clientX, y = t.clientY;
  for (var i = 0; i < this._buttons.length; i++) {
    var b = this._buttons[i];
    console.log("hitTest", x, y, b.action, b.x, b.y, b.w, b.h); if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
      console.log("EMIT createRoom"); if (b.action === "createRoom") this.emit("createRoom");
      else if (b.action === 'quickMatch') this.emit('quickMatch');
      else if (b.action === 'joinRoom') this._promptRoomCode();
      return;
    }
  }
};

LobbyScene.prototype.onTouchStart = function () {};

LobbyScene.prototype._promptRoomCode = function () {
  var self = this;
  wx.showModal({
    title: '输入房间码',
    editable: true,
    placeholderText: '6位房间码',
    success: function (res) {
      if (res.confirm && res.content) {
        self.emit('joinRoom', res.content.trim().toUpperCase());
      }
    },
  });
};

module.exports = LobbyScene;
