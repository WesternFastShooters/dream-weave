import type { ItemId } from './ids.js';

/** Independent canvas geometry. Frames never own or constrain other nodes. */
export interface Placement {
  itemId: ItemId;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}
