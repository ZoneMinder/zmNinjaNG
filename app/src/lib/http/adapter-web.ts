/**
 * Web (fetch) HTTP adapter. Performs the request with the browser fetch API
 * and parses the response per responseType, streaming the body via a reader
 * when binary output is requested so download progress can be reported.
 */

import type { AdapterRequest, HttpProgress, HttpResponse } from './types';
import { serializeRequestBody, normalizeHeaders, bytesToBase64 } from './encoding';

async function readResponseBytes(
  response: Response,
  onDownloadProgress?: (progress: HttpProgress) => void
): Promise<Uint8Array> {
  if (!response.body) {
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    if (onDownloadProgress) {
      onDownloadProgress({
        loaded: bytes.length,
        total: bytes.length,
        percentage: 100,
      });
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const contentLengthHeader = response.headers.get('content-length');
  const total = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
  let loaded = 0;
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.length;
      if (onDownloadProgress) {
        const percentage = total > 0 ? Math.round((loaded * 100) / total) : 0;
        onDownloadProgress({ loaded, total, percentage });
      }
    }
  }

  const combined = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  if (onDownloadProgress) {
    onDownloadProgress({
      loaded,
      total: total || loaded,
      percentage: 100,
    });
  }

  return combined;
}

async function parseFetchResponse<T>(
  response: Response,
  responseType: string,
  onDownloadProgress?: (progress: HttpProgress) => void
): Promise<{ data: T; headers: Record<string, string> }> {
  const responseHeaders = normalizeHeaders(response.headers);

  let data: T;
  if (responseType === 'blob' || responseType === 'arraybuffer' || responseType === 'base64') {
    const bytes = await readResponseBytes(response, onDownloadProgress);
    if (responseType === 'blob') {
      const contentType =
        responseHeaders['content-type'] ||
        responseHeaders['Content-Type'] ||
        'application/octet-stream';
      const blobBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      data = new Blob([blobBuffer], { type: contentType }) as T;
    } else if (responseType === 'arraybuffer') {
      data = bytes.buffer as T;
    } else {
      data = bytesToBase64(bytes) as T;
    }
  } else if (responseType === 'text') {
    const text = await response.text();
    data = text as T;
  } else {
    const text = await response.text();
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = text as T;
    }
  }

  return { data, headers: responseHeaders };
}

/**
 * Web (fetch) HTTP request implementation
 */
export async function webHttpRequest<T>(req: AdapterRequest): Promise<HttpResponse<T>> {
  const { url, method, headers, body, responseType, signal, onDownloadProgress } = req;
  const requestBody = serializeRequestBody(body);

  const response = await fetch(url, {
    method,
    headers,
    body: requestBody,
    signal,
  });

  const { data, headers: responseHeaders } = await parseFetchResponse<T>(response, responseType, onDownloadProgress);

  return {
    data,
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  };
}
