# AI 底层接口封装方案（已实现：apps/server + apps/web）

> **状态：已落地实现。** 本文件以代码为准，描述 `apps/server`（NestJS 后端代理）与 `apps/web`（前端 AI 编排层）的真实分工。
> **与原评估方案存在重大偏差**（后端从"SSE 流式 + tool calling + 自带提示词 + TypeORM"简化为"纯透传代理"，AI 编排逻辑整体上移到前端）。差异清单见第 8 节，改动较大，请勿再按旧方案理解。
>
> 一句话概括当前架构：**后端只做一件事——持有 Key、把前端发来的完整 OpenAI 请求转发给 LLM 并把原始回包原样返回；提示词组装、契约定义、回包解析、结构/战略校验、指令执行全部在前端完成。**

---

## 0. 技术决策：原始结论 vs 实际落地

| # | 决策项 | 原始结论（2026-07-09 评估） | 实际落地 | 备注 |
|---|--------|------|----------|------|
| 1 | 模型 / 协议 | DeepSeek，OpenAI 兼容 | **OpenAI 兼容客户端**（provider 可换）。代码默认 `deepseek-chat`，实际 `.env` 配的是 **stepfun**（`step-3.7-flash`）。 | 换模型只改 `.env`，前端无感 ✓ |
| 2 | 后端框架 | NestJS | **NestJS 10** ✓（`apps/server`，独立 package） | 一致 |
| 3 | 输出方式 | tool calling → `Order` | **JSON Mode**：前端对 LLM 传 `response_format: { type: 'json_object' }`，回包按 JSON 解析 | 没用 tool calling |
| 4 | 流式协议 | 后端手写 SSE（`thinking`/`order`/`done`） | **无 SSE**，普通 JSON `POST` + `res.json()`，回包即完整 completion | 大幅简化 |
| 5 | 提示词/契约 | 后端拼 System Prompt + 注册 7 个 tools | **前端** `aiPromptBuilder.ts` + `aiOrderContract.ts` 组装与定义；17 条指令 | 逻辑上移 |
| 6 | 数据库 | TypeORM + SQLite（`UsageLog`/`Faction` 实体，用量审计） | **未接线，且依赖已移除**（2026-08-31 `000e40a`：`typeorm`/`@nestjs/typeorm`/`better-sqlite3`/`class-validator`/`class-transformer` 五个零引用依赖整体删除，`game.db` 空文件一并不存在；dependencies 12→7 项） | 保持 stateless；审计层若要重建需重新引依赖（注意 better-sqlite3 原生模块在 Node 24 的重编译风险） |
| 7 | 跨轮记忆 | 本期跳过，后端 stateless | stateless ✓ | 一致 |
| 8 | 端点 | `POST /api/ai/decide` | **`POST /api/ai/chat`** | 控制器路径变了 |
| 9 | `thinking` 推理流 | 后端必返 `event:thinking` | 不再单独透传；前端把模型文本当作解析失败的兜底，或直接取 `msg`/`reason` 字段 | — |

---

## 1. 为什么不在前端直接接 LLM（保留原结论）

- API Key 一旦进前端 bundle，任何人开 DevTools 就能扒出来、被刷爆、被滥用。
- 前端直接调 LLM 还绕不开 CORS、无法做鉴权/限流/审计、无法保密 System Prompt 与游戏策略。
- 正确做法：**唯一出口是后端**（`apps/server`），前端只和自己的后端对话，后端再带 Key 去调 LLM。**这一点在落地版中仍然成立**——前端 `useAiChat` 只 `fetch('/api/ai/chat')`，Key 在 `apps/server/.env`，代码里零硬编码。

---

## 2. 实际拓扑

```
Vue 前端 (apps/web)                              NestJS 后端 (apps/server)              LLM Provider
  useAiChat → fetch('/api/ai/chat')                AiController.chat(body)               OpenAI 兼容
   (发完整 OpenAI 请求体)        ───────────────▶    AiService.chat(body)  ────────────▶  (DeepSeek / stepfun / …)
   { messages, response_format,                     (带 Key, server-side)                 chat/completions
     temperature, model? ... }                                                    (非流式)
                                                  ◀──────── 原始 ChatCompletion JSON ──
   ◀────────────── res.json() ───────────────
   useAiOrchestrator:
     extractPayloads → validateOrders
       (结构校验 aiOrderContract)
     → executeOrder(order)   ──→ store.applyEvent（世界态变更 + 动画）
```

