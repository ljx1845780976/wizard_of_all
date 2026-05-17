const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();

  var maxPlayers = event.maxPlayers || 4;
  if (maxPlayers < 3) maxPlayers = 3;
  if (maxPlayers > 6) maxPlayers = 6;

  // 生成6位房间码（排除易混淆字符 I O 0 1）
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var code = '';
  for (var i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];

  var nickname = '玩家';
  var avatarUrl = '';
  try {
    var u = await db.collection('users').doc(OPENID).get();
    if (u.data) { nickname = u.data.nickname || nickname; avatarUrl = u.data.avatarUrl || avatarUrl; }
  } catch (e) {}

  var seats = new Array(maxPlayers);
  for (var j = 0; j < maxPlayers; j++) seats[j] = null;
  seats[0] = { userId: OPENID, nickname, avatarUrl, isOnline: true, isReady: true };

  var res = await db.collection('rooms').add({
    data: {
      roomCode: code,
      ownerId: OPENID,
      maxPlayers: maxPlayers,
      status: 'waiting',
      seats: seats,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  });

  return { ok: true, roomId: res._id, roomCode: code };
};
