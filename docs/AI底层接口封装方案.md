# AI 接入层方案（NestJS 后端代理 + TypeORM + SSE 流式）

> 状态：方案评估，**已锁定关键技术决策，未改任何代码**。
> 本方案是用户真正想要的"AI 底层接口"——**如何安全地把 LLM 接进来**（API Key 不落前端、Node 中转、SSE 流式）。
> 它与"游戏侧事件接口"（Kernel 边界 / `submitEvent`）是两件不同的事：本方案是**生产者**（产出指令流），游戏侧接口是**消费者**（把指令流喂给 Kernel）。两者通过统一的 `Order` 事件衔接。

---

## 0. 已锁定的技术决策（2026-07-09）

| # | 决策项 | 结论 |
|---|--------|------|
| 1 | 模型 / 协议 | **DeepSeek**，**OpenAI 兼容** 协议 |
| 2 | 后端框架 | **NestJS**（Node + TS） |
| 3 | 数据库方案 | **TypeORM**（NestJS 官方推荐 ORM；"OM" 即 Object-Relational Mapper） |
| 4 | 跨轮对话记忆 | **本期跳过**，后端保持 stateless（每轮前端传当前 `worldState`） |
| 5 | `thinking` 推理流 | **后端必须返回** `event: thinking`；**是否展示由前端决定**（后端不关心 UI） |

> 补充：若"OM"你指的是 MikroORM / Prisma 而非 TypeORM，告诉我即可，差异仅在 entity 写法与 `forRoot` 配置，整体结构不变。

---

## 1. 为什么不能直接在前端接 LLM

- API Key 一旦进前端 bundle，任何人开 DevTools 就能扒出来、被刷爆、被滥用。
- 前端直接调 LLM 还绕不开 CORS、无法做鉴权/限流/审计、无法保密 System Prompt 与游戏策略。
- 正确做法：**唯一出口是后端**，前端只和自己的后端对话，后端再带 Key 去调 LLM。

---

## 2. 拓扑（见架构图）

```
Vue 前端 (Kernel / gameOrders / UI)        NestJS 后端 (代理)              LLM Provider
   │  POST /api/ai/decide                   │  chat/completions            │
   │  (游戏状态, 无 Key)     ──────────────▶ │  AiController → AiService    │
   │                                        │  (带 Key, server-side) ────▶ │  OpenAI 兼容
   │                                        │                             │  DeepSeek
   │  ◀───────────── SSE ────────────────── │  ◀──── SSE delta ────────── │
   │  event: thinking(必返) / order / done  │  解析 tool_call → Order      │
                  │                                  │
                  │            TypeORM ──────────────┘  (用量审计 / 势力目录)
```

- 前端**零接触 Key**，只发游戏状态、收事件流。
- 后端持有 Key（`.env`），作为唯一对外出口；经 NestJS 的 `TypeOrmModule` 落地数据库。
- 模型可换：后端用 OpenAI 兼容协议，换模型只改 `.env` 三个字段，前端无感。

---

## 3. 端到端请求流

1. 前端 Kernel 在某势力轮次，收集 `worldState`（`currentDate` / `ownership` / `myCities` / `battles` / `pendingEvents` …）→ `POST /api/ai/decide`。
2. 后端 `AiController` 收请求 → `AiService` 读 `.env` 的 Key，拼 **System Prompt**（游戏规则 + 可用指令 + 战略建议，来源于 `AI指定.md` / `设计文档.md`）+ 当前状态，调用 DeepSeek（`stream: true`）。
3. DeepSeek 流式返回；`AiService` 把文本 delta 透传为 **`event: thinking`**（必返），把 **tool_call** 解析为 `event: order`。
4. 前端 `aiClient` 收到 `order` 事件 → `kernel.submitEvent(order)`；`thinking` 事件缓存下来，是否渲染由 UI 决定。

---

## 4. 关键设计点

### 4.1 Key 与配置安全

- `.env`（`gitignore`）：`LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` / `PORT`。
  - DeepSeek 取值示例：`LLM_BASE_URL=https://api.deepseek.com/v1` / `LLM_MODEL=deepseek-chat`。