- 前端**零接触 Key**，只发「完整 OpenAI 请求体」、收「原始 completion」。
- 后端持有 Key（`.env`），作为唯一对外出口；后端**不读、不改、不解析**任何游戏语义——它就是一个带 Key 的透传代理。
- 模型可换：后端用 OpenAI 兼容协议，换模型只改 `.env` 三个字段，前端无感。

---

## 3. 后端：apps/server（NestJS 透传代理）

### 3.1 实际文件结构

```
apps/server/                            # 独立 NestJS package（当前用 npm 安装，含 package-lock.json）
  .env.example                          # PORT / CORS_ORIGIN / LLM_API_KEY / LLM_BASE_URL / LLM_MODEL
  .env                                  # 实际配置（gitignore，已填 stepfun Key）
  .gitignore                            # node_modules / dist / .env / *.db / *.log
  package.json / tsconfig.json / nest-cli.json
  src/
    main.ts                             # NestFactory → enableCors → ValidationPipe → setGlobalPrefix('api') → listen(PORT)
    app.module.ts                       # ConfigModule.forRoot({isGlobal}) + AiModule（⚠ 无 TypeOrmModule）
    app.controller.ts                   # GET /api/health（健康检查，原计划无）
    ai/
      ai.module.ts                      # @Module({ controllers:[AiController], providers:[AiService] })
      ai.controller.ts                  # @Controller('ai') + @Post('chat') → AiService.chat(body)
      ai.service.ts                     # 把 body 原样转给 OpenAI client，返回原始 completion
      llm.client.ts                     # OpenAI client 工厂 + 环境变量校验
```

> 对比原方案：`decide.dto.ts` / `tools.ts` / `prompt.ts` / `sse.util.ts` 这四个文件**均未创建**——它们的职责被前端接管或取消（见第 4 节）。`db/entities/*`（UsageLog/Faction）也未创建。

### 3.2 关键文件职责

**`main.ts`**
```ts
const app = await NestFactory.create(AppModule)
const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173'
app.enableCors({ origin: corsOrigin.split(',').map(s => s.trim()), credentials: true })
app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }))
app.setGlobalPrefix('api')                 // → 路由前缀 /api
const port = process.env.PORT ?? 3001
await app.listen(port)
```
- 因 `setGlobalPrefix('api')`，`@Controller('ai')` + `@Post('chat')` 实际暴露为 **`POST /api/ai/chat`**。
- CORS 放行 `CORS_ORIGIN`（逗号分隔可配多域名）；同时前端 Vite 也有 `/api` dev proxy（见 §7）。

**`app.module.ts`**
```ts
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), AiModule],
  controllers: [AppController],   // 仅 GET /api/health
})
export class AppModule {}
```
⚠ **无 `TypeOrmModule`、不连任何数据库**（2026-08-31 起相关依赖已整体移除，见 §3.5）——本服务是纯 stateless 透传。

**`ai.controller.ts`**
```ts
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}
  @Post('chat') @HttpCode(HttpStatus.OK)
  chat(@Body() body: Record<string, unknown>) { return this.aiService.chat(body) }
}
```
- 入参是**任意 JSON 对象**（`Record<string, unknown>`），不做业务 DTO 约束；`ValidationPipe` 的 `whitelist` 因类型是开放对象，基本不剥离字段。

**`ai.service.ts`**
```ts
constructor() {
  this.client = createLLMClient()        // 未配置则返回 null
  this.model = getModel()                // 默认 'deepseek-chat'
}
async chat(body: Record<string, unknown>) {
  if (!this.client) throw new HttpException(
    { error: 'AI 服务未配置', detail: `缺少环境变量: ${getMissingEnv().join(', ')}`,
      hint: '请在 apps/server/ 下创建 .env，参考 .env.example' }, HttpStatus.SERVICE_UNAVAILABLE /*503*/)
  const payload = { ...body, model: body.model ?? this.model }
  try {
    return await this.client.chat.completions.create(
      payload as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming)
  } catch (err) {
    throw new HttpException({ error: 'AI 请求失败', detail: (err as Error).message },
      HttpStatus.BAD_GATEWAY /*502*/)
  }
}
```
- **非流式**：直接 `create(...)`（不带 `stream:true`），返回完整的 `ChatCompletion` 对象。
- 仅做两件小事：① 未配置 Key 时返回 503；② LLM 调用异常时转 502。其余全部透传。

