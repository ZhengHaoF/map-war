# 烽火舆图 · Warlords 1931

全栈战争地图策略游戏。仓库采用 **pnpm workspace** 单仓多包（monorepo）结构：

| 目录 | 说明 |
| --- | --- |
| `apps/web` | 前端：Vue 3 + Vite + Pinia + Vue Router + PixiJS 8 |
| `apps/server` | 后端：NestJS + TypeORM + better-sqlite3，DeepSeek AI 代理 |
| `scripts/` | 数据处理脚本（Python） |
| `docs/` | 项目文档 |

## 快速开始

```sh
pnpm install        # 在仓库根目录一次安装前后端依赖（单一锁文件）
pnpm dev            # 并行启动前端(5714)与后端(3001)
```

仅启动某一端：

```sh
pnpm dev:web        # 仅前端
pnpm dev:server     # 仅后端
```

> ⚠️ **端口对齐**：前端 Vite 实际端口是 **5714**（`apps/web/vite.config.ts`），而后端 `CORS_ORIGIN` 默认是 `http://localhost:5173`（`apps/server/.env.example`）。本地联调请把 `apps/server/.env` 的 `CORS_ORIGIN` 改为 `http://localhost:5714`，否则浏览器会因 CORS 拦截 `/api` 请求（Vite 的 `/api` dev proxy 只解决「前端→后端」连通，不解决浏览器跨域预检）。

## 地图行军

点击工具栏“进攻”或“调兵”，在地图选择己方出发城，再选择敌城或己方目的城。已有己方选中城时省去出发城步骤；选城只填入行军预览，调整兵量、检查路线与银粮后仍需点击底栏“确认进攻／确认调兵”，不会自动发兵。

绿色表示路线和外交上可选，蓝色为出发城，朱砂色为目标；高亮不代表预算充足或战斗安全。支持地图重选、下拉选择和取消；A 进攻、M 调兵、Esc 取消，输入框与推演期间不触发字母快捷键。详见 [地图选城实施与验收](docs/map-command-shortcuts-implementation.md)。

## 构建

```sh
pnpm build          # 依次构建前后端（pnpm -r run build）
```

## 约定

- 前端通过 Vite 代理把 `/api` 转发到后端 `http://localhost:3001`。
- 后端监听 `3001`，全局前缀 `api`，CORS 默认允许 `http://localhost:5173`（与前端实际端口 5714 不一致，本地需按上文改 `.env`）。
- 前端地图为**纯 PixiJS 8 渲染**（无 Leaflet 依赖；`LeafletMap.vue` 是历史遗留组件名）。
- 原生模块构建放行只保留 `unrs-resolver`（根 `.npmrc`）与 `@nestjs/core`（根 `pnpm-workspace.yaml` 的 `allowBuilds`）；better-sqlite3 等五个零引用依赖已于 2026-08-31 从后端移除。
- `.mimocode/`、`.omo/` 为外部工具产物，已在 `.gitignore` 中排除。
