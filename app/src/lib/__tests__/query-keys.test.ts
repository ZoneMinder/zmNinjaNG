import { describe, it, expect } from 'vitest';
import { queryKeys } from '../query-keys';
import { asProfileId } from '../../api/types';

const PID = asProfileId('profile-1');

/** True when `prefix` is an element-wise prefix of `key` (React Query match). */
function isPrefixOf(prefix: readonly unknown[], key: readonly unknown[]): boolean {
  if (prefix.length > key.length) return false;
  return prefix.every((el, i) => el === key[i]);
}

describe('queryKeys', () => {
  it('produces stable, profile-scoped shapes', () => {
    expect(queryKeys.monitors(PID)).toEqual(['monitors', PID]);
    expect(queryKeys.monitor(PID, '7')).toEqual(['monitor', PID, '7']);
    expect(queryKeys.event(PID, '42')).toEqual(['event', PID, '42']);
    expect(queryKeys.states(PID)).toEqual(['states', PID]);
    expect(queryKeys.monitorRecentEvents(PID, '7', 10)).toEqual([
      'monitorRecentEvents',
      PID,
      '7',
      10,
    ]);
    expect(queryKeys.eventsHeatmap(PID, '7d')).toEqual(['events-heatmap', PID, '7d']);
  });

  it('places the profile id immediately after the domain for every key', () => {
    expect(queryKeys.monitors(PID)[1]).toBe(PID);
    expect(queryKeys.monitor(PID, '7')[1]).toBe(PID);
    expect(queryKeys.eventsList(PID, {}, 100, undefined, false, undefined, undefined)[1]).toBe(PID);
    expect(queryKeys.monitorsAllIncludingExcluded(PID)[1]).toBe(PID);
    expect(queryKeys.timelineEventsList(PID, 's', 'e', undefined, false, 'all')[1]).toBe(PID);
  });

  it('keeps domain keys a strict prefix of their leaf keys (prefix invalidation works)', () => {
    // events domain
    expect(isPrefixOf(
      queryKeys.events(PID),
      queryKeys.eventsList(PID, { a: 1 }, 50, '3', true, ['1'], ['9']),
    )).toBe(true);
    expect(isPrefixOf(queryKeys.events(PID), queryKeys.eventsWidget(PID, '3', 5, false))).toBe(true);
    expect(isPrefixOf(queryKeys.events(PID), queryKeys.eventsTimelineWidget(PID, 123))).toBe(true);

    // monitors domain (list + all-including-excluded)
    expect(isPrefixOf(queryKeys.monitors(PID), queryKeys.monitorsAllIncludingExcluded(PID))).toBe(true);

    // consoleEvents / event-montage / timeline-events domains
    expect(isPrefixOf(queryKeys.consoleEvents(PID), queryKeys.consoleEventsList(PID, '1 week'))).toBe(true);
    expect(isPrefixOf(queryKeys.eventMontage(PID), queryKeys.eventMontageList(PID, { m: 1 }))).toBe(true);
    expect(isPrefixOf(
      queryKeys.timelineEvents(PID),
      queryKeys.timelineEventsList(PID, 's', 'e', '3', false, 'all'),
    )).toBe(true);
  });

  it('does not cross-match a different domain by prefix', () => {
    // 'event' must not prefix-match 'events'
    expect(isPrefixOf(queryKeys.event(PID, '1'), queryKeys.eventsList(PID, {}, 1, undefined, false, undefined, undefined))).toBe(false);
    // events domain must not match events-heatmap (distinct domain name)
    expect(isPrefixOf(queryKeys.events(PID), queryKeys.eventsHeatmap(PID, '7d'))).toBe(false);
  });

  it('scopes keys per profile so different profiles never match', () => {
    const A = asProfileId('a');
    const B = asProfileId('b');
    expect(isPrefixOf(queryKeys.events(A), queryKeys.eventsWidget(B, '1', 5, false))).toBe(false);
    expect(queryKeys.monitors(A)).not.toEqual(queryKeys.monitors(B));
  });

  it('keeps the app-level developer notices key profile-independent', () => {
    expect(queryKeys.developerNotices()).toEqual(['developer-notices']);
  });
});