**`llm.client.ts`**
```ts
const REQUIRED_ENV = ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'] as const
export function isLLMConfigured(): boolean { /* 三个变量都在 */ }
export function getMissingEnv(): string[] { /* 缺哪些 */ }
export function createLLMClient(): OpenAI | null {
  if (!isLLMConfigured()) { /* warn 并 return null */ }
  return new OpenAI({ apiKey: process.env.LLM_API_KEY, baseURL: process.env.LLM_BASE_URL })
}
export function getModel(): string { return process.env.LLM_MODEL ?? 'deepseek-chat' }
```

### 3.3 请求 / 响应形状

**请求（前端 → 后端）**：即 OpenAI `chat.completions.create` 的参数对象，由前端组装后整体发出。典型字段：
```json
POST /api/ai/chat
{
  "messages": [
    { "role": "system", "content": "<由前端 aiPromptBuilder 拼好的系统提示词>" },
    { "role": "user",   "content": "进攻杭州" }
  ],
  "response_format": { "type": "json_object" },
  "temperature": 0.7,
  "model": "step-3.7-flash"      // 可选，不传则用服务端 getModel() 默认值
}
```

**响应（后端 → 前端）**：OpenAI `ChatCompletion` 原始 JSON，例如：
```json
{
  "id": "chatcmpl-xxx", "object": "chat.completion", "model": "step-3.7-flash",
  "choices": [{
    "index": 0,
    "message": { "role": "assistant", "content": "{\"orders\":[...],\"msg\":\"...\"}" },
    "finish_reason": "stop"
  }],
  "usage": { "prompt_tokens": 123, "completion_tokens": 45, "total_tokens": 168 }
}
```
- 若模型支持 `tool_calls`，`message.tool_calls[].function.arguments` 也会被前端解析（见 §4.4，兼容两种回包形态）。
- **无 SSE**、无 `event:` 帧、无 `thinking`/`order`/`done` 事件类型——旧方案的流式协议已废弃。

**错误码**
- `503 SERVICE_UNAVAILABLE`：`apps/server/.env` 缺 `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` 之一。
- `502 BAD_GATEWAY`：LLM 调用本身失败（超时、Key 无效、限流等），`detail` 为底层错误信息。

### 3.4 配置与安全（`.env`）

`.env.example`：
```
PORT=3001
CORS_ORIGIN=http://localhost:5173
LLM_API_KEY=sk-xxxxxxxxxxxxxxxx
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat
# 推理强度（step-3.7-flash 等支持的模型）：low / medium / high，默认 low
# 请求体携带 reasoning_effort 可临时覆盖此默认值
LLM_REASONING_EFFORT=low
```
实际 `.env`（已配）：`LLM_BASE_URL=https://api.stepfun.com/step_plan/v1`、`LLM_MODEL=step-3.7-flash`。换 provider 只改这两项 + Key 即可，前端无感。

- `.env` 已被 `.gitignore`（连同 `*.db` / `*.log` / `node_modules` / `dist`），Key 不入仓库、不入前端。
- 绝不 `console.log(KEY)`；错误日志仅打印 `message`，不打印 Key 与完整对话。

### 3.5 未接入项：数据库 / 审计（2026-10-09 核对更新）

**依赖已移除**（2026-08-31 `000e40a`）：`@nestjs/typeorm` / `typeorm` / `better-sqlite3` / `class-validator` / `class-transformer` 五个包全库 grep 零引用，已从 `apps/server/package.json` 删除（dependencies 12→7 项），`game.db` 空文件一并不存在。因此：

- 当前服务端是**纯 stateless 透传**，不做用量审计、不存势力目录、无限流。
- `main.ts` 仍挂 `ValidationPipe`，但入参是开放 `Record<string, unknown>`，实际不触发校验（`whitelist` 无从剥离）。
- 原方案的 `UsageLog` / `Faction` 审计层属于**未实现项**；若要做，需重新引入 typeorm + better-sqlite3（后者为原生模块，Node 24 下有重编译风险——这正是当初移除的理由），或在 `AiService` 内加进程内速率限制（不引数据库，更轻）。

---

## 4. 前端：AI 编排层（apps/web/src）

