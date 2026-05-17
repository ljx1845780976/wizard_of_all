技术设计文档 — 自然巫师 (Nature Wizard)

---

## 1. 架构总览

```
┌─────────────────────────────────────────────────┐
│                微信小程序前端 (WXML + JS)          │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │  大厅页   │ │  房间页   │ │   结算页          │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
│        │              │               │          │
│        └──────────────┼───────────────┘          │
│                       │ db.collection('rooms')    │
│                    .watch() 实时监听              │
└───────────────────────┼──────────────────────────┘
                        │
        ┌───────────────┴───────────────┐
        │       微信云开发平台            │
        │                               │
        │  ┌──────────┐ ┌────────────┐  │
        │  │  云函数   │ │  云数据库   │  │
        │  │ (Node.js) │ │ (NoSQL)    │  │
        │  └──────────┘ └────────────┘  │
        │  ┌──────────┐ ┌────────────┐  │
        │  │  云存储   │ │  云调用     │  │
        │  │ (卡牌图)  │ │ (微信API)  │  │
        │  └──────────┘ └────────────┘  │
        └───────────────────────────────┘
```

**核心数据流**：客户端调用云函数 → 云函数校验 + 写库 → 所有客户端通过 `watch()` 收到变更 → 更新 UI。

---

## 2. 云数据库设计

### 2.1 集合概览

| 集合名 | 用途 | 实时监听 |
|--------|------|---------|
| `users` | 用户档案 | 否 |
| `rooms` | 房间 + 游戏状态（核心） | 是（所有玩家 watch 房间文档） |
| `match_queue` | 快速匹配队列 | 否 |

### 2.2 `users` 集合

```js
{
  _id: "openid_xxx",          // 微信 openid 作为主键
  nickname: "玩家A",
  avatarUrl: "https://...",
  createdAt: Date,
  stats: {
    gamesPlayed: 0,
    gamesWon: 0,
    totalScore: 0
  }
}
```

### 2.3 `rooms` 集合（核心）

```js
{
  _id: "room_xxx",
  roomCode: "A3F9K2",         // 6位字母数字，用于分享加入
  ownerId: "openid_xxx",
  maxPlayers: 4,
  status: "waiting",          // waiting | playing | finished

  // 玩家座位（固定长度数组，空位为 null）
  seats: [
    { userId: "openid_a", nickname: "玩家A", avatarUrl: "...", isOnline: true },
    { userId: "openid_b", nickname: "玩家B", avatarUrl: "...", isOnline: true },
    { userId: "openid_c", nickname: "玩家C", avatarUrl: "...", isOnline: true },
    null                       // 空位
  ],

  // ===== 以下字段仅在 status="playing" 时有值 =====
  game: {
    trumpSuit: "forest",       // 王牌色: sky|forest|grassland|ocean|null(null=无王牌)
    trumpRevealedCard: { suit: "ocean", rank: 7 },  // 翻出的牌
    totalRounds: 15,          // 总回合数 = 60 / 人数
    currentRound: 3,          // 当前第几回合 (1-based)
    phase: "playing",         // dealing | predicting | playing | round_result
    phaseDeadline: 1700000000000,  // 当前阶段截止时间（用于倒计时）

    // 发牌（仅当前回合有效）
    hands: {
      "openid_a": [
        { suit: "sky", rank: 5 },
        { suit: "forest", rank: 12 },
        { suit: "human", rank: 0 }
      ],
      "openid_b": [...],
    },

    // 本回合预测
    predictions: {
      "openid_a": 1,
      "openid_b": 2,
      // openid_c 尚未提交
    },
    predictionOrder: ["openid_a", "openid_b", "openid_c"],  // 本轮提交顺序
    lastPredictor: "openid_c",    // 本轮最后预测的玩家
    forbiddenPrediction: 1,       // 最后预测者禁止选的数字（= 手牌数 - 前面预测之和）

    // 本回合赢墩计数
    tricksWon: {
      "openid_a": 1,
      "openid_b": 0,
      "openid_c": 0
    },

    // 当前轮（trick）
    currentTrick: {
      leadPlayer: "openid_a",
      leadSuit: "sky",           // 本轮引色（可能为 null，如人类/蚂蚁开场）
      cards: [
        { userId: "openid_a", suit: "sky", rank: 5, playOrder: 0 },
        // 其他玩家按出牌顺序追加
      ],
      specialRule: null,         // "first_human" | "first_ant" | null（用于特殊判定）
    },

    // 累计得分（所有已完结回合的得分之和）
    scores: {
      "openid_a": 52,
      "openid_b": -10,
      "openid_c": 38
    },

    // 回合历史（用于结算展示）
    roundHistory: [
      {
        round: 1,
        predictions: { "openid_a": 1, "openid_b": 2, "openid_c": 0 },
        actual: { "openid_a": 1, "openid_b": 1, "openid_c": 1 },
        scores: { "openid_a": 30, "openid_b": -10, "openid_c": 0 }
      }
    ]
  },

  createdAt: Date,
  updatedAt: Date
}
```

