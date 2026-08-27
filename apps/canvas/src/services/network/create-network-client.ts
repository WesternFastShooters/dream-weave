import type {
  ApiError,
  ClientTransport,
  DuplexStream,
  ServerStream,
} from '@dream-weave/canvas-core/generated';

export class DreamWeaveApiError extends Error {
  readonly code: string;

  constructor(readonly status: number, readonly apiError: ApiError) {
    super(apiError.message || `Request failed (${status}).`);
    this.name = 'DreamWeaveApiError';
    this.code = apiError.code || 'HTTP_ERROR';
  }
}

export interface DreamWeaveNetworkRuntime {
  readonly transport: ClientTransport;
  put(url: string, body: BodyInit, headers?: HeadersInit): Promise<void>;
}

/** Generic runtime for generated clients. Endpoint paths and JSON DTOs remain
 * owned by protoc output; this boundary owns credentials and HTTP failures. */
export function createDreamWeaveNetworkClient(apiBasePath = '/'): DreamWeaveNetworkRuntime {
  const transport: ClientTransport = {
    unary: (path, method, body) => requestJson(resolvePath(apiBasePath, path), {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === null ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body ?? undefined,
    }),
    serverStream: <T>(_path: string): ServerStream<T> => unsupportedStream('server streaming'),
    duplexStream: <TIn, TOut>(_path: string): DuplexStream<TIn, TOut> => unsupportedStream('duplex streaming'),
  };

  return {
    transport,
    put: async (url: string, body: BodyInit, headers?: HeadersInit) => {
      const response = await fetch(url, { method: 'PUT', body, headers, credentials: 'same-origin' });
      if (!response.ok) throw await toApiError(response);
    },
  };
}

function resolvePath(basePath: string, path: string): string {
  return `${basePath.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, { ...init, credentials: 'same-origin' });
  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return {};
  const text = await response.text();
  return text ? JSON.parse(text) as unknown : {};
}

async function toApiError(response: Response): Promise<DreamWeaveApiError> {
  let body: ApiError = { code: 'HTTP_ERROR', message: `Request failed (${response.status}).` };
  try {
    const parsed = await response.json() as Partial<ApiError>;
    body = {
      ...parsed,
      code: typeof parsed.code === 'string' ? parsed.code : 'HTTP_ERROR',
      message: typeof parsed.message === 'string' ? parsed.message : `Request failed (${response.status}).`,
    };
  } catch { /* non-JSON proxy errors remain useful by status */ }
  return new DreamWeaveApiError(response.status, body);
}

function unsupportedStream<T>(kind: string): ServerStream<T> & DuplexStream<unknown, T> {
  throw new Error(`Dream Weave does not expose ${kind} through this client.`);
}
