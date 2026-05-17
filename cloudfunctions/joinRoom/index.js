const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { roomCode } = event;

  if (!roomCode || roomCode.length < 4) return { ok: false, msg: '房间码无效' };

  // 查找房间
  const res = await db.collection('rooms').where({ roomCode: roomCode.toUpperCase() }).get();
  if (!res.data.length) return { ok: false, msg: '房间不存在' };

  const room = res.data[0];
  if (room.status !== 'waiting') return { ok: false, msg: '游戏已开始' };

  // 检查是否已在房间
  const alreadyIn = (room.seats || []).find(s => s && s.userId === OPENID);
  if (alreadyIn) return { ok: true, roomId: room._id };

  // 找空位
  const seats = room.seats || [];
  const emptyIdx = seats.findIndex(s => !s);
  if (emptyIdx < 0) return { ok: false, msg: '房间已满' };

  // 获取用户信息
  let nickname = '玩家';
  let avatarUrl = '';
  try {
    const u = await db.collection('users').doc(OPENID).get();
    if (u.data) { nickname = u.data.nickname || nickname; avatarUrl = u.data.avatarUrl || avatarUrl; }
  } catch (e) {}

  seats[emptyIdx] = { userId: OPENID, nickname, avatarUrl, isOnline: true, isReady: false };

  await db.collection('rooms').doc(room._id).update({
    data: { seats, updatedAt: Date.now() }
  });

  return { ok: true, roomId: room._id };
};
