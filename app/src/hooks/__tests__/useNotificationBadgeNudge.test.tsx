/**
 * Regression test for the notification -> badge nudge contract: a genuinely
 * new event invalidates that monitor's monitorEventsSinceMonitor prefix, but
 * mounting with pre-existing events (or a re-delivered event) must not.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useNotificationBadgeNudge } from '../useNotificationBadgeNudge';
import { queryKeys } from '../../lib/query/query-keys';
import { asProfileId } from '../../api/types';
import type { NotificationEvent } from '../../stores/notifications';

const P1 = asProfileId('p1');
const P2 = asProfileId('p2');

const invalidateQueries = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

function makeEvent(eventId: number, monitorId: number): NotificationEvent {
  return {
    MonitorId: monitorId,
    MonitorName: `Monitor-${monitorId}`,
    EventId: eventId,
    Cause: 'Motion',
    Name: `Event-${eventId}`,
    receivedAt: Date.now(),
    read: false,
    source: 'websocket',
  };
}

describe('useNotificationBadgeNudge', () => {
  beforeEach(() => {
    invalidateQueries.mockClear();
  });

  it('does not invalidate on mount with a pre-existing event (seed only)', () => {
    renderHook(({ profileId, events }) => useNotificationBadgeNudge(profileId, events), {
      initialProps: { profileId: P1, events: [makeEvent(1, 5)] },
    });

    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it('invalidates monitorEventsSinceMonitor for a new event after mount', () => {
    const { rerender } = renderHook(
      ({ profileId, events }) => useNotificationBadgeNudge(profileId, events),
      { initialProps: { profileId: P1, events: [] as NotificationEvent[] } }
    );

    rerender({ profileId: P1, events: [makeEvent(1, 5)] });

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.monitorEventsSinceMonitor(P1, '5'),
    });
  });

  it('does not invalidate again when the same event is re-delivered', () => {
    const { rerender } = renderHook(
      ({ profileId, events }) => useNotificationBadgeNudge(profileId, events),
      { initialProps: { profileId: P1, events: [] as NotificationEvent[] } }
    );

    rerender({ profileId: P1, events: [makeEvent(1, 5)] });
    expect(invalidateQueries).toHaveBeenCalledTimes(1);

    // Same EventId, new array identity (e.g. store re-emits the same event).
    rerender({ profileId: P1, events: [makeEvent(1, 5)] });
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it('invalidates a second distinct event for a different monitor', () => {
    const { rerender } = renderHook(
      ({ profileId, events }) => useNotificationBadgeNudge(profileId, events),
      { initialProps: { profileId: P1, events: [] as NotificationEvent[] } }
    );

    rerender({ profileId: P1, events: [makeEvent(1, 5)] });
    rerender({ profileId: P1, events: [makeEvent(2, 8), makeEvent(1, 5)] });

    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenLastCalledWith({
      queryKey: queryKeys.monitorEventsSinceMonitor(P1, '8'),
    });
  });

  it('re-seeds instead of nudging when the profile id changes', () => {
    const { rerender } = renderHook(
      ({ profileId, events }) => useNotificationBadgeNudge(profileId, events),
      { initialProps: { profileId: P1, events: [makeEvent(1, 5)] } }
    );

    // Switch profile: the new profile's backlog event must seed, not nudge.
    rerender({ profileId: P2, events: [makeEvent(99, 7)] });
    expect(invalidateQueries).not.toHaveBeenCalled();

    // A subsequent genuinely new event for the new profile nudges normally.
    rerender({ profileId: P2, events: [makeEvent(100, 7), makeEvent(99, 7)] });
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.monitorEventsSinceMonitor(P2, '7'),
    });
  });
});