### 2.4 `match_queue` 集合

```js
{
  _id: "openid_xxx",
  joinedAt: Date,
  preferredPlayerCount: 4,   // 期望人数（可选项）
  status: "waiting"           // waiting | matched
}
```

---

## 3. 云函数设计

### 3.1 函数清单

| 云函数 | 触发方式 | 功能简述 |
|--------|---------|---------|
| `userLogin` | 小程序端调用 | 微信登录，写入/更新 users 表 |
| `createRoom` | 小程序端调用 | 创建房间，写入 rooms 表，房主自动入座 |
| `joinRoom` | 小程序端调用 | 通过 roomCode 加入房间 |
| `readyToggle` | 小程序端调用 | 切换准备状态 |
| `leaveRoom` | 小程序端调用 | 退出房间 |
| `startGame` | 小程序端调用 | 房主开始游戏，初始化 game 字段 |
| `submitPrediction` | 小程序端调用 | 提交预测数字 |
| `playCard` | 小程序端调用 | 打出一张牌 |
| `nextRound` | 小程序端调用 | 进入下一回合（回合结果展示后触发） |
| `enterMatch` | 小程序端调用 | 进入快速匹配队列 |
| `cancelMatch` | 小程序端调用 | 取消匹配 |
| `matchWorker` | 定时触发器 | 每分钟执行，撮合匹配队列中的玩家 |

### 3.2 核心云函数详细逻辑

#### `startGame`

```
输入: roomId
校验: 调用者 == 房主, status == "waiting", 所有座位玩家 ready
执行:
  1. 洗牌: 生成 60 张牌的数组, Fisher-Yates 洗牌
  2. 翻王牌: 从牌堆取一张, 确定 trumpSuit
  3. 更新 rooms:
     status → "playing"
     game → { trumpSuit, trumpRevealedCard, totalRounds, currentRound: 1,
               phase: "dealing", hands: {} }
  4. 调用 dealRound(roomId) 发第一回合牌
  5. 设置 phaseDeadline
```

#### `submitPrediction`

```
输入: roomId, prediction (整数)
校验:
  1. game.phase == "predicting"
  2. 调用者尚未提交
  3. prediction ∈ [0, 当前手牌数]
  4. 调用者的提交顺序在 predictionOrder 中正确
  5. 如果是 lastPredictor: prediction ≠ forbiddenPrediction
执行:
  1. 写入 game.predictions[userId]
  2. 如果所有人已提交:
     phase → "playing"
     设置 currentTrick (首个引牌人 = 本回合先出牌者)
     设置 phaseDeadline
  3. 否则: 更新 forbiddenPrediction (给下一个最后预测者)
```

#### `playCard`

```
输入: roomId, card: { suit, rank }
校验:
  1. game.phase == "playing"
  2. 轮到该玩家出牌（按 seats 顺序 + currentTrick 状态判定）
  3. 玩家手中有这张牌
  4. 跟色合法性:
     - 牌是人类/蚂蚁: 合法
     - 引牌人: 合法
     - currentTrick.leadSuit 有值 且 手中有该颜色: 必须出该颜色
     - currentTrick.leadSuit 有值 且 手中无该颜色: 可出任意
     - currentTrick.leadSuit = null (引牌人出人类/蚂蚁): 无约束
执行:
  1. 从 hands[userId] 中移除该牌
  2. 追加到 currentTrick.cards
  3. 设置/更新 leadSuit（如果 leadSuit=null 且出的不是人类/蚂蚁）
  4. 设置 specialRule（如果出了人类/蚂蚁且是该轮第一个）
  5. 如果本轮未结束（还有人没出牌）: 轮转到下一个玩家
  6. 如果本轮结束:
     a. 判定赢家（根据大小比较规则 + 特殊规则）
     b. tricksWon[赢家]++
     c. 赢家成为下一轮引牌人
     d. 如果当前回合所有轮打完:
        - 计算本回合每人得分
        - 追加到 roundHistory
        - 更新 scores
        - phase → "round_result"
        - 设置 phaseDeadline (自动进入下一回合的倒计时)
```

