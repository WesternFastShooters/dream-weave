# Dream Weave

基于 pnpm workspace 的 monorepo。

## 目录

- `apps/`：可部署的应用
- `packages/`：共享包与配置

画布的分层包：

- `@dream-weave/canvas-core`：项目画布文档、命令、持久化与 Undo/Redo
- `@dream-weave/canvas-renderer`：React Flow 文档投影与节点注册
- `@dream-weave/canvas-interaction`：选区、视口、拖拽、删除与通用事件中心

## 全栈开发

日常开发使用根目录的 `make dev`。它用 Docker 启动 PostgreSQL、MinIO、迁移、ONLYOFFICE 与 HTTPS 反向代理；前端使用 Vite HMR，本机 Go Server、预览 Worker 与媒体处理器在源码变更后自动重启。

首次运行前，复制 `infra/compose/local/.env.example` 为 `.env`，填入密码和密钥，并安装 Docker Desktop、mkcert、Node.js 22、Go 1.25 与 FFmpeg。随后执行：

```bash
make dev
```

访问 `https://app.localhost`。`make dev` 会仅在本机 Vite 开发服务中使用 `.env` 的管理员账号自动登录，并记住最近项目；生产构建和 `make acceptance` 不包含该行为。`make dev-down` 停止并移除开发容器。需要验证最终容器镜像时，执行 `make acceptance`；它会先构建镜像再启动完整的容器化环境。

## 常用命令

```bash
pnpm install
pnpm dev
pnpm build
pnpm lint
pnpm test
pnpm typecheck
```

首次在新机器运行浏览器端测时，安装 Chromium：

```bash
pnpm --filter @dream-weave/canvas-renderer exec playwright install chromium
```

`pnpm test` 会执行三个层次的画布验证：核心命令单测、React/jsdom 交互测试，以及 Chromium Playwright 端测。

`pnpm dev` 会启动 `apps/canvas`，默认地址为 `http://localhost:5173`。
