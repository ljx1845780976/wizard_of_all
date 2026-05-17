/** 游戏房间场景 (Canvas 2D) - 响应式修复版 */
const { screenWidth, screenHeight, cardWidth, cardHeight, cardGap, trickCardWidth, colors, drawRoundRect, drawButton, drawCard } = require('../config');
const { SUIT_META } = require('../utils/card-constants');

function RoomScene() {
  this._timeoutFired = false;
  this._lastPhase = null;
  this._handlers = {};
  this._myId = '';
  this._status = 'waiting';
  this._seats = [];
  this._room = null;
  this._game = null;
  this._hitAreas = [];
}

RoomScene.prototype.on = function (name, fn) {
  if (!this._handlers[name]) this._handlers[name] = [];
  this._handlers[name].push(fn);
};

RoomScene.prototype.emit = function (name, data) {
  var list = this._handlers[name];
  if (list) for (var i = 0; i < list.length; i++) list[i](data);
};

RoomScene.prototype.init = function () {};
RoomScene.prototype.destroy = function () {};

RoomScene.prototype.applyRoomData = function (room, myId) { 
  this._room = room;
  this._myId = myId;
  this._status = room.status;
  this._seats = (room.seats || []).filter(function (s) { return s; });

  if (room.status === 'finished') {
    this.emit('gameOver', room);
  }
};

RoomScene.prototype.render = function (ctx) {
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, screenWidth, screenHeight);

  this._hitAreas = [];
  this._drawTopBar(ctx);

  var room = this._room;
  if (!room) return;

  // 倒计时 + 超时处理
  if (room.game && room.game.phaseDeadline) {
    var now = Date.now();
    var deadline = room.game.phaseDeadline;
    var remaining = Math.max(0, Math.ceil((deadline - now) / 1000));

    // 显示倒计时
    ctx.fillStyle = remaining <= 5 ? '#e74c3c' : 'rgba(255,255,255,0.5)';
    ctx.font = '18px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(remaining + 's', screenWidth - 14, 64);

    // 超时自动提交
    if (remaining <= 0 && !this._timeoutFired) {
      this._timeoutFired = true;
      var game = room.game;
      var myId = this._myId;
      if (game.phase === 'predicting') {
        var pred = game.predictions && game.predictions[myId];
        if (pred === undefined || pred === null) {
          this.emit('submitPrediction', 0);
        }
      } else if (game.phase === 'playing' && this._isMyTurn(game, myId)) {
        var hand = game.hands && game.hands[myId] || [];
        if (hand.length > 0) {
          // 出第一张合法牌
          var card = findFirstLegal(hand, game.currentTrick);
          if (card) this.emit('playCard', card);
        }
      }
    }
    // 阶段变化时重置
    if (this._lastPhase && this._lastPhase !== room.game.phase) {
      this._timeoutFired = false;
    }
    this._lastPhase = room.game.phase;
  }

  if (room.status === 'waiting') {
    this._drawWaiting(ctx);
  } else if (room.status === 'playing' && room.game) {
    this._drawPlaying(ctx);
  }
};

// ==================== 顶栏 ====================
RoomScene.prototype._drawTopBar = function (ctx) {
  var room = this._room;

  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(0, 0, screenWidth, 60);

  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '20px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('房间 ' + (room ? room.roomCode : '--'), 14, 30);

  if (room && room.status === 'playing' && room.game) {
    var g = room.game;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('第 ' + g.currentRound + '/' + g.totalRounds + ' 回合', screenWidth / 2, 22);

    if (g.trumpSuit) {
      var meta = SUIT_META[g.trumpSuit];
      ctx.font = '18px sans-serif';
      ctx.fillStyle = '#FFD700';
      ctx.fillText('王牌: ' + (meta ? meta.emoji : ''), screenWidth / 2, 46);
    } else {
      ctx.font = '18px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText('无王牌', screenWidth / 2, 46);
    }
  }

  drawButton(ctx, screenWidth - 86, 10, 76, 40, '退出', { bg: 'rgba(80,50,50,0.7)', fontSize: 18, radius: 8 });
  this._hitAreas.push({ x: screenWidth - 86, y: 10, w: 76, h: 40, action: 'leave' });
};

