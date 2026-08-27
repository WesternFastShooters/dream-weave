export type Disposable = { dispose(): void };

/** A small browser-safe event primitive for domain services. */
export class Signal<T> {
  private readonly listeners = new Set<(event: T) => void>();

  public subscribe(listener: (event: T) => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  public emit(event: T): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  public clear(): void {
    this.listeners.clear();
  }
}
