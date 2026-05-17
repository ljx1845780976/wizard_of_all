const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { roomId } = event;

  const res = await db.collection('rooms').doc(roomId).get();
  const room = res.data;
  if (!room) return { ok: false, msg: '房间不存在' };
  if (room.ownerId !== OPENID) return { ok: false, msg: '非房主' };
  if (room.status !== 'waiting') return { ok: false, msg: '游戏已开始' };

  const seats = room.seats || [];
  const emptyIdx = seats.findIndex(s => !s);
  if (emptyIdx < 0) return { ok: false, msg: '房间已满' };

  // AI 玩家命名：电脑-A, 电脑-B, ...
  const aiCount = seats.filter(s => s && s.isAI).length;
  const names = ['A', 'B', 'C', 'D', 'E'];
  seats[emptyIdx] = {
    userId: 'ai_seat_' + emptyIdx + '_' + Date.now(),
    nickname: '电脑-' + (names[aiCount] || 'X'),
    avatarUrl: '',
    isOnline: true,
    isReady: true,
    isAI: true,
  };

  await db.collection('rooms').doc(roomId).update({
    data: { seats, updatedAt: Date.now() }
  });

  return { ok: true };
};