// ==================== 等待状态 ====================
RoomScene.prototype._drawWaiting = function (ctx) {
  var room = this._room;
  var myId = this._myId;
  var isOwner = room.ownerId === myId;
  var cx = screenWidth / 2;

  // 修复：改为2x2网格，宽度自适应屏幕
  var maxP = room.maxPlayers || 4;
  var cols = 2; 
  var gap = 16;
  var seatW = (screenWidth - gap * 3) / 2; // 动态计算宽度
  var seatH = 120;
  var gridW = cols * seatW + (cols - 1) * gap;
  var startX = (screenWidth - gridW) / 2;
  var startY = 90;
  var seats = room.seats || [];

  for (var i = 0; i < maxP; i++) {
    var col = i % cols;
    var row = Math.floor(i / cols);
    var sx = startX + col * (seatW + gap);
    var sy = startY + row * (seatH + gap);
    var slot = seats[i];

    ctx.fillStyle = slot ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)';
    drawRoundRect(ctx, sx, sy, seatW, seatH, 14);
    ctx.fill();

    if (slot && slot.userId === myId) {
      ctx.strokeStyle = '#667eea';
      ctx.lineWidth = 2;
      drawRoundRect(ctx, sx, sy, seatW, seatH, 14);
      ctx.stroke();
    }

    if (slot) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '18px sans-serif'; // 缩小字体防溢出
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      // 截断过长的名字
      var nick = slot.nickname || '玩家';
      if (nick.length > 5) nick = nick.substring(0, 5) + '..';
      ctx.fillText(nick, sx + seatW / 2, sy + 30);

      if (slot.userId === room.ownerId) {
        ctx.fillStyle = 'rgba(102,126,234,0.25)';
        drawRoundRect(ctx, sx + seatW / 2 - 26, sy + 62, 52, 20, 6);
        ctx.fill();
        ctx.fillStyle = '#667eea';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('房主', sx + seatW / 2, sy + 72);
      }

	      if (slot.isAI) {
	        ctx.fillStyle = "rgba(255,200,0,0.2)";
	        drawRoundRect(ctx, sx + seatW / 2 - 26, sy + 86, 52, 20, 6);
	        ctx.fill();
	        ctx.fillStyle = "#FFC107";
	        ctx.font = "12px sans-serif";
	        ctx.textAlign = "center";
	        ctx.textBaseline = "middle";
	        ctx.fillText("电脑", sx + seatW / 2, sy + 96);
	      } else
      if (slot.isReady) {
        ctx.fillStyle = 'rgba(46,204,113,0.2)';
        drawRoundRect(ctx, sx + seatW / 2 - 26, sy + 86, 52, 20, 6);
        ctx.fill();
        ctx.fillStyle = '#2ecc71';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('已准备', sx + seatW / 2, sy + 96);
      } else if (slot.userId === myId) {
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        drawRoundRect(ctx, sx + seatW / 2 - 16, sy + 86, 32, 20, 6);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('你', sx + seatW / 2, sy + 96);
      }
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('虚位以待', sx + seatW / 2, sy + seatH / 2);
    }
  }

  var btnY = screenHeight - 120;
  var mySlot = seats.find(function (s) { return s && s.userId === myId; });

  if (isOwner) {
    var filled = seats.filter(function (s) { return s; }).length;
    var allReady = seats.filter(function (s) { return s; }).every(function (s) { return s.isReady; });
    var canStart = filled >= 3 && allReady;
    var label = canStart ? '开始游戏' : (filled < 3 ? '等待玩家 (' + filled + '/' + maxP + ')' : '等待准备');
    drawButton(ctx, cx - 120, btnY, 240, 56, label, { bg: canStart ? '#667eea' : '#333355' });
    if (canStart) this._hitAreas.push({ x: cx - 120, y: btnY, w: 240, h: 56, action: 'startGame' });
  } else if (mySlot) {
    var readyLabel = mySlot.isReady ? '取消准备' : '准备';
    drawButton(ctx, cx - 120, btnY, 240, 56, readyLabel, { bg: mySlot.isReady ? '#444466' : '#667eea' });
    this._hitAreas.push({ x: cx - 120, y: btnY, w: 240, h: 56, action: 'readyToggle' });
  }

  // 添加电脑按钮（房主可见，有空位时显示）
  if (isOwner) {
    var emptyCount = maxP - seats.filter(function (s) { return s; }).length;
    if (emptyCount > 0) {
      btnY += 66;
      drawButton(ctx, cx - 110, btnY, 220, 48, '添加电脑 (' + emptyCount + ')', { bg: '#4a4a6a', fontSize: 20 });
      this._hitAreas.push({ x: cx - 110, y: btnY, w: 220, h: 48, action: 'addAI' });
    }
  }
};

