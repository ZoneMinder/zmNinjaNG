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
  /**
   * `host:port` of the URL the request dialled, stamped by `lib/http.ts` on
   * every failure. Optional because a relative URL has no host to report.
   *
   * Here so a caller can name the address WITHOUT parsing it out of the
   * platform's error message, which is different on all four adapters and
   * carries formatting artifacts: Android's libcore says "failed to connect to
   * /192.168.50.11 (port 11434)" (the leading slash is
   * `InetSocketAddress.toString()` printing an empty hostname before the
   * literal address), Node says "connect ECONNREFUSED 192.168.50.11:11434",
   * iOS `URLSession` says "Could not connect to the server", and browser
   * `fetch` says "Failed to fetch" with no address at all (refs #312).
   */
  host?: string;
}

export function createHttpError(
  status: number,
  statusText: string,
  data: unknown,
  headers: Record<string, string>
): HttpError {
  // The native adapter has no status text to report (CapacitorHttp does not
  // expose one), and this message reaches the user through the error banner.
  // Leave off the separator rather than render a dangling "HTTP 401: ".
  const error = new Error(statusText ? `HTTP ${status}: ${statusText}` : `HTTP ${status}`) as HttpError;
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

/**
 * Whether the server says it has no such record. ZoneMinder answers a write
 * against a deleted event this way, which happens routinely on a server that
 * prunes: a list fetched a minute ago still shows the card, and the write goes
 * to a row that is gone. That is not a failure to retry or a permission to
 * explain - the right response is to refresh the list the card came from.
 */
export function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { status?: number }).status === 404;
}

