---
type: Architecture Overview
title: Dream Weave runtime architecture
description: Browser-to-service architecture for Dream Weave, including canvas packages, Go services, PostgreSQL, object storage, preview workers, and Office isolation.
tags: [architecture, canvas, api, deployment]
---
# Runtime architecture

Dream Weave is a modular full-stack application rather than a standalone canvas widget. The browser app composes reusable canvas packages around a project ID; the Go server owns authentication, project authorization, canvas persistence, asset metadata, capability issuance, and Office sessions. PostgreSQL is authoritative for domain state and job coordination, while S3-compatible storage holds managed bytes.

## Browser composition

[`apps/canvas/src/main.tsx`](../../apps/canvas/src/main.tsx) reads `projectId` from the query string (falling back to `default-project`), creates generated HTTP clients, and builds a project-scoped DI container. It loads the initial document before rendering `CanvasRenderer` with the creative-node registry.

The UI is intentionally layered:

- `canvas-core` owns document types (including persistent node-to-node connections), validated commands/history, repository abstraction, and HTTP repository.
- `canvas-interaction` owns selection, drag, viewport, keyboard, and event behavior; its state is transient.
- `canvas-renderer` projects document items and connections into React Flow nodes/edges and delegates events to interaction.
- `creative-nodes` registers the product-specific node views and media/web/Office behaviors.

This composition **executes the persistence and rendering flow described in [canvas and asset workflows](../workflows/canvas-and-assets.md)**. It should not be inverted by putting server calls directly in renderer components.

## Server boundary

[`apps/server/internal/app/app.go`](../../apps/server/internal/app/app.go) assembles the HTTP surface: identity, projects, canvas, assets, Office, generated protobuf HTTP transport, native asset delivery, health endpoints, and a separate Office source-proxy listener. API contracts live in [`apps/server/api/dreamweave/v1/`](../../apps/server/api/dreamweave/v1/); generated TypeScript is consumed from `packages/canvas-core/src/api/generated/`.

The server uses a modular-monolith shape:

- `internal/projects` owns membership authorization.
- `internal/canvas` owns versioned canvas mutation and PostgreSQL persistence.
- `internal/assets` owns ticketed uploads, format detection, asset state, and capability-backed delivery.
- `internal/preview` owns leased asynchronous preview jobs.
- `internal/office` creates restricted ONLYOFFICE sessions and exposes their private source route.

These service boundaries **enforce the roles and access constraints defined in [domain and security](../domain/security.md)**; their contract-to-service-to-storage trace is maintained in the [backend capability map](backend-map.md), rather than merely mirroring folder organization.

## Data and asynchronous work

PostgreSQL contains users/sessions, projects/memberships, one canvas document per project, nodes/placements, project-scoped canvas connections, assets, upload tickets, preview artifacts/jobs, and mutation receipts. The initial schema is in [`000001_project_auth_canvas_assets.up.sql`](../../apps/server/migrations/000001_project_auth_canvas_assets.up.sql); later migrations evolve placement, idempotency/upload, HTML preview behavior, and connection storage (`000006_add_canvas_connections.up.sql`).

Managed objects stay in S3/MinIO. The API gives the browser a temporary upload ticket, then confirms the stored object’s size and type before creating an asset. Preview jobs are stored in Postgres and claimed with `FOR UPDATE SKIP LOCKED`; workers can renew leases and retry eligible failures. This means the worker **turns accepted assets from [the workflow](../workflows/canvas-and-assets.md) into renderable artifacts**, while the document remains a state/metadata projection rather than a store of raw bytes.

## Runtime topology

Local Compose provides PostgreSQL, MinIO, migrations, Nginx TLS proxy, ONLYOFFICE, and the viewer shell. The `make dev` orchestrator instead runs Vite plus the Go API, preview worker, and media processor on the host with restart-on-change. Kubernetes deployment is represented by the Helm chart.

The topology **is configured and operated through the [operations runbook](../operations/runbook.md)**. Most importantly:

- `app` is the authenticated application origin.
- `preview` is a cookie/API-free host that exposes capability-scoped asset delivery only.
- the Office source proxy is a separate private listener limited to ONLYOFFICE network peers.

This separation is part of the product’s access-control design, not an optional routing convenience.

## Change boundaries

- Change model/command semantics in `canvas-core` first; update interaction/renderer and server contract/persistence together only when the wire behavior changes.
- Keep generated code generated: edit `.proto` sources and run the server API target.
- Any change to a host, origin, capability, upload route, or Office source route has security consequences; use [testing and quality](../testing/quality.md) alongside the operations checks.
