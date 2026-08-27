---
type: Source Map
title: Dream Weave source map
description: Change-oriented map from Dream Weave product and runtime concerns to primary source, contract, infrastructure, and test locations.
tags: [source-map, navigation, monorepo]
---
# Source map

Use this map to identify the canonical change location before editing. Follow the linked concept pages for behavior and constraints.

| Concern | Primary source | Related evidence/tests |
| --- | --- | --- |
| Browser bootstrapping and project composition | `apps/canvas/src/main.tsx`, `apps/canvas/src/composition/` | [`architecture`](architecture/overview.md), `apps/canvas/test/` |
| HTTP client and upload adapters | `apps/canvas/src/services/` | [`workflows`](workflows/canvas-and-assets.md), real-service specs |
| Canvas model, commands, history, HTTP repository | `packages/canvas-core/src/` | [canvas node catalog](domain/canvas-node-catalog.md), `packages/canvas-core/test/`, API generated output |
| Pointer/keyboard/selection/drag behavior | `packages/canvas-interaction/src/` | `packages/canvas-interaction/test/`, fixture UI |
| React Flow document projection, controls, layout, and persistent connection edge interaction | `packages/canvas-renderer/src/` | [canvas node catalog](domain/canvas-node-catalog.md), [canvas workflows](workflows/canvas-and-assets.md), `packages/canvas-renderer/test/`, fixture UI |
| Product node UI, media, web previews | `packages/creative-nodes/src/` | [canvas node catalog](domain/canvas-node-catalog.md), `packages/creative-nodes/test/` |
| Public contract source | `apps/server/api/dreamweave/v1/*.proto` | [backend capability map](architecture/backend-map.md), `apps/server/Makefile`, generated Go and `canvas-core/src/api/generated/` |
| Server assembly and HTTP transport | `apps/server/internal/app/`, `internal/transport/dreamweavev1/` | [backend capability map](architecture/backend-map.md), `internal/transport/**/_test.go` |
| Project role checks | `apps/server/internal/projects/projects.go` | [`domain/security`](domain/security.md) |
| Sessions/origin middleware | `apps/server/internal/identity/identity.go` | [`domain/security`](domain/security.md) |
| Canvas transactions and revision/idempotency | `apps/server/internal/canvas/` | [`workflows`](workflows/canvas-and-assets.md), canvas service tests |
| Assets, upload tickets, access capabilities | `apps/server/internal/assets/`, `internal/resourceaccess/` | [`domain/security`](domain/security.md), asset/capability tests |
| Preview processing and URL validation | `apps/server/internal/preview/`, `cmd/preview-worker`, `cmd/media-preview-processor` | [`workflows`](workflows/canvas-and-assets.md), worker/SSRF/HTML tests |
| Office session/source proxy | `apps/server/internal/office/`, `apps/office-viewer-shell/` | [backend capability map](architecture/backend-map.md), [`operations`](operations/runbook.md), `office-real.spec.ts` |
| Schema evolution | `apps/server/migrations/` | [`domain/security`](domain/security.md), migration CI check |
| Local runtime | root `Makefile`, `scripts/dev.mjs`, `infra/compose/local/` | [`operations`](operations/runbook.md) |
| Kubernetes deployment | `infra/helm/dream-weave/` | [`operations`](operations/runbook.md), static-manifest CI job |
| Quality gates | `.github/workflows/canvas-ci.yml`, package test config | [`testing`](testing/quality.md) |
| Wiki maintenance automation | `.github/workflows/openwiki-update.yml`, `openwiki/INSTRUCTIONS.md` | scheduled daily update workflow |

## High-risk change paths

- A new persistent canvas node or connection behavior usually crosses `canvas-core` → `.proto` → server mutation/repository → migration → renderer/creative-node registry → real-service tests. Update the [canvas node catalog](domain/canvas-node-catalog.md) and [backend capability map](architecture/backend-map.md) with concrete paths; the canonical behavioral guide is [canvas and assets](workflows/canvas-and-assets.md).
- A new asset delivery mode crosses asset service → capability verification/native handler → preview/Office behavior if applicable → proxy/ingress configuration → real-service tests. Its non-negotiable security rules live in [domain and security](domain/security.md) and the capability trace belongs in the [backend capability map](architecture/backend-map.md).
- An origin or network change crosses server config → local Compose/reverse proxy → Helm ingress/NetworkPolicy → real integration/static manifest checks. Use [operations](operations/runbook.md) and [testing](testing/quality.md) together.
