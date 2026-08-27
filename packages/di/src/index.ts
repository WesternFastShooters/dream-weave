export type { BrandedService, ServiceDependency, ServiceIdentifier, ServicesAccessor } from './base.js';
export { createDecorator, getServiceDependencies, refineServiceDecorator } from './base.js';
export { SyncDescriptor } from './descriptor.js';
export type { SyncDescriptor0 } from './descriptor.js';
export type { GetLeadingNonServiceArgs, IDisposable } from './container.js';
export { getService, IInstantiationService, InstantiationService } from './container.js';
export { IInstantiationService as IContainerService, InstantiationService as ContainerService } from './container.js';
export { ServiceCollection, ServiceOwnership, ServiceRegistry } from './service-collection.js';
export { InstantiationContext, useService } from './react.js';
