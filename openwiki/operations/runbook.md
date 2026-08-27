---
type: Operations Runbook
title: Local development and deployment runbook
description: Practical runtime guidance for Dream Weave local development, Compose, generated contracts, migrations, Kubernetes deployment, and security-sensitive configuration.
tags: [operations, development, compose, helm, deployment]
---
# Local development and deployment runbook

## Local development modes

Use `make dev` for the normal full-stack loop. The root [`Makefile`](../../Makefile) checks for `mkcert` and starts [`scripts/dev.mjs`](../../scripts/dev.mjs). The script expects `infra/compose/local/.env`, provisions local certificates, starts the Compose dependencies, runs the Go server/preview worker/media processor natively with source-change restart, and starts Vite with HMR. Open `https://app.localhost`.

The local base Compose file supplies PostgreSQL 17, MinIO, MinIO initialization, migrations, Nginx TLS reverse proxy, ONLYOFFICE Document Server, and the Office viewer shell. The development overlay swaps app/worker/frontend containers for host processes. Use:

```bash
make dev          # hybrid daily workflow
make dev-logs     # follow Compose services
make dev-down     # remove local development containers
make acceptance   # container-only manual acceptance setup
```

The first run requires Docker Desktop, mkcert, Node 22, Go 1.25, and FFmpeg. Copy the provided example environment file; only document variable names and keep its values private. The three local origins—`app.localhost`, `preview.localhost`, and `office.localhost`—are required by [the security model](../domain/security.md), not optional aliases.

## Contracts, builds, and migrations

Root scripts dispatch recursively through pnpm: `pnpm build`, `lint`, `test`, and `typecheck`. The API source of truth is `apps/server/api/dreamweave/v1/*.proto`; `make -C apps/server api` regenerates Go and TypeScript outputs. `make -C apps/server verify` regenerates, rejects generated drift, runs Go tests, and builds principal server commands.

Migrations run via `make -C apps/server migrate` (which requires `DATABASE_URL`) and automatically before dependent services in local Compose. Migration changes must be forward-compatible and idempotent: CI checks that every migration is present in the ledger and can be rerun. The domain impact of migrations is summarized in [domain and security](../domain/security.md).

## Production chart

`infra/helm/dream-weave` deploys the server, canvas frontend, Office viewer shell, one preview worker, ONLYOFFICE, and a pre-install/pre-upgrade migration Job. PostgreSQL and object storage are external services; the chart reads their credentials and other runtime material from a pre-created `dream-weave-runtime` Kubernetes Secret.

Defaults use `latest` image tags in `values.yaml`; pin immutable release tags in an actual deployment. Public ingress exposes separate TLS hosts:

- `app.<domain>` for the application/API;
- `preview.<domain>` for capability-scoped asset delivery only;
- `office.<domain>` for the viewer shell; its `/internal/office-viewer-sessions/` route reaches the server while DocsAPI and other Document Server routes remain on the Office origin.

The chart also creates an upload route with a 1 GB body limit. Keep object storage private: browser upload is routed through the same-origin proxy rather than opened via bucket CORS. The Office route split is required for the opaque, no-store viewer-session bootstrap documented in the [backend capability map](../architecture/backend-map.md).

## Security-sensitive deployment checks

- `onlyoffice.documentServerCIDRs` is required and must be the actual Document Server pod CIDR(s). The chart cannot infer it. The NetworkPolicy permits the Office source proxy only from that identity.
- Required runtime secret keys include database URL, object-store endpoint/credentials, bootstrap admin credentials, capability secret, ONLYOFFICE JWT secret, and preview processor configuration. Never place their values in `values.yaml`, wiki pages, logs, or commits.
- Server readiness is `/readyz` (includes database ping) and liveness is `/healthz`; the viewer shell has `/healthz` readiness.
- Production integrations and static manifests are exercised by [testing and quality](../testing/quality.md). Do not rely on fixture UI tests to validate ingress, capability origin, migration, or Office configuration.

## Troubleshooting order

1. For startup, confirm prerequisites and the local environment file exist; do not inspect/share its secret values.
2. For a blank/inaccessible app, inspect `make dev-logs`, proxy/certificate setup, and server readiness.
3. For uploads/previews, check migration completion, MinIO initialization, preview-worker availability, and then asset/job state.
4. For Office failures, check the document server health, configured source-proxy base, JWT secret agreement, and actual permitted CIDR.
5. For contract failures, regenerate from `.proto` sources and run server `verify` before editing generated output.

The implementation locations for each concern are linked from [the source map](../source-map.md); behavior-level flows are in [canvas and assets](../workflows/canvas-and-assets.md).
