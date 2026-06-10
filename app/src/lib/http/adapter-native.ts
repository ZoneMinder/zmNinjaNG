/**
 * Native (Capacitor) HTTP adapter. Sends the request through CapacitorHttp
 * (dynamically imported, so the web build never bundles it) and enforces the
 * timeout via native connect/read timeouts plus a JS race, since CapacitorHttp
 * has no AbortSignal support.
 */

import type { AdapterRequest, HttpResponse } from './types';
import { raceNativeTimeout } from './timeout';

/**
 * Native (Capacitor) HTTP request implementation
 */
export async function nativeHttpRequest<T>(req: AdapterRequest): Promise<HttpResponse<T>> {
  const { url, method, headers, body, responseType, timeoutMs, signal } = req;
  const { CapacitorHttp } = await import('@capacitor/core');
  const nativeResponseType =
    responseType === 'arraybuffer' ? 'arraybuffer' : responseType === 'blob' || responseType === 'base64' ? 'blob' : undefined;
  // CapacitorHttp has no AbortSignal support, so the timeout is enforced two
  // ways: native connect/read timeouts (so the underlying socket gives up) and
  // a JS race (so the promise settles deterministically even if the native
  // timer drifts, since readTimeout resets on each received chunk).
  const requestPromise = CapacitorHttp.request({
    method: method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD',
    url,
    headers,
    data: body,
    responseType: nativeResponseType,
    ...(timeoutMs ? { connectTimeout: timeoutMs, readTimeout: timeoutMs } : {}),
  });
  const response = await raceNativeTimeout(requestPromise, timeoutMs, signal);

  const data = response.data as T;
  const responseHeaders = response.headers as Record<string, string>;

  return {
    data,
    status: response.status,
    statusText: '',
    headers: responseHeaders,
  };
}