- 前端只配 `/api` 基址；**Vite dev proxy** 把 `/api` 指向 `http://localhost:3001`，前端代码里完全不出现后端域名与 Key。
- 生产：NestJS 独立部署（自有域名/网关）；`app.enableCors({ origin: 游戏域名 })`；可选一个轻量 app token 防滥用（Guard 校验）。
- 绝不 `console.log(KEY)`；错误日志脱敏。

### 4.2 后端框架：NestJS + OpenAI 兼容客户端

- 框架：**NestJS**（模块化：`AiModule` 内聚 LLM 相关逻辑）。运行 `npm run start:dev`（基于 `@nestjs/cli`）。
- 客户端：官方 `openai` SDK（`chat.completions.create({ stream: true, ... })`）——DeepSeek **OpenAI 兼容**，直接复用；`baseURL` 指向 DeepSeek。
- 换模型 = 改 `.env` 三个字段，前端无感。

### 4.3 数据库：TypeORM

- 通过 `TypeOrmModule.forRoot({...})` 接入。开发用 **SQLite**（零配置的 `game.db` 文件），生产可切换 Postgres（仅改 `forRoot` 配置）。
- 本期后端 stateless（不存对话记忆），TypeORM 主要用于：
  - `UsageLog` 实体：每次 decide 记一笔（faction / model / tokens / 耗时 / 状态）——做用量审计与限流依据。
  - `Faction` 实体：势力目录（id / 名称 / 阵营色），可从游戏 GeoJSON 初始化，供后端校验 `faction` 合法性。
- 这些是"配套的数据库方案"落点，属于可演进层，不阻塞 AI 主链路。

### 4.4 结构化输出：用 Tool Calling（推荐）

把 7 个指令注册为 LLM 的 `tools`，参数即协议字段：

```jsonc
{
  "name": "attack",
  "parameters": {
    "type": "object",
    "properties": {
      "from": { "type": "string", "description": "起点地点 id（城市 gb 或国家 iso_a3）" },
      "to":   { "type": "string", "description": "终点地点 id" },
      "text": { "type": "string", "description": "到达后弹出的文字，可选" }
    },
    "required": ["from", "to"]
  }
}
// 其余 scout / declareWar / battle / stopBattle / stopBattles / listBattles 同理
```

- 模型调用 tool → 后端直接拿到结构化参数 → 即合法 `Order`，**免去脆弱的 JSON 全文解析**。
- 备选：JSON Mode + `zod` 校验；但 tool calling 更稳，优先。

### 4.5 SSE 流式协议

- 后端响应 `Content-Type: text/event-stream`。由于 `decide` 是 **POST**（游戏状态不便塞 URL），NestJS 侧用 `@Post('ai/decide')` + `@Res() res: Response` 手写 SSE 帧（不依赖仅支持 GET 的 `@Sse()` 装饰器）。
- 事件类型：
  - `thinking`：**必返**，模型文本增量（前端决定是否展示）。
  - `order`：一个结构化游戏指令 `{ "order", "from?", "to?", "id?", "text?" }`。
  - `error`：模型超时 / 格式错误 / 限流。
  - `done`：本轮结束。
- 一次决策可多次 `event: order`（连发多个指令）；`thinking` 在 `order` 之前流式返回。

### 4.6 前端 aiClient（薄封装，不感知模型/Key）

```ts
// src/ai/aiClient.ts —— 只认"事件流"，不认具体模型
interface Order { order: string; from?: string; to?: string; id?: string; text?: string }

async function decide(
  faction: string,
  worldState: unknown,
  handlers: {
    onOrder: (o: Order) => void
    onThinking?: (t: string) => void   // 收到即缓存；展示与否由 UI 决定
    onDone?: () => void
  }
) {
  const res = await fetch('/api/ai/decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ faction, worldState }),
  })
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const parts = buf.split('\n\n'); buf = parts.pop() ?? ''
    for (const chunk of parts) {
      const ev = parseSSE(chunk)
      if (ev.event === 'order') handlers.onOrder(JSON.parse(ev.data))
      else if (ev.event === 'thinking') handlers.onThinking?.(ev.data)
      else if (ev.event === 'done') handlers.onDone?.()
    }
  }
}
// Kernel 触发：decide(faction, state, { onOrder: (o) => kernel.submitEvent(o) })
```

### 4.7 与游戏内核的接缝

