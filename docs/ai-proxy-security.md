# AI 模型代理安全加固（apps/server）

本次改动包含代理安全边界与离线测试；**未部署上线**，也未调用真实模型。生产环境需要完成下述认证与反向代理配置后才能启用 AI。

## 端点行为

| 端点 | 行为 |
| --- | --- |
| `POST /api/ai/chat` | 先认证，再检查 LLM 是否已配置，然后做限流、schema 白名单校验、并发/排队，最后访问上游 |
| `GET /api/ai/health` | 默认只返回配置状态，**不调用模型**，零成本 |
| `GET /api/ai/health?probe=1` | 必须同时满足 `AI_HEALTH_PROBE_ENABLED=true`、认证通过、计入限流；结果缓存 `AI_HEALTH_PROBE_COOLDOWN_MS`（默认 5 分钟），并发探活合并为一次；上游请求用 `max_tokens=16` |
| `GET /api/health` | 进程存活检查，不变 |

## 认证模式（`AI_PROXY_AUTH_MODE`）

- **`local-dev`**：非 production 时的默认值。只接受对端为回环地址（127.0.0.0/8、::1）**并且**不带 `X-Forwarded-For` / `Forwarded` / `X-Real-IP` / `X-Forwarded-Host` 头的请求。这样即便同机反向代理把公网流量转进来，也不会被当成本机请求。Vite 开发代理（`changeOrigin: true`，没有开 `xfwd`）从本机直连，前端联调不需要任何秘钥。如果你的开发代理会加转发头，可以设置 `AI_PROXY_DEV_ALLOW_FORWARDED=true`（仅开发环境）。
- **`shared-secret`**：生产 / 公网部署时使用。反向代理先自己完成用户 session/登录校验（例如 oauth2-proxy、basic auth、SSO），再向上游注入 `x-ai-proxy-secret: <AI_PROXY_SHARED_SECRET>`。秘钥至少 32 字符，比较时先做 SHA-256 再恒定时间比较。**前端和浏览器都不持有秘钥。**
- **`disabled`**：关闭 AI 调用（返回 503）。
- **fail closed**：`NODE_ENV=production` 时，如果没设置模式、设成 `local-dev`、秘钥缺失或太短，或任何预算变量非法，AI 调用一律返回 503 `ai_proxy_unavailable`，启动日志会打印 ERROR。非 production 下配置非法也同样拒绝。

### 反向代理信任边界（必须做到）

1. 后端只监听 `127.0.0.1`（`HOST=127.0.0.1`）或私有网络，不能直接暴露到公网。
2. 反向代理**必须覆盖或删除**客户端发来的同名 `x-ai-proxy-secret` 头，以及 `AI_PROXY_CLIENT_ID_HEADER` 指定的身份头，然后再自行设置。
3. 后端**不开** Express `trust proxy`，也不读 `X-Forwarded-For`。限流 key 在设置了 `AI_PROXY_CLIENT_ID_HEADER` 并且秘钥校验通过时用 `user:<身份头>`，否则用 socket 对端 IP。经过反向代理时对端 IP 都是代理本身，所以没有身份头时，单客户端限流实际上等同于全局限流。
4. 秘钥只放在后端 `.env` 和代理配置里，定期轮换（两边同时更新）。

nginx 示例（假设 auth_request 已经完成登录校验）：

```nginx
location /api/ {
    auth_request /oauth2/auth;
    auth_request_set $user $upstream_http_x_auth_request_user;
    proxy_set_header x-ai-proxy-secret "<AI_PROXY_SHARED_SECRET>";   # 覆盖客户端同名头
    proxy_set_header x-auth-request-user $user;                       # 覆盖客户端同名头
    proxy_read_timeout 95s;
    proxy_pass http://127.0.0.1:3001;
}
```

## 请求 schema（显式白名单，不透传任意字段）

允许的顶层字段只有：`messages`、`model`、`response_format`、`reasoning_effort`、`max_tokens`、`temperature`。出现任何其他字段（`tools`、`stream`、`n`、`user`、`logit_bias` 等）都直接返回 **400** `ai_invalid_request`，并在 `detail` 里列出问题。

- `messages`：非空数组；每条只能有 `{role: system|user|assistant, content: string}`；条数、单条字符数、总字符数都有上限。
- `model`：可选，必须在 `LLM_ALLOWED_MODELS` 里（默认只允许 `LLM_MODEL`）。
- `response_format`：`text` / `json_object` / `json_schema`（`json_schema` 只允许 name/schema/strict/description 字段，schema 大小有上限）。
- `reasoning_effort`：`low|medium|high`，默认取 `LLM_REASONING_EFFORT`。
- `max_tokens`：服务端会强制设置。默认等于上限，客户端只能调低。
- 服务端固定 `stream: false`。

