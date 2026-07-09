import { describe, it, expect, afterEach, vi } from 'vitest';
import { electronHttpRequest } from '../adapter-electron';
import { isAbortError } from '../../is-abort-error';
import type { AdapterRequest } from '../types';

// Minimal AdapterRequest for a JSON GET; individual tests override as needed.
function req(overrides: Partial<AdapterRequest> = {}): AdapterRequest {
  return {
    url: 'https://zm.example/api/monitors.json',
    method: 'GET',
    headers: {},
    body: undefined,
    responseType: 'json',
    ...overrides,
  };
}

function installBridge(request: (r: unknown) => Promise<unknown>) {
  (window as unknown as { electronHttp?: unknown }).electronHttp = { request };
}

afterEach(() => {
  delete (window as unknown as { electronHttp?: unknown }).electronHttp;
  vi.restoreAllMocks();
});

describe('electronHttpRequest', () => {
  it('decodes a successful JSON response from the ok:true envelope', async () => {
    installBridge(async () =>
      ({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        bodyText: '{"monitors":[]}',
      }));

    const res = await electronHttpRequest<{ monitors: unknown[] }>(req());

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ monitors: [] });
  });

  it('throws an AbortError when the bridge reports a timeout', async () => {
    installBridge(async () =>
      ({ ok: false, error: { name: 'AbortError', message: 'Request timed out after 5000ms' } }));

    const err = await electronHttpRequest(req({ timeoutMs: 5000 })).catch((e) => e);

    expect(isAbortError(err)).toBe(true);
    expect((err as Error).message).toBe('Request timed out after 5000ms');
  });

  it('throws a named error for a genuine network failure, preserving the name', async () => {
    installBridge(async () =>
      ({ ok: false, error: { name: 'TypeError', message: 'net::ERR_CONNECTION_REFUSED' } }));

    const err = await electronHttpRequest(req()).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('TypeError');
    expect((err as Error).message).toBe('net::ERR_CONNECTION_REFUSED');
    expect(isAbortError(err)).toBe(false);
  });

  it('rejects with AbortError when the caller signal aborts before the bridge resolves', async () => {
    const controller = new AbortController();
    installBridge(() => new Promise(() => { /* never resolves */ }));

    const promise = electronHttpRequest(req({ signal: controller.signal })).catch((e) => e);
    controller.abort();

    expect(isAbortError(await promise)).toBe(true);
  });
});
