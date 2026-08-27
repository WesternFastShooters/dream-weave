---
type: Testing Guide
title: Testing and quality gates
description: Test layers and CI quality gates for Dream Weave canvas behavior, generated contracts, real services, secure rendering, Office integration, and deployment manifests.
tags: [testing, ci, playwright, vitest, go]
---
# Testing and quality gates

## Test layers

Dream Weave uses separate test tiers because the fixture canvas and full secure runtime validate different claims.

| Layer | Primary location | What it establishes |
| --- | --- | --- |
| Go unit/service tests | `apps/server/internal/**/**/*_test.go` | Canvas mutations, assets, capabilities, preview worker, SSRF validation, Office services, transport, and config behavior. |
| TypeScript/Vitest | `packages/*/test/` | Canvas commands/history and generated client (including connection snapshot, lifecycle, undo/redo, and protocol adaptation), DI, interaction hooks, renderer registry/toolbars, and creative media/web nodes. |
| Fixture UI Playwright | `apps/canvas/test/e2e/fixture-ui.spec.ts` | Browser UI and visual baseline using in-memory/fake providers, including four connection anchors per node, edge styling, and all directed pairs of the ten node kinds—without Postgres, MinIO, server, or Document Server. |
| Real-service Playwright | `real-service`, `html-real-service`, `media-real-service` specs | Live API/database/object-store flows, including revision conflicts, persistent connection reload/style behavior, and secure asset behavior. |
| Office Playwright | `office-real.spec.ts` | A real ONLYOFFICE Document Server loads DOCX/XLSX/PPTX/PDF through the private read-only source path and opaque Office-shell session flow. |
| Static manifest checks | `.github/workflows/canvas-ci.yml` | Helm routes, migration hook, preview origin, upload route/body limit, Office proxy, and Compose validity. |

`apps/canvas/playwright.config.ts` defines the three projects: `fixture-ui`, `real-service`, and `office-real`. It fixes Chromium, a 1440×900 viewport, UTC, and `zh-CN`; the fixture screenshot baseline is intentionally host-OS independent.

## Commands

```bash
pnpm test
pnpm --filter @dream-weave/canvas-renderer test
pnpm --filter @dream-weave/canvas-app exec playwright install chromium
pnpm --filter @dream-weave/canvas-app exec playwright test --project=fixture-ui
make -C apps/server verify
```

Use a running full stack (normally `make dev` or the acceptance setup) and the appropriate `DW_E2E_*` environment to run real-service/Office Playwright projects. CI handles its own ephemeral environment and does not expose its secret values.

## CI pipeline

[`.github/workflows/canvas-ci.yml`](../../.github/workflows/canvas-ci.yml) runs on pull requests and pushes to `main`:

1. **fixture-ui-no-services** installs Node/Go/protoc tooling, verifies generated Go/TypeScript contracts, runs renderer tests, fixture Playwright, and canvas build.
2. **true-service-integration-no-mocks** requires configured CI secrets/variables, starts real Compose services, runs real-service tests, and verifies migration ledger/rerun behavior.
3. **office-document-server-real-readonly** starts the complete real stack and runs the Office suite.
4. **static-manifests** lints/templates Helm and validates Compose configuration.

The test progression **corresponds to the execution boundaries in [architecture](../architecture/overview.md)**: fast package tests protect pure behavior, while later tiers test the server, storage, origins, network, and Office boundaries that fixture providers cannot prove.

## What to run when changing

- **Canvas model, commands, renderer, interactions, or connections:** package tests; fixture UI; real-service tests for persistent connection creation/style/reload or any other persistence/contract behavior change. For a node-kind change, update and use the [canvas node catalog](../domain/canvas-node-catalog.md); for a wire/service change, use the [backend capability map](../architecture/backend-map.md). Preserve the workflow in [canvas and assets](../workflows/canvas-and-assets.md).
- **Protobuf/API/server persistence:** `make -C apps/server verify`, then real-service tests. Generated output drift is a failure, not a manual-edit request.
- **Asset delivery, preview, HTML, origin, session, or authorization:** Go security/service tests plus real-service media/HTML tests. See [domain and security](../domain/security.md).
- **Office viewer/proxy/JWT/CIDR:** Office tests and Helm/Compose checks.
- **Infrastructure/migrations:** static manifests, Compose config, and the migration rerun check; follow [operations](../operations/runbook.md).

## Known scope boundaries

Root `pnpm test` is recursive, but CI explicitly selects the renderer and browser projects; do not assume it alone covers Go verification or real Compose behavior. The real integration jobs intentionally fail early when required CI variables/secrets or images are absent. That is configuration enforcement, not a flaky-test condition.