### 3.3 定时触发器

```js
// matchWorker - 每分钟触发
// 逻辑:
// 1. 查询 match_queue 中 status="waiting" 的玩家
// 2. 按 preferredPlayerCount 分组
// 3. 当某组人数 >= preferredPlayerCount，创建新房间，批量加入
// 4. 标记已匹配玩家 status="matched"，5分钟后自动清理
```

---

## 4. 前端设计

### 4.1 页面结构

```
pages/
├── index/          # 大厅页
├── room/           # 游戏房间页（等待 + 游戏中）
├── result/         # 战局结算页
└── rules/          # 规则说明页（静态）
```

### 4.2 各页面状态拆解

#### 大厅页 (`index`)

```
状态:
  - userInfo: { nickname, avatarUrl }
  - creatingRoom: boolean (loading)
  - joiningRoom: boolean (loading)
  - matching: boolean (是否在匹配队列中)
  - showJoinInput: boolean (是否显示加入房间输入框)

操作:
  - 点击"创建房间" → 调用 createRoom 云函数 → 跳转房间页
  - 点击"快速匹配" → 调用 enterMatch 云函数 → 显示等待动画
  - 输入房间码 → 调用 joinRoom 云函数 → 跳转房间页
  - 匹配成功（watch 触发）→ 跳转房间页
```

#### 游戏房间页 (`room`) — 最复杂

```
UI 区域:
  ┌─────────────────────────────┐
  │  [退出]  第3/15回合  王牌:🌲 │  ← 顶栏
  ├─────────────────────────────┤
  │      玩家B (12分)           │
  │   预测:2  已赢:1            │  ← 对手座位（上方/两侧）
  │                             │
  │       🃏 当前牌桌 🃏        │  ← 当前轮出牌区域
  │   [天空5] [森林10]         │
  │                             │
  │      玩家A (52分) ←你       │
  │   预测:3  已赢:2            │
  │                             │
  │  ┌───┬───┬───┬───┬───┐    │
  │  │🌲1│☁️5│🌾8│🌊3│🧙 │ ← 手牌区（底部）
  │  └───┴───┴───┴───┴───┘    │
  ├─────────────────────────────┤
  │     [预测选择器/确认按钮]    │  ← 操作区
  └─────────────────────────────┘

状态机:
  1. WAITING: 显示座位、准备按钮、房主可见开始按钮
  2. PREDICTING: 手牌可见、弹出预测选择器、倒计时
  3. PLAYING:
     - 我的回合: 手牌可点击、高亮合法牌
     - 他人回合: 手牌灰显不可点击
  4. ROUND_RESULT: 显示本回合得分摘要、倒计时自动进入下一回合
  5. GAME_OVER: 跳转结算页
```

#### 结算页 (`result`)

```
状态:
  - rankings: [{ nickname, avatarUrl, totalScore, roundScores[] }]
  - playerCount: number

操作:
  - "再来一局" → 调用 createRoom → 跳转新房间
  - "分享战绩" → 微信分享接口
  - "返回大厅" → 跳转 index
```

### 4.3 核心组件

| 组件 | 职责 |
|------|------|
| `card` | 单张卡牌渲染（根据 suit 显示不同颜色/图标） |
| `hand` | 手牌区，支持出牌选择和合法牌高亮 |
| `player-seat` | 玩家座位：头像、昵称、预测数、已赢墩数、正在出牌动画 |
| `trick-area` | 当前轮的出牌展示区域 |
| `predict-picker` | 预测数字选择器（0 ~ 手牌数） |
| `countdown` | 倒计时组件 |
| `score-badge` | 分数变化动画 |

### 4.4 前端数据层