// ==================== 游戏状态 ====================
RoomScene.prototype._drawPlaying = function (ctx) {
  var game = this._room.game;
  this._game = game;
  var myId = this._myId;
  var seats = this._seats;
  var cx = screenWidth / 2;

  // ---- 对手区 ----
  var others = seats.filter(function (s) { return s.userId !== myId; });
  var oppW = Math.min(120, (screenWidth - 24) / Math.max(others.length, 1)); // 动态缩小对手框
  var oppStartX = (screenWidth - (others.length * oppW + (others.length - 1) * 8)) / 2;

  others.forEach(function (s, i) {
    var x = oppStartX + i * (oppW + 8);
    var y = 72;

    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    drawRoundRect(ctx, x, y, oppW, 64, 10);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var nick = s.nickname || '玩家';
    ctx.fillText(nick.substring(0,4), x + oppW/2, y + 8);

    var pred = game.predictions && game.predictions[s.userId] !== undefined ? game.predictions[s.userId] : '?';
    var won = game.tricksWon && game.tricksWon[s.userId] || 0;
    var scr = game.scores && game.scores[s.userId] || 0;
    
    ctx.fillStyle = '#FFD700';
    ctx.font = '12px sans-serif';
    ctx.fillText('分:' + scr + ' 测:' + pred + ' 赢:' + won, x + oppW/2, y + 34);
  });

  // ---- 牌桌 (当前出牌) ----
  if (game.currentTrick && game.currentTrick.cards && game.currentTrick.cards.length > 0) {
    var trickCards = game.currentTrick.cards;
    var trickY = 160;
    var totalW = trickCards.length * trickCardWidth + (trickCards.length - 1) * 8;
    var startX = (screenWidth - totalW) / 2;

    trickCards.forEach(function (c, i) {
      var tx = startX + i * (trickCardWidth + 8);
      drawCard(ctx, tx, trickY, trickCardWidth, trickCardWidth * 1.45, c.suit, c.rank);

      var seat = seats.find(function (s) { return s.userId === c.userId; });
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      var name = seat ? seat.nickname.substring(0,3) : '?';
      ctx.fillText(name, tx + trickCardWidth / 2, trickY + trickCardWidth * 1.45 + 8);
    });
  }

  // ---- 阶段提示 ----
  var phaseText = '';
  if (game.phase === 'predicting') {
    var myPred = game.predictions && game.predictions[myId];
    phaseText = (myPred !== undefined && myPred !== null) ? '等待其他玩家预测...' : '预测你能赢几墩';
  } else if (game.phase === 'playing') {
    phaseText = this._isMyTurn(game, myId) ? '轮到你了！' : '等待出牌...';
  } else if (game.phase === 'round_result') {
    phaseText = '回合结算中...';
  }

  var phaseY = 280;
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(phaseText, cx, phaseY);

  // ---- 我的手牌 (修复重叠问题) ----
  var myHand = (game.hands && game.hands[myId]) || [];
  var handY = screenHeight - cardHeight - 20;
  
  // 核心修复：根据牌的数量自动调整间距（叠牌）
  var maxHandArea = screenWidth - 20;
  var currentGap = cardWidth + 5; 
  if (myHand.length > 1) {
    currentGap = Math.min(currentGap, (maxHandArea - cardWidth) / (myHand.length - 1));
  }
  var totalHandW = (myHand.length - 1) * currentGap + cardWidth;
  var handStartX = (screenWidth - totalHandW) / 2;
  var isMyTurn = this._isMyTurn(game, myId);

  myHand.forEach(function (c, i) {
    var hx = handStartX + i * currentGap;
    var playable = isMyTurn && game.phase === 'playing' && canPlayCard(c, game, myId);
    
    // 如果是最后一张牌，可点击区域是整张牌；否则只是露出来的边缘宽度
    var hitWidth = (i === myHand.length - 1) ? cardWidth : currentGap;

    drawCard(ctx, hx, handY, cardWidth, cardHeight, c.suit, c.rank, { playable: playable });
    if (playable) {
      this._hitAreas.push({ x: hx, y: handY, w: hitWidth, h: cardHeight, action: 'playCard', card: c });
    }
  }.bind(this));

  // ---- 预测选择器 (修复超出屏幕问题) ----
  if (game.phase === 'predicting') {
    var pred = game.predictions && game.predictions[myId];
    if (pred === undefined || pred === null) {
      this._drawPredictionPicker(ctx, game, myId, myHand.length);
    }
  }

  // ---- 回合结果弹窗 ----
  if (game.phase === 'round_result' && game.roundHistory && game.roundHistory.length > 0) {
    this._drawRoundResult(ctx, game);
  }
};

