---
type: Workflow Guide
title: Canvas and asset workflows
description: End-to-end behavior for canvas commands, optimistic revision persistence, asset upload and delivery, preview processing, web content, and read-only Office rendering.
tags: [workflows, canvas, assets, previews, office]
---
# Canvas and asset workflows

## Edit and persist a canvas

A canvas document is project-scoped and versioned. `CanvasDocumentService` in [`packages/canvas-core/src/services/canvas-document-service.ts`](../../packages/canvas-core/src/services/canvas-document-service.ts) loads a snapshot, validates and applies commands locally, records pending commands, then persists batches with the expected revision.

Placement-only commands are coalesced after 120 ms; other commands flush immediately. On a successful response, the client reconciles the returned server snapshot and replays still-pending commands where possible. A revision conflict drops the local pending set and replaces the document with the authoritative snapshot. Undo/redo is based on inverse commands, so history is cleared after a conflict rather than pretending it can safely apply to a different document version.

The interaction package commits drag positions as `set-placements` only when dragging ends; React Flow positions during a drag are transient. Dragging a Frame also offsets fully enclosed, non-selected children and commits all affected placements as that command. Connections are a separate persistent relation in the same document: the renderer creates them between shared top/right/bottom/left handles, and style or deletion actions emit `create-connection`, `update-connection`, or `delete-connection` commands. Local application removes relations attached to deleted nodes and undo restores them with the nodes; PostgreSQL independently cascades rows when either referenced project node is deleted. This workflow **persists the canvas document, node/placement, and connection concepts defined in [domain and security](../domain/security.md)** and is composed by the browser architecture in [the overview](../architecture/overview.md). The complete node/renderer and connection-affordance inventory is the [canvas node catalog](../domain/canvas-node-catalog.md).

Server-side canvas batches are atomic, revision-checked, and idempotent by request ID/receipt. Do not introduce independent per-node persistence paths that bypass the document revision or receipt behavior.

## Upload and render an asset

The normal managed-object path is:

1. A project editor asks the API for an upload ticket.
2. The browser PUTs directly to the ticket URL, then calls completion.
3. The server locks the ticket, validates expiry and byte size, detects file type from object bytes/metadata, creates the asset, and queues a preview if that kind needs one.
4. The client creates or updates the appropriate asset-backed canvas item through canvas commands.
5. A node requests a purpose-specific access URL only when it needs preview, playback, download, or HTML content.

The asset service deliberately does not put storage references into canvas DTOs. It instead mints short-lived browser capabilities and resolves them server-side to a short-lived object-store URL. This flow **depends on the session, membership, and capability controls in [domain and security](../domain/security.md)**; do not treat a returned URL as a reusable storage credential.

Text file uploads are rejected: markdown is created directly as a document node. The server derives the asset-backed node kind from the stored asset instead of accepting an arbitrary client-selected type.

## Preview processing

Audio waveform, video poster, and sandboxed HTML rendering use the preview job/artifact path. The worker in [`apps/server/internal/preview/worker.go`](../../apps/server/internal/preview/worker.go) claims a queued or retryable job with a lease, renews it while processing, and has a five-minute default timeout. Failed retryable jobs use bounded retry delays; permanent failures or exhausted attempts mark the artifact and asset failed.

A preview access request returns a conflict until the relevant asset/artifact is ready. Media playback and downloads use original bytes; visual previews may use an artifact. HTML specifically uses the `sandboxed-html` artifact path in the current code/migrations.

Migration history matters: migration `000002` removed legacy HTML/web preview artifacts, while `000005` restores a controlled sandboxed-HTML renderer. When diagnosing an environment, verify migrations and the worker are both present before assuming source behavior is live. The worker’s runtime and processor configuration are covered by [operations](../operations/runbook.md) and verified by relevant tests in [testing](../testing/quality.md).

## External web and Office content

A web-preview asset is an external HTTPS URL, validated for syntax, no userinfo, and unsafe literal IP ranges. The server does not fetch it. The browser renders it in an iframe with `sandbox="allow-scripts"` and `referrerPolicy="no-referrer"`; this is containment, not a promise that browser-side hostname resolution cannot reach private network destinations.

Office files and PDFs use a separate path: the server creates a five-minute, read-only ONLYOFFICE JWT and retains its runtime configuration behind an opaque same-origin Office-shell session URL. The shell fetches that configuration without browser credentials; ONLYOFFICE retrieves bytes through the isolated private proxy, which the public app handler does not expose. This **requires the origin, network, and CIDR deployment controls in [operations](../operations/runbook.md)**; its precise contracts and boundaries are in the [backend capability map](../architecture/backend-map.md) and it is covered by a real Document Server suite.

## When changing this area

- Change command shapes in `canvas-core`, the `.proto` contract, server adapter, and persistence together; regenerate generated clients.
- Preserve optimistic conflict semantics and receipt idempotency. There is no real-time/CRDT transport in the inspected implementation.
- Treat preview and Office failures as lifecycle states, not as a reason to leak object-storage URLs or bypass authorization.
- Run core/unit checks plus the relevant real-service, media/HTML, or Office browser project described in [testing and quality](../testing/quality.md).