原方案里"后端拼提示词 + 解析 tool_call + 写 SSE"的工作，现在全部在 web 前端完成。相关文件：

| 文件 | 职责 |
|------|------|
| `composables/useAiChat.ts` | **薄 HTTP 封装**：`POST /api/ai/chat`，发完整请求体、收原始 JSON、处理非 2xx 错误。服务于 `useAiOrchestrator`（玩家面板 / god-mode） |
| `composables/useLlmClient.ts` | **统一 LLM 调用层**：`callLlm(opts)` 直 `fetch('/api/ai/chat')`，带退避重试（4xx 不重试 / 5xx 重试）/ 错误归一。`utils/ai/*` 全部 AI 模块的底层出口 |
| `utils/ai/` | **自包含 AI 模块层**（12 文件）：`index`（统一导出）/ `contract`（3 个核心 prompt 常量）/ `client`（re-export `callLlm`）/ `invoke`（通用包装 `invokeAgentDecision`）/ `prompts`（动态模板）/ `context`（上下文构建）+ 6 个角色模块 `factionAi` / `worldAi` / `battleFlavorAi` / `retreatAi` / `peaceAi` / `telegramAi`。详见《开发文档.md》「AI 模块使用规范」 |
| `utils/aiOrderContract.ts` | **唯一指令契约**（真相源）：17 条 `ORDER_TYPES`、结构校验、玩家战略校验、世界 AI 可行性判定、两份 system prompt 文案 |
| `utils/aiPromptBuilder.ts` | 提示词装配（**兼容层**：新代码应走 `utils/ai/prompts.ts` + 各角色模块） |
| `composables/useAiOrchestrator.ts` | **编排**：`runSend()`（组装→发→解析→校验）、`runExecute()`（逐条 `executeOrder`），支持单步撤销/重置 |
| `components/AiDebugPanel.vue` | god-mode 调试面板（`useAiOrchestrator('world')`） |
| `components/PlayerAiPanel.vue` | 玩家军师面板（`useAiOrchestrator('user')`） |

### 4.1 `useAiChat` —— 薄 HTTP 封装

```ts
export interface AiChatRequest {
  messages: { role: string; content: string }[]
  tools?: unknown[]
  model?: string
  temperature?: number
  /** 可选：强制输出格式。后端默认注入 { type:'json_object' }（结构化）；传 {type:'text'} 可覆盖。 */
  response_format?: { type: 'text' | 'json_object' | 'json_schema'; [k: string]: unknown }
  [key: string]: unknown                 // 透传任意 OpenAI 参数
}
async function send(body: AiChatRequest) {
  const res = await fetch('/api/ai/chat', { method:'POST',
    headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
  if (!res.ok) { /* 取 errBody.detail/error 抛错 */ }
  response.value = await res.json()       // 原始 ChatCompletion
}
```
注意：前端**不写死模型名/Key/后端域名**；Vite dev proxy 把 `/api` 指向 `http://localhost:3001`。

### 4.2 `aiPromptBuilder` —— 提示词装配（2026-10-09 核对）

- `buildSystemPrompt(kind)`：`kind==='user'` → `PLAYER_AI_UNIFIED_PROMPT`（玩家势力代理，受限）；否则 → `CONTRACT_SCHEMA_TEXT`（god-mode，最高权限）。两份文案都定义在 `aiOrderContract.ts`，保证"AI 看到的"与"前端校验的"一致。
- **世界态注入已改版**：旧 `buildWorldContext(userText)` / `buildMentionedCities(userText)`（按需匹配提到城市）**已删除**；现由 `aiContext.ts` 的 `buildWorldOverview()` 提供**全势力城市全景**（每行自含 `归属X` 标注），默认随 system prompt 注入，不再按需匹配。
- `buildMessages({ userText, injectContext })`：拼 `[system, (可选 worldContext), user]`。

### 4.3 `aiOrderContract` —— 唯一指令契约

**17 条 `ORDER_TYPES`**（旧方案只规划了 7 条，现已扩充）：
```
arrowFly  radarPulse  orbBurst                              // 纯视觉演出，不改世界态
battle  stopBattle  listBattles  fogCover                    // 战斗控制 + 时间流逝演出
capture  setFactionAlive  setCurrentDate  setCurrentFaction  // 世界态写回（god-mode）
moveTroops  deploy  recruit  develop  fortify  rally         // 军事/内政玩家指令
```