// ==================== 辅助 ====================

RoomScene.prototype._isMyTurn = function (game, myId) {
  if (game.phase !== 'playing') return false;
  var trick = game.currentTrick;
  if (!trick) return true;
  var played = (trick.cards || []).length;
  var seats = this._seats;
  var leadIdx = seats.findIndex(function (s) { return s.userId === trick.leadPlayer; });
  if (leadIdx < 0) return false;
  return seats[(leadIdx + played) % seats.length] && seats[(leadIdx + played) % seats.length].userId === myId;
};

function canPlayCard(card, game, myId) {
  var trick = game.currentTrick;
  if (!trick) return true;
  if (card.suit === 'human' || card.suit === 'ant') return true;
  if (!trick.leadSuit) return true;
  var myHand = (game.hands && game.hands[myId]) || [];
  var hasLead = myHand.some(function (c) { return c.suit === trick.leadSuit && c.suit !== 'human' && c.suit !== 'ant'; });
  if (hasLead && card.suit !== trick.leadSuit) return false;
  return true;
}

// 核心修复：预测选择器自动换行
RoomScene.prototype._drawPredictionPicker = function (ctx, game, myId, handSize) {
  var numSize = 50, numGap = 10;
  var options = [];
  for (var n = 0; n <= handSize; n++) options.push(n);

  // 计算最大列数和行数
  var maxCols = Math.floor((screenWidth - 40) / (numSize + numGap));
  var totalRows = Math.ceil(options.length / maxCols);
  
  // 整体居中计算
  var pickerAreaH = totalRows * numSize + (totalRows - 1) * numGap;
  var pickerY = screenHeight - cardHeight - pickerAreaH - 40; // 放在手牌上方
  var cx = screenWidth / 2;
  var forbidden = game.forbiddenPrediction;

  options.forEach(function (n, i) {
    var col = i % maxCols;
    var row = Math.floor(i / maxCols);
    
    // 让最后一行自动居中对齐
    var currentRowItems = (row === totalRows - 1 && options.length % maxCols !== 0) ? options.length % maxCols : maxCols;
    var rowW = currentRowItems * numSize + (currentRowItems - 1) * numGap;
    var startX = (screenWidth - rowW) / 2;

    var nx = startX + col * (numSize + numGap);
    var ny = pickerY + row * (numSize + numGap);

    ctx.fillStyle = (forbidden !== null && n === forbidden) ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.08)';
    drawRoundRect(ctx, nx, ny, numSize, numSize, 10);
    ctx.fill();

    ctx.fillStyle = (forbidden !== null && n === forbidden) ? 'rgba(255,255,255,0.15)' : '#ffffff';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(n.toString(), nx + numSize / 2, ny + numSize / 2);

    if (!(forbidden !== null && n === forbidden)) {
      this._hitAreas.push({ x: nx, y: ny, w: numSize, h: numSize, action: 'submitPrediction', value: n });
    }
  }.bind(this));
};

