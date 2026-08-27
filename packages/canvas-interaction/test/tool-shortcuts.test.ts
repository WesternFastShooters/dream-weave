import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const interactionSource = readFileSync(new URL('../src/use-canvas-flow-interaction.ts', import.meta.url), 'utf8');

describe('canvas tool shortcuts', () => {
  it('does not bind the line lasso to the L key', () => {
    expect(interactionSource).not.toContain("key === 'l'");
  });
});
