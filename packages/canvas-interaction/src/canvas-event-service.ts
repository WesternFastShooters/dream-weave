import { Signal } from '@dream-weave/canvas-core';
import type { CanvasEventNotification, CanvasEventRequest, ICanvasEventService } from './canvas-event-service.interface.js';

/** Decoupled event transport. Persistent document and interaction state live elsewhere. */
export class CanvasEventService implements ICanvasEventService {
  readonly _serviceBrand: undefined = undefined;
  readonly onDidRequest = new Signal<CanvasEventRequest>();
  readonly onDidNotify = new Signal<CanvasEventNotification>();

  public request(event: CanvasEventRequest): void {
    this.onDidRequest.emit(event);
  }

  public notify(event: CanvasEventNotification): void {
    this.onDidNotify.emit(event);
  }

  public dispose(): void {
    this.onDidRequest.clear();
    this.onDidNotify.clear();
  }
}