**三层校验**：
1. `validateGameOrder` / `validateOrders` —— **结构校验**（城市码存在/枚举合法/日期格式对）。调试 god-mode 只查结构，不查战略合法性。
2. `validatePlayerOrder` / `validatePlayerOrders` —— **玩家战略硬编码规则**（零 LLM 成本）：未选势力拒、禁 `setFactionAlive`/`setCurrentFaction`、capture 归属须是己方、from 须己方城。
3. `WorldValidationResult` / `WarVerdict`（`feasible`/`difficult`/`impossible`）—— **世界 AI 可行性判定**（仅在 `user` 模式、由模型在 `results` 里给出，前端按三档放行：`feasible` 执行，`difficult`/`impossible` 拦截交还玩家）。

### 4.4 `useAiOrchestrator` —— 编排（send → parse → validate → execute）

`runSend()`：
```ts
const messages = buildMessages({ userText, injectContext })
await send({ messages, response_format: { type: 'json_object' } })
const payloads = extractPayloads(response.value)   // 兼容 content 内 JSON 与 tool_calls.arguments
const merged = payloads.length === 1 ? payloads[0] : payloads

if (mode === 'user' && isUnifiedResult(merged)) {
  // 玩家模式统一格式 {msg, results:[{order,verdict,reason,suggestion,scores}]}
  parsed.value = validateOrders(unified.results.map(r => r.order))
  worldValidation.value = buildFromResults(unified.results)   // 三档判定
} else {
  // god-mode 旧格式 {orders:[...], msg}
  parsed.value = validateOrders(unwrapData(merged))
  aiMessage.value = extractAiMessage(merged)
}
```
- `extractPayloads` 同时支持**模型把 JSON 放在 `content` 文本**和**放在 `tool_calls`** 两种回包——所以前端对"JSON Mode 还是 tool calling"都兼容，后端无需关心。
- `runExecute()`：对每条结构校验通过的指令，`await executeOrder(order)`；结果回显到 `execResults`。（旧稿提到的 `snapshotForUndo()` 撤销快照在代码中不存在，已移除。）

### 4.5 契约形状（AI 回包 JSON）

**god-mode（world）**——`response_format: json_object`，返回：
```json
{
  "orders": [
    { "order": "capture", "gb": "上海", "owner": "KMT", "resultTroops": 20 },
    { "order": "setCurrentDate", "date": "1937-07-07" }
  ],
  "msg": "上海守军易帜，时间推进至卢沟桥事变。"
}
```
> 约定：`setCurrentDate` 须放 `orders` 末项；地点用中文名（前端 `locationResolver` 自动转内部编码）。

**玩家军师（user）**——一次调用同时产出指令 + 可行性判断：
```json
{
  "msg": "川军自重庆挥师东进，剑指杭州",
  "results": [
    { "order": {"order":"battle","from":"成都","to":"汉中"},
      "verdict": "feasible", "reason": "川陕相邻，可行", "suggestion": null,
      "scores": {"geography":4,"military":4,"political":3,"overall":3.7} },
    { "order": {"order":"battle","from":"成都","to":"杭州"},
      "verdict": "impossible", "reason": "千里跃进无胜算", "suggestion": "先经营陕南走廊",
      "scores": {"geography":0,"military":1,"political":0,"overall":0.3} }
  ]
}
```

### 4.6 与游戏内核的接缝：`executeOrder`

- 校验通过的指令最终经 `src/utils/gameOrders.ts` 的 **`executeOrder(order)`** 落地——这是 AI 与 UI 共用的**唯一指令入口**（见 `gameOrders.ts` 文件头注释）。
- `executeOrder` 内部按 `order` 类型分发到各演出/写回函数，世界态变更统一经 `useGameStore` 的 `applyEvent` 落地（事件溯源/回放见引擎架构决策记录）。
- 因此"AI 底层接口"的生产者（前端 `useAiOrchestrator` 产出结构化 `GameOrder`）与消费者（`executeOrder → applyEvent`）通过统一的 `GameOrder` 契约解耦。

---

## 5. 端到端请求流（实际）

1. 用户在 `AiDebugPanel`（god-mode）或 `PlayerAiPanel`（玩家军师）输入自然语言（如"进攻杭州"）。
2. 前端 `useAiOrchestrator.runSend()`：
   - `aiPromptBuilder.buildMessages` 组装 `[system(契约文案), (可选世界态), user(输入)]`；
   - `useAiChat.send({ messages, response_format:{type:'json_object'} })` → `POST /api/ai/chat`。
