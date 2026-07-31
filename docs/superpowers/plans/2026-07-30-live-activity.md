# Live Activity Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/live-activity` route showing only the monitors ZoneMinder currently reports as alarmed, as live montage tiles that appear on alarm and leave a short while after it clears.

**Architecture:** Per-monitor alarm status is polled through `getAlarmStatus`, fanned out one React Query per monitor. A pure reducer turns the raw per-monitor states into an ordered, damped display list with a dwell window so tiles do not flicker. Tiles are the existing `MontageMonitor`, which brings its whole ZMS connection-key and CMD_QUIT lifecycle with it.

**Tech Stack:** React 19, TypeScript, Zustand (persisted), TanStack Query v5, react-i18next, Tailwind, shadcn/ui primitives, Vitest, Playwright/Cucumber `.feature` files.

**Spec:** `docs/superpowers/specs/2026-07-30-live-activity-design.md`
**Issue:** #313
**Branch:** `feat/313-live-activity` (already created; the spec is already committed there)

## Global Constraints

- Run all npm commands from `app/`.
- Contract: all network requests go through `app/src/lib/http.ts` helpers or the API client. Never raw `fetch`/`axios`.
- Contract: all diagnostic output goes through `log.*` helpers with an explicit `LogLevel`. Never `console`.
- Contract: React Query keys come from `app/src/lib/query/query-keys.ts`. Never inline key arrays.
- Contract: all profile-scoped preferences go through `getProfileSettings` / `updateProfileSettings`, with every default declared in `mergeProfileSettings`.
- Contract: every recurring interval resolves from `useBandwidthSettings` / `getBandwidthSettings`. Never a literal interval value.
- Contract: no hardcoded user-facing text. Every string is a locale key, and all five locales (`de`, `en`, `es`, `fr`, `zh`) are updated in the same commit.
- Contract: semantic constants live in `app/src/lib/zmninja-ng-constants.ts`. No magic numbers inline.
- Zustand subscriptions must select every reactive field they read, using `useShallow` for multi-field selects.
- No em-dashes anywhere in source or docs. The `src/tests/no-em-dash.test.ts` gate enforces this.
- Test assertions must be able to fail: assert on fetched values or user-visible outcomes, never on element existence or child count.
- Keep files near 400 lines.
- Flex text uses `min-w-0`, `truncate`, and a `title`. Labels must fit 320px.
- One logical change per conventional commit. Every commit message ends with `Refs #313`.
- Never commit `app/android/app/build.gradle` or `app/ios/App/App.xcodeproj/project.pbxproj`. Both are modified in the working tree with incidental native build-number bumps and must stay unstaged. Always `git add` explicit paths, never `git add -A` or `git add .`.
- Run the gates covering a change before each commit. Full `npm run gates` before pushing or opening the PR.

---

### Task 0: Verify server assumptions

This task produces no code. It resolves three unknowns the later tasks encode. Do it against a real ZoneMinder server before writing Task 1.

**Files:** none.

**Interfaces:**
- Consumes: nothing.
- Produces: confirmed values for the state mapping in Task 1.

- [ ] **Step 1: Fetch the alarm status of an idle monitor**

Ask the maintainer to run this against their server, substituting a real monitor id and token:

```bash
curl -s "https://<portal>/zm/api/monitors/alarm/id:1/command:status.json?token=<token>"
```

Record the exact JSON. Note whether the value arrives under `status` or `output`, and whether it is a string or a number.

- [ ] **Step 2: Fetch the alarm status of a monitor while it is alarming**

Force an alarm, then re-run the same request:

```bash
curl -s "https://<portal>/zm/api/monitors/alarm/id:1/command:on.json?token=<token>"
curl -s "https://<portal>/zm/api/monitors/alarm/id:1/command:status.json?token=<token>"
curl -s "https://<portal>/zm/api/monitors/alarm/id:1/command:off.json?token=<token>"
```

Record which numeric state a real alarm reports, and watch whether it passes through 3 (ALERT) on the way back down to 0.

- [ ] **Step 3: Check whether excluded monitors already drop out of the monitor list**

In `app/src/api/monitors.ts`, `getMonitors` calls `filterExcludedMonitors` with `getExcludedMonitorIds()`. Confirm by reading that function whether the returned list already omits globally excluded monitors.

Run: `grep -n "filterExcludedMonitors" -A5 app/src/api/monitors.ts`

If it does, Task 5 does not need to re-apply the global exclusion, only the page-specific ignore list.

- [ ] **Step 4: Record the answers**

Write the three answers into the spec's "Assumptions to confirm" section, replacing the assumption wording with what was observed. Commit:

```bash
git add docs/superpowers/specs/2026-07-30-live-activity-design.md
git commit -m "docs: record verified ZoneMinder alarm-status values

Refs #313"
```

If ALERT (3) turns out not to occur in practice, adjust `ALARMING_STATES` in Task 1 accordingly and note it in that task's commit.

---

### Task 1: Shared alarm-state parse

`useAlarmControl` already parses this response inline. Extracting it prevents a second, divergent parser and gives the new page a typed state rather than a loose number. The extraction is behavior-preserving for `useAlarmControl`.

**Files:**
- Create: `app/src/lib/monitor/alarm-state.ts`
- Create: `app/src/lib/monitor/__tests__/alarm-state.test.ts`
- Modify: `app/src/pages/hooks/useAlarmControl.ts:54-79` (replace the inline `useMemo` parse and the border-class mapping)

**Interfaces:**
- Consumes: `AlarmStatusResponse` from `app/src/api/types.ts`.
- Produces:
  - `type MonitorAlarmState = 'idle' | 'prealarm' | 'alarm' | 'alert' | 'tape' | 'unknown'`
  - `parseAlarmState(raw: AlarmStatusResponse | undefined): MonitorAlarmState`
  - `isAlarmingState(state: MonitorAlarmState): boolean`
  - `isArmedState(state: MonitorAlarmState): boolean`

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/monitor/__tests__/alarm-state.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseAlarmState, isAlarmingState, isArmedState } from '../alarm-state';

describe('parseAlarmState', () => {
  it('maps numeric ZoneMinder states to named states', () => {
    expect(parseAlarmState({ status: 0 })).toBe('idle');
    expect(parseAlarmState({ status: 1 })).toBe('prealarm');
    expect(parseAlarmState({ status: 2 })).toBe('alarm');
    expect(parseAlarmState({ status: 3 })).toBe('alert');
    expect(parseAlarmState({ status: 4 })).toBe('tape');
  });

  it('accepts the same states as strings', () => {
    expect(parseAlarmState({ status: '0' })).toBe('idle');
    expect(parseAlarmState({ status: '2' })).toBe('alarm');
  });

  it('falls back to the output field when status is absent', () => {
    expect(parseAlarmState({ output: 2 })).toBe('alarm');
    expect(parseAlarmState({ output: '0' })).toBe('idle');
  });

  it('prefers status over output when both are present', () => {
    expect(parseAlarmState({ status: 0, output: 2 })).toBe('idle');
  });

  it('maps non-numeric truthy words to alarm', () => {
    expect(parseAlarmState({ status: 'on' })).toBe('alarm');
    expect(parseAlarmState({ status: 'armed' })).toBe('alarm');
    expect(parseAlarmState({ status: 'true' })).toBe('alarm');
  });

  it('maps non-numeric falsy words to idle', () => {
    expect(parseAlarmState({ status: 'off' })).toBe('idle');
    expect(parseAlarmState({ status: 'false' })).toBe('idle');
  });

  it('returns unknown for an absent response or an unrecognised value', () => {
    expect(parseAlarmState(undefined)).toBe('unknown');
    expect(parseAlarmState({})).toBe('unknown');
    expect(parseAlarmState({ status: null })).toBe('unknown');
    expect(parseAlarmState({ status: 'wat' })).toBe('unknown');
  });

  it('treats the ZoneMinder API error sentinel as unknown, not as an alarm', () => {
    // api/monitors.ts uses the literal string 'false' as the error marker.
    expect(parseAlarmState({ status: 'false', error: 'nope' })).toBe('idle');
  });
});

describe('isAlarmingState', () => {
  it('counts alarm and alert as alarming', () => {
    expect(isAlarmingState('alarm')).toBe(true);
    expect(isAlarmingState('alert')).toBe(true);
  });

  it('does not count idle, prealarm, tape, or unknown as alarming', () => {
    expect(isAlarmingState('idle')).toBe(false);
    expect(isAlarmingState('prealarm')).toBe(false);
    expect(isAlarmingState('tape')).toBe(false);
    expect(isAlarmingState('unknown')).toBe(false);
  });
});

