const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { roomId } = event;

  if (!roomId) return { ok: false, msg: '缺少 roomId' };

  const res = await db.collection('rooms').doc(roomId).get();
  const room = res.data;
  if (!room) return { ok: false, msg: '房间不存在' };

  const seats = room.seats || [];
  const idx = seats.findIndex(s => s && s.userId === OPENID);
  if (idx < 0) return { ok: false, msg: '不在房间中' };

  // 如果游戏进行中，标记离线而非踢出
  if (room.status === 'playing') {
    seats[idx].isOnline = false;
    await db.collection('rooms').doc(roomId).update({ data: { seats, updatedAt: Date.now() } });
    return { ok: true };
  }

  // 清除座位
  seats[idx] = null;

  // 如果全员退出或房主离开且无人接管
  const active = seats.filter(s => s);
  if (active.length === 0) {
    await db.collection('rooms').doc(roomId).remove();
    return { ok: true };
  }

  // 如果房主离开，转移房主
  let ownerId = room.ownerId;
  if (OPENID === room.ownerId) {
    ownerId = active[0].userId;
    active[0].isReady = true;
  }

  await db.collection('rooms').doc(roomId).update({
    data: { seats, ownerId, updatedAt: Date.now() }
  });

  return { ok: true };
};
