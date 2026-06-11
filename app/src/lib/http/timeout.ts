/**
 * Timeout helpers for the HTTP client. `withTimeoutSignal` composes a caller
 * signal with a timeout into one AbortSignal for the fetch and Electron paths.
 * `raceNativeTimeout` settles a CapacitorHttp promise on timeout or abort,
 * since CapacitorHttp has no AbortSignal support.
 */

export function withTimeoutSignal(timeoutMs?: number, signal?: AbortSignal): { signal?: AbortSignal; cleanup: () => void } {
  if (!timeoutMs) {
    return { signal, cleanup: () => {} };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();

  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    },
  };
}

/**
 * Settle a native request promise within `timeoutMs` (and on `signal` abort),
 * since CapacitorHttp can't be aborted directly. The underlying native request
 * keeps running until its own connect/read timeout fires, but the caller's
 * promise rejects on time so the UI can error and retry.
 */
export function raceNativeTimeout<R>(
  requestPromise: Promise<R>,
  timeoutMs?: number,
  signal?: AbortSignal
): Promise<R> {
  if (!timeoutMs && !signal) return requestPromise;
  return new Promise<R>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const onAbort = () => finish(() => reject(new DOMException('The operation was aborted.', 'AbortError')));
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
    if (timeoutMs) {
      timer = setTimeout(
        () => finish(() => reject(new Error(`Native request timed out after ${timeoutMs}ms`))),
        timeoutMs,
      );
    }
    requestPromise.then(
      (r) => finish(() => resolve(r)),
      (e) => finish(() => reject(e)),
    );
  });
}
