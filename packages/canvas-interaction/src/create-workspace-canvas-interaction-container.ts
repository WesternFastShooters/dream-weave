import { IInstantiationService, type IInstantiationService as InstantiationService, ServiceCollection, SyncDescriptor } from '@dream-weave/di';
import { CanvasEventService } from './canvas-event-service.js';
import { ICanvasEventService } from './canvas-event-service.interface.js';
import { CanvasInteractionService } from './canvas-interaction-service.js';
import { ICanvasInteractionService } from './canvas-interaction-service.interface.js';

/** Adds workspace-scoped, non-persistent canvas interaction services. */
export function createWorkspaceCanvasInteractionContainer(workspaceCanvasContainer: InstantiationService): InstantiationService {
  const services = new ServiceCollection();
  services.set(ICanvasEventService, new SyncDescriptor(CanvasEventService));
  services.set(ICanvasInteractionService, new SyncDescriptor(CanvasInteractionService));
  return workspaceCanvasContainer.createChild(services);
}

export { IInstantiationService };
