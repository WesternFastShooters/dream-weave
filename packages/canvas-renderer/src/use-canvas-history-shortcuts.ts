import { ICanvasHistoryService } from '@dream-weave/canvas-core';
import { useService } from '@dream-weave/di';
import { useEffect } from 'react';

/** The single capture-phase Cmd/Ctrl+Z route for a project canvas. */
export function useCanvasHistoryShortcuts(): void {
  const history = useService(ICanvasHistoryService);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.isComposing || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z' || isEditableTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) history.redo();
      else history.undo();
    };
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [history]);
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'));
}
