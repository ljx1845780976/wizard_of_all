/**
 * 游戏主逻辑 — Canvas 2D 渲染 / 场景管理 / 云开发
 */
var config = require('./config');
var screenWidth = config.screenWidth;
var screenHeight = config.screenHeight;
var pixelRatio = config.pixelRatio;
var colors = config.colors;
var LobbyScene = require('./scenes/lobby');
var RoomScene = require('./scenes/room');
var ResultScene = require('./scenes/result');

// ==================== 1. Canvas 设置 ====================
var canvas = globalThis.canvas;
var ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = true;

// ==================== 2. 云开发 ====================
wx.cloud.init({ env: 'cloud1-d9gcxen1a33413d6d', traceUser: true });
var db = wx.cloud.database();

// ==================== 3. 场景管理器 ====================
var currentScene = null;
var roomWatcher = null;

function switchScene(SceneClass, params) {
  if (roomWatcher) { roomWatcher.close(); roomWatcher = null; }
  if (currentScene && currentScene.destroy) currentScene.destroy();
  currentScene = new SceneClass(params);
  if (currentScene.init) currentScene.init(params);
  return currentScene;
}

// ==================== 4. 主循环 ====================
function gameLoop() {
  ctx.clearRect(0, 0, screenWidth, screenHeight);
  if (currentScene && currentScene.render) currentScene.render(ctx);
  requestAnimationFrame(gameLoop);
}

// ==================== 5. 触摸事件 ====================
wx.onTouchStart(function (e) {
  if (currentScene && currentScene.onTouchStart) currentScene.onTouchStart(e);
});

wx.onTouchEnd(function (e) {
  if (currentScene && currentScene.onTouchEnd) currentScene.onTouchEnd(e);
});

// ==================== 6. 用户信息 & 登录 ====================
var userInfo = null;
var openid = '';

function doLogin() {
  wx.login({
    success: function () {
      wx.cloud.callFunction({
        name: 'userLogin',
        success: function (res) {
          console.log('userLogin response:', JSON.stringify(res));
          var r = res.result || res;
          if (r && r.ok) openid = r.openid;
        },
        fail: function (e) {
          console.log('userLogin error:', JSON.stringify(e));
        }
      });
    },
  });
}

// ==================== 7. 场景事件绑定 ====================

function goLobby() {
  var scene = switchScene(LobbyScene);

  if (!userInfo) {
    userInfo = { nickName: '游客' + Math.floor(Math.random() * 9000 + 1000) };
  }
  scene.setUserInfo(userInfo);

  scene.on('createRoom', function () {
    wx.showActionSheet({
      itemList: ['3 人', '4 人', '5 人', '6 人'],
      success: function (res) {
        var playerCount = res.tapIndex + 3;
        wx.showLoading({ title: '创建中...' });
        wx.cloud.callFunction({
          name: 'createRoom',
          data: { maxPlayers: playerCount },
          success: function (res2) {
            wx.hideLoading();
            var r = res2.result || res2;
            if (r && r.ok) goRoom(r.roomId, true);
            else wx.showToast({ title: (r && r.msg) || '创建失败', icon: 'none' });
          },
          fail: function () {
            wx.hideLoading();
            wx.showToast({ title: '创建失败', icon: 'none' });
          }
        });
      }
    });
      }
    );



  scene.on('quickMatch', function () {
    wx.showToast({ title: '匹配功能开发中', icon: 'none' });
  });

  scene.on('joinRoom', function (code) {
    console.log('>>> calling joinRoom:', code);
    wx.showLoading({ title: '加入中...' });
    wx.cloud.callFunction({
      name: 'joinRoom',
      data: { roomCode: code },
      success: function (res) {
        console.log('joinRoom response:', JSON.stringify(res));
        wx.hideLoading();
        var r = res.result || res;
        if (r && r.ok) goRoom(r.roomId, false);
        else wx.showToast({ title: (r && r.msg) || '加入失败', icon: 'none' });
      },
      fail: function (e) {
        console.log('joinRoom error:', JSON.stringify(e));
        wx.hideLoading();
        wx.showToast({ title: '加入失败', icon: 'none' });
      }
    });
  });
}

