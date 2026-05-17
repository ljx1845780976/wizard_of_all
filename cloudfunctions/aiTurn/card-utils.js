/** 卡牌数据常量 — 前后端共用（云函数侧引入此文件） */

const SUITS = ['sky', 'forest', 'grassland', 'ocean'];
const SPECIALS = ['human', 'ant'];

const SUIT_META = {
  sky:       { name: '天空',  emoji: '☁️', color: '#87CEEB' },
  forest:    { name: '森林',  emoji: '🌲', color: '#228B22' },
  grassland: { name: '草原',  emoji: '🌾', color: '#DAA520' },
  ocean:     { name: '海洋',  emoji: '🌊', color: '#4169E1' },
  human:     { name: '巫师',  emoji: '🧙', color: '#FFD700' },
  ant:       { name: '蚂蚁',  emoji: '🐜', color: '#8B4513' },
};

/** 生成一副完整的 60 张牌 */
function createDeck() {
  const deck = [];
  // 52 张基础牌
  SUITS.forEach(suit => {
    for (let rank = 1; rank <= 13; rank++) {
      deck.push({ suit, rank });
    }
  });
  // 8 张特殊牌
  for (let i = 0; i < 4; i++) deck.push({ suit: 'human', rank: 0 });
  for (let i = 0; i < 4; i++) deck.push({ suit: 'ant', rank: 0 });
  return deck;
}

/** Fisher-Yates 洗牌 */
function shuffle(deck) {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 比较两张牌的大小（不考虑特殊牌的人类/蚂蚁优先规则，仅按花色+数字） */
function compareCards(a, b, trumpSuit, leadSuit) {
  // 返回正数表示 a > b，负表示 a < b
  if (a.suit === b.suit) return a.rank - b.rank;
  if (a.suit === trumpSuit) return 1;
  if (b.suit === trumpSuit) return -1;
  if (a.suit === leadSuit) return 1;
  if (b.suit === leadSuit) return -1;
  return a.rank - b.rank;
}

module.exports = { SUITS, SPECIALS, SUIT_META, createDeck, shuffle, compareCards };