describe('isArmedState', () => {
  // Preserves useAlarmControl's existing rule: any finite non-zero state is armed.
  it('counts every non-idle known state as armed', () => {
    expect(isArmedState('prealarm')).toBe(true);
    expect(isArmedState('alarm')).toBe(true);
    expect(isArmedState('alert')).toBe(true);
    expect(isArmedState('tape')).toBe(true);
  });

  it('does not count idle or unknown as armed', () => {
    expect(isArmedState('idle')).toBe(false);
    expect(isArmedState('unknown')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npm test -- src/lib/monitor/__tests__/alarm-state.test.ts --run`
Expected: FAIL, cannot resolve `../alarm-state`.

- [ ] **Step 3: Write the implementation**

Create `app/src/lib/monitor/alarm-state.ts`:

```typescript
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

export function parseAlarmState(raw: AlarmStatusResponse | undefined): MonitorAlarmState {
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npm test -- src/lib/monitor/__tests__/alarm-state.test.ts --run`
Expected: PASS, 10 tests.

If the `status: 'false'` case fails, check the order of the checks: `Number('false')` is `NaN`, so it falls through to the word check, where `FALSY_WORDS` maps it to `idle`.

- [ ] **Step 5: Refactor useAlarmControl to use the shared parse**

In `app/src/pages/hooks/useAlarmControl.ts`, add the import:

```typescript
import { parseAlarmState, isArmedState, type MonitorAlarmState } from '../../lib/monitor/alarm-state';
```

Replace the parse `useMemo` (currently at lines 54-71) with:

```typescript
  const { isAlarmArmed, hasAlarmStatus, alarmState } = useMemo(() => {
    const state = parseAlarmState(alarmStatus);
    return {
      isAlarmArmed: isArmedState(state),
      hasAlarmStatus: state !== 'unknown',
      alarmState: state,
    };
  }, [alarmStatus]);
```

Replace the border-class `useMemo` (currently at lines 74-79) with:

```typescript
  const alarmBorderClass = useMemo(() => {
    if (alarmState === 'alarm') return 'ring-4 ring-orange-500/70';
    if (alarmState === 'alert' || alarmState === 'tape') return 'ring-4 ring-red-500/70';
    return 'ring-0';
  }, [alarmState]);
```

Delete the now-unused `parsedAlarmStatus` binding. Keep the `MonitorAlarmState` import only if it ends up referenced; remove it from the import list otherwise, or the correctness lint will flag an unused import.

- [ ] **Step 6: Run the alarm-control tests and the type check**

Run: `cd app && npm test -- src/pages --run && npm run build`
Expected: PASS, and a clean build.

`hasAlarmStatus` changes subtly: it was `value !== undefined && value !== null`, and is now `state !== 'unknown'`, which additionally treats an unrecognised word as "no status". That is the intended reading. If any existing test asserts the old behavior, read the test before changing it and only adjust it if the new reading is genuinely correct.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/monitor/alarm-state.ts app/src/lib/monitor/__tests__/alarm-state.test.ts app/src/pages/hooks/useAlarmControl.ts
git commit -m "refactor: extract shared monitor alarm-state parse

useAlarmControl parsed the alarm-status response inline. The Live Activity
page needs the same parse, so it moves to a shared pure function with a
named state type rather than a loose number.

Refs #313"
```

---

### Task 2: The dwell reducer

This is the core of the feature and the only place the churn rules live. It is a pure function, so it is tested without React, timers, or a query client.

**Files:**
- Create: `app/src/lib/monitor/live-activity.ts`
- Create: `app/src/lib/monitor/__tests__/live-activity.test.ts`
- Modify: `app/src/lib/zmninja-ng-constants.ts` (append the `LIVE_ACTIVITY` constant near the other feature constant blocks)

**Interfaces:**
- Consumes: `MonitorAlarmState`, `isAlarmingState` from Task 1.
- Produces:
  - `interface ActiveMonitorEntry { monitorId: string; state: MonitorAlarmState; enteredAt: number; lastAlarmingAt: number; alarmCount: number; isCooling: boolean }`
  - `reduceActiveMonitors(previous: ActiveMonitorEntry[], states: Record<string, MonitorAlarmState>, now: number, dwellMs: number): ActiveMonitorEntry[]`
  - `capActiveMonitors(entries: ActiveMonitorEntry[], maxTiles: number): { visible: ActiveMonitorEntry[]; overflowCount: number }`
  - `LIVE_ACTIVITY` constant with `defaultDwellSeconds`, `defaultMaxTiles`, `defaultPollSeconds`, `minDwellSeconds`, `maxDwellSeconds`, `minTiles`, `maxTiles`

- [ ] **Step 1: Add the constants**

Append to `app/src/lib/zmninja-ng-constants.ts`:

```typescript
/**
 * Live Activity page.
 *
 * A monitor stays on the page for `dwellSeconds` after its alarm clears. That
 * is not cosmetic: every tile that enters or leaves mounts or unmounts a
 * MontageMonitor, which mints a ZMS connection key and sends CMD_QUIT, so a
 * flickering monitor thrashes nph-zms processes on the server.
 */
export const LIVE_ACTIVITY = {
  defaultPollSeconds: 5,
  defaultDwellSeconds: 30,
  defaultMaxTiles: 12,
  minPollSeconds: 2,
  maxPollSeconds: 60,
  minDwellSeconds: 0,
  maxDwellSeconds: 300,
  minTiles: 1,
  maxTiles: 40,
} as const;
```

- [ ] **Step 2: Write the failing test**

Create `app/src/lib/monitor/__tests__/live-activity.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  reduceActiveMonitors,
  capActiveMonitors,
  type ActiveMonitorEntry,
} from '../live-activity';

const DWELL = 30_000;

describe('reduceActiveMonitors', () => {
  it('adds a monitor when it starts alarming', () => {
    const next = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL);
    expect(next.map((e) => e.monitorId)).toEqual(['1']);
    expect(next[0].enteredAt).toBe(1000);
    expect(next[0].isCooling).toBe(false);
  });

  it('ignores monitors that are idle', () => {
    const next = reduceActiveMonitors([], { '1': 'idle', '2': 'unknown' }, 1000, DWELL);
    expect(next).toEqual([]);
  });

  it('keeps a monitor listed while its alarm has cleared but dwell has not elapsed', () => {
    const first = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL);
    const next = reduceActiveMonitors(first, { '1': 'idle' }, 1000 + DWELL - 1, DWELL);
    expect(next.map((e) => e.monitorId)).toEqual(['1']);
    expect(next[0].isCooling).toBe(true);
  });

  it('drops a monitor once dwell has fully elapsed', () => {
    const first = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL);
    const next = reduceActiveMonitors(first, { '1': 'idle' }, 1000 + DWELL + 1, DWELL);
    expect(next).toEqual([]);
  });

  it('resets the dwell timer when a monitor re-alarms inside the window', () => {
    const first = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL);
    const cooling = reduceActiveMonitors(first, { '1': 'idle' }, 20_000, DWELL);
    const reArmed = reduceActiveMonitors(cooling, { '1': 'alarm' }, 25_000, DWELL);
    // Would have expired at 31_000 without the reset; now survives well past it.
    const later = reduceActiveMonitors(reArmed, { '1': 'idle' }, 50_000, DWELL);
    expect(later.map((e) => e.monitorId)).toEqual(['1']);
  });

  it('counts each fresh alarm rather than re-entering the monitor', () => {
    const first = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL);
    const cooling = reduceActiveMonitors(first, { '1': 'idle' }, 5000, DWELL);
    const reArmed = reduceActiveMonitors(cooling, { '1': 'alarm' }, 9000, DWELL);
    expect(reArmed[0].alarmCount).toBe(2);
    expect(reArmed[0].enteredAt).toBe(1000);
  });

  it('does not count a sustained alarm as a second alarm', () => {
    const first = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL);
    const still = reduceActiveMonitors(first, { '1': 'alarm' }, 3000, DWELL);
    expect(still[0].alarmCount).toBe(1);
  });

  it('appends new monitors after existing ones rather than re-sorting', () => {
    const first = reduceActiveMonitors([], { '2': 'alarm' }, 1000, DWELL);
    const second = reduceActiveMonitors(first, { '2': 'alarm', '1': 'alarm' }, 2000, DWELL);
    expect(second.map((e) => e.monitorId)).toEqual(['2', '1']);
  });

  it('keeps surviving monitors in place when one in the middle expires', () => {
    let list: ActiveMonitorEntry[] = [];
    list = reduceActiveMonitors(list, { a: 'alarm' }, 1000, DWELL);
    list = reduceActiveMonitors(list, { a: 'alarm', b: 'alarm' }, 2000, DWELL);
    list = reduceActiveMonitors(list, { a: 'alarm', b: 'alarm', c: 'alarm' }, 3000, DWELL);
    // b goes idle and expires; a and c stay alarming.
    list = reduceActiveMonitors(list, { a: 'alarm', b: 'idle', c: 'alarm' }, 3000 + DWELL + 1, DWELL);
    expect(list.map((e) => e.monitorId)).toEqual(['a', 'c']);
  });

  it('drops a monitor that disappears from the states map entirely', () => {
    const first = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL);
    const next = reduceActiveMonitors(first, {}, 1000 + DWELL + 1, DWELL);
    expect(next).toEqual([]);
  });

  it('records the latest state so the tile can label itself', () => {
    const first = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL);
    const next = reduceActiveMonitors(first, { '1': 'alert' }, 2000, DWELL);
    expect(next[0].state).toBe('alert');
  });

  it('expires immediately when dwell is zero', () => {
    const first = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL);
    const next = reduceActiveMonitors(first, { '1': 'idle' }, 1001, 0);
    expect(next).toEqual([]);
  });

  it('returns the same array reference when nothing changed', () => {
    const first = reduceActiveMonitors([], { '1': 'alarm' }, 1000, DWELL);
    const again = reduceActiveMonitors(first, { '1': 'alarm' }, 1000, DWELL);
    expect(again).toBe(first);
  });
});

describe('capActiveMonitors', () => {
  const make = (id: string): ActiveMonitorEntry => ({
    monitorId: id,
    state: 'alarm',
    enteredAt: 0,
    lastAlarmingAt: 0,
    alarmCount: 1,
    isCooling: false,
  });

  it('returns every entry when under the cap', () => {
    const { visible, overflowCount } = capActiveMonitors([make('1'), make('2')], 12);
    expect(visible.map((e) => e.monitorId)).toEqual(['1', '2']);
    expect(overflowCount).toBe(0);
  });

  it('truncates and reports how many were hidden', () => {
    const entries = ['1', '2', '3', '4', '5'].map(make);
    const { visible, overflowCount } = capActiveMonitors(entries, 3);
    expect(visible.map((e) => e.monitorId)).toEqual(['1', '2', '3']);
    expect(overflowCount).toBe(2);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd app && npm test -- src/lib/monitor/__tests__/live-activity.test.ts --run`
Expected: FAIL, cannot resolve `../live-activity`.

- [ ] **Step 4: Write the implementation**

Create `app/src/lib/monitor/live-activity.ts`:

```typescript
/**
 * Which monitors the Live Activity page shows, and for how long.
 *
 * A monitor enters the list when ZoneMinder reports it alarming, and leaves
 * only after `dwellMs` of continuous non-alarming state. Any fresh alarm
 * inside that window resets the timer.
 *
 * The dwell window is not cosmetic. Each entry and exit mounts or unmounts a
 * MontageMonitor, and useStreamLifecycle mints a ZMS connection key on mount
 * and sends CMD_QUIT on unmount, so a monitor that flickers in and out
 * thrashes nph-zms processes on the server.
 *
 * Order is first-entered ascending and is never re-sorted while the list is
 * non-empty: a list that reorders under a user's finger loses them the tile
 * they were about to tap.
 *
 * Pure on (previous, states, now, dwellMs) so the whole policy is testable
 * without React, fake timers, or a query client.
 */

import { isAlarmingState, type MonitorAlarmState } from './alarm-state';

export interface ActiveMonitorEntry {
  monitorId: string;
  /** Latest reported state, used for the tile label. */
  state: MonitorAlarmState;
  /** When this monitor first entered the list. Fixes its position. */
  enteredAt: number;
  /** When it was last actually alarming. The dwell window runs from here. */
  lastAlarmingAt: number;
  /** How many separate alarms it has had while resident. */
  alarmCount: number;
  /** True while it is resident but no longer alarming. */
  isCooling: boolean;
}

function sameEntry(a: ActiveMonitorEntry, b: ActiveMonitorEntry): boolean {
  return (
    a.monitorId === b.monitorId &&
    a.state === b.state &&
    a.enteredAt === b.enteredAt &&
    a.lastAlarmingAt === b.lastAlarmingAt &&
    a.alarmCount === b.alarmCount &&
    a.isCooling === b.isCooling
  );
}

export function reduceActiveMonitors(
  previous: ActiveMonitorEntry[],
  states: Record<string, MonitorAlarmState>,
  now: number,
  dwellMs: number
): ActiveMonitorEntry[] {
  const next: ActiveMonitorEntry[] = [];

  // Existing entries first, in their existing order, so positions never shift.
  for (const entry of previous) {
    const state = states[entry.monitorId];

    // A monitor that vanished from the poll set (ignored, deleted, filtered
    // out) leaves immediately rather than lingering with a stale state.
    if (state === undefined) continue;

    const alarming = isAlarmingState(state);

    if (alarming) {
      // A fresh alarm is one that starts while the entry was cooling.
      const isFreshAlarm = entry.isCooling;
      next.push({
        ...entry,
        state,
        lastAlarmingAt: now,
        alarmCount: entry.alarmCount + (isFreshAlarm ? 1 : 0),
        isCooling: false,
      });
      continue;
    }

    // Not alarming: keep it until the dwell window from its last alarm closes.
    if (now - entry.lastAlarmingAt > dwellMs) continue;

    next.push({ ...entry, state, isCooling: true });
  }

  // Then monitors that are newly alarming, appended in the order the states
  // map presents them.
  const resident = new Set(next.map((e) => e.monitorId));
  for (const [monitorId, state] of Object.entries(states)) {
    if (resident.has(monitorId)) continue;
    if (!isAlarmingState(state)) continue;
    next.push({
      monitorId,
      state,
      enteredAt: now,
      lastAlarmingAt: now,
      alarmCount: 1,
      isCooling: false,
    });
  }

  // Preserve reference identity when nothing moved, so React Query poll ticks
  // that change nothing do not re-render every tile.
  if (
    next.length === previous.length &&
    next.every((entry, i) => sameEntry(entry, previous[i]))
  ) {
    return previous;
  }

  return next;
}

export function capActiveMonitors(
  entries: ActiveMonitorEntry[],
  maxTiles: number
): { visible: ActiveMonitorEntry[]; overflowCount: number } {
  if (entries.length <= maxTiles) {
    return { visible: entries, overflowCount: 0 };
  }
  return {
    visible: entries.slice(0, maxTiles),
    overflowCount: entries.length - maxTiles,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd app && npm test -- src/lib/monitor/__tests__/live-activity.test.ts --run`
Expected: PASS, 15 tests.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/monitor/live-activity.ts app/src/lib/monitor/__tests__/live-activity.test.ts app/src/lib/zmninja-ng-constants.ts
git commit -m "feat: add Live Activity dwell reducer

Decides which monitors the page shows and for how long. The dwell window
protects the server as much as the eye: each tile entering or leaving mints
a ZMS connection key and sends CMD_QUIT.

Refs #313"
```

---

### Task 3: The alarm-state fanout hook

**Files:**
- Create: `app/src/hooks/useAlarmStates.ts`
- Create: `app/src/hooks/__tests__/useAlarmStates.test.tsx`

**Interfaces:**
- Consumes: `parseAlarmState`, `MonitorAlarmState` (Task 1); `getAlarmStatus` (`app/src/api/monitors.ts`); `queryKeys.monitorAlarmStatus`; `useBandwidthSettings`; `useCurrentProfile`; `useAuthStore`.
- Produces: `useAlarmStates(monitorIds: string[], options: { enabled: boolean; pollIntervalMs: number }): { states: Record<string, MonitorAlarmState>; isLoading: boolean; error: Error | null }`

- [ ] **Step 1: Write the failing test**

Create `app/src/hooks/__tests__/useAlarmStates.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAlarmStates } from '../useAlarmStates';
import { getAlarmStatus } from '../../api/monitors';

vi.mock('../../api/monitors', () => ({ getAlarmStatus: vi.fn() }));
vi.mock('../useCurrentProfile', () => ({
  useCurrentProfile: () => ({ currentProfile: { id: 'p1' }, settings: {} }),
}));
vi.mock('../../stores/auth', () => ({
  useAuthStore: (selector: (s: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: true }),
}));

const mockStatus = vi.mocked(getAlarmStatus);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useAlarmStates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a parsed state per monitor', async () => {
    mockStatus.mockImplementation(async (id: string) =>
      id === '1' ? { status: 2 } : { status: 0 }
    );

    const { result } = renderHook(
      () => useAlarmStates(['1', '2'], { enabled: true, pollIntervalMs: 5000 }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.states).toEqual({ '1': 'alarm', '2': 'idle' });
    });
  });

  it('issues one request per monitor rather than one combined request', async () => {
    mockStatus.mockResolvedValue({ status: 0 });

    renderHook(
      () => useAlarmStates(['1', '2', '3'], { enabled: true, pollIntervalMs: 5000 }),
      { wrapper }
    );

    await waitFor(() => {
      expect(mockStatus).toHaveBeenCalledTimes(3);
    });
    expect(mockStatus.mock.calls.map((c) => c[0])).toEqual(['1', '2', '3']);
  });

  it('fetches nothing while disabled', async () => {
    mockStatus.mockResolvedValue({ status: 0 });

    const { result } = renderHook(
      () => useAlarmStates(['1'], { enabled: false, pollIntervalMs: 5000 }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(mockStatus).not.toHaveBeenCalled();
    expect(result.current.states).toEqual({});
  });

  it('reports a monitor whose request failed as unknown and surfaces the error', async () => {
    mockStatus.mockImplementation(async (id: string) => {
      if (id === '2') throw new Error('boom');
      return { status: 2 };
    });

    const { result } = renderHook(
      () => useAlarmStates(['1', '2'], { enabled: true, pollIntervalMs: 5000 }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.states['1']).toBe('alarm');
    });
    expect(result.current.states['2']).toBe('unknown');
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('returns an empty map for an empty monitor list', async () => {
    const { result } = renderHook(
      () => useAlarmStates([], { enabled: true, pollIntervalMs: 5000 }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.states).toEqual({});
    expect(mockStatus).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npm test -- src/hooks/__tests__/useAlarmStates.test.tsx --run`
Expected: FAIL, cannot resolve `../useAlarmStates`.

- [ ] **Step 3: Write the implementation**

Create `app/src/hooks/useAlarmStates.ts`:

```typescript
/**
 * Live alarm state for several monitors at once.
 *
 * One query per monitor. The alternative, a single combined request, is not
 * available: ZoneMinder's alarm endpoint is addressed by a single monitor id.
 * This matches the fanout useMonitorNewEvents already uses for the same
 * reason, and React Query dedupes and caches each monitor independently.
 *
 * The caller passes `enabled` so the fanout only runs while the Live Activity
 * page is actually on screen. There is no background polling cost anywhere
 * else in the app.
 */

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { getAlarmStatus } from '../api/monitors';
import { queryKeys } from '../lib/query/query-keys';
import { parseAlarmState, type MonitorAlarmState } from '../lib/monitor/alarm-state';
import { useCurrentProfile } from './useCurrentProfile';
import { useAuthStore } from '../stores/auth';

interface UseAlarmStatesOptions {
  /** Poll only while the page is visible. */
  enabled: boolean;
  /** Already reconciled against the bandwidth floor by the caller. */
  pollIntervalMs: number;
}

interface UseAlarmStatesReturn {
  states: Record<string, MonitorAlarmState>;
  isLoading: boolean;
  error: Error | null;
}

export function useAlarmStates(
  monitorIds: string[],
  { enabled, pollIntervalMs }: UseAlarmStatesOptions
): UseAlarmStatesReturn {
  const { currentProfile } = useCurrentProfile();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const profileId = currentProfile?.id;

  const results = useQueries({
    queries: monitorIds.map((monitorId) => ({
      queryKey: queryKeys.monitorAlarmStatus(profileId, monitorId),
      queryFn: () => getAlarmStatus(monitorId),
      enabled: enabled && !!profileId && isAuthenticated,
      refetchInterval: pollIntervalMs,
      // The page is only mounted while visible, so background refetching would
      // poll a screen nobody is looking at.
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
    })),
  });

  return useMemo(() => {
    const states: Record<string, MonitorAlarmState> = {};
    let isLoading = false;
    let error: Error | null = null;

    monitorIds.forEach((monitorId, i) => {
      const result = results[i];
      if (!result) return;
      if (result.isLoading) isLoading = true;
      // A monitor whose request failed reads as unknown, which the reducer
      // treats as not alarming. A transient error must not strand a tile.
      states[monitorId] = result.isError ? 'unknown' : parseAlarmState(result.data);
      if (result.error && !error) error = result.error as Error;
    });

    return { states, isLoading, error };
  }, [monitorIds, results]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npm test -- src/hooks/__tests__/useAlarmStates.test.tsx --run`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useAlarmStates.ts app/src/hooks/__tests__/useAlarmStates.test.tsx
git commit -m "feat: add useAlarmStates fanout hook

One alarm-status query per monitor, enabled only while the caller is on
screen.

Refs #313"
```

---

### Task 4: Settings keys and the generalized interval floor

**Files:**
- Modify: `app/src/stores/settings.ts` (add four fields to `ProfileSettings` near line 158, and their defaults in `DEFAULT_SETTINGS` near line 276)
- Modify: `app/src/stores/notifications.ts:684-692` (generalize `resolvePollIntervalMs`)
- Modify: `app/src/stores/__tests__/notifications.test.ts` (extend the existing `resolvePollIntervalMs` tests)

**Interfaces:**
- Consumes: `LIVE_ACTIVITY` (Task 2); `BandwidthSettings` from `app/src/lib/zmninja-ng-constants.ts`.
- Produces:
  - `ProfileSettings.liveActivityPollSeconds: number`
  - `ProfileSettings.liveActivityDwellSeconds: number`
  - `ProfileSettings.liveActivityMaxTiles: number`
  - `ProfileSettings.liveActivityIgnoredMonitorIds: string[]`
  - `resolvePollIntervalMs(bandwidthMode: BandwidthMode, pollingIntervalSeconds: number | undefined, floorKey?: keyof BandwidthSettings): number`

- [ ] **Step 1: Write the failing test for the generalized floor**

Add to `app/src/stores/__tests__/notifications.test.ts`, inside the existing `resolvePollIntervalMs` describe block:

```typescript
  it('floors against the named bandwidth key when one is given', () => {
    // alarmStatusInterval is 10000 in low mode, 5000 in normal.
    expect(resolvePollIntervalMs('low', 2, 'alarmStatusInterval')).toBe(10_000);
    expect(resolvePollIntervalMs('normal', 2, 'alarmStatusInterval')).toBe(2000);
  });

  it('still defaults to the event-poller interval when no key is given', () => {
    expect(resolvePollIntervalMs('normal', 0)).toBe(30_000);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npm test -- src/stores/__tests__/notifications.test.ts --run`
Expected: FAIL, the third argument is ignored so the low-mode assertion returns 60000.

- [ ] **Step 3: Generalize the helper**

In `app/src/stores/notifications.ts`, replace `resolvePollIntervalMs` with:

```typescript
export function resolvePollIntervalMs(
  bandwidthMode: BandwidthMode,
  pollingIntervalSeconds: number | undefined,
  floorKey: 'eventPollerInterval' | 'alarmStatusInterval' = 'eventPollerInterval'
): number {
  const bandwidthMs = getBandwidthSettings(bandwidthMode)[floorKey];
  const userMs = (pollingIntervalSeconds ?? 0) * 1000;
  if (!Number.isFinite(userMs) || userMs <= 0) return bandwidthMs;
  return bandwidthMode === 'low' ? Math.max(userMs, bandwidthMs) : userMs;
}
```

Keep the existing doc comment above it and extend its last line to explain the new parameter: the caller names which bandwidth interval acts as the floor, because bandwidth mode stays authoritative regardless of which feature is polling.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npm test -- src/stores/__tests__/notifications.test.ts --run`
Expected: PASS.

- [ ] **Step 5: Add the settings fields**

In `app/src/stores/settings.ts`, add to the `ProfileSettings` interface after `bandwidthMode`:

```typescript
  /** Live Activity: alarm-status poll interval in seconds, floored by bandwidth mode. */
  liveActivityPollSeconds: number;
  /** Live Activity: how long a monitor stays listed after its alarm clears, in seconds. */
  liveActivityDwellSeconds: number;
  /** Live Activity: how many tiles render before the rest collapse into an overflow row. */
  liveActivityMaxTiles: number;
  /** Live Activity: monitors that never appear on that page. Separate from the
   *  profile-wide monitor exclusion, which hides a monitor everywhere. */
  liveActivityIgnoredMonitorIds: string[];
```

Add the matching defaults to `DEFAULT_SETTINGS`, importing `LIVE_ACTIVITY` from `../lib/zmninja-ng-constants`:

```typescript
  liveActivityPollSeconds: LIVE_ACTIVITY.defaultPollSeconds,
  liveActivityDwellSeconds: LIVE_ACTIVITY.defaultDwellSeconds,
  liveActivityMaxTiles: LIVE_ACTIVITY.defaultMaxTiles,
  liveActivityIgnoredMonitorIds: [],
```

No `SETTINGS_VERSION` bump is needed: `mergeProfileSettings` spreads `DEFAULT_SETTINGS` first, so existing persisted profiles pick the new keys up automatically. Verify that by reading `mergeProfileSettings` before deciding otherwise.

- [ ] **Step 6: Run the settings and contract gates**

Run: `cd app && npm test -- src/stores src/tests --run && npm run build`
Expected: PASS, clean build.

- [ ] **Step 7: Commit**

```bash
git add app/src/stores/settings.ts app/src/stores/notifications.ts app/src/stores/__tests__/notifications.test.ts
git commit -m "feat: add Live Activity settings and a named interval floor

resolvePollIntervalMs hardcoded the event-poller interval as its bandwidth
floor. It now takes the key, so a second feature with a user-tunable
interval does not need a second copy of the clamp.

Refs #313"
```

---

### Task 5: The Live Activity page

**Files:**
- Create: `app/src/pages/LiveActivity.tsx`
- Create: `app/src/pages/__tests__/LiveActivity.test.tsx`
- Modify: `app/src/components/monitors/MontageMonitor.tsx:47-62` (add one optional prop) and its header label at line 194-199
- Modify: `app/src/App.tsx` (lazy import near line 38, route near line 251)

**Interfaces:**
- Consumes: `useAlarmStates` (Task 3); `reduceActiveMonitors`, `capActiveMonitors`, `ActiveMonitorEntry`, `LIVE_ACTIVITY` (Task 2); `resolvePollIntervalMs` and the four settings fields (Task 4); `getMonitors` (`app/src/api/monitors.ts`); `useEventMontageGrid`, `EventMontageGridControls`, `EmptyState`, `ErrorBanner`, `MontageMonitor`.
- Produces: default-exported `LiveActivity` page component; `MontageMonitorProps.titleOverride?: string`.

- [ ] **Step 1: Add the title override prop to MontageMonitor**

In `app/src/components/monitors/MontageMonitor.tsx`, add to `MontageMonitorProps`:

```typescript
  /**
   * Replaces the monitor name in the tile header. The Live Activity page uses
   * it to show name, id, and alarm state together.
   */
  titleOverride?: string;
```

Destructure `titleOverride` alongside the other props, then change the header label from:

```tsx
          <span className={cn(
            "text-xs font-medium truncate",
            isFullscreen && "text-white"
          )} title={monitor.Name}>
            {monitor.Name}
          </span>
```

to:

```tsx
          <span className={cn(
            "text-xs font-medium truncate",
            isFullscreen && "text-white"
          )} title={titleOverride ?? monitor.Name}>
            {titleOverride ?? monitor.Name}
          </span>
```

- [ ] **Step 2: Run the existing MontageMonitor tests to confirm nothing regressed**

Run: `cd app && npm test -- src/components/monitors/__tests__/MontageMonitor.test.tsx --run`
Expected: PASS. The prop is optional and defaults to the previous behavior.

- [ ] **Step 3: Write the failing page test**

Create `app/src/pages/__tests__/LiveActivity.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import LiveActivity from '../LiveActivity';
import { getMonitors } from '../../api/monitors';
import { getAlarmStatus } from '../../api/monitors';

vi.mock('../../api/monitors', () => ({
  getMonitors: vi.fn(),
  getAlarmStatus: vi.fn(),
}));
vi.mock('../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => ({
    currentProfile: { id: 'p1', portalUrl: 'https://zm.test' },
    settings: {
      liveActivityPollSeconds: 5,
      liveActivityDwellSeconds: 30,
      liveActivityMaxTiles: 12,
      liveActivityIgnoredMonitorIds: [],
      bandwidthMode: 'normal',
      monitorGridCols: 2,
    },
  }),
}));
vi.mock('../../stores/auth', () => ({
  useAuthStore: (selector: (s: { isAuthenticated: boolean; accessToken: string | null }) => unknown) =>
    selector({ isAuthenticated: true, accessToken: 't' }),
}));
// The tile mounts a real video stream otherwise.
vi.mock('../../components/monitors/MontageMonitor', () => ({
  MontageMonitor: ({ titleOverride }: { titleOverride?: string }) => (
    <div data-testid="live-activity-tile">{titleOverride}</div>
  ),
}));

const mockMonitors = vi.mocked(getMonitors);
const mockStatus = vi.mocked(getAlarmStatus);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const MONITORS = {
  monitors: [
    { Monitor: { Id: '3', Name: 'Front Door', Function: 'Modect', Capturing: 'Always' } },
    { Monitor: { Id: '4', Name: 'Backyard', Function: 'Modect', Capturing: 'Always' } },
  ],
};

describe('LiveActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMonitors.mockResolvedValue(MONITORS as never);
  });

  it('shows only the alarming monitor, labelled with name, id, and state', async () => {
    mockStatus.mockImplementation(async (id: string) =>
      id === '3' ? { status: 2 } : { status: 0 }
    );

    render(<LiveActivity />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('Front Door(3):Alarmed')).toBeInTheDocument();
    });
    expect(screen.queryByText(/Backyard/)).not.toBeInTheDocument();
  });

  it('shows the quiet empty state when nothing is alarming', async () => {
    mockStatus.mockResolvedValue({ status: 0 });

    render(<LiveActivity />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('live-activity-empty')).toHaveTextContent('All quiet');
    });
  });

  it('never polls a monitor on the ignore list', async () => {
    mockStatus.mockResolvedValue({ status: 0 });

    render(<LiveActivity />, { wrapper });

    await waitFor(() => {
      expect(mockStatus).toHaveBeenCalled();
    });
    // Both monitors are pollable in this fixture; the ignore-list case is
    // covered by overriding the mocked settings in the test below.
    expect(mockStatus.mock.calls.map((c) => c[0]).sort()).toEqual(['3', '4']);
  });
});
```

Note for the implementer: the third test above asserts the baseline. Add a fourth test that re-mocks `useCurrentProfile` with `liveActivityIgnoredMonitorIds: ['4']` and asserts `getAlarmStatus` is only ever called with `'3'`. Use `vi.doMock` plus a dynamic `import()` of the page inside that test, since the module-level `vi.mock` factory is hoisted and shared.

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd app && npm test -- src/pages/__tests__/LiveActivity.test.tsx --run`
Expected: FAIL, cannot resolve `../LiveActivity`.

