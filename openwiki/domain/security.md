---
type: Domain and Security Model
title: Project, canvas, asset, and access model
description: "Dream Weave domain concepts and enforced security boundaries: users, memberships, versioned canvas documents, assets, sessions, capability URLs, preview origins, and Office isolation."
tags: [domain, security, projects, assets, authorization]
---
# Domain and security model

## Domain concepts

The schema begins in [`apps/server/migrations/000001_project_auth_canvas_assets.up.sql`](../../apps/server/migrations/000001_project_auth_canvas_assets.up.sql):

- **User** — uniquely identified email, Argon2id password hash, enabled flag.
- **Session** — server-side record tied to a user, with a hash of the issued random token, expiry, and revocation timestamp.
- **Project** — title, summary, `active`/`archived` status, and audit fields.
- **Project membership** — `owner`, `editor`, or `viewer` role. Creation establishes an owner; project services prevent removing/demoting the last owner.
- **Canvas document** — exactly one per project, carrying a non-negative revision.
- **Canvas node, placement, and connection** — a node is markdown, frame, or an asset-backed kind; placements have finite coordinates, positive dimensions, and z-index. A connection is a project-scoped source/target node relation with validated border handles and visual style; its database foreign keys require both endpoints to belong to that project and cascade deletion.
- **Asset** — project-owned managed object or external URL, with server-detected kind/format, metadata, and processing state.
- **Upload ticket, preview artifact/job, command receipt** — operational records that make uploads temporary, previews asynchronous, and mutations idempotent.

The canvas workflow **reads and updates these concepts through the process documented in [canvas and assets](../workflows/canvas-and-assets.md)**. The browser and server ownership boundaries are described in [architecture](../architecture/overview.md).

## Authentication and request integrity

[`internal/identity/identity.go`](../../apps/server/internal/identity/identity.go) uses a `dw_session` cookie; clients never receive a session token in an API response. The raw token is 32 random bytes and only its SHA-256 digest is stored. Password verification accepts constrained Argon2id PHC hashes. Sessions must be unexpired, unreleased, and associated with an enabled user.

For non-read API methods, middleware requires the request `Origin` to exactly equal the configured application origin before it attaches a principal. The configured cookie is HTTP-only, Secure, SameSite=Lax, and scoped to the API prefix. Browser requests use same-origin credentials.

## Authorization model

Project authorization is centralized in `internal/projects`. Membership grants read; writes require a non-viewer role and an active project. Canvas reads/writes, upload completion, web creation, and Office session creation call this guard.

Asset access uses the `asset:download` permission string, but the current `Require` implementation’s special distinction is `project:write`; other permission strings amount to authenticated project membership/read. Do not claim asset-level RBAC exists without changing that implementation and tests.

## Asset delivery boundary

Object keys are internal. An authorized access call produces a five-minute signed capability scoped to an asset, a purpose (`preview`, `download`, `playback`, or `html-preview`), and the `browser` audience. A server route verifies it, selects the permitted original/artifact reference, then creates a short-lived storage URL. Capabilities never appear in canvas snapshots.

The preview host is intentionally separate from the authenticated application host: it carries controlled capability-scoped bytes but no application/API surface. Sandboxed HTML delivery adds content-security and framing controls. This **constrains the Compose and Helm configuration described in [operations](../operations/runbook.md)**; merging the hosts or exposing raw object storage changes the security model.

## Office boundary

Office and PDF viewing are read-only and isolated twice: a five-minute JWT disables edit/download/print/comment/copy in ONLYOFFICE, and source bytes are served from a separate listener requiring both a distinct capability audience and a configured Document Server CIDR. The browser shell receives only an opaque session ID and fetches the retained configuration same-origin without credentials; it does not receive project/asset IDs, document URL, or token from its parent. Its network policy is operationally significant; see [operations](../operations/runbook.md) and the [backend capability map](../architecture/backend-map.md).

## Change guardrails

- Add new node/asset types coherently across schema, server domain/transport, generated contract, `canvas-core`, creative-node registry, and tests. Use [the source map](../source-map.md) to navigate that set.
- Do not expose storage references, long-lived signed URLs, session tokens, or runtime secrets to clients/logs/docs.
- Treat origin values and Office CIDRs as security configuration, not cosmetic deployment settings.
- Test changes to these controls with the real service and Office suites in [testing and quality](../testing/quality.md), not fixture UI alone.
