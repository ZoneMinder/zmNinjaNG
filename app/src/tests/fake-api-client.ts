/**
 * A scriptable ApiClient. A leaf module on purpose: fake-store-gates imports
 * it, and must not import anything that reaches the stores, or the mock
 * factory for api/store-gates forms an import cycle with the stores it is
 * standing in for.
 */
import type { ApiClient, ApiRequestConfig } from '../api/client';
import type { HttpResponse } from '../lib/http/types';

export function fakeResponse<T>(data: T, status = 200): HttpResponse<T> {
  return { data, status, statusText: status === 200 ? 'OK' : 'Error', headers: {} };
}

type RouteValue = unknown | ((url: string, data?: unknown) => unknown);
export interface FakeApiClient extends ApiClient {
  /** Every request made, in order, for assertions on what the app asked for. */
  calls: Array<{ method: string; url: string; data?: unknown }>;
}

/**
 * A scriptable ApiClient. Routes are matched by substring against the URL,
 * first match wins; a function route is called with (url, data). Unmatched
 * requests reject like a 404 so a test cannot pass on a request nobody
 * scripted.
 */
export function fakeApiClient(routes: Record<string, RouteValue> = {}): FakeApiClient {
  const calls: FakeApiClient['calls'] = [];
  const resolve = async <T,>(method: string, url: string, data?: unknown): Promise<HttpResponse<T>> => {
    calls.push({ method, url, data });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (key === undefined) {
      const err = Object.assign(new Error(`fakeApiClient: no route for ${method} ${url}`), { status: 404 });
      throw err;
    }
    const v = routes[key];
    const body = typeof v === 'function' ? await (v as (u: string, d?: unknown) => unknown)(url, data) : v;
    return fakeResponse(body as T);
  };
  return {
    calls,
    get: (url: string, _c?: ApiRequestConfig) => resolve('GET', url),
    post: (url: string, data?: unknown) => resolve('POST', url, data),
    put: (url: string, data?: unknown) => resolve('PUT', url, data),
    delete: (url: string) => resolve('DELETE', url),
    postForm: (url: string, fields: unknown) => resolve('POST', url, fields),
    putForm: (url: string, fields: unknown) => resolve('PUT', url, fields),
  } as FakeApiClient;
}

