import type { ItemId } from './ids.js';

export type CanvasItemKind =
  | 'markdown'
  | 'image'
  | 'audio'
  | 'video'
  | 'web-preview'
  | 'html'
  | 'pdf'
  | 'office'
  | 'frame';

export interface CanvasItemBase {
  id: ItemId;
  kind: CanvasItemKind;
  title: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface MarkdownItem extends CanvasItemBase {
  kind: 'markdown';
  markdown: string;
}

export interface ImageItem extends CanvasItemBase {
  kind: 'image';
  assetId: string;
  previewAvailable: boolean;
  format: string;
}

export interface AudioItem extends CanvasItemBase {
  kind: 'audio';
  assetId: string;
  /** Server-detected audio format; the uploader does not constrain extensions. */
  format: string;
  durationMs: number;
  waveform: readonly number[];
  sceneLabel: string;
}

export interface VideoItem extends CanvasItemBase {
  kind: 'video';
  assetId: string;
  posterAvailable: boolean;
  durationMs: number;
  shotLabel: string;
}

export interface WebPreviewItem extends CanvasItemBase {
  kind: 'web-preview';
  assetId: string;
  /** The original, validated HTTPS URL rendered directly in a sandboxed iframe. */
  url: string;
  embeddable: boolean;
}

export interface HtmlItem extends CanvasItemBase {
  kind: 'html';
  assetId: string;
  /** A single uploaded HTML/HTM viewer; WebGL is content, not a node mode. */
  previewAvailable: boolean;
}

export interface PdfItem extends CanvasItemBase {
  kind: 'pdf';
  assetId: string;
  previewAvailable: boolean;
}

export interface OfficeItem extends CanvasItemBase {
  kind: 'office';
  assetId: string;
  officeKind: 'word' | 'spreadsheet' | 'presentation';
  fileType: 'doc' | 'docx' | 'xls' | 'xlsx' | 'ppt' | 'pptx';
  previewAvailable: boolean;
}

export interface FrameItem extends CanvasItemBase {
  kind: 'frame';
  description: string;
  color: string;
}

export type CanvasItem =
  | MarkdownItem
  | ImageItem
  | AudioItem
  | VideoItem
  | WebPreviewItem
  | HtmlItem
  | PdfItem
  | OfficeItem
  | FrameItem;
