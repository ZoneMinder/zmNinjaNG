/**
 * Returns true when an unknown error represents a cancelled/aborted operation.
 *
 * Aborting a fetch/HTTP request rejects with a `DOMException` named
 * 'AbortError'. `DOMException` does NOT extend `Error` in browsers (only Node's
 * built-in DOMException happens to), so an `error instanceof Error` guard drops
 * real aborts on the floor and they get logged/reported as failures. Check the
 * `name` property directly instead.
 */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}
