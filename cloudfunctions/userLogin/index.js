const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, msg: '获取 openid 失败' };

  const usersCol = db.collection('users');
  const { data: exist } = await usersCol.doc(OPENID).get().catch(() => ({ data: null }));

  const now = Date.now();

  if (!exist) {
    // 新用户，写入默认档案
    await usersCol.add({
      data: {
        _id: OPENID,
        nickname: '',
        avatarUrl: '',
        createdAt: now,
        stats: { gamesPlayed: 0, gamesWon: 0, totalScore: 0 },
      },
    });
  }

  return {
    ok: true,
    openid: OPENID,
    isNew: !exist,
    profile: exist || {
      _id: OPENID,
      nickname: '',
      avatarUrl: '',
      createdAt: now,
      stats: { gamesPlayed: 0, gamesWon: 0, totalScore: 0 },
    },
  };
};
