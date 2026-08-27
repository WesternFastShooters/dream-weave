import { createDecorator, getServiceDependencies, type BrandedService, type ServiceIdentifier, type ServicesAccessor } from './base.js';
import { SyncDescriptor, type SyncDescriptor0 } from './descriptor.js';
import { isDisposable, type IDisposable } from './disposable.js';
import { ServiceCollection, ServiceOwnership, type ServiceEntry } from './service-collection.js';

export type GetLeadingNonServiceArgs<TArgs extends unknown[]> = TArgs extends []
  ? []
  : TArgs extends [...infer Leading, BrandedService]
    ? GetLeadingNonServiceArgs<Leading>
    : TArgs;

export interface IInstantiationService extends BrandedService {
  createInstance<T>(descriptor: SyncDescriptor0<T>): T;
  createInstance<Ctor extends new (...args: any[]) => object>(
    ctor: Ctor,
    ...args: GetLeadingNonServiceArgs<ConstructorParameters<Ctor>>
  ): InstanceType<Ctor>;
  invokeFunction<R, TArgs extends unknown[] = []>(
    fn: (accessor: ServicesAccessor, ...args: TArgs) => R,
    ...args: TArgs
  ): R;
  createChild(services: ServiceCollection): IInstantiationService;
  dispose(): void;
}

export const IInstantiationService = createDecorator<IInstantiationService>('instantiation');

type Resolution = {
  owner: InstantiationService;
  entry: ServiceEntry;
};

/**
 * A synchronous, hierarchical dependency-injection container.
 * Services are cached in the container that registered them, so project children
 * can inherit host services without sharing project-scoped instances.
 */
export class InstantiationService implements IInstantiationService {
  readonly _serviceBrand: undefined = undefined;

  private readonly children = new Set<InstantiationService>();
  private readonly resolving = new Set<ServiceIdentifier<unknown>>();
  private disposed = false;

  constructor(
    private readonly services: ServiceCollection = new ServiceCollection(),
    private readonly parent?: InstantiationService
  ) {
    this.services.set(IInstantiationService, this, ServiceOwnership.Reference);
    parent?.children.add(this);
  }

  createChild(services: ServiceCollection): InstantiationService {
    this.assertActive();
    return new InstantiationService(services, this);
  }

  invokeFunction<R, TArgs extends unknown[] = []>(
    fn: (accessor: ServicesAccessor, ...args: TArgs) => R,
    ...args: TArgs
  ): R {
    this.assertActive();
    let active = true;
    const accessor: ServicesAccessor = {
      get: <T>(id: ServiceIdentifier<T>): T => {
        if (!active) {
          throw new Error('The service accessor is only valid while its callback is running.');
        }
        return this.resolve(id);
      },
    };

    try {
      return fn(accessor, ...args);
    } finally {
      active = false;
    }
  }

  createInstance<T>(descriptor: SyncDescriptor0<T>): T;
  createInstance<Ctor extends new (...args: any[]) => object>(
    ctor: Ctor,
    ...args: GetLeadingNonServiceArgs<ConstructorParameters<Ctor>>
  ): InstanceType<Ctor>;
  createInstance(
    ctorOrDescriptor: SyncDescriptor0<any> | (new (...args: any[]) => any) | SyncDescriptor<any>,
    ...args: unknown[]
  ): any {
    this.assertActive();
    const descriptor =
      ctorOrDescriptor instanceof SyncDescriptor
        ? ctorOrDescriptor
        : 'ctor' in ctorOrDescriptor
          ? new SyncDescriptor(ctorOrDescriptor.ctor)
          : new SyncDescriptor(ctorOrDescriptor);
    return this.instantiate(descriptor, args);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    for (const child of [...this.children]) {
      child.dispose();
    }
    this.children.clear();
    this.parent?.children.delete(this);

    for (const [id, entry] of this.services.entries()) {
      if (
        entry instanceof SyncDescriptor ||
        entry === this ||
        this.services.getOwnership(id) === ServiceOwnership.Reference ||
        !isDisposable(entry)
      ) {
        continue;
      }
      entry.dispose();
    }
  }

  private resolve<T>(id: ServiceIdentifier<T>): T {
    const resolution = this.find(id);
    if (!resolution) {
      throw new Error(`Unknown dependency '${id}'.`);
    }

    if (!(resolution.entry instanceof SyncDescriptor)) {
      return resolution.entry as T;
    }

    return resolution.owner.instantiateRegistered(id, resolution.entry) as T;
  }

  private find<T>(id: ServiceIdentifier<T>): Resolution | undefined {
    const entry = this.services.get(id);
    if (entry !== undefined) {
      return { owner: this, entry };
    }
    return this.parent?.find(id);
  }

  private instantiateRegistered<T>(id: ServiceIdentifier<T>, descriptor: SyncDescriptor<T>): T {
    if (this.resolving.has(id as ServiceIdentifier<unknown>)) {
      throw new Error(`Circular dependency detected while creating '${id}'.`);
    }

    this.resolving.add(id as ServiceIdentifier<unknown>);
    try {
      const instance = descriptor.supportsDelayedInstantiation
        ? (createLazyProxy(() => this.instantiate(descriptor, []) as object) as T)
        : this.instantiate(descriptor, []);
      this.services.replace(id, instance);
      return instance;
    } finally {
      this.resolving.delete(id as ServiceIdentifier<unknown>);
    }
  }

  private instantiate<T>(descriptor: SyncDescriptor<T>, suppliedArguments: unknown[]): T {
    const dependencies = [...getServiceDependencies(descriptor.ctor)].sort((left, right) => left.index - right.index);
    const firstDependencyIndex = dependencies[0]?.index ?? suppliedArguments.length;
    const staticArguments = [...descriptor.staticArguments, ...suppliedArguments];
    const argumentsBeforeServices = staticArguments.slice(0, firstDependencyIndex);
    while (argumentsBeforeServices.length < firstDependencyIndex) {
      argumentsBeforeServices.push(undefined);
    }

    const serviceArguments = dependencies.map((dependency) => this.resolve(dependency.id));
    return Reflect.construct(descriptor.ctor, [...argumentsBeforeServices, ...serviceArguments]) as T;
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error('Cannot use a disposed dependency-injection container.');
    }
  }
}

export function getService<T>(container: IInstantiationService, id: ServiceIdentifier<T>): T {
  return container.invokeFunction((accessor) => accessor.get(id));
}

function createLazyProxy<T extends object>(factory: () => T): T {
  let instance: T | undefined;
  const getInstance = (): T => (instance ??= factory());
  return new Proxy(Object.create(null), {
    get(_target, key) {
      const value = Reflect.get(getInstance(), key);
      return typeof value === 'function' ? value.bind(getInstance()) : value;
    },
    set(_target, key, value) {
      Reflect.set(getInstance(), key, value);
      return true;
    },
  }) as T;
}

export type { IDisposable };