- [ ] **Step 5: Write the page**

Create `app/src/pages/LiveActivity.tsx`. Keep it under 400 lines; if it grows past that, split the tile grid into `app/src/components/live-activity/LiveActivityGrid.tsx`.

```tsx
/**
 * Live Activity.
 *
 * Only the monitors ZoneMinder currently reports as alarming, as live montage
 * tiles. A monitor appears on alarm and leaves once the dwell window from its
 * last alarm closes. See lib/monitor/live-activity.ts for why the dwell window
 * exists (it protects nph-zms, not just the eye).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { getMonitors } from '../api/monitors';
import { queryKeys } from '../lib/query/query-keys';
import { useCurrentProfile } from '../hooks/useCurrentProfile';
import { useAuthStore } from '../stores/auth';
import { useBandwidthSettings } from '../hooks/useBandwidthSettings';
import { useAlarmStates } from '../hooks/useAlarmStates';
import { useEventMontageGrid } from '../hooks/useEventMontageGrid';
import { resolvePollIntervalMs } from '../stores/notifications';
import {
  reduceActiveMonitors,
  capActiveMonitors,
  type ActiveMonitorEntry,
} from '../lib/monitor/live-activity';
import { MontageMonitor } from '../components/monitors/MontageMonitor';
import { EventMontageGridControls } from '../components/events/EventMontageGridControls';
import { EmptyState } from '../components/ui/empty-state';
import { ErrorBanner } from '../components/ui/query-state';
import { resolveQueryError } from '../lib/query/query-error';
import { PageContainer } from '../components/layout/PageContainer';
import type { MonitorAlarmState } from '../lib/monitor/alarm-state';

/** Locale key for each state that can appear in a tile title. */
const STATE_LABEL_KEYS: Record<MonitorAlarmState, string> = {
  alarm: 'live_activity.state_alarm',
  alert: 'live_activity.state_alert',
  idle: 'live_activity.state_cooling',
  prealarm: 'live_activity.state_cooling',
  tape: 'live_activity.state_cooling',
  unknown: 'live_activity.state_cooling',
};

export default function LiveActivity() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentProfile, settings } = useCurrentProfile();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accessToken = useAuthStore((s) => s.accessToken);
  const bandwidth = useBandwidthSettings();
  const gridContainerRef = useRef<HTMLDivElement>(null);

  const { data, isLoading: monitorsLoading, error: monitorsError } = useQuery({
    queryKey: queryKeys.monitors(currentProfile?.id),
    queryFn: () => getMonitors(),
    enabled: !!currentProfile && isAuthenticated,
    refetchInterval: bandwidth.monitorStatusInterval,
  });

  // Monitors this page is allowed to watch. The profile-wide exclusion is
  // already applied inside getMonitors; this drops the page-specific ignores.
  const watchedIds = useMemo(() => {
    const ignored = new Set(settings.liveActivityIgnoredMonitorIds);
    return (data?.monitors ?? [])
      .map(({ Monitor }) => Monitor.Id)
      .filter((id) => !ignored.has(id));
  }, [data?.monitors, settings.liveActivityIgnoredMonitorIds]);

  const pollIntervalMs = resolvePollIntervalMs(
    settings.bandwidthMode,
    settings.liveActivityPollSeconds,
    'alarmStatusInterval'
  );

  const { states, error: alarmError } = useAlarmStates(watchedIds, {
    enabled: true,
    pollIntervalMs,
  });

  // The damped display list. Held in state rather than derived during render
  // because it depends on the previous list and on the current time.
  const [active, setActive] = useState<ActiveMonitorEntry[]>([]);
  const dwellMs = settings.liveActivityDwellSeconds * 1000;

  useEffect(() => {
    setActive((prev) => reduceActiveMonitors(prev, states, Date.now(), dwellMs));
  }, [states, dwellMs]);

  // A cooling monitor expires on a timer, not on a poll response, so the list
  // still empties when every monitor has gone quiet and nothing is changing.
  useEffect(() => {
    if (active.length === 0) return;
    const timer = setInterval(() => {
      setActive((prev) => reduceActiveMonitors(prev, states, Date.now(), dwellMs));
    }, 1000);
    return () => clearInterval(timer);
  }, [active.length, states, dwellMs]);

  const { visible, overflowCount } = capActiveMonitors(active, settings.liveActivityMaxTiles);

  const monitorsById = useMemo(
    () => new Map((data?.monitors ?? []).map((m) => [m.Monitor.Id, m])),
    [data?.monitors]
  );

  const {
    gridCols,
    isCustomGridDialogOpen,
    setIsCustomGridDialogOpen,
    customCols,
    setCustomCols,
    handleApplyGridLayout,
    handleCustomGridSubmit,
  } = useEventMontageGrid({
    initialCols: settings.monitorGridCols,
    containerRef: gridContainerRef,
  });

  const error = monitorsError ?? alarmError;

  return (
    <PageContainer>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h1 className="text-lg font-semibold min-w-0 truncate" title={t('live_activity.title')}>
          {t('live_activity.title')}
        </h1>
        <EventMontageGridControls
          gridCols={gridCols}
          customCols={customCols}
          isCustomGridDialogOpen={isCustomGridDialogOpen}
          onApplyGridLayout={handleApplyGridLayout}
          onCustomColsChange={setCustomCols}
          onCustomGridDialogOpenChange={setIsCustomGridDialogOpen}
          onCustomGridSubmit={handleCustomGridSubmit}
        />
      </div>

      {error && <ErrorBanner error={resolveQueryError(error)} />}

      {visible.length === 0 && !monitorsLoading ? (
        <EmptyState
          icon={Activity}
          title={t('live_activity.all_quiet')}
          description={t('live_activity.watching_count', { count: watchedIds.length })}
          data-testid="live-activity-empty"
        />
      ) : (
        <div
          ref={gridContainerRef}
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
        >
          {visible.map((entry) => {
            const monitorData = monitorsById.get(entry.monitorId);
            if (!monitorData) return null;
            const title = t('live_activity.tile_title', {
              name: monitorData.Monitor.Name,
              id: entry.monitorId,
              state: t(STATE_LABEL_KEYS[entry.state]),
            });
            return (
              <div
                key={entry.monitorId}
                className={entry.isCooling ? 'opacity-60 transition-opacity' : 'transition-opacity'}
                data-testid="live-activity-tile"
              >
                <MontageMonitor
                  monitor={monitorData.Monitor}
                  status={monitorData.Monitor_Status}
                  currentProfile={currentProfile}
                  accessToken={accessToken}
                  navigate={navigate}
                  titleOverride={title}
                />
              </div>
            );
          })}
        </div>
      )}

      {overflowCount > 0 && (
        <p className="text-sm text-muted-foreground mt-3" data-testid="live-activity-overflow">
          {t('live_activity.overflow', { count: overflowCount })}
        </p>
      )}
    </PageContainer>
  );
}
```

