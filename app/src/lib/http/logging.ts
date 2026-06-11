/**
 * Log formatting helpers for the HTTP client: the per-request ID counter,
 * correlation tags tying wire-level lines to API-level requests, short URL
 * paths for headlines, and binary body placeholders so log payloads stay small.
 */

// Monotonically increasing request ID counter for correlation
let requestIdCounter = 0;

export function nextRequestId(): number {
  return ++requestIdCounter;
}

/**
 * Extract the path + query for log lines so the host/proxy doesn't dominate.
 */
export function shortPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search ? '?…' : ''}`;
  } catch {
    return url;
  }
}

/**
 * Replace a binary response body with a short placeholder so the log
 * payload doesn't include megabytes of base64.
 */
export function loggableResponseBody(data: unknown, responseType: string): unknown {
  if (responseType === 'blob' || responseType === 'arraybuffer' || responseType === 'base64') {
    return `<binary: ${responseType}>`;
  }
  return data;
}

export function correlationPrefix(requestId: number, correlationId?: number): string {
  return correlationId !== undefined ? `{api:${correlationId}, http:${requestId}}` : `#${requestId}`;
}
