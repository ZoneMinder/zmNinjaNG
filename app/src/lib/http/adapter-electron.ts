/**
 * Electron HTTP adapter. Bridges the request over IPC to the main process
 * (electron/preload.cjs exposes window.electronHttp) where Electron's net
 * module performs it. Declares the window.electronHttp global used by the
 * lib/http.ts dispatcher to detect the bridge.
 */

import type { AdapterRequest, HttpResponse } from './types';
import { serializeRequestBody, base64ToBytes } from './encoding';

// Envelope returned by the Electron main-process HTTP bridge (main.cjs). The
// bridge never rejects for HTTP-level failures: a timeout or transport error
// comes back as `{ ok: false, error }` so Electron does not log it as an
// unhandled ipcMain.handle rejection. This adapter turns `ok: false` back into
// a thrown Error, preserving the name so isAbortError() and other name-based
// checks upstream keep working.
interface ElectronHttpSuccess {
  ok: true;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText?: string;
  bodyBase64?: string;
}

interface ElectronHttpFailure {
  ok: false;
  error: { name: string; message: string };
}

type ElectronHttpResult = ElectronHttpSuccess | ElectronHttpFailure;

declare global {
  interface Window {
    electronHttp?: {
      request(req: {
        url: string;
        method: string;
        headers: Record<string, string>;
        body?: string;
        responseType: string;
        timeoutMs?: number;
      }): Promise<ElectronHttpResult>;
    };
  }
}

/**
 * Electron HTTP request implementation.
 *
 * The request runs in the privileged process (Electron's main process, via the
 * net module) rather than the sandboxed renderer, bridged over IPC by
 * electron/preload.cjs. This avoids renderer CORS, and self-signed certs are
 * handled in main.cjs. Binary responses come back as base64 over IPC (no
 * streaming progress, like the Capacitor path).
 */
export async function electronHttpRequest<T>(req: AdapterRequest): Promise<HttpResponse<T>> {
  const { url, method, headers, body, responseType, signal, timeoutMs } = req;
  const requestBody = serializeRequestBody(body);
  const invocation = window.electronHttp!.request({
    url,
    method,
    headers,
    body: requestBody,
    responseType,
    timeoutMs,
  });

  let envelope: ElectronHttpResult;
  if (signal) {
    envelope = await Promise.race([
      invocation,
      new Promise<never>((_resolve, reject) => {
        const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      }),
    ]);
  } else {
    envelope = await invocation;
  }

  // A timeout or transport error is reported as a structured failure (see the
  // envelope comment above). Rebuild it as a thrown Error with the original name
  // so upstream error handling behaves exactly as it did when the bridge threw.
  if (!envelope.ok) {
    const error =
      envelope.error.name === 'AbortError'
        ? new DOMException(envelope.error.message, 'AbortError')
        : Object.assign(new Error(envelope.error.message), { name: envelope.error.name });
    throw error;
  }

  const result = envelope;

  let data: T;
  if (responseType === 'blob' || responseType === 'arraybuffer' || responseType === 'base64') {
    const base64 = result.bodyBase64 ?? '';
    if (responseType === 'base64') {
      data = base64 as T;
    } else if (responseType === 'arraybuffer') {
      data = base64ToBytes(base64).buffer as T;
    } else {
      const contentType =
        result.headers['content-type'] || result.headers['Content-Type'] || 'application/octet-stream';
      const bytes = base64ToBytes(base64);
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      data = new Blob([buffer], { type: contentType }) as T;
    }
  } else if (responseType === 'text') {
    data = (result.bodyText ?? '') as T;
  } else {
    const text = result.bodyText ?? '';
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = text as T;
    }
  }

  return {
    data,
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  };
}
