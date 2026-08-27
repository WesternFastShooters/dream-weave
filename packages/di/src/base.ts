/** A service instance that can participate in constructor injection. */
export type BrandedService = { readonly _serviceBrand: undefined };

/** Runtime key used to register and resolve a service implementation. */
export interface ServiceIdentifier<T> {
  (target: object, propertyKey: string | symbol | undefined, parameterIndex: number): void;
  readonly type: T;
  toString(): string;
}

export interface ServicesAccessor {
  get<T>(id: ServiceIdentifier<T>): T;
}

export interface ServiceDependency {
  id: ServiceIdentifier<unknown>;
  index: number;
}

const serviceIdentifiers = new Map<string, ServiceIdentifier<unknown>>();
const dependenciesKey = Symbol('dream-weave:di:dependencies');

export function getServiceDependencies(ctor: object): readonly ServiceDependency[] {
  return (ctor as { [dependenciesKey]?: ServiceDependency[] })[dependenciesKey] ?? [];
}

/**
 * Creates a service token and a parameter decorator in one value.
 * The decorator stores constructor dependency metadata; it does not create a service.
 */
export function createDecorator<T>(serviceId: string): ServiceIdentifier<T> {
  const existing = serviceIdentifiers.get(serviceId);
  if (existing) {
    return existing as ServiceIdentifier<T>;
  }

  const identifier = ((target: object, _propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (!Number.isInteger(parameterIndex) || parameterIndex < 0) {
      throw new Error(`Service decorator '${serviceId}' can only decorate a constructor parameter.`);
    }

    const ctor = target as { [dependenciesKey]?: ServiceDependency[] };
    const hasOwnDependencies = Object.hasOwn(ctor, dependenciesKey);
    const dependencies = hasOwnDependencies ? (ctor[dependenciesKey] ?? []) : [];
    if (!hasOwnDependencies) {
      Object.defineProperty(ctor, dependenciesKey, {
        configurable: false,
        enumerable: false,
        writable: true,
        value: dependencies,
      });
    }
    dependencies.push({ id: identifier as ServiceIdentifier<unknown>, index: parameterIndex });
  }) as ServiceIdentifier<T>;

  Object.defineProperty(identifier, 'toString', {
    value: () => serviceId,
  });
  serviceIdentifiers.set(serviceId, identifier as ServiceIdentifier<unknown>);
  return identifier;
}

export function refineServiceDecorator<TBase, T extends TBase>(
  serviceIdentifier: ServiceIdentifier<TBase>
): ServiceIdentifier<T> {
  return serviceIdentifier as unknown as ServiceIdentifier<T>;
}
