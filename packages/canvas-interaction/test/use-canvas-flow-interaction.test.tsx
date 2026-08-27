// @vitest-environment jsdom
import { createProjectCanvasContainer, ICanvasDocumentService, ICanvasHistoryService, InMemoryCanvasDocumentRepository } from '@dream-weave/canvas-core';
import { getService, InstantiationContext, InstantiationService } from '@dream-weave/di';
import { act, renderHook } from '@testing-library/react';
import type { Node, ReactFlowInstance } from '@xyflow/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ICanvasEventService } from '../src/canvas-event-service.interface.js';
import { ICanvasInteractionService } from '../src/canvas-interaction-service.interface.js';
import { createWorkspaceCanvasInteractionContainer } from '../src/create-workspace-canvas-interaction-container.js';
import { useCanvasFlowInteraction } from '../src/use-canvas-flow-interaction.js';

const projectId = 'interaction-project';
const createdAt = '2026-07-22T00:00:00.000Z';

type TestNode = Node<{ label: string }>;

beforeEach(() => {
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
  });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: () => undefined });
});

describe('useCanvasFlowInteraction', () => {
  it('persists a completed drag as one undoable placement command', async () => {
    const setup = await createSetup();
    const movedNode = { ...setup.nodes[0], position: { x: 420, y: 260 } };
    const { result } = renderHook(() => useCanvasFlowInteraction(setup.nodes), { wrapper: setup.wrapper });

    act(() => {
      result.current.onNodeDragStart([setup.nodes[0]]);
      result.current.onNodeDragStop([movedNode]);
    });

    expect(setup.documentService.getDocument().placements.get('node-a')).toMatchObject({ x: 420, y: 260 });
    expect(setup.interactionService.getSnapshot().isDragging).toBe(false);
    expect(setup.historyService.undo()).toBe(true);
    expect(setup.documentService.getDocument().placements.get('node-a')).toMatchObject({ x: 100, y: 100 });
  });

  it('selects the dragged node before its position changes', async () => {
    const setup = await createSetup();
    const { result } = renderHook(() => useCanvasFlowInteraction(setup.nodes), { wrapper: setup.wrapper });

    act(() => result.current.onNodeDragStart([setup.nodes[0]]));

    expect(result.current.flowNodes.find((node) => node.id === 'node-a')?.selected).toBe(true);
    expect(result.current.flowNodes.find((node) => node.id === 'node-b')?.selected).toBe(false);
    expect(setup.interactionService.getSnapshot().selectedItemIds).toEqual(['node-a']);
  });

  it('moves every fully enclosed node with a dragged frame and persists the group atomically', async () => {
    const setup = await createSetup();
    const frameNode: TestNode = { id: 'frame-a', type: 'test', position: { x: 50, y: 50 }, data: { label: 'Frame' } };
    setup.historyService.execute({
      id: 'create-frame-a',
      projectId,
      createdAt,
      actor: 'user',
      type: 'create-item',
      item: { id: 'frame-a', kind: 'frame', title: 'Frame', summary: '', description: '', color: '#eef0ff', createdAt, updatedAt: createdAt },
      placement: { itemId: 'frame-a', x: 50, y: 50, width: 600, height: 400, zIndex: 0 },
    });
    const { result } = renderHook(() => useCanvasFlowInteraction([...setup.nodes, frameNode]), { wrapper: setup.wrapper });
    const movedFrame = { ...frameNode, position: { x: 80, y: 90 } };

    act(() => {
      result.current.onNodeDragStart([frameNode]);
      result.current.onNodesChange([{ id: 'frame-a', type: 'position', position: movedFrame.position }]);
    });

    expect(result.current.flowNodes.find((node) => node.id === 'node-a')?.position).toEqual({ x: 130, y: 140 });
    expect(result.current.flowNodes.find((node) => node.id === 'node-b')?.position).toEqual({ x: 380, y: 100 });

    act(() => result.current.onNodeDragStop([movedFrame]));

    expect(setup.documentService.getDocument().placements.get('frame-a')).toMatchObject({ x: 80, y: 90 });
    expect(setup.documentService.getDocument().placements.get('node-a')).toMatchObject({ x: 130, y: 140 });
    expect(setup.documentService.getDocument().placements.get('node-b')).toMatchObject({ x: 380, y: 100 });
    expect(setup.historyService.undo()).toBe(true);
    expect(setup.documentService.getDocument().placements.get('frame-a')).toMatchObject({ x: 50, y: 50 });
    expect(setup.documentService.getDocument().placements.get('node-a')).toMatchObject({ x: 100, y: 100 });
  });

  it('deletes the current selection atomically through the event center', async () => {
    const setup = await createSetup();
    const { result } = renderHook(() => useCanvasFlowInteraction(setup.nodes), { wrapper: setup.wrapper });

    act(() => {
      result.current.onSelectionChange(setup.nodes);
      setup.eventService.request({ type: 'delete-selection' });
    });

    expect(setup.documentService.getDocument().items.size).toBe(0);
    expect(setup.historyService.undo()).toBe(true);
    expect(new Set(setup.documentService.getDocument().items.keys())).toEqual(new Set(['node-a', 'node-b']));
  });

  it('selects items requested by a node toolbar', async () => {
    const setup = await createSetup();
    const { result } = renderHook(() => useCanvasFlowInteraction(setup.nodes), { wrapper: setup.wrapper });
    const notifications: unknown[] = [];
    setup.eventService.onDidNotify.subscribe((event) => notifications.push(event));

    act(() => setup.eventService.request({ type: 'select-items', itemIds: ['node-b'] }));

    // React Flow emits the previous selection once while it accepts a node
    // inserted by the same toolbar action. That notification must not restore
    // the node that was selected before the copy.
    act(() => result.current.onSelectionChange([setup.nodes[0]]));

    expect(setup.interactionService.getSnapshot().selectedItemIds).toEqual(['node-b']);
    expect(result.current.flowNodes.find((node) => node.id === 'node-a')?.selected).toBe(false);
    expect(result.current.flowNodes.find((node) => node.id === 'node-b')?.selected).toBe(true);
    expect(notifications).toContainEqual({ type: 'selection-changed', itemIds: ['node-b'] });
  });

  it('routes viewport and zoom requests without persisting viewport state', async () => {
    const setup = await createSetup();
    const zoomTo = vi.fn();
    const flowInstance = {
      getZoom: () => 1,
      zoomTo,
      fitView: vi.fn(),
    } as unknown as ReactFlowInstance<TestNode>;
    const notifications: string[] = [];
    setup.eventService.onDidNotify.subscribe((event) => notifications.push(event.type));
    const { result } = renderHook(() => useCanvasFlowInteraction(setup.nodes), { wrapper: setup.wrapper });

    act(() => {
      result.current.onInit(flowInstance);
      setup.eventService.request({ type: 'zoom-in' });
      result.current.onMove({ x: 18, y: 24, zoom: 1.2 });
    });

    expect(zoomTo).toHaveBeenCalledWith(1.1, { duration: 160 });
    expect(setup.interactionService.getSnapshot().viewport).toEqual({ x: 18, y: 24, zoom: 1.2 });
    expect(notifications).toContain('viewport-changed');
    expect(setup.documentService.getDocument().placements.get('node-a')).toMatchObject({ x: 100, y: 100 });
  });

  it('starts with the pointer tool and returns to pointer when Escape clears a selection', async () => {
    const setup = await createSetup();
    const { result } = renderHook(() => useCanvasFlowInteraction(setup.nodes), { wrapper: setup.wrapper });

    expect(setup.interactionService.getSnapshot().toolMode).toBe('pointer');
    act(() => {
      setup.interactionService.setToolMode('freeform-lasso');
      result.current.onSelectionChange(setup.nodes);
      result.current.onKeyDown({ key: 'Escape', preventDefault: vi.fn(), target: document.body } as never);
    });

    expect(setup.interactionService.getSnapshot().toolMode).toBe('pointer');
    expect(setup.interactionService.getSnapshot().selectedItemIds).toEqual([]);
  });

  it.each([
    { metaKey: true, ctrlKey: false, name: 'Cmd+A' },
    { metaKey: false, ctrlKey: true, name: 'Ctrl+A' },
  ])('selects every canvas node with $name', async ({ metaKey, ctrlKey }) => {
    const setup = await createSetup();
    const { result } = renderHook(() => useCanvasFlowInteraction(setup.nodes), { wrapper: setup.wrapper });
    const preventDefault = vi.fn();
    const notifications: unknown[] = [];
    setup.eventService.onDidNotify.subscribe((event) => notifications.push(event));

    act(() => {
      result.current.onKeyDown({ key: 'a', metaKey, ctrlKey, altKey: false, preventDefault, target: document.body } as never);
    });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(setup.interactionService.getSnapshot().selectedItemIds).toEqual(['node-a', 'node-b']);
    expect(result.current.flowNodes.every((node) => node.selected)).toBe(true);
    expect(notifications).toContainEqual({ type: 'selection-changed', itemIds: ['node-a', 'node-b'] });
  });
});

