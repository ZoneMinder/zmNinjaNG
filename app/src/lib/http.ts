/**
 * Unified HTTP Client
 *
 * Provides a platform-agnostic HTTP interface that works across Web, iOS, Android, and Desktop.
 * Handles CORS, proxying, and platform-specific implementations automatically.
 *
 * This file is the public facade: it builds the final URL (params, token,
 * dev proxy), dispatches to the platform adapter (lib/http/adapter-native.ts,
 * lib/http/adapter-electron.ts, lib/http/adapter-web.ts), validates the
 * status, and logs the request/response pair.
 *
 * Features:
 * - Automatic platform detection (Native/Electron/Web/Proxy)
 * - CORS handling via native HTTP or proxy
 * - Token injection for authenticated requests
 * - Response type handling (json, blob, arraybuffer, text, base64)
 * - Logging integration
 */

import { Platform } from './platform';
import { log, LogLevel } from './logger';
import { createHttpError } from './http/types';
import type { HttpOptions, HttpResponse, HttpError } from './http/types';
import { stringifyParams } from './http/encoding';
import { withTimeoutSignal } from './http/timeout';
import { nextRequestId, shortPath, loggableResponseBody, correlationPrefix } from './http/logging';
import { nativeHttpRequest } from './http/adapter-native';
import { electronHttpRequest } from './http/adapter-electron';
import { webHttpRequest } from './http/adapter-web';

export type { HttpOptions, HttpResponse, HttpProgress, HttpError } from './http/types';

/**
 * Make an HTTP request using the appropriate platform-specific method.
 *
 * @param url - The URL to request (full URL, not relative)
 * @param options - Request options
 * @returns Promise resolving to the response
 */
