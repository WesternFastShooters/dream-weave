# @dream-weave/canvas-core

The project-canvas data layer. It owns serializable documents, commands,
optimistic persistence, and browser-session Undo/Redo. It contains no React,
iframe runtime, or product node renderers.

```ts
const projectCanvas = createProjectCanvasContainer(rootContainer, {
  projectId: 'project-1',
  repository: new InMemoryCanvasDocumentRepository(),
});
```

All changes use public `CanvasCommand` values through `ICanvasHistoryService`.
`executeBatch()` records one atomic Undo/Redo entry; deleted nodes are restored by
ordinary `create-item` commands with their original content and placement.