function goRoom(roomId, isOwner) {
  console.log('goRoom:', roomId);
  var scene = switchScene(RoomScene);

  roomWatcher = db.collection('rooms').doc(roomId).watch({
    onChange: function (snapshot) { console.log("watcher onChange", snapshot.docs.length);
      var room = snapshot.docs[0];
      if (!room) { wx.showToast({ title: '房间不存在', icon: 'none' }); goLobby(); return; }
      if (room.status === 'finished') { goResult(room); return; }
      scene.applyRoomData(room, openid);
    },
    onError: function () { wx.showToast({ title: '连接中断', icon: 'none' }); },
  });


  scene.on("leaveRoom", function () {
    wx.cloud.callFunction({ name: "leaveRoom", data: { roomId: roomId } });
    goLobby();
  });
  scene.on("startGame", function () {
    console.log('>>> startGame clicked');
    wx.showLoading({ title: '开始中...' });
    wx.cloud.callFunction({
      name: "startGame",
      data: { roomId: roomId },
      success: function (res) {
        console.log('startGame success:', JSON.stringify(res));
        var r = res.result || res;
        if (r && r.ok) { wx.hideLoading(); return; }
        wx.hideLoading();
        wx.showToast({ title: (r && r.msg) || '开始失败', icon: 'none' });
      },
      fail: function (e) {
        console.log('startGame fail:', JSON.stringify(e));
        wx.hideLoading();
        wx.showToast({ title: '开始失败', icon: 'none' });
      }
    });
  });
  scene.on("readyToggle", function () {
    wx.cloud.callFunction({ name: "readyToggle", data: { roomId: roomId } });
  });
  scene.on("submitPrediction", function (prediction) {
    wx.cloud.callFunction({
      name: "submitPrediction",
      data: { roomId: roomId, prediction: prediction },
      success: function () {}
    });
  });
  scene.on("playCard", function (card) {
    wx.cloud.callFunction({
      name: "playCard",
      data: { roomId: roomId, card: card },
      success: function () {}
    });
  });
  scene.on("gameOver", function (room) { goResult(room); });
  scene.on("addAI", function () {
    console.log('>>> addAI clicked');
    wx.cloud.callFunction({
      name: "addAI",
      data: { roomId: roomId },
      success: function (res) { console.log('addAI success:', JSON.stringify(res)); },
      fail: function (e) { console.log('addAI fail:', JSON.stringify(e)); }
    });
  });
}

function goResult(room) {
  if (roomWatcher) { roomWatcher.close(); roomWatcher = null; }
  var seats = (room.seats || []).filter(function (s) { return s; });
  var game = room.game || {};
  var scores = game.scores || {};
  var rankings = seats.map(function (s) {
    return {
      userId: s.userId, nickname: s.nickname, avatarUrl: s.avatarUrl,
      totalScore: scores[s.userId] || 0, isMe: s.userId === openid,
      accurateRounds: 0, totalRounds: game.totalRounds || 0,
    };
  }).sort(function (a, b) { return b.totalScore - a.totalScore; });
  if (game.roundHistory) {
    rankings.forEach(function (r) {
      r.accurateRounds = game.roundHistory.filter(function (h) {
        return h.predictions[r.userId] === h.actual[r.userId];
      }).length;
    });
  }
  var scene = switchScene(ResultScene, rankings);
  scene.on('playAgain', function () {
    wx.cloud.callFunction({
      name: 'createRoom',
      success: function (res) {
        var r = res.result || res;
        if (r && r.ok) goRoom(r.roomId, true);
        else goLobby();
      },
      fail: function () { goLobby(); }
    });
  });
  scene.on('backHome', function () { goLobby(); });
}

// ==================== 8. 启动 ====================
doLogin();
requestAnimationFrame(gameLoop);
goLobby();