async function createSetup() {
  const root = new InstantiationService();
  const workspace = createProjectCanvasContainer(root, { projectId, repository: new InMemoryCanvasDocumentRepository() });
  const interactionWorkspace = createWorkspaceCanvasInteractionContainer(workspace);
  const documentService = getService(workspace, ICanvasDocumentService);
  const historyService = getService(workspace, ICanvasHistoryService);
  const eventService = getService(interactionWorkspace, ICanvasEventService);
  const interactionService = getService(interactionWorkspace, ICanvasInteractionService);
  await documentService.initialize();
  const nodes: TestNode[] = [
    { id: 'node-a', type: 'test', position: { x: 100, y: 100 }, data: { label: 'A' } },
    { id: 'node-b', type: 'test', position: { x: 380, y: 100 }, data: { label: 'B' } },
  ];
  for (const node of nodes) {
    historyService.execute({
      id: `create-${node.id}`,
      projectId,
      createdAt,
      actor: 'user',
      type: 'create-item',
      item: { id: node.id, kind: 'markdown', title: node.data.label, summary: '', markdown: '', createdAt, updatedAt: createdAt },
      placement: { itemId: node.id, x: node.position.x, y: node.position.y, width: 420, height: 320, zIndex: 1 },
    });
  }
  const wrapper = ({ children }: { children: ReactNode }) => createElement(InstantiationContext, { instantiationService: interactionWorkspace }, children);
  return { nodes, wrapper, documentService, historyService, eventService, interactionService };
}
