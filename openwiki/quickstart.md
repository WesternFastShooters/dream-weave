---
type: Repository Guide
title: Dream Weave quickstart
description: "Entry point for the Dream Weave full-stack canvas monorepo: local startup, architecture map, workflow, security, operations, tests, and source navigation."
tags: [dream-weave, monorepo, canvas, quickstart]
---
# Dream Weave

Dream Weave is a pnpm monorepo for a project-scoped creative canvas. Its React/Vite application uses shared TypeScript canvas packages and a generated HTTP client to talk to a Go service backed by PostgreSQL and S3-compatible storage. Media and sandboxed HTML previews are asynchronous; office files are rendered read-only through an isolated ONLYOFFICE path.

Start with this page, then use the linked concepts below rather than treating the repository as an undifferentiated file tree.

## Start locally

1. Install the prerequisites named in [`README.md`](../README.md): Docker Desktop, `mkcert`, Node 22+, Go 1.25, and FFmpeg. Install workspace dependencies with `pnpm install`.
2. Copy `infra/compose/local/.env.example` to `infra/compose/local/.env` and populate its required runtime values. Do **not** commit it or record secret values in documentation.
3. Run `make dev`, then open `https://app.localhost`. The root [`Makefile`](../Makefile) starts the hybrid development workflow; `make dev-down` stops its containers and `make acceptance` starts the all-container acceptance environment.

For a browser-only UI shell, `pnpm dev` runs `apps/canvas` at its Vite default. That is not equivalent to the secure, service-backed path used by `make dev`.

## Documentation map

- [Architecture overview](architecture/overview.md) explains the browser, package, API, persistence, worker, and deployment boundaries.
- [Backend capability map](architecture/backend-map.md) traces each public capability from protobuf/transport through Go ownership, persistence or async work, security boundary, and tests.
- [Canvas and asset workflows](workflows/canvas-and-assets.md) traces editing, revision conflicts, uploads, rendering, previews, and Office integration end to end.
- [Canvas node catalog](domain/canvas-node-catalog.md) is the complete `CanvasItemKind` inventory with model, renderer, creation, dependency, and test paths.
- [Domain and security](domain/security.md) defines projects, roles, canvas documents, assets, sessions, capability URLs, and boundary controls.
- [Operations runbook](operations/runbook.md) covers local development, Compose, Helm, migrations, contract generation, and deployment constraints.
- [Testing and quality](testing/quality.md) maps unit, component, browser, integration, Office, and manifest checks.
- [Source map](source-map.md) is the change-oriented map from product concern to implementation location.

## Repository shape

- `apps/canvas` is the browser canvas app.
- `apps/server` contains Go API definitions, services, migrations, and executables.
- `apps/office-viewer-shell` is the separate browser shell for ONLYOFFICE.
- `packages/canvas-core`, `canvas-interaction`, `canvas-renderer`, and `creative-nodes` separate model/persistence, interaction behavior, React Flow projection, and product node UI.
- `infra/compose/local` and `infra/helm/dream-weave` package the local and Kubernetes runtime.

## Current implementation context

Since the prior documentation baseline, the committed implementation added Frame creation/rename and grouped dragging, tool-driven placement/lasso/keyboard behavior, pointer-anchored wheel zoom, and Crepe-based Markdown editing with content-height resizing. It also made Office/PDF sessions opaque to the parent page and moved their runtime configuration behind the Office origin. The current worktree adds persistent canvas connections: a project canvas snapshot carries styled, handle-to-handle edges, and create/update/delete mutations use the same revision-checked document path as nodes and placements. Use the [canvas node catalog](domain/canvas-node-catalog.md), [canvas workflows](workflows/canvas-and-assets.md), and [backend capability map](architecture/backend-map.md) before changing that cross-layer behavior.

## Change checklist

- Preserve the separation between persistent canvas state and transient interaction state described in [canvas workflows](workflows/canvas-and-assets.md).
- When a public API `.proto` changes, regenerate both Go and TypeScript outputs through `make -C apps/server api`, then use the server’s `verify` target.
- When changing rendering, auth, uploads, preview delivery, or Office behavior, read [domain and security](domain/security.md) and run the relevant real-service tests from [testing guidance](testing/quality.md).
- When changing deployment manifests or origin/network behavior, validate against [operations](operations/runbook.md); the preview host and Office source proxy are intentional security boundaries.

## Backlog

- **Production observability and incident response** — source anchor: `infra/helm/dream-weave/templates/`; deferred because the chart defines probes and deployment wiring but no dedicated monitoring, alerting, backup, or restoration runbook was found.
