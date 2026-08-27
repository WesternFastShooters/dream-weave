export type OfficeFileType = 'doc' | 'docx' | 'xls' | 'xlsx' | 'ppt' | 'pptx' | 'pdf';
export type OfficeDocumentType = 'word' | 'cell' | 'slide' | 'pdf';

export interface OfficeSessionConfig {
  sessionId: string;
  documentServerUrl: string;
  documentUrl: string;
  documentKey: string;
  token: string;
  documentTitle: string;
  fileType: OfficeFileType;
  documentType: OfficeDocumentType;
  expiresAt: string;
}

export type ShellBootstrapMessage = {
  type: 'office:configure';
  protocolVersion: 1;
  session: OfficeSessionConfig;
};

export type ShellResultMessage =
  | { type: 'office:ready'; sessionId: string }
  | { type: 'office:error'; sessionId: string; code: string };

const fileTypes = new Set<OfficeFileType>(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf']);
const documentTypes = new Set<OfficeDocumentType>(['word', 'cell', 'slide', 'pdf']);
const sessionIdPattern = /^[A-Za-z0-9_-]{16,128}$/;
const opaqueTextPattern = /^.{1,1024}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isAbsoluteHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function parseTrustedOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash ? url.origin : null;
  } catch {
    return null;
  }
}

export function sessionIdFromPath(pathname: string): string | null {
  const match = /^\/dw-viewer-shell\/([A-Za-z0-9_-]{16,128})\/?$/.exec(pathname);
  return match?.[1] ?? null;
}

export function parseBootstrapMessage(value: unknown, expectedSessionId: string, shellOrigin: string): OfficeSessionConfig | null {
  if (!isRecord(value) || value.type !== 'office:configure' || value.protocolVersion !== 1 || !isRecord(value.session)) return null;
  const session = value.session;
  if (
    session.sessionId !== expectedSessionId ||
    !sessionIdPattern.test(expectedSessionId) ||
    !isHttpsUrl(session.documentServerUrl) ||
    !isAbsoluteHttpUrl(session.documentUrl) ||
    typeof session.documentKey !== 'string' || !opaqueTextPattern.test(session.documentKey) ||
    typeof session.token !== 'string' || !opaqueTextPattern.test(session.token) ||
    typeof session.documentTitle !== 'string' || !opaqueTextPattern.test(session.documentTitle) ||
    typeof session.expiresAt !== 'string' || Number.isNaN(Date.parse(session.expiresAt)) ||
    !fileTypes.has(session.fileType as OfficeFileType) ||
    !documentTypes.has(session.documentType as OfficeDocumentType)
  ) return null;

  try {
    const documentServerUrl = new URL(session.documentServerUrl as string);
    if (documentServerUrl.origin !== shellOrigin || documentServerUrl.pathname !== '/' || documentServerUrl.search || documentServerUrl.hash) return null;
  } catch {
    return null;
  }

  const fileType = session.fileType as OfficeFileType;
  const documentType = session.documentType as OfficeDocumentType;
  const requiredDocumentType: Record<OfficeFileType, OfficeDocumentType> = {
    doc: 'word', docx: 'word', xls: 'cell', xlsx: 'cell', ppt: 'slide', pptx: 'slide', pdf: 'pdf',
  };
  if (requiredDocumentType[fileType] !== documentType || Date.parse(session.expiresAt as string) <= Date.now()) return null;

  return {
    sessionId: expectedSessionId,
    documentServerUrl: session.documentServerUrl as string,
    documentUrl: session.documentUrl as string,
    documentKey: session.documentKey as string,
    token: session.token as string,
    documentTitle: session.documentTitle as string,
    fileType,
    documentType,
    expiresAt: session.expiresAt as string,
  };
}

export function resultMessage(type: ShellResultMessage['type'], sessionId: string, code?: string): ShellResultMessage {
  return type === 'office:ready'
    ? { type, sessionId }
    : { type, sessionId, code: /^[A-Z0-9_]{1,64}$/.test(code ?? '') ? code! : 'DOCUMENT_SERVER_ERROR' };
}