- 后端产出 `Order` 事件，前端 `Kernel.submitEvent` 消费——和"游戏侧事件接口"方案对齐。
- 后端**保持无游戏状态**（stateless）：每轮前端传当前状态，简单、可水平扩展。
- 跨轮对话记忆本期**明确跳过**（决策项 4）；如未来要做，再加 `ConversationMemory` 实体 + 上下文窗口管理，属应用层，不影响本接入层骨架。

---

## 5. 目录结构（NestJS 形态，后端独立于前端）

```
server/                                # NestJS 后端，独立 package.json
  .env.example                         # LLM_API_KEY= / LLM_BASE_URL= / LLM_MODEL= / PORT=3001
  package.json / tsconfig.json / nest-cli.json
  src/
    main.ts                            # NestFactory.create → enableCors → listen(PORT)
    app.module.ts                      # TypeOrmModule.forRoot + AiModule
    ai/
      ai.module.ts                     # @Module({ controllers:[AiController], providers:[AiService] })
      ai.controller.ts                 # @Post('ai/decide') → 手写 SSE 帧（@Res()）
      ai.service.ts                    # 调 DeepSeek (OpenAI SDK, stream) → 解析 → 写 SSE
      decide.dto.ts                    # DecideDto: { faction: string; worldState: unknown }
      llm.client.ts                    # OpenAI 兼容 client (DeepSeek, baseURL+key)
      tools.ts                         # 7 个指令 → tools 定义
      prompt.ts                        # 拼 system prompt + 当前游戏状态
      sse.util.ts                      # 把事件格式化为 SSE 帧 (event:/data:/\\n\\n)
    db/
      entities/
        usage-log.entity.ts            # 用量审计（可选但推荐）
        faction.entity.ts              # 势力目录（可选）

前端（现有 Vue 项目内新增）
  src/ai/aiClient.ts                   # 消费 SSE → kernel.submitEvent
  vite.config.js                       # proxy: '/api' → 'http://localhost:3001'
```

---

## 6. 请求 / 响应示例

前端 → 后端：

```json
POST /api/ai/decide
{
  "faction": "KMT",
  "worldState": {
    "currentDate": "1931-09-19",
    "myCities": ["156500000", "156450200"],
    "battles": [],
    "pendingEvents": []
  }
}
```

后端 → 前端（SSE，多段；`thinking` 必返）：

```
event: thinking
data: 东北局势紧张，拟先侦察沈阳周边

event: order
data: {"order":"scout","from":"156450200","text":"侦察敌情！"}

event: order
data: {"order":"declareWar","from":"156450200","to":"156450100","text":"对日宣战！"}

event: done
data: {}
```

---

## 7. 安全与运维清单

- [ ] `.env` 已 `gitignore`，Key 不入仓库、不入前端。
- [ ] 生产 `CORS` 仅放行游戏域名；可选 app token 校验（NestJS Guard）。
- [ ] 请求体大小 / 超时限制；LLM 调用超时兜底（回 `event: error`）。
- [ ] 限流（按 IP / 按 token），防 Key 被刷；限流依据可来自 `UsageLog`。
- [ ] 错误日志脱敏，不打印 Key 与完整对话。
- [ ] dev 用 Vite proxy，前端代码零硬编码后端地址与 Key。

---

## 8. 与原"待确认"的对应（已全部锁定）

1. 模型 / 协议 → **DeepSeek，OpenAI 兼容**。
2. 后端框架 → **NestJS**。
3. 决策触发频率：每个势力每个"游戏日"一次（由前端 Kernel 快进循环触发）——沿用原设计，未变。
4. 跨轮对话记忆 → **本期跳过，stateless**。
5. `thinking` → **后端必返，前端决定是否展示**。

---

## 9. 与"游戏侧事件接口"方案的关系

- 本方案（AI 接入层）= **生产者**：安全地把 LLM 接进来，产出 `Order` 事件流。
- 游戏侧事件接口（Kernel 边界，`submitEvent` / `getState`，不 import Pixi）= **消费者**：把事件流应用到世界状态并触发动画副作用。
- 两者通过统一的 `Order` 事件契约解耦：前端 `aiClient.onOrder → kernel.submitEvent`。

*注：早期那版被误当成"AI 底层接口"的文档，实际是上面说的"游戏侧事件接口（消费者）"。本文件才是你要的"最底层 AI 接入方案（生产者）"。*
