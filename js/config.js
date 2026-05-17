/** 全局配置常量 + Canvas 绘图工具 */
const sysInfo = wx.getSystemInfoSync();

const screenWidth = sysInfo.screenWidth;
const screenHeight = sysInfo.screenHeight;
const pixelRatio = sysInfo.pixelRatio;

// 卡牌尺寸
const cardWidth = Math.round(screenWidth * 0.165);
const cardHeight = Math.round(cardWidth * 1.45);
const cardGap = 6;
const trickCardWidth = Math.round(screenWidth * 0.18);

// 色板
const colors = {
  bg: '#0f0f23',
  cardBg: '#1a1a3e',
  primary: '#667eea',
  primaryDark: '#764ba2',
  white: '#e0e0e0',
  success: '#2ecc71',
  danger: '#e74c3c',
  gold: '#ffd700',
  overlay: 'rgba(0,0,0,0.6)',
};

// ========== Canvas 绘图工具 ==========

/** 绘制圆角矩形路径 */
function drawRoundRect(ctx, x, y, w, h, r) {
  r = r || 10;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** 绘制一个按钮，返回按钮 bounds */
function drawButton(ctx, x, y, w, h, text, opts) {
  opts = opts || {};
  var bg = opts.bg || '#667eea';
  var color = opts.color || '#ffffff';
  var fontSize = opts.fontSize || Math.round(h * 0.38);
  var radius = opts.radius || 12;

  ctx.fillStyle = bg;
  drawRoundRect(ctx, x, y, w, h, radius);
  ctx.fill();

  ctx.fillStyle = color;
  ctx.font = 'bold ' + fontSize + 'px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2);
}

/** 绘制一张卡牌 */
function drawCard(ctx, x, y, w, h, suit, rank, opts) {
  opts = opts || {};
  var SUIT_META = require('./utils/card-constants').SUIT_META;
  var meta = SUIT_META[suit] || { emoji: '?', color: '#999' };

  // 背景
  ctx.fillStyle = colors.cardBg;
  drawRoundRect(ctx, x, y, w, h, 8);
  ctx.fill();

  // 边框
  if (opts.playable) {
    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = 3;
  } else if (opts.selected) {
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 3;
  } else {
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
  }
  drawRoundRect(ctx, x, y, w, h, 8);
  ctx.stroke();

  // 卡面内容
  if (suit === 'human' || suit === 'ant') {
    ctx.fillStyle = meta.color;
    ctx.font = Math.round(w * 0.55) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(meta.emoji, x + w / 2, y + h / 2);
  } else {
    // 左上角
    var corner = Math.round(w * 0.22);
    ctx.fillStyle = '#ffffff';
    ctx.font = corner + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(meta.emoji, x + Math.round(w * 0.1), y + Math.round(h * 0.08));
    ctx.fillText(rank, x + Math.round(w * 0.1), y + Math.round(h * 0.08) + corner + 4);

    // 中间 emoji
    ctx.fillStyle = meta.color;
    ctx.font = Math.round(w * 0.4) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(meta.emoji, x + w / 2, y + h * 0.45);

    // 数字
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold ' + Math.round(w * 0.28) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(rank, x + w / 2, y + h * 0.72);
  }
}

module.exports = {
  screenWidth, screenHeight, pixelRatio,
  cardWidth, cardHeight, cardGap, trickCardWidth,
  colors,
  drawRoundRect, drawButton, drawCard,
};