export async function httpRequest<T = unknown>(
  url: string,
  options: HttpOptions = {}
): Promise<HttpResponse<T>> {
  const {
    method = 'GET',
    headers = {},
    params = {},
    body,
    responseType = 'json',
    token,
    timeout,
    timeoutMs,
    signal,
    validateStatus,
    onDownloadProgress,
    correlationId,
    intent,
    suppressLog,
  } = options;

  // Add token to params if provided
  const finalParams = { ...params };
  if (token) {
    finalParams.token = token;
  }

  // Build query string
  const queryString = new URLSearchParams(stringifyParams(finalParams)).toString();
  const fullUrl = queryString ? (url.includes('?') ? `${url}&${queryString}` : `${url}?${queryString}`) : url;

  // Handle proxy in dev mode for web
  let requestUrl = fullUrl;
  let requestHeaders = { ...headers };

  if (body && typeof body !== 'string' && !(body instanceof URLSearchParams)) {
    requestHeaders = {
      ...requestHeaders,
      'Content-Type': requestHeaders['Content-Type'] || 'application/json',
    };
  }

  if (Platform.shouldUseProxy && (url.startsWith('http://') || url.startsWith('https://'))) {
    // Extract the base URL to use as X-Target-Host
    const urlObj = new URL(url);
    const baseUrl = `${urlObj.protocol}//${urlObj.host}`;

    // Replace base URL with proxy
    requestUrl = fullUrl.replace(baseUrl, 'http://localhost:3001/proxy');
    requestHeaders['X-Target-Host'] = baseUrl;
  }

  // Generate monotonically increasing request ID for correlation
  const requestId = nextRequestId();
  const platform = Platform.isNative
    ? 'Native'
    : Platform.isElectron && typeof window !== 'undefined' && window.electronHttp
      ? 'Electron'
      : 'Web';
  const startTime = performance.now();
  const corrTag = correlationPrefix(requestId, correlationId);
  const path = shortPath(fullUrl);
  const intentTag = intent ? `${intent} · ` : '';

  // Prepare request body for logging (form-data → object so logger can sanitize)
  let requestBodyForLog: unknown = body;
  if (body instanceof URLSearchParams) {
    const formData: Record<string, string> = {};
    body.forEach((value, key) => {
      formData[key] = value;
    });
    requestBodyForLog = formData;
  }

  try {
    let response: HttpResponse<T>;
    if (Platform.isNative) {
      response = await nativeHttpRequest<T>({
        url: requestUrl,
        method,
        headers: requestHeaders,
        body,
        responseType,
        timeoutMs: timeoutMs ?? timeout,
        signal,
      });
    } else if (Platform.isElectron && typeof window !== 'undefined' && window.electronHttp) {
      const { signal: timeoutSignal, cleanup } = withTimeoutSignal(timeoutMs ?? timeout, signal);
      response = await electronHttpRequest<T>({
        url: requestUrl,
        method,
        headers: requestHeaders,
        body,
        responseType,
        signal: timeoutSignal,
        timeoutMs: timeoutMs ?? timeout,
      });
      cleanup();
    } else {
      const { signal: timeoutSignal, cleanup } = withTimeoutSignal(timeoutMs ?? timeout, signal);
      response = await webHttpRequest<T>({
        url: requestUrl,
        method,
        headers: requestHeaders,
        body,
        responseType,
        signal: timeoutSignal,
        onDownloadProgress,
      });
      cleanup();
    }

    const isValidStatus = validateStatus
      ? validateStatus(response.status)
      : response.status >= 200 && response.status < 300;

    if (!isValidStatus) {
      throw createHttpError(response.status, response.statusText, response.data, response.headers);
    }

    const duration = Math.round(performance.now() - startTime);

    // Headline + collapsed details. The headline carries everything you
    // need at a glance; click to expand for the full sanitized request
    // and response. Bodies are NOT flattened: the user opted in to see
    // them by expanding the row, so they get the real shape.
    if (!suppressLog) log.groupCollapsed(
      'HTTP',
      `${corrTag} ${intentTag}${method} ${path} → ${response.status} (${duration}ms)`,
      LogLevel.DEBUG,
      {
        platform,
        request: {
          method,
          url: fullUrl,
          params: Object.keys(finalParams).length > 0 ? finalParams : undefined,
          headers: Object.keys(requestHeaders).length > 0 ? requestHeaders : undefined,
          body: requestBodyForLog,
        },
        response: {
          status: response.status,
          statusText: response.statusText || undefined,
          headers: Object.keys(response.headers).length > 0 ? response.headers : undefined,
          body: loggableResponseBody(response.data, responseType),
        },
      },
    );

    return response;
  } catch (error) {
    const duration = Math.round(performance.now() - startTime);
    const httpError = error as HttpError;
    const status = httpError.status ?? 'ERR';

    // A caller-initiated cancellation (a superseded snapshot frame, a cancelled
    // download) is expected, not a failure. Log it quietly so it does not
    // surface as a red HTTP error, but still rethrow so callers can handle it.
    const wasCancelled = signal?.aborted === true;

    if (!suppressLog) log.groupCollapsed(
      'HTTP',
      wasCancelled
        ? `${corrTag} ${intentTag}${method} ${path} ⊘ cancelled (${duration}ms)`
        : `${corrTag} ${intentTag}${method} ${path} ✗ ${status} (${duration}ms)`,
      wasCancelled ? LogLevel.DEBUG : LogLevel.ERROR,
      {
        platform,
        request: {
          method,
          url: fullUrl,
          params: Object.keys(finalParams).length > 0 ? finalParams : undefined,
          headers: Object.keys(requestHeaders).length > 0 ? requestHeaders : undefined,
          body: requestBodyForLog,
        },
        error: {
          message: httpError.message || String(error),
          status: httpError.status ?? undefined,
          statusText: httpError.statusText ?? undefined,
          headers: httpError.headers && Object.keys(httpError.headers).length > 0 ? httpError.headers : undefined,
          data: httpError.data,
        },
      },
    );
    throw error;
  }
}

/**
 * Convenience method for GET requests
 */
export async function httpGet<T = unknown>(
  url: string,
  options?: Omit<HttpOptions, 'method' | 'body'>
): Promise<HttpResponse<T>> {
  return httpRequest<T>(url, { ...options, method: 'GET' });
}

/**
 * Convenience method for POST requests
 */
export async function httpPost<T = unknown>(
  url: string,
  body?: unknown,
  options?: Omit<HttpOptions, 'method' | 'body'>
): Promise<HttpResponse<T>> {
  return httpRequest<T>(url, { ...options, method: 'POST', body });
}

/**
 * Convenience method for PUT requests
 */
export async function httpPut<T = unknown>(
  url: string,
  body?: unknown,
  options?: Omit<HttpOptions, 'method' | 'body'>
): Promise<HttpResponse<T>> {
  return httpRequest<T>(url, { ...options, method: 'PUT', body });
}

/**
 * Convenience method for DELETE requests
 */
export async function httpDelete<T = unknown>(
  url: string,
  options?: Omit<HttpOptions, 'method' | 'body'>
): Promise<HttpResponse<T>> {
  return httpRequest<T>(url, { ...options, method: 'DELETE' });
}