```js
// app.js 全局数据/工具
App({
  globalData: {
    userInfo: null,
    currentRoomId: null,
  },

  // 封装云函数调用
  async callFunction(name, data) { ... },

  // 建立房间实时监听
  watchRoom(roomId, onChange) {
    const watcher = db.collection('rooms')
      .doc(roomId)
      .watch({ onChange });
    return watcher;  // 返回 watcher 以便页面 onUnload 时关闭
  }
})
```

### 4.5 卡牌数据映射

```js
// 前端渲染映射
const SUIT_CONFIG = {
  sky:     { name: '天空', emoji: '☁️', color: '#87CEEB' },
  forest:  { name: '森林', emoji: '🌲', color: '#228B22' },
  grassland: { name: '草原', emoji: '🌾', color: '#DAA520' },
  ocean:   { name: '海洋', emoji: '🌊', color: '#4169E1' },
  human:   { name: '巫师', emoji: '🧙', color: '#FFD700' },
  ant:     { name: '蚂蚁', emoji: '🐜', color: '#8B4513' },
};
```

---

## 5. 实时通信设计

### 5.1 核心机制：数据库 watch()

```js
// 在 room 页面的 onLoad 中
this.roomWatcher = db.collection('rooms')
  .doc(this.data.roomId)
  .watch({
    onChange: (snapshot) => {
      const room = snapshot.docs[0];
      this.handleRoomUpdate(room);
    },
    onError: (err) => {
      wx.showToast({ title: '连接断开，正在重连...', icon: 'none' });
    }
  });
```

### 5.2 同步时序

```
玩家A出牌 → 前端调用 playCard 云函数
         → 云函数校验 + 更新 rooms 文档
         → 云数据库 push 变更给所有 watch 该文档的客户端
         → 玩家A/B/C 的 watch onChange 触发
         → 各客户端更新 UI
```

延迟估算：云函数冷启动 ~200ms + 数据库写入 ~50ms + watch 推送 ~100ms ≈ **350ms**（热启动 ~150ms）。

### 5.3 超时与离线处理

| 场景 | 处理方式 |
|------|---------|
| 预测阶段超时未提交 | 云函数设置定时器，到期自动提交 prediction=0 |
| 出牌阶段超时未出牌 | 自动从手牌随机出一张合法牌 |
| 客户端断线 | seats[].isOnline = false，保留状态，允许 60s 重连 |
| 房主断线 | 将房主转移给座位最靠前的在线玩家 |

超时检测：云函数中通过 phaseDeadline 判断。客户端额外轮询检查是否超时。

---

## 6. 游戏状态机

```
                    ┌─────────────────┐
                    │    WAITING      │
                    │ (房间等待开始)   │
                    └───────┬─────────┘
                            │ 房主点击"开始"
                            ▼
                    ┌─────────────────┐
            ┌──────>│    DEALING      │◄─────┐
            │       │ (发牌阶段)       │      │
            │       └───────┬─────────┘      │
            │               │ 牌已发完          │
            │               ▼                 │
            │       ┌─────────────────┐      │
            │       │   PREDICTING    │      │
            │       │ (玩家提交预测)   │      │
            │       └───────┬─────────┘      │
            │               │ 所有人提交        │
            │               ▼                 │
            │       ┌─────────────────┐      │
            │  ┌───>│    PLAYING      │      │
            │  │    │ (出牌进行中)     │      │
            │  │    └───┬─────┬───────┘      │
            │  │        │     │ 一轮结束       │
            │  │        │     ▼ (非最后一轮)   │
            │  │        │ ┌──────────┐       │
            │  │        │ │ 判定赢家  │       │
            │  │        │ │ 下一轮引牌 │───────┘
            │  │        │ └──────────┘
            │  │        │ 所有轮结束
            │  │        ▼
            │  │  ┌─────────────────┐
            │  │  │  ROUND_RESULT   │───> 不是最后一回合 → DEALING
            │  │  │ (展示回合得分)   │
            │  │  └───────┬─────────┘
            │  │          │ 最后一回合
            │  │          ▼
            │  │  ┌─────────────────┐
            │  │  │   GAME_OVER     │
            │  │  │ (跳转结算页)     │
            │  │  └─────────────────┘
```

---

## 7. 安全设计

