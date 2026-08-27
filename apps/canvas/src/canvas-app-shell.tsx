import { type ReactNode } from 'react';

export interface CanvasAppShellProps {
  readonly children: ReactNode;
  readonly subtitle: string;
}

/** Application shell. Canvas gesture policy is owned centrally by CanvasRenderer. */
export function CanvasAppShell({ children, subtitle }: CanvasAppShellProps) {
  return <main className="canvas-app">
    <header className="canvas-app__header">
      <span>Dream Weave</span>
      <span className="canvas-app__subtitle">{subtitle}</span>
    </header>
    {children}
  </main>;
}