**兼容性**：前端现有调用都能正常工作——`{messages, response_format}`、可选的 `model`，以及 `reasoning_effort`。响应仍然原样返回上游的 completion 对象，`choices[0].message.content` 不变。新增行为：请求默认带上 `max_tokens=8192`；非 JSON 请求体会返回 400；`useAiChat` 的类型虽然允许 `tools`/任意键，但当前没有调用方会传这些字段，传了就会 400。

## 默认预算及选择理由

| 变量 | 默认值 | 理由 |
| --- | --- | --- |
| `LLM_TIMEOUT_MS` | 70000 | 前端单次尝试超时 90s（`WORLD_AI_ATTEMPT_TIMEOUT_MS`）；排队 15s + 上游 70s 小于 90s，能在前端放弃之前先返回 |
| `LLM_MAX_RETRIES` | 0（最大 2） | 前端已有 3 次退避重试；SDK 默认 2 次重试会让请求量放大到 3×3 |
| `LLM_MAX_OUTPUT_TOKENS` | 8192 | 足够输出 JSON 指令并留出推理余量，同时限制单次输出成本 |
| `AI_MAX_BODY_BYTES` | 524288 | 原 Nest 默认上限是 100KB；放宽到 512KB 保证中文 prompt 兼容，字符级预算另行限制 |
| `AI_MAX_MESSAGES` / `AI_MAX_MESSAGE_CHARS` / `AI_MAX_TOTAL_CHARS` | 40 / 60000 / 100000 | 世界回合 prompt 是 2 条 system 消息；100k 字符大约对应几万 token，留在常见上下文窗口之内 |
| `AI_RATE_LIMIT_PER_CLIENT_PER_MIN` | 40 | 一个世界回合约有 10 多个并行调用（相关势力 + 批量 + 结算 + 战斗描写） |
| `AI_RATE_LIMIT_GLOBAL_PER_MIN` | 120 | 适合单实例小规模部署的成本上限 |
| `AI_MAX_CONCURRENT` / `AI_MAX_QUEUE` / `AI_QUEUE_TIMEOUT_MS` | 12 / 24 / 15000 | 能覆盖一个回合的并行扇出；队列满或排队超时返回 503 `ai_busy` 并带 `Retry-After`（前端会按 5xx 有限重试） |

限流超出时返回 **429**，并带 `Retry-After`。前端把 4xx 当作不可重试，因此不会放大请求量。所有计数都在单进程内存里；多实例部署需要在网关层另做全局限流。

## 取消与超时

- 当响应在完成之前 `close`（前端 AbortController 触发、前端超时、或连接断开），后端会中止 `AbortSignal`：排队中的请求出队，上游 OpenAI SDK 请求随之取消，并发名额立即释放。
- 上游超时返回 504 `ai_upstream_timeout`，其他上游错误返回 502。日志只记录元数据（客户端、模型、条数、字符数、耗时），**不记录 prompt 或回复内容**（旧版会打印健康检查的完整回包）。

## 部署所需配置（生产）

```env
NODE_ENV=production
HOST=127.0.0.1
LLM_API_KEY=...
LLM_BASE_URL=...
LLM_MODEL=deepseek-chat
AI_PROXY_AUTH_MODE=shared-secret
AI_PROXY_SHARED_SECRET=<openssl rand -hex 32>
# 可选
AI_PROXY_CLIENT_ID_HEADER=x-auth-request-user
LLM_ALLOWED_MODELS=deepseek-chat
```

再加上认证模式章节所述的反向代理配置。完整变量列表见 `apps/server/.env.example`。

## 测试

```bash
cd apps/server
pnpm test         # tsc -p tsconfig.test.json && node --test（离线，假上游）
pnpm run build    # nest build（tsconfig.build.json 排除 test/）
```

一共 42 个用例，覆盖：配置 fail closed、local-dev 回环与转发头检查、shared-secret 与身份头、schema 白名单与预算、限流与 Retry-After、并发队列满/超时/取消、客户端断开传播到上游、413 请求体上限、健康检查默认零调用与探活缓存、SDK 显式 timeout/maxRetries。

另已启动真实 Nest 与当前 Vite 开发代理做本机 HTTP 联调：`POST /api/ai/chat` 的空请求返回预期的 400 `ai_invalid_request`，而非认证失败的 403；默认 AI health 返回 `probed:false`。联调使用占位配置和不可访问的本机上游地址，未发送有效模型请求。
