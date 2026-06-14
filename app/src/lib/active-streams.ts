/**
 * Registry of active monitor-stream teardown thunks.
 *
 * Each useStreamLifecycle instance registers a thunk that sends CMD_QUIT for
 * its own stream, capturing that tile's per-server URL, token, and connkey.
 * A profile switch awaits every registered thunk BEFORE it tears down the old
 * profile's auth and SSL trust, so the old (possibly self-signed) server's
 * streams are quit while its trust setting and access token are still in
 * effect. Relying on React unmount alone races the switch: the new profile's
 * SSL-trust flip can reject the old server's in-flight CMD_QUIT, orphaning the
 * nph-zms process. A centralized quit keyed only by monitorId cannot do this
 * because it has no record of which server each stream used. refs #188
 */

/** Sends CMD_QUIT for one stream. Must not reject. */
type StreamTeardown = () => Promise<void>;

const activeStreams = new Map<string, StreamTeardown>();

export function registerActiveStream(id: string, teardown: StreamTeardown): void {
  activeStreams.set(id, teardown);
}

export function unregisterActiveStream(id: string): void {
  activeStreams.delete(id);
}

/**
 * Quit every registered stream and wait for the CMD_QUITs to settle. Never
 * rejects: a failed teardown must not block a profile switch.
 */
export async function quitAllActiveStreams(): Promise<void> {
  const teardowns = Array.from(activeStreams.values());
  await Promise.allSettled(teardowns.map((fn) => fn()));
}
