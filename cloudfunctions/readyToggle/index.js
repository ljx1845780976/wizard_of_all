const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { roomId } = event;

  const res = await db.collection('rooms').doc(roomId).get();
  const room = res.data;
  if (!room || room.status !== 'waiting') return { ok: false };

  const seats = room.seats || [];
  const seat = seats.find(s => s && s.userId === OPENID);
  if (!seat || seat.userId === room.ownerId) return { ok: false }; // 房主默认已准备

  seat.isReady = !seat.isReady;
  await db.collection('rooms').doc(roomId).update({ data: { seats, updatedAt: Date.now() } });
  return { ok: true };
};
