# map-war

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
pnpm dev            # 并行启动前端(5173)与后端(3001)
```

仅启动某一端：

```sh
pnpm dev:web        # 仅前端
pnpm dev:server     # 仅后端
```

## 构建

```sh
pnpm build          # 依次构建前后端（pnpm -r run build）
```

## 约定

- 前端通过 Vite 代理把 `/api` 转发到后端 `http://localhost:3001`。
- 后端监听 `3001`，全局前缀 `api`，CORS 默认允许 `http://localhost:5173`。
- 原生模块（如 `better-sqlite3`）的构建已在根 `.npmrc` 的 `only-built-dependencies` 中放行。
- `.mimocode/`、`.omo/` 为外部工具产物，已在 `.gitignore` 中排除。