Before writing this, read `app/src/pages/Monitors.tsx` for the exact `PageContainer`, `ErrorBanner`, and `EmptyState` import paths and prop names, and confirm the field name for a monitor's status in `MonitorData` (the plan assumes `Monitor_Status`). Match whatever that page does rather than the shapes assumed here.

- [ ] **Step 6: Run the page test**

Run: `cd app && npm test -- src/pages/__tests__/LiveActivity.test.tsx --run`
Expected: PASS. The title assertion depends on Task 7's locale keys; until those exist, `t()` returns the raw key. Either land Task 7 first or assert against the key in the interim and tighten the assertion in Task 7. Do not leave a weakened assertion behind.

- [ ] **Step 7: Register the route**

In `app/src/App.tsx`, add the lazy import beside the others:

```tsx
const LiveActivity = lazy(() => import('./pages/LiveActivity'));
```

Add the route beside `/montage`, copying the exact wrapper elements (auth guard, error boundary, suspense) that the neighbouring routes use:

```tsx
            path="/live-activity"
```

- [ ] **Step 8: Run the build and the full unit suite**

Run: `cd app && npm run build && npm test -- --run`
Expected: clean build, all tests pass.

- [ ] **Step 9: Commit**

```bash
git add app/src/pages/LiveActivity.tsx app/src/pages/__tests__/LiveActivity.test.tsx app/src/components/monitors/MontageMonitor.tsx app/src/App.tsx
git commit -m "feat: add Live Activity page

Shows only monitors currently in alarm, as montage tiles. Reusing
MontageMonitor brings the ZMS connection-key and CMD_QUIT lifecycle with it,
so no stream teardown code is written here.

Refs #313"
```

