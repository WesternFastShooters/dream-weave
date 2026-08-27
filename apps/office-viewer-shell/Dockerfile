# Build from repository root: docker build -f apps/office-viewer-shell/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/office-viewer-shell/package.json apps/office-viewer-shell/package.json
RUN corepack enable && COREPACK_ENABLE_PROJECT_SPEC=0 corepack prepare pnpm@11.15.1 --activate \
  && COREPACK_ENABLE_PROJECT_SPEC=0 pnpm install --filter @dream-weave/office-viewer-shell --no-frozen-lockfile
COPY apps/office-viewer-shell apps/office-viewer-shell
RUN COREPACK_ENABLE_PROJECT_SPEC=0 pnpm --filter @dream-weave/office-viewer-shell build

FROM nginx:1.27-alpine
COPY --from=build /workspace/apps/office-viewer-shell/dist /usr/share/nginx/html/dw-viewer-shell
COPY apps/office-viewer-shell/nginx/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY apps/office-viewer-shell/nginx/entrypoint.sh /entrypoint.sh
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
