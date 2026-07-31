/**
 * ZoneMinder monitor alarm state.
 *
 * `/monitors/alarm/id:{id}/command:status.json` reports the monitor's live
 * alarm state. ZoneMinder varies which field carries it between versions, so
 * both `status` and `output` are accepted, and the value may arrive as a
 * number or as a string. Older responses use words rather than digits.
 *
 * Note that `status: 'false'` is the API's *error* marker (see
 * api/monitors.ts), not an alarm state, so it must never read as alarming.
 */

import type { AlarmStatusResponse } from '../../api/types';

export type MonitorAlarmState =
  | 'idle'
  | 'prealarm'
  | 'alarm'
  | 'alert'
  | 'tape'
  | 'unknown';

/**
 * The subset of AlarmStatusResponse this parser reads. `status` is nullable
 * here even though the schema's static type says it is required and never
 * null: `withFieldCatch` (schema-tolerance.ts) falls back a mismatched
 * `status` field to `null` at runtime while deliberately leaving the static
 * type unchanged, so a real response can still carry `status: null`. Field
 * types are derived from AlarmStatusResponse so this stays in sync with it.
 */
type AlarmStatusLike = {
  status?: AlarmStatusResponse['status'] | null;
  output?: AlarmStatusResponse['output'];
  error?: AlarmStatusResponse['error'];
};

/** ZoneMinder's numeric states, in its own order. */
const NUMERIC_STATES: Record<number, MonitorAlarmState> = {
  0: 'idle',
  1: 'prealarm',
  2: 'alarm',
  3: 'alert',
  4: 'tape',
};

const TRUTHY_WORDS = new Set(['on', 'armed', 'true']);
const FALSY_WORDS = new Set(['off', 'disarmed', 'false']);

/** The states that mean "something is happening on this camera right now". */
const ALARMING_STATES = new Set<MonitorAlarmState>(['alarm', 'alert']);

export function parseAlarmState(raw: AlarmStatusLike | undefined): MonitorAlarmState {
  const value = raw?.status ?? raw?.output;
  if (value === undefined || value === null) return 'unknown';

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return NUMERIC_STATES[numeric] ?? 'unknown';
  }

  const word = String(value).toLowerCase();
  if (TRUTHY_WORDS.has(word)) return 'alarm';
  if (FALSY_WORDS.has(word)) return 'idle';
  return 'unknown';
}

/** True when the monitor should appear on the Live Activity page. */
export function isAlarmingState(state: MonitorAlarmState): boolean {
  return ALARMING_STATES.has(state);
}

/**
 * True when the monitor is in any non-idle state.
 *
 * This is the question the monitor-detail alarm toggle asks, and it is
 * deliberately broader than isAlarmingState: it preserves that screen's
 * existing rule that any finite non-zero state reads as armed.
 */
export function isArmedState(state: MonitorAlarmState): boolean {
  return state !== 'idle' && state !== 'unknown';
}