---

### Task 5b: Websocket accelerant and the repeat-alarm count

Two spec requirements the page does not yet meet. The accelerant makes a monitor appear the instant a websocket alarm arrives rather than up to one poll interval later. The count is what stops a chatty camera from re-animating: it increments in place instead.

**Files:**
- Modify: `app/src/lib/monitor/live-activity.ts` (add `applyLiveAlarmHints`)
- Modify: `app/src/lib/monitor/__tests__/live-activity.test.ts` (add its tests)
- Modify: `app/src/pages/LiveActivity.tsx` (read the hints, render the count)

**Interfaces:**
- Consumes: `MonitorAlarmState`, `isAlarmingState` (Task 1); `useNotificationStore` (`app/src/stores/notifications.ts`); `ActiveMonitorEntry.alarmCount` (Task 2).
- Produces: `applyLiveAlarmHints(states: Record<string, MonitorAlarmState>, hintedMonitorIds: Set<string>): Record<string, MonitorAlarmState>`

- [ ] **Step 1: Write the failing test**

Add to `app/src/lib/monitor/__tests__/live-activity.test.ts`:

```typescript
import { applyLiveAlarmHints } from '../live-activity';

describe('applyLiveAlarmHints', () => {
  it('promotes a watched idle monitor to alarming when a hint names it', () => {
    const result = applyLiveAlarmHints({ '1': 'idle' }, new Set(['1']));
    expect(result['1']).toBe('alarm');
  });

  it('ignores hints for monitors that are not being watched', () => {
    // An ignored or excluded monitor must not be resurrected by a hint.
    const result = applyLiveAlarmHints({ '1': 'idle' }, new Set(['2']));
    expect(result).toEqual({ '1': 'idle' });
  });

  it('leaves an already-alarming state alone rather than downgrading it', () => {
    const result = applyLiveAlarmHints({ '1': 'alert' }, new Set(['1']));
    expect(result['1']).toBe('alert');
  });

  it('returns the same reference when no hint changes anything', () => {
    const states = { '1': 'alarm' as const };
    expect(applyLiveAlarmHints(states, new Set(['1']))).toBe(states);
    expect(applyLiveAlarmHints(states, new Set())).toBe(states);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npm test -- src/lib/monitor/__tests__/live-activity.test.ts --run`