3. 后端 `AiController.chat` → `AiService.chat`：把 body 原样转给 OpenAI 客户端（带 Key）→ 返回原始 `ChatCompletion` JSON。
4. 前端 `extractPayloads` 抽取 JSON → `validateOrders` 结构校验（玩家模式还跑 `validatePlayerOrders` 战略规则 + 读 `results[].verdict` 做世界 AI 可行性判定）。
5. 用户点执行 → `runExecute()` 逐条 `snapshotForUndo()` + `executeOrder(order)` → 世界态变更 + PixiJS 演出。

---

## 6. 目录结构（与实际代码一致，2026-10-09 核对补全）

```
apps/server/                              # NestJS 后端，独立 package
  .env(.example)                          # LLM_API_KEY / LLM_BASE_URL / LLM_MODEL / LLM_REASONING_EFFORT / PORT / CORS_ORIGIN
  package.json / tsconfig.json / nest-cli.json
  src/
    main.ts                               # NestFactory → CORS → ValidationPipe → prefix 'api' → listen
    app.module.ts                         # ConfigModule + AiModule（无 TypeOrmModule）
    app.controller.ts                     # GET /api/health
    ai/
      ai.module.ts                        # controllers:[AiController], providers:[AiService]
      ai.controller.ts                    # @Post('chat') → AiService.chat(body)
      ai.service.ts                       # 透传 body 给 OpenAI，返回原始 completion（非流式）
      llm.client.ts                       # OpenAI client 工厂 + 必填环境变量校验

apps/web/src/
  composables/
    useAiChat.ts                          # 薄封装：POST /api/ai/chat，收原始 JSON（服务 useAiOrchestrator）
    useLlmClient.ts                       # 统一 LLM 调用层 callLlm（退避重试），utils/ai/* 的底层出口
    useAiOrchestrator.ts                  # 编排：组装→发送→解析→校验→执行（god/user 双模式）
    useAgentKernel.ts                     # 回合编排：P2 分类 → P3 并行决策 → P4a 战斗结算 → P4b 叙事+日期
    useGameScheduler.ts                   # 指令队列调度 + settleActiveBattles
    useDiplomacyBus.ts                    # 外交三段式总线（含赴列强求援）
    useSaveGame.ts                        # 存档/读档（loadGame → requestMapReload）
  utils/
    ai/                                   # 自包含 AI 模块层（index/contract/client/invoke/prompts/context
                                         #  + factionAi/worldAi/battleFlavorAi/retreatAi/peaceAi/telegramAi）
    aiOrderContract.ts                    # 指令契约（17 条）+ 三层校验 + 两份 system prompt
    aiContext.ts / aiHistory.ts / aiParse.ts / aiPromptBuilder.ts（兼容层）
    gameOrders.ts                         # executeOrder 唯一指令入口
    battleFormula.ts / economy.ts / eventClamp.ts / freeActionRules.ts / chronicle.ts / battleTrend.ts …
  data/
    gameConfig.ts                         # 全部平衡参数（含单胜奖励/威慑、freeAction 钳制）
    milestones.ts                         # 战纪里程碑谓词表（13 条）
    owners.ts / chinaCities.ts / worldCountries.ts / displayNames.ts / scenarioBrief.ts
  components/
    AiDebugPanel.vue                      # god-mode 调试（useAiOrchestrator('world')）
    PlayerAiPanel.vue                     # 玩家军师（useAiOrchestrator('user')）
    ChroniclePanel.vue                    # 战纪（成长轨迹）
```

---

## 7. 安全与运维清单（更新）

- [x] `.env` 已 `gitignore`，Key 不入仓库、不入前端；前端零硬编码后端域名与 Key。
- [x] 生产 `CORS` 由 `CORS_ORIGIN` 环境变量控制（默认 `http://localhost:5173`）；同时 Vite dev proxy `/api → http://localhost:3001` 也生效。
      > ⚠ 注意：Vite 实际开发端口在 `vite.config.ts` 里是 **5714**，而 `CORS_ORIGIN` 默认 5173。本地联调时需把 `CORS_ORIGIN` 设为 `http://localhost:5714`（或改 Vite 端口为 5173），否则浏览器会被 CORS 拦截。
