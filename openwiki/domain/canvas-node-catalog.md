---
type: Canvas Node Catalog
title: Canvas item kinds and renderers
description: "Complete inventory of Dream Weave CanvasItemKind values: model data, renderer registration, creation path, server or asset dependency, and primary tests."
tags: [domain, canvas, nodes, renderer, assets]
---
# Canvas item kinds and renderers

`CanvasItemKind` is a closed discriminated union in [`packages/canvas-core/src/model/canvas-item.ts`](../../packages/canvas-core/src/model/canvas-item.ts). [`CanvasNodeRegistry`](../../packages/canvas-renderer/src/canvas-node-registry.ts) has a matching `ALL_KINDS` check, while [`create-creative-node-registry.tsx`](../../packages/creative-nodes/src/create-creative-node-registry.tsx) registers one product renderer for each kind. A missing renderer is an error—not a silently omitted item.

Creation and persistence follow [canvas and asset workflows](../workflows/canvas-and-assets.md): `create-item` is adapted to canvas mutations where supported, batches remain revision-checked, and asset-backed kinds are derived from an accepted server asset. The public/server details are canonical in the [backend capability map](../architecture/backend-map.md).

| Kind | User role and core model | Registered renderer | Creation path | Server or asset dependency | Primary tests |
| --- | --- | --- | --- | --- | --- |
| `markdown` | Editable `markdown` with derived `summary` (`MarkdownItem`) | `dream-weave-markdown` → `MarkdownNode` | Bottom-toolbar placement in `packages/canvas-renderer/src/canvas-renderer.tsx`; text import is converted to Markdown rather than an asset | `CreateMarkdownNode` / `UpdateMarkdownNode`; `nodes.tsx` uses the Crepe editor and records content-driven sizing | `packages/creative-nodes/test/markdown-node-drag.test.tsx`; `packages/canvas-core/test/document.test.mjs`; fixture UI Markdown cases |
| `image` | Uploaded `assetId`, `previewAvailable`, `format` (`ImageItem`) | `dream-weave-image` → `ImageNode` | Upload classifier in `apps/canvas/src/services/assets/project-attachment-upload-service.ts` | Preview capability through `HttpAssetPreviewService`; server derives the kind from asset metadata | `packages/creative-nodes/test/resource-node-chrome.test.tsx`; `contracts.test.mjs` |
| `audio` | Uploaded format, duration, waveform, and scene label (`AudioItem`) | `dream-weave-audio` → `AudioNode` | Upload classifier | Signed playback access; server projects extracted waveform/metadata | `packages/creative-nodes/test/audio-node.test.tsx`; `packages/canvas-core/test/document.test.mjs` |
| `video` | Uploaded poster flag, duration, shot label (`VideoItem`) | `dream-weave-video` → `VideoNode` | Upload classifier | Signed preview/playback; `canvas-node-registry.ts` derives current hit-box height from width so old placements do not leave clickable empty space | `packages/creative-nodes/test/video-node.test.tsx`; renderer registry test; fixture UI drag/control cases |
| `web-preview` | Validated external HTTPS `url`, `assetId`, `embeddable` (`WebPreviewItem`) | `dream-weave-web-preview` → `WebPreviewNode` | Bottom-toolbar draft, then runtime `createWebPreview` | `CreateWebAsset` validates before navigation; browser renders a sandboxed iframe and server does not fetch the URL | `packages/creative-nodes/test/web-preview-node.test.tsx`; core URL contract tests |
| `html` | Uploaded HTML preview flag and `assetId` (`HtmlItem`) | `dream-weave-html` → `HtmlViewerNode` | Upload classifier | Dedicated HTML-preview capability; sandboxed iframe and MessageChannel runtime configuration | `packages/creative-nodes/test/resource-node-chrome.test.tsx` |
| `pdf` | Uploaded PDF preview flag and `assetId` (`PdfItem`) | `dream-weave-pdf` → shared `OnlyOfficeViewerNode` | Upload classifier | `CreateOfficeSession` accepts ready PDF and maps its document type to `pdf`; it uses the isolated Office session path | Resource-node component test; `apps/canvas/test/e2e/office-real.spec.ts` |
| `office` | Uploaded Word/Spreadsheet/Presentation kind, file type, preview flag (`OfficeItem`) | `dream-weave-office` → shared `OnlyOfficeViewerNode` | Upload classifier maps extension to Office kind/file type | Read-only ONLYOFFICE session; unsupported formats fall back to attachment projection | Resource-node component test; `office-real.spec.ts` |
| `attachment` | Generic uploaded filename, extension, MIME type, `assetId` (`AttachmentItem`) | `dream-weave-attachment` → `AttachmentNode` | Upload classifier fallback | Asset-backed download capability; no web-preview download action | Registry coverage; fixture UI connection-source case |
| `frame` | Visual group title, description, color; no asset (`FrameItem`) | `dream-weave-frame` → `FrameNode` | Draw-frame mode in `canvas-renderer.tsx` creates it behind content | `CreateFrameNode`; `UpdateFrameNode` persists title in `frame_data`; dragging a frame commits its enclosed children’s placements together | `canvas-node-registry.test.ts`; `use-canvas-flow-interaction.test.tsx`; fixture UI frame/group-drag cases |

## Rendering and interaction invariants

The registry projects each persisted item to React Flow and deliberately places frames below all content. Non-frame items use `[data-drag-handle]`; a frame accepts dragging on its full visible surface while its rename input is `nodrag`. The interaction adapter keeps pointer-time movement transient and commits one `set-placements` command at drag end; a dragged frame offsets contained, non-selected children in the same command. See [canvas and asset workflows](../workflows/canvas-and-assets.md) for the persistence implications.

The committed renderer work also provides rectangular and Alt-drag freeform selection, keyboard selection/tool behavior, drawn frames, and pointer-anchored Ctrl/Meta-wheel zoom (0.1–3). Native React Flow pinch zoom is disabled. Relevant coverage lives in `packages/canvas-interaction/test/use-canvas-flow-interaction.test.tsx`, `packages/canvas-interaction/test/tool-shortcuts.test.ts`, `packages/canvas-renderer/test/`, and `apps/canvas/test/e2e/fixture-ui.spec.ts`.

Current uncommitted renderer work wraps every registered renderer in four connection handles (`packages/canvas-renderer/src/canvas-connectable-node.tsx`) and renders configurable edges from `canvas-connection-edge.tsx`. Connections are **not** `CanvasItemKind`s, but they are persistent `CanvasDocument` relations: `CanvasRenderer` creates a UUID-backed `create-connection` history command, selected-edge controls issue `update-connection`, and edge removal issues `delete-connection`. Each relation records source/target item IDs and one of four handles, plus `straight`/`curve`/`elbow`, `solid`/`dashed`, and `none`/`forward`/`both` styles; the protocol and database trace are in the [backend capability map](../architecture/backend-map.md), and their revision/undo semantics are in [canvas workflows](../workflows/canvas-and-assets.md).

## Change checklist

1. Change the union/model and `ALL_KINDS`, then register exactly one creative-node renderer.
2. For a persistent kind, trace creation through command adapter, protobuf/transport, mutation validation, repository projection/persistence, and tests using the [backend map](../architecture/backend-map.md).
3. For asset-backed kinds, update the upload classifier, asset metadata/projection, purpose-specific access behavior, and real-service coverage.
4. Preserve the distinction between persistent item/placement state and the renderer’s transient selection, viewport, draft, and current-edge state; use [testing guidance](../testing/quality.md) for the applicable layers.
