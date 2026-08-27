export class SyncDescriptor<T> {
  constructor(
    readonly ctor: new (...args: any[]) => T,
    readonly staticArguments: unknown[] = [],
    readonly supportsDelayedInstantiation = false
  ) {}
}

export interface SyncDescriptor0<T> {
  readonly ctor: new () => T;
}