RoomScene.prototype._drawRoundResult = function (ctx, game) {
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, screenWidth, screenHeight);

  var last = game.roundHistory[game.roundHistory.length - 1];
  if (!last) return;

  var modalW = screenWidth * 0.85, modalH = 280;
  var mx = (screenWidth - modalW) / 2, my = (screenHeight - modalH) / 2;
  var cx = screenWidth / 2;

  ctx.fillStyle = '#1a1a3e';
  drawRoundRect(ctx, mx, my, modalW, modalH, 16);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('第 ' + game.currentRound + ' 回合结束', cx, my + 24);

  this._seats.forEach(function (s, i) {
    var y = my + 70 + i * 36;
    var pred = last.predictions[s.userId];
    var actual = last.actual[s.userId];
    var score = last.scores[s.userId];
    var sign = score >= 0 ? '+' : '';
    ctx.fillStyle = score >= 0 ? '#2ecc71' : '#e74c3c';
    ctx.font = '18px sans-serif';
    ctx.textAlign = 'center';
    
    // 缩短文字以适应手机屏幕
    var txt = s.nickname.substring(0,4) + ' | 测' + pred + '赢' + actual + ' | ' + sign + score + '分';
    ctx.fillText(txt, cx, y);
  });

  if (game.phase === 'game_over') {
    drawButton(ctx, cx - 100, my + modalH - 60, 200, 44, '查看结果', { bg: '#667eea' });
    this._hitAreas.push({ x: cx - 100, y: my + modalH - 60, w: 200, h: 44, action: 'showResult' });
  }
};

// ==================== 触摸事件 ====================

RoomScene.prototype.onTouchEnd = function (e) {
  var t = e.changedTouches && e.changedTouches[0];
  if (!t) return;
  var x = t.clientX, y = t.clientY;
  // 反向遍历 hitAreas，确保重叠时（比如手牌）点到的是最上面的一张
  for (var i = this._hitAreas.length - 1; i >= 0; i--) {
    var h = this._hitAreas[i];
    if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
      if (h.action === 'leave') this.emit('leaveRoom');
      else if (h.action === 'startGame') this.emit('startGame');
      else if (h.action === 'readyToggle') this.emit('readyToggle');
      else if (h.action === 'submitPrediction') this.emit('submitPrediction', h.value);
      else if (h.action === 'playCard') this.emit('playCard', h.card);
      else if (h.action === 'addAI') this.emit('addAI');
      else if (h.action === 'showResult') this.emit('gameOver', this._room);
      return;
    }
  }
};

RoomScene.prototype.onTouchStart = function () {};

module.exports = RoomScene;

function findFirstLegal(hand, trick) {
  if (!trick || !trick.leadSuit) return hand[0];
  var legal = hand.filter(function (c) {
    if (c.suit === "human" || c.suit === "ant") return true;
    if (c.suit === trick.leadSuit) return true;
    return !hand.some(function (h) { return h.suit === trick.leadSuit && h.suit !== "human" && h.suit !== "ant"; });
  });
  return legal[0] || hand[0];
}
