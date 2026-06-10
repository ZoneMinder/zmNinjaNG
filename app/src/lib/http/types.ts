/**
 * Shared types for the HTTP client: the public request/response/error shapes
 * re-exported by lib/http.ts, the HttpError factory, and the AdapterRequest
 * shape every platform adapter accepts.
 */

export interface HttpOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';
  headers?: Record<string, string>;
  params?: Record<string, string | number>;
  body?: unknown;
  responseType?: 'json' | 'blob' | 'arraybuffer' | 'text' | 'base64';
  token?: string; // Optional auth token to inject
  timeoutMs?: number;
  timeout?: number;
  signal?: AbortSignal;
  validateStatus?: (status: number) => boolean;
  onDownloadProgress?: (progress: HttpProgress) => void;
  /**
   * Caller-supplied correlation ID (e.g., from api/client.ts) so the wire-level
   * HTTP log can be tied back to the originating API request without inspecting
   * stack traces. Rendered as `{api:N, http:M}` in the completion line.
   */
  correlationId?: number;
  /**
   * Caller-supplied business-level label for the request, e.g.
   * "Fetch monitors list". Rendered in the HTTP completion headline so a
   * single line carries both the wire fact and the domain intent.
   * No leading verb requirement. Keep it short.
   */
  intent?: string;
  /**
   * Suppress the per-request HTTP log line. Use for high-frequency internal
   * fetches (e.g. snapshot frames) that would otherwise flood the log on every
   * refresh. The caller is responsible for logging genuine failures.
   */
  suppressLog?: boolean;
}

export interface HttpResponse<T = unknown> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

export interface HttpProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export interface HttpError extends Error {
  status: number;
  statusText: string;
  data: unknown;
  headers: Record<string, string>;
}

export function createHttpError(
  status: number,
  statusText: string,
  data: unknown,
  headers: Record<string, string>
): HttpError {
  const error = new Error(`HTTP ${status}: ${statusText}`) as HttpError;
  error.status = status;
  error.statusText = statusText;
  error.data = data;
  error.headers = headers;
  return error;
}

/**
 * Request shape passed from the lib/http.ts dispatcher to a platform adapter.
 * The dispatcher fills in the fields each adapter uses: `timeoutMs` for the
 * native and Electron paths, `signal` for all paths (the native adapter gets
 * the caller's raw signal, the Electron and web adapters get the composed
 * timeout signal), and `onDownloadProgress` for the web path only.
 */
export interface AdapterRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  responseType: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onDownloadProgress?: (progress: HttpProgress) => void;
}
