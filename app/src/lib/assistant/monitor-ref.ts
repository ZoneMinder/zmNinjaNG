/**
 * Resolves whatever the model called a monitor into a real monitor id (refs #246).
 *
 * The tool schemas say `monitorId`, and the system prompt says to use ids from
 * `list_monitors`, but a small on-device model reliably passes the NAME it saw
 * in an earlier row ("Front Door", or "FrontDoor" with the spaces eaten).
 * ZoneMinder's events index takes that literally: `MonitorId:FrontDoor` matches
 * no rows and returns `total: 0`, which the model then reports as "no one came
 * to your front door". A malformed query is indistinguishable from a real
 * negative once it reaches the answer, so the resolution has to happen before
 * the query, and anything unresolvable has to be an error rather than an empty
 * result set.
 *
 * A tool schema is prose in a prompt, not a contract anything enforces: treat
 * every model-supplied value as untrusted input.
 */
import type { MonitorData } from '../../api/types';

export type MonitorRefResolution = { id: string } | { error: string };

/** Letters and digits only (any script), lowercased: makes "Front Door",
 *  "front door" and "FrontDoor" the same key, which covers how models mangle
 *  names. Unicode-aware, or two monitors with non-Latin names both normalize
 *  to '' and collide as false "duplicates". Shared with the pre-turn mention
 *  scan (monitor-stage.ts) so a name matches the same way on both paths. */
export function normalizeMonitorName(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * `ref` may be a monitor id or a monitor name. Returns the id, or an error
 * message naming the monitors that do exist so the model can retry with a real
 * one rather than guessing again.
 *
 * A numeric ref that matches no monitor is an error too, not a pass-through: it
 * would otherwise reach the API and come back as the same empty result set this
 * function exists to prevent.
 */
export function resolveMonitorRef(ref: string, monitors: MonitorData[]): MonitorRefResolution {
  const trimmed = ref.trim();
  if (!trimmed) return { error: 'monitorId is required.' };

  const byId = monitors.find((m) => m.Monitor.Id === trimmed);
  if (byId) return { id: byId.Monitor.Id };

  const target = normalizeMonitorName(trimmed);
  const byName = monitors.filter((m) => normalizeMonitorName(m.Monitor.Name) === target);
  if (byName.length === 1) return { id: byName[0].Monitor.Id };
  if (byName.length > 1) {
    // Two monitors sharing a name: picking one would be a coin flip, and this
    // app answers questions about security cameras.
    return {
      error:
        `More than one monitor is called "${trimmed}" (ids ${byName.map((m) => m.Monitor.Id).join(', ')}). ` +
        'Use the id instead.',
    };
  }

  return {
    error:
      `No monitor matches "${trimmed}". Available monitors: ` +
      `${monitors.map((m) => `${m.Monitor.Name} (id ${m.Monitor.Id})`).join(', ')}. ` +
      'Use one of these, by id.',
  };
}
