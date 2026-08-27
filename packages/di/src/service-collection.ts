import type { ServiceIdentifier } from './base.js';
import { SyncDescriptor } from './descriptor.js';

export enum ServiceOwnership {
  Owned = 'owned',
  Reference = 'reference',
}

export type ServiceEntry<T = unknown> = T | SyncDescriptor<T>;

export class ServiceCollection {
  private readonly entriesById = new Map<ServiceIdentifier<unknown>, ServiceEntry>();
  private readonly ownershipById = new Map<ServiceIdentifier<unknown>, ServiceOwnership>();

  set<T>(id: ServiceIdentifier<T>, entry: ServiceEntry<T>, ownership = ServiceOwnership.Owned): void {
    this.entriesById.set(id as ServiceIdentifier<unknown>, entry as ServiceEntry);
    this.ownershipById.set(id as ServiceIdentifier<unknown>, ownership);
  }

  has(id: ServiceIdentifier<unknown>): boolean {
    return this.entriesById.has(id);
  }

  get<T>(id: ServiceIdentifier<T>): ServiceEntry<T> | undefined {
    return this.entriesById.get(id as ServiceIdentifier<unknown>) as ServiceEntry<T> | undefined;
  }

  getOwnership(id: ServiceIdentifier<unknown>): ServiceOwnership {
    return this.ownershipById.get(id) ?? ServiceOwnership.Owned;
  }

  replace<T>(id: ServiceIdentifier<T>, instance: T): void {
    if (!this.entriesById.has(id as ServiceIdentifier<unknown>)) {
      throw new Error(`Cannot cache unknown service '${id}'.`);
    }
    this.entriesById.set(id as ServiceIdentifier<unknown>, instance);
  }

  entries(): IterableIterator<[ServiceIdentifier<unknown>, ServiceEntry]> {
    return this.entriesById.entries();
  }
}

export class ServiceRegistry {
  private readonly collection = new ServiceCollection();
  private readonly registeredIds = new Set<string>();

  constructor(private readonly options: { checkDuplicate?: boolean } = {}) {}

  register<T>(
    id: ServiceIdentifier<T>,
    ctorOrDescriptor: (new (...args: any[]) => T) | SyncDescriptor<T>,
    supportsDelayedInstantiation = false
  ): void {
    this.assertUnique(id);
    const descriptor = this.isDescriptor(ctorOrDescriptor)
      ? ctorOrDescriptor
      : new SyncDescriptor<T>(ctorOrDescriptor, [], supportsDelayedInstantiation);
    this.collection.set(id, descriptor);
  }

  registerInstance<T>(
    id: ServiceIdentifier<T>,
    instance: T,
    options?: { ownership?: ServiceOwnership }
  ): void {
    this.assertUnique(id);
    this.collection.set(id, instance, options?.ownership ?? ServiceOwnership.Owned);
  }

  makeCollection(): ServiceCollection {
    const result = new ServiceCollection();
    for (const [id, entry] of this.collection.entries()) {
      result.set(id, entry, this.collection.getOwnership(id));
    }
    return result;
  }

  private assertUnique(id: ServiceIdentifier<unknown>): void {
    if (this.options.checkDuplicate && this.registeredIds.has(id.toString())) {
      throw new Error(`Service '${id}' is already registered.`);
    }
    this.registeredIds.add(id.toString());
  }

  private isDescriptor<T>(value: unknown): value is SyncDescriptor<T> {
    return value instanceof SyncDescriptor;
  }
}