- [x] 后端对 LLM 异常统一转 502，缺配置转 503，错误 `detail` 不泄露 Key。
- [x] **质量门禁**（2026-10-09 实跑）：`vue-tsc --noEmit` exit 0；`vitest run --pool=threads` 290 passed / 21 files；`eslint .` exit 0；`oxlint .` 3 处 error（均在 `llmClient.spec.ts`）。
- [ ] **限流/审计未实现**：服务端 stateless（数据库依赖已移除），暂无按 IP/token 的限流与 `UsageLog`。若 Key 有泄漏风险，建议尽快在 `AiService` 加一层进程内速率限制（比重建 typeorm + better-sqlite3 审计链更轻）。
- [ ] **请求体大小/超时限制**：当前 `AiService` 未设 LLM 调用超时兜底，依赖 OpenAI SDK 默认；生产建议显式设 `timeout` 并兜底返回错误。
- [x] dev 用 Vite proxy，前端代码零硬编码后端地址与 Key。

---

## 8. 与原始方案差异（重要，务必阅读）

| 维度 | 原方案（评估） | 实际落地 | 影响 |
|------|---------------|----------|------|
| 后端角色 | SSE 流式 + tool calling + 自带提示词 + 解析 Order + TypeORM | **纯透传代理**：只转发 OpenAI 请求/回包 | 后端极简、易维护；AI 智能全在前端 |
| 端点 | `POST /api/ai/decide` | `POST /api/ai/chat` | 路径变了，调用方注意 |
| 流式 | 手写 SSE（`thinking`/`order`/`done`） | 普通 JSON，无 SSE | 无增量"思考"展示；前端取 `msg`/`reason` |
| 结构化输出 | 注册 7 个 tools | **JSON Mode**（`response_format: json_object`），兼容 content/tool_calls | 解析更轻，但依赖模型稳定吐 JSON |
| 提示词/契约 | 后端拼 + 7 指令 | 前端 `aiPromptBuilder`+`aiOrderContract`，**17 指令**（旧稿记 12，已过时） | 契约真相源在前端 |
| 校验 | 后端解析 tool_call→Order | 前端 `validateOrders`+`validatePlayerOrders`+世界 AI 判定 | 校验全在前端 |
| 数据库 | TypeORM + SQLite 审计 | **依赖已整体移除**（2026-08-31），stateless | 无审计/限流；重建需重新引依赖 |
| 模型 | DeepSeek | OpenAI 兼容（默认 deepseek-chat，实际配 stepfun） | 可换，前端无感 |
| 健康检查 | 无 | 新增 `GET /api/health` | 运维可用 |
| AI 编排范围 | 仅调试面板 + 玩家军师 | **Agent-Kernel 全自动推演已落地**（2026-07 起）：`useAgentKernel` P2 分类 → P3 并行 `decideFaction`/`runWorldBatch` → P4a 战斗结算 → P4b 叙事+日期，`utils/ai/` 12 个自包含模块 | 不再是"调试/预生产"路径 |

**结论**：原始方案把"AI 接入"设计成后端重、前端轻；落地版反了过来——**后端只做安全透传，AI 编排职责前移到 web 前端**。这套实现既服务于调试面板（`AiDebugPanel` god-mode）与玩家军师（`PlayerAiPanel`），也支撑完整的 Agent-Kernel 自动推演（势力 AI / 世界 AI / 战斗裁决 / 撤退 / 议和 / 电报各角色模块，见《开发文档.md》「AI 模块使用规范」与《引擎架构决策记录.md》§5）。

---

## 9. 与"游戏侧事件接口"方案的关系

- 本方案（AI 接入层）= **生产者**：安全地把 LLM 接进来，由前端 `useAiOrchestrator` 产出结构化 `GameOrder`。
- 游戏侧指令层（`src/utils/gameOrders.ts` 的 `executeOrder`）= **消费者**：把 `GameOrder` 应用到世界状态（`useGameStore.applyEvent`）并触发 PixiJS 动画副作用。
- 两者通过统一的 `GameOrder` 契约解耦：前端 `useAiOrchestrator.runExecute → executeOrder(order)`。

*注：早期那版被误当成"AI 底层接口"的文档，实际是"游戏侧事件接口（消费者）"。本文件是 AI 接入方案（生产者），且已按现状重写为"后端透传 + 前端编排"的真实形态。*
