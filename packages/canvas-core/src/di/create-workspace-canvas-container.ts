import { IInstantiationService, ServiceCollection, SyncDescriptor, type IInstantiationService as InstantiationService } from '@dream-weave/di';
import { ICanvasDocumentRepository, type ICanvasDocumentRepository as ICanvasDocumentRepositoryType } from '../repository/canvas-document-repository.interface.js';
import { CanvasDocumentService } from '../services/canvas-document-service.js';
import { ICanvasDocumentService } from '../services/canvas-document-service.interface.js';
import { CanvasHistoryService } from '../services/canvas-history-service.js';
import { ICanvasHistoryService } from '../services/canvas-history-service.interface.js';
import type { ProjectId } from '../model/ids.js';

export interface ProjectCanvasContainerOptions {
  projectId: ProjectId;
  repository: ICanvasDocumentRepositoryType;
}

/** Creates the only container allowed to own project canvas state. */
export function createProjectCanvasContainer(rootContainer: InstantiationService, options: ProjectCanvasContainerOptions): InstantiationService {
  const services = new ServiceCollection();
  services.set(ICanvasDocumentRepository, options.repository);
  services.set(ICanvasDocumentService, new SyncDescriptor(CanvasDocumentService, [options.projectId]));
  services.set(ICanvasHistoryService, new SyncDescriptor(CanvasHistoryService));
  return rootContainer.createChild(services);
}

export { IInstantiationService };