Expected: FAIL, `applyLiveAlarmHints` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `app/src/lib/monitor/live-activity.ts`:

```typescript
/**
 * Overlay websocket alarm hints onto polled state.
 *
 * A push event arrives seconds before the next poll tick would notice, so a
 * hinted monitor is treated as alarming immediately and the next poll either
 * confirms it or lets the dwell window expire it.
 *
 * Hints only ever promote a monitor that is already being polled. A hint for a
 * monitor the page is not watching (ignored here, or excluded profile-wide) is
 * dropped, or the ignore list would leak.
 */
export function applyLiveAlarmHints(
  states: Record<string, MonitorAlarmState>,
  hintedMonitorIds: Set<string>
): Record<string, MonitorAlarmState> {
  let changed = false;
  const next: Record<string, MonitorAlarmState> = {};

  for (const [monitorId, state] of Object.entries(states)) {
    if (hintedMonitorIds.has(monitorId) && !isAlarmingState(state)) {
      next[monitorId] = 'alarm';
      changed = true;
    } else {
      next[monitorId] = state;
    }
  }

  return changed ? next : states;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npm test -- src/lib/monitor/__tests__/live-activity.test.ts --run`
Expected: PASS, 19 tests.

- [ ] **Step 5: Read the hints in the page**

In `app/src/pages/LiveActivity.tsx`, add the selector and feed the merged states to the reducer. Select with `useShallow` so unrelated notification-store writes do not re-render the page:

