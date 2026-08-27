FROM node:22-alpine AS build
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/canvas/package.json apps/canvas/package.json
COPY packages/di/package.json packages/di/package.json
COPY packages/canvas-core/package.json packages/canvas-core/package.json
COPY packages/canvas-interaction/package.json packages/canvas-interaction/package.json
COPY packages/canvas-renderer/package.json packages/canvas-renderer/package.json
COPY packages/creative-nodes/package.json packages/creative-nodes/package.json
# Corepack rejects the root devEngines range before pnpm can run. Install the
# pinned workspace package manager directly inside the isolated build image.
RUN corepack disable pnpm && npm install --global pnpm@11.5.2 && pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @dream-weave/creative-nodes... run build && pnpm --filter @dream-weave/canvas-app build
FROM nginx:1.27-alpine
COPY --from=build /src/apps/canvas/dist /usr/share/nginx/html
COPY apps/canvas/nginx.conf /etc/nginx/conf.d/default.conf
