import type {
  ApplyCanvasMutationsRequestDto,
  CanvasHttpTransport,
  CanvasSnapshotDto,
} from '@dream-weave/canvas-core';
import type { CanvasService } from '@dream-weave/canvas-core/generated';
import { DreamWeaveApiError } from '../network/create-network-client.js';

/** Domain adapter around the generated CanvasService client. */
export class CanvasApi implements CanvasHttpTransport {
  constructor(private readonly service: CanvasService) {}

  getCanvas(projectId: string): Promise<CanvasSnapshotDto> {
    return this.service.GetCanvas({ projectId });
  }

  async applyCanvasCommands(request: ApplyCanvasMutationsRequestDto): Promise<CanvasSnapshotDto> {
    try {
      return await this.service.ApplyCanvasMutations(request);
    } catch (error) {
      if (error instanceof DreamWeaveApiError && error.code === 'CANVAS_REVISION_CONFLICT') {
        throw {
          code: 'CANVAS_REVISION_CONFLICT' as const,
          currentRevision: error.apiError.canvasRevisionConflict?.currentRevision,
        };
      }
      throw error;
    }
  }
}
