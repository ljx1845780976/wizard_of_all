/**
 * AI 决策模块 — 中等难度
 * 供 playCard / submitPrediction 云函数引用
 */

/**
 * AI 预测：基于手牌估值估算赢墩数
 * @param {Array} hand - AI 手牌 [{ suit, rank }, ...]
 * @param {number|null} trumpSuit - 本场王牌色
 * @param {number|null} forbiddenVal - 禁止预测的值
 * @returns {number} 预测的赢墩数 [0, hand.length]
 */
function aiPredict(hand, trumpSuit, forbiddenVal) {
  const handSize = hand.length;
  let trumpCount = 0;
  let highCount = 0;  // rank >= 10

  for (let i = 0; i < hand.length; i++) {
    const c = hand[i];
    if (c.suit === trumpSuit) trumpCount++;
    if (c.rank >= 10) highCount++;
  }

  // 基础概率 20% + 王牌加权 15% + 大牌加权 12%
  let estimate = Math.round(handSize * 0.2 + trumpCount * 0.25 + highCount * 0.15);
  estimate = Math.max(0, Math.min(handSize, estimate));

  // 避开禁止值
  if (forbiddenVal !== null && estimate === forbiddenVal) {
    estimate = forbiddenVal > 0 ? estimate - 1 : estimate + 1;
    estimate = Math.max(0, Math.min(handSize, estimate));
  }

  return estimate;
}

/**
 * 筛选合法出牌
 * @param {Array} hand - AI 手牌
 * @param {Object} trick - 当前 trick { leadSuit, cards, specialRule }
 * @returns {Array} 合法手牌索引
 */
function getLegalPlays(hand, trick) {
  if (!trick || !trick.leadSuit) {
    // 引牌人，任意出
    return hand.map((_, i) => i);
  }

  // 检查手牌中是否有引色（排除人类/蚂蚁）
  const hasLeadSuit = hand.some(c => c.suit === trick.leadSuit && c.suit !== 'human' && c.suit !== 'ant');

  if (!hasLeadSuit) {
    // 没有引色，可出任意
    return hand.map((_, i) => i);
  }

  // 有引色，必须出引色 或 人类/蚂蚁
  return hand.reduce((arr, c, i) => {
    if (c.suit === trick.leadSuit || c.suit === 'human' || c.suit === 'ant') arr.push(i);
    return arr;
  }, []);
}

/**
 * AI 出牌：中等难度
 * 策略：优先出最小合法牌（尽量避免赢墩），除非手中有蚂蚁牌可用来免掉不想赢的墩
 * @param {Array} hand - 当前手牌 [{ suit, rank }]
 * @param {Object} trick - 当前 trick
 * @param {string|null} trumpSuit - 王牌色
 * @returns {Object} 选中的牌 { suit, rank }
 */
function aiPlayCard(hand, trick, trumpSuit) {
  const legalIdx = getLegalPlays(hand, trick);
  if (legalIdx.length === 0) return hand[0]; // fallback

  const legalCards = legalIdx.map(i => ({ idx: i, card: hand[i] }));

  // 如果引牌，不急着出人类/蚂蚁
  if (!trick.leadSuit) {
    // 引牌：出最低的普通牌
    const normalCards = legalCards.filter(c => c.card.suit !== 'human' && c.card.suit !== 'ant');
    if (normalCards.length > 0) {
      normalCards.sort((a, b) => a.card.rank - b.card.rank);
      return normalCards[0].card;
    }
    // 只有人类/蚂蚁，出蚂蚁（输）
    const ant = legalCards.find(c => c.card.suit === 'ant');
    if (ant) return ant.card;
    return legalCards[0].card;
  }

  // 跟牌：找出当前牌桌上最大的牌
  const tableCards = trick.cards || [];
  let bestCard = null;
  for (let i = 0; i < tableCards.length; i++) {
    const tc = tableCards[i];
    if (tc.suit === 'human') return legalCards[0].card; // 已有人类牌，必输，随便出
    if (!bestCard || cardPower(tc, trumpSuit, trick.leadSuit) > cardPower(bestCard, trumpSuit, trick.leadSuit)) {
      bestCard = tc;
    }
  }

  // 检查是否有能赢 bestCard 的牌
  const winningCards = legalCards.filter(c => {
    if (c.card.suit === 'ant') return false;
    return cardPower(c.card, trumpSuit, trick.leadSuit) > cardPower(bestCard, trumpSuit, trick.leadSuit);
  });

  if (winningCards.length > 0) {
    // 有能赢的——出刚好能赢的最小牌
    winningCards.sort((a, b) => cardPower(a.card, trumpSuit, trick.leadSuit) - cardPower(b.card, trumpSuit, trick.leadSuit));
    return winningCards[0].card;
  }

  // 不能赢——出最低合法牌，或者出蚂蚁
  const ant = legalCards.find(c => c.card.suit === 'ant');
  if (ant) return ant.card;

  const normalLegal = legalCards.filter(c => c.card.suit !== 'human');
  if (normalLegal.length > 0) {
    normalLegal.sort((a, b) => cardPower(a.card, trumpSuit, trick.leadSuit) - cardPower(b.card, trumpSuit, trick.leadSuit));
    return normalLegal[0].card;
  }

  return legalCards[0].card;
}

/** 牌力值：王牌色 > 引色 > 其他，同色比数字 */
function cardPower(card, trumpSuit, leadSuit) {
  if (card.suit === 'human') return 1000;
  if (card.suit === 'ant') return -1000;
  let power = card.rank;
  if (card.suit === trumpSuit) power += 500;
  else if (card.suit === leadSuit) power += 200;
  return power;
}

module.exports = { aiPredict, aiPlayCard, getLegalPlays, cardPower };
