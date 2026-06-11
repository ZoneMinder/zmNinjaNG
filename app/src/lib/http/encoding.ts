/**
 * Encoding helpers shared by the HTTP platform adapters: request body
 * serialization, header and query-param normalization, and base64/byte
 * conversion for binary response bodies.
 */

/**
 * Serialize request body to string for fetch-based requests
 */
export function serializeRequestBody(body: unknown): string | undefined {
  if (!body) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  return JSON.stringify(body);
}

export function normalizeHeaders(headers: Headers): Record<string, string> {
  const responseHeaders: Record<string, string> = {};
  headers.forEach((value: string, key: string) => {
    responseHeaders[key] = value;
  });
  return responseHeaders;
}

export function stringifyParams(params: Record<string, string | number>): Record<string, string> {
  const stringParams: Record<string, string> = {};
  Object.entries(params).forEach(([key, value]) => {
    stringParams[key] = String(value);
  });
  return stringParams;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
