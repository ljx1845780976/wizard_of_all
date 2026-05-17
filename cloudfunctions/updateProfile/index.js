const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { nickname, avatarUrl } = event;

  if (!nickname && !avatarUrl) return { ok: false, msg: '无更新内容' };

  const updateData = {};
  if (nickname) updateData.nickname = nickname;
  if (avatarUrl) updateData.avatarUrl = avatarUrl;

  await db.collection('users').doc(OPENID).update({ data: updateData });

  return { ok: true };
};