```tsx
  const hintedMonitorIds = useNotificationStore(
    useShallow((state) => {
      const events = currentProfile ? state.profileEvents[currentProfile.id] : undefined;
      if (!events?.length) return new Set<string>();
      const cutoff = Date.now() - dwellMs;
      return new Set(
        events.filter((e) => e.receivedAt >= cutoff).map((e) => String(e.MonitorId))
      );
    })
  );

  const hintedStates = useMemo(
    () => applyLiveAlarmHints(states, hintedMonitorIds),
    [states, hintedMonitorIds]
  );
```

Replace both `reduceActiveMonitors(prev, states, ...)` calls with `reduceActiveMonitors(prev, hintedStates, ...)`, and update those effects' dependency arrays to `hintedStates`.

`useShallow` compares one level deep, and a fresh `Set` is a new reference every render, so this selector still re-renders on each store write. If that shows up as a problem, memoise the event list selection and build the `Set` outside the selector. Leave a `ponytail:` comment naming that ceiling if you take the simple route.

- [ ] **Step 6: Render the repeat-alarm count**

In the tile loop, show `entry.alarmCount` when it exceeds one, so a camera alarming repeatedly reads as busy rather than re-animating:

```tsx
                {entry.alarmCount > 1 && (
                  <span
                    className="absolute top-1 right-1 z-30 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white"
                    data-testid={`live-activity-count-${entry.monitorId}`}
                    aria-label={t('live_activity.alarm_count', { count: entry.alarmCount })}
                  >
                    {t('live_activity.alarm_count', { count: entry.alarmCount })}
                  </span>
                )}
```

The wrapping `div` needs `relative` added to its className for this to position. Add the `live_activity.alarm_count` key to all five locales in Task 7: English `"{{count}} alarms"`.

- [ ] **Step 7: Run the page tests and the build**

Run: `cd app && npm test -- src/lib/monitor src/pages/__tests__/LiveActivity.test.tsx --run && npm run build`
Expected: PASS, clean build.

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/monitor/live-activity.ts app/src/lib/monitor/__tests__/live-activity.test.ts app/src/pages/LiveActivity.tsx
git commit -m "feat: promote Live Activity monitors on websocket alarm hints

A push event arrives before the next poll tick would notice. Hints only
promote monitors already being polled, so the ignore list still holds.

Refs #313"
```

---

### Task 6: The settings gear

**Files:**
- Create: `app/src/components/live-activity/LiveActivitySettingsDialog.tsx`
- Create: `app/src/components/live-activity/__tests__/LiveActivitySettingsDialog.test.tsx`
- Modify: `app/src/pages/LiveActivity.tsx` (add the gear button to the toolbar)

**Interfaces:**
- Consumes: the four settings fields and `LIVE_ACTIVITY` bounds (Tasks 2 and 4); `useSettingsStore`; shadcn `Dialog`, `Select`, `Switch`, `Label` primitives.
- Produces: `LiveActivitySettingsDialog({ open, onOpenChange, profileId, monitors }: LiveActivitySettingsDialogProps)`

- [ ] **Step 1: Write the failing test**

Create `app/src/components/live-activity/__tests__/LiveActivitySettingsDialog.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LiveActivitySettingsDialog } from '../LiveActivitySettingsDialog';
import { useSettingsStore } from '../../../stores/settings';

const MONITORS = [
  { Monitor: { Id: '3', Name: 'Front Door' } },
  { Monitor: { Id: '4', Name: 'Backyard' } },
];