| 风险 | 防护措施 |
|------|---------|
| 客户端篡改手牌 | 手牌数据仅存在云函数侧，客户端只拿到洗好的手牌数组，出牌时云端校验手牌中是否存在该牌 |
| 篡改预测/出牌为他人操作 | 云函数通过 `cloud.getWXContext().OPENID` 获取调用者身份，校验是否为当前应操作的玩家 |
| 偷看他人手牌 | 云函数返回给客户端的 room 数据中，其他玩家的 hands 字段置空或过滤（需在 watch 层面做数据脱敏） |
| 伪造分数 | 分数由云函数计算并写入，客户端仅读取展示 |

### 数据脱敏方案

云函数返回 room 文档给客户端前，需要过滤敏感数据。有两种方式：

**方式 A（推荐）**：云函数不直接返回敏感字段。在云函数中直接操作完整文档，但小程序端查询时使用 `.field()` 排除他人手牌字段。然而 `watch()` 不能用 `.field()`。

**方式 B**：维护两个文档：
- `rooms/{roomId}` — 完整数据（仅供云函数读写）
- `rooms/{roomId}/public` — 公开数据（各玩家手牌替换为卡片数量）

MVP 建议用方式 A 的折中方案：云函数返回完整 room 文档，但客户端收到 watch 回调后，**在本地手动清理**其他玩家的 hand 数据（仅保留手牌数量）。核心安全逻辑在云函数侧做校验，客户端"看到"别人手牌也不影响公平性——但我们要避免这种体验。

最佳实践：**云函数返回 room 时，在各云函数中对 hands 做脱敏——只保留该用户自己的手牌，其他玩家的 hand 替换为空数组 `[]`。**

---

## 8. 开发顺序（建议）

### 第一阶段：骨架（1-2天）
1. 初始化微信小程序项目，开通云开发
2. 创建 `users` / `rooms` / `match_queue` 集合
3. 实现 `userLogin` 云函数 + 前端登录流程
4. 搭建三个页面的骨架导航

### 第二阶段：房间系统（1-2天）
1. 实现 `createRoom` / `joinRoom` / `leaveRoom` 云函数
2. 房间页等待状态 UI（座位、准备按钮、房主开始按钮）
3. `watch()` 实时同步房间成员变更

### 第三阶段：核心玩法（3-5天）
1. 实现 `startGame` 云函数（洗牌、发牌、翻王牌）
2. 实现 `submitPrediction` 云函数 + 预测 UI
3. 实现 `playCard` 云函数（出牌逻辑、胜负判定）
4. 回合流转 + 得分计算

### 第四阶段：对战体验（1-2天）
1. 倒计时 + 超时自动操作
2. 分数变化动画
3. 回合结果展示

### 第五阶段：匹配 + 结算 + 分享（1天）
1. `enterMatch` + `matchWorker` 匹配系统
2. 结算页排名展示
3. 微信分享接口

### 第六阶段：打磨（1-2天）
1. 卡牌美术替换 AI 占位图
2. 音效（可选）
3. 边界 case 测试

---

## 9. 关键数据：各人数局牌数验证

| 人数 | 总回合 | 最大回合每人牌 | 所需总牌 | 是否满足 60 张 |
|------|--------|--------------|---------|--------------|
| 3 人 | 20 | 20 | 60 | ✅ |
| 4 人 | 15 | 15 | 60 | ✅ |
| 5 人 | 12 | 12 | 60 | ✅ |
| 6 人 | 10 | 10 | 60 | ✅ |

每回合收回重新洗牌，所以一副 60 张牌始终够用。

---

## 10. 待决策项

| # | 问题 | 选项 | 建议 |
|---|------|------|------|
| 1 | 卡牌美术 | A. AI 生成 B. 人工绘制 | MVP 选 A（Midjourney/DALL·E 批量生成） |
| 2 | 预测/出牌超时时间 | 15s / 30s / 60s | 建议 30s，可配置 |
| 3 | 断线重连窗口 | 30s / 60s / 120s | 建议 60s |
| 4 | 微信云开发环境 | 预付费 / 按量付费 | MVP 选按量付费，有免费额度 |
| 5 | 云函数预热 | 是否做定时触发防冷启动 | MVP 先不做，延迟可接受 |
