/**
 * Records the ZoneMinder requests one tool made, so the panel transcript can
 * show the exact call behind a tool result (refs #246).
 *
 * Without this the transcript showed what the model was told, but not what was
 * actually asked of the server, which is where several real bugs lived: a
 * `when: "today"` query that reported no time filter, and an object-type query
 * whose zero rows came from a filter the answer never mentioned. Reading the
 * URL is the difference between "the model is wrong" and "the query was wrong".
 *
 * A module-level buffer rather than context plumbing: `lib/http.ts` is called
 * from deep inside the api layer, several frames below any tool, and threading
 * a recorder through every api function to serve a diagnostic panel is a lot of
 * signature churn for one reader. Safe because the agent loop runs tool
 * executions one at a time (see the `for` loop in agent.ts), so a capture
 * window has one owner; concurrent requests INSIDE one tool (list_events does
 * `Promise.all`) all belong to that same tool and are meant to be collected
 * together.
 */

let buffer: string[] | undefined;

/** Called by `lib/http.ts` on every request. A no-op unless a capture is
 *  open, so it costs one undefined check outside the assistant. */
export function recordApiCall(method: string, path: string, status: number, ms: number): void {
  if (!buffer) return;
  buffer.push(`${method} ${path} -> ${status} (${ms}ms)`);
}

/** Runs `fn` while collecting the ZM calls it makes. Restores the previous
 *  buffer on the way out (rather than clearing it) so a nested capture cannot
 *  silently swallow its parent's recording. */
export async function captureApiCalls<T>(fn: () => Promise<T>): Promise<{ result: T; calls: string[] }> {
  const previous = buffer;
  const collected: string[] = [];
  buffer = collected;
  try {
    const result = await fn();
    return { result, calls: collected };
  } finally {
    buffer = previous;
  }
}