describe('LiveActivitySettingsDialog', () => {
  beforeEach(() => {
    useSettingsStore.setState({ profileSettings: {} });
  });

  it('persists a changed dwell value to the profile settings', () => {
    render(
      <LiveActivitySettingsDialog
        open
        onOpenChange={() => {}}
        profileId="p1"
        monitors={MONITORS as never}
      />
    );

    fireEvent.change(screen.getByTestId('live-activity-dwell-input'), {
      target: { value: '60' },
    });

    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityDwellSeconds
    ).toBe(60);
  });

  it('adds a monitor to the ignore list when it is toggled off', () => {
    render(
      <LiveActivitySettingsDialog
        open
        onOpenChange={() => {}}
        profileId="p1"
        monitors={MONITORS as never}
      />
    );

    fireEvent.click(screen.getByTestId('live-activity-ignore-4'));

    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityIgnoredMonitorIds
    ).toEqual(['4']);
  });

  it('removes a monitor from the ignore list when it is toggled back on', () => {
    useSettingsStore.getState().updateProfileSettings('p1', {
      liveActivityIgnoredMonitorIds: ['4'],
    });

    render(
      <LiveActivitySettingsDialog
        open
        onOpenChange={() => {}}
        profileId="p1"
        monitors={MONITORS as never}
      />
    );

    fireEvent.click(screen.getByTestId('live-activity-ignore-4'));

    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityIgnoredMonitorIds
    ).toEqual([]);
  });

  it('clamps an out-of-range poll interval instead of storing it', () => {
    render(
      <LiveActivitySettingsDialog
        open
        onOpenChange={() => {}}
        profileId="p1"
        monitors={MONITORS as never}
      />
    );

    fireEvent.change(screen.getByTestId('live-activity-poll-input'), {
      target: { value: '9999' },
    });

    expect(
      useSettingsStore.getState().getProfileSettings('p1').liveActivityPollSeconds
    ).toBe(60);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npm test -- src/components/live-activity --run`
Expected: FAIL, cannot resolve `../LiveActivitySettingsDialog`.

- [ ] **Step 3: Write the dialog**

Create `app/src/components/live-activity/LiveActivitySettingsDialog.tsx`. Structure it after `app/src/components/notifications/NotificationModeSection.tsx`, which is the closest existing example of a settings surface with a numeric select and per-monitor toggles. Read that file first and match its layout and prop conventions.

Requirements the tests pin down:

- A number input with `data-testid="live-activity-poll-input"` bound to `liveActivityPollSeconds`, clamped to `[LIVE_ACTIVITY.minPollSeconds, LIVE_ACTIVITY.maxPollSeconds]` before it is written to the store.
- A number input with `data-testid="live-activity-dwell-input"` bound to `liveActivityDwellSeconds`, clamped to `[LIVE_ACTIVITY.minDwellSeconds, LIVE_ACTIVITY.maxDwellSeconds]`.
- A number input with `data-testid="live-activity-tiles-input"` bound to `liveActivityMaxTiles`, clamped to `[LIVE_ACTIVITY.minTiles, LIVE_ACTIVITY.maxTiles]`.
- One `Switch` per monitor with `data-testid={`live-activity-ignore-${monitorId}`}`, checked when the monitor is *not* ignored, toggling membership of `liveActivityIgnoredMonitorIds`.
- Every write goes through `useSettingsStore.getState().updateProfileSettings(profileId, { ... })`.
- Every label and description is a locale key under `live_activity.*`. No literal strings.
- A short helper line under the poll input explaining that low-bandwidth mode raises the interval floor, so a user who sets 2 seconds and sees 10 is not confused.

Write the clamp once as a module-level helper rather than three times:

```typescript
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npm test -- src/components/live-activity --run`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire the gear into the page**

In `app/src/pages/LiveActivity.tsx`, add local state and a gear button beside `EventMontageGridControls`:

```tsx
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
```

```tsx
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsSettingsOpen(true)}
          title={t('live_activity.settings_title')}
          aria-label={t('live_activity.settings_title')}
          data-testid="live-activity-settings-btn"
        >
          <Settings className="h-4 w-4" />
        </Button>
```

Render the dialog below the grid, passing `currentProfile.id` and `data?.monitors ?? []`. Import `Settings` from `lucide-react` and `Button` from `../components/ui/button`.

- [ ] **Step 6: Run the page and dialog tests plus the a11y lint**

Run: `cd app && npm test -- src/pages/__tests__/LiveActivity.test.tsx src/components/live-activity --run && npm run lint:a11y`
Expected: PASS, no a11y findings. The gear needs both `title` and `aria-label`, matching the icon buttons in `MontageMonitor`.

- [ ] **Step 7: Commit**

```bash
git add app/src/components/live-activity app/src/pages/LiveActivity.tsx
git commit -m "feat: add Live Activity settings dialog

Poll interval, dwell window, tile cap, and a page-specific monitor ignore
list. The ignore list is separate from the profile-wide monitor exclusion,
which hides a monitor everywhere.

Refs #313"
```

---

### Task 7: Locales, sidebar, and the activity badge

**Files:**
- Modify: `app/src/locales/en/translation.json`, `app/src/locales/de/translation.json`, `app/src/locales/es/translation.json`, `app/src/locales/fr/translation.json`, `app/src/locales/zh/translation.json`
- Modify: `app/src/components/layout/SidebarContent.tsx:106-115` (nav entry) and the badge render around line 323

**Interfaces:**
- Consumes: `useNotificationStore` for the badge count; the page route from Task 5.
- Produces: the `live_activity.*` and `sidebar.live_activity` locale keys used by Tasks 5 and 6.

- [ ] **Step 1: Add the English keys**

Add a `live_activity` block to `app/src/locales/en/translation.json`, and a `live_activity` entry to the existing `sidebar` block:

```json
  "live_activity": {
    "title": "Live Activity",
    "all_quiet": "All quiet",
    "watching_count": "Watching {{count}} monitors",
    "tile_title": "{{name}}({{id}}):{{state}}",
    "state_alarm": "Alarmed",
    "state_alert": "Alert",
    "state_cooling": "Clearing",
    "overflow": "+{{count}} more active",
    "settings_title": "Live Activity settings",
    "poll_interval": "Check every",
    "poll_interval_desc": "How often alarm state is checked. Low bandwidth mode raises this floor.",
    "dwell": "Keep on screen for",
    "dwell_desc": "How long a monitor stays after its alarm clears. Higher values reduce flicker.",
    "max_tiles": "Maximum tiles",
    "max_tiles_desc": "Extra monitors collapse into a count instead of rendering.",
    "ignored_title": "Monitors to watch",
    "ignored_desc": "Turn a monitor off to keep it off this page. It stays visible everywhere else.",
    "seconds": "{{count}} sec"
  },
```

The `sidebar` block gains:

```json
    "live_activity": "Live Activity",
```

- [ ] **Step 2: Translate into the other four locales**

Add the same key structure to `de`, `es`, `fr`, and `zh`, translating the values. Keep labels short: they must fit 320px. `tile_title` keeps its interpolation shape unchanged in every locale, since it is a format rather than prose.

- [ ] **Step 3: Run the locale parity gate**

Run: `cd app && npm test -- src/tests --run`
Expected: PASS. `agents-contracts.test.ts` fails if any locale is missing a key that another has.

- [ ] **Step 4: Add the sidebar entry**

In `app/src/components/layout/SidebarContent.tsx`, add to the nav array after the `/montage` entry:

```typescript
    { path: '/live-activity', label: t('sidebar.live_activity'), icon: Activity },
```

Import `Activity` from `lucide-react`.

- [ ] **Step 5: Add the count badge**

Beside that nav item, render a count of monitors with a recent alarm event, read from the notification store. This costs nothing extra: it reuses events the websocket already delivered, and shows nothing when notifications are off.

Select it with a `useShallow` selector so the sidebar does not re-render on every unrelated store write:

```typescript
  const recentAlarmMonitorCount = useNotificationStore(
    useShallow((state) => {
      const events = currentProfile ? state.profileEvents[currentProfile.id] : undefined;
      if (!events?.length) return 0;
      const cutoff = Date.now() - LIVE_ACTIVITY.defaultDwellSeconds * 1000;
      return new Set(
        events.filter((e) => e.receivedAt >= cutoff).map((e) => String(e.MonitorId))
      ).size;
    })
  );
```

Render it using the same `Badge` treatment the existing notification count uses in that file. Read the surrounding code and match it rather than inventing a new badge style.

- [ ] **Step 6: Run the build and the full unit suite**

Run: `cd app && npm run build && npm test -- --run`
Expected: clean build, all tests pass. Tighten the Task 5 title assertion to the rendered English string now that the keys exist.

- [ ] **Step 7: Commit**

```bash
git add app/src/locales app/src/components/layout/SidebarContent.tsx app/src/pages/__tests__/LiveActivity.test.tsx
git commit -m "feat: add Live Activity locales, sidebar entry, and count badge

Refs #313"
```

---

### Task 8: End-to-end coverage and documentation

**Files:**
- Create: `app/tests/features/live-activity.feature`
- Create or modify: whichever step definitions the new steps need (find them with `grep -rn "I navigate to the" app/tests/`)
- Modify: the user documentation page listing the app's pages, and `docs/developer-guide/call-flows.rst`

**Interfaces:**
- Consumes: the `data-testid` values from Tasks 5 and 6: `live-activity-tile`, `live-activity-empty`, `live-activity-overflow`, `live-activity-settings-btn`, `live-activity-dwell-input`.
- Produces: no code interfaces.

- [ ] **Step 1: Read an existing feature file and its steps**

Run: `cd app && cat tests/features/monitors.feature && grep -rn "I navigate to the" tests/ | head -5`

Match the existing `Feature` / `Background` / `@all` tag structure exactly. Do not invent a new step vocabulary where an existing step already expresses the same thing.

- [ ] **Step 2: Write the feature file**

Create `app/tests/features/live-activity.feature`:

```gherkin
Feature: Live Activity
  As a ZoneMinder user
  I want to see only the cameras that are alarming right now
  So that I can tell what is happening without scanning every tile

  Background:
    Given I am logged into zmNinjaNg
    When I navigate to the "Live Activity" page

  @all
  Scenario: The page reports how many monitors it is watching when nothing is alarming
    Then I should see the all-quiet message
    And the all-quiet message should name how many monitors are being watched

  @all
  Scenario: Opening the settings dialog and changing the dwell window persists it
    When I open the Live Activity settings
    And I set the dwell window to 60 seconds
    And I close the Live Activity settings
    And I reload the page
    And I open the Live Activity settings
    Then the dwell window should be 60 seconds
```

Assert on the message content and the persisted value, never on element presence alone (C6).

- [ ] **Step 3: Add the step definitions**

Implement only the steps that do not already exist. Reuse `I am logged into zmNinjaNg` and `I navigate to the "..." page` as-is.

- [ ] **Step 4: Run the e2e feature**

Run: `cd app && npm run test:e2e -- live-activity.feature`
Expected: PASS.

Only one `npm run test:e2e` may run per working tree at a time. Device e2e on iOS, Android, and Tauri is manual-only and must not be run here.

- [ ] **Step 5: Update the documentation**

Add a Live Activity section to the user documentation, covering what the page shows, why a monitor lingers after its alarm clears, and what each of the four settings does.

Add a call-flow entry to `docs/developer-guide/call-flows.rst` tracing: the poll tick, through `useAlarmStates` fanout, into `parseAlarmState`, into `reduceActiveMonitors`, out to the rendered tiles, and the CMD_QUIT that fires when a tile finally unmounts. Read the existing entries first and match their narrative style. Prose reads like a developer explaining to a colleague: no marketing language, no headline headings.

- [ ] **Step 6: Run the full gate suite**

Run: `cd app && npm run gates`
Expected: PASS. This runs the vitest suite, the build including `tsc -b`, and the three blocking lint configs.

If `lint:ratchet` reports a raised baseline, fix the new findings rather than raising the number. C7 allows lowering it, never growing it.

- [ ] **Step 7: Commit and open the PR**

```bash
git add app/tests/features/live-activity.feature app/tests/steps docs
git commit -m "test: add Live Activity e2e coverage and docs

Refs #313"
git push -u origin feat/313-live-activity
gh pr create --label core --title "feat: Live Activity page showing only monitors currently in alarm" --body "..."
```

The PR body should summarise the approach, state which gates were run, and record the three verified ZoneMinder answers from Task 0. End it with `Posted by Claude, assisting @pliablepixels.` and the Claude Code footer. Do not use a closing keyword until the maintainer confirms.

Before pushing, confirm `git status` shows `app/android/app/build.gradle` and `app/ios/App/App.xcodeproj/project.pbxproj` still modified and unstaged.

---

## Notes for the implementer

**Where the interesting logic is.** Task 2 is the feature. Tasks 5 through 7 are wiring. If time is short, the reducer is the part that must be right.

**Reuse already done for you.** `getAlarmStatus`, `queryKeys.monitorAlarmStatus`, and the `alarmStatusInterval` bandwidth key all already exist. So does the entire ZMS stream lifecycle: mounting a `MontageMonitor` mints a connection key and unmounting it sends CMD_QUIT, including the profile-switch teardown registry. Do not write stream teardown code for this page.

**The one thing that looks like a contract violation.** A per-page poll interval appears to contradict the Polling contract's "users tune bandwidth globally". It is resolved by routing the user value through `resolvePollIntervalMs` against the `alarmStatusInterval` floor, exactly as notification polling already does. If a reviewer flags it, that is the answer.
