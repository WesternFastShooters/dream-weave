export interface IDisposable {
  dispose(): void;
}

export function isDisposable(value: unknown): value is IDisposable {
  return typeof (value as Partial<IDisposable> | null)?.dispose === 'function';
}
