/**
 * Data hook for the monitor-detail recent-events list. Wraps the events query
 * and the per-monitor hidden toggle. The query is disabled while hidden so no
 * request or refresh fires (refs #213).
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getEvents } from '../api/events';
import { getCurrentSession } from '../services/sessions';
import type { EventData } from '../api/types';
import { useCurrentProfile } from './useCurrentProfile';
import { useAuthSlice } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import { useBandwidthSettings } from './useBandwidthSettings';
import { queryKeys } from '../lib/query/query-keys';
import {
  clampRecentEventsCount,
  isMonitorRecentEventsHidden,
  toggleMonitorRecentEventsHidden,
} from '../lib/monitor/monitor-recent-events';

export interface UseMonitorRecentEvents {
  events: EventData[];
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  hidden: boolean;
  count: number;
  toggleHidden: () => void;
  refetch: () => void;
}

export function useMonitorRecentEvents(monitorId: string): UseMonitorRecentEvents {
  const { currentProfile, settings } = useCurrentProfile();
  const isAuthenticated = useAuthSlice(currentProfile?.id ?? null).isAuthenticated;
  const updateProfileSettings = useSettingsStore((s) => s.updateProfileSettings);
  const bandwidth = useBandwidthSettings();

  const count = clampRecentEventsCount(settings.monitorDetailRecentEventsCount);
  const hiddenList = settings.monitorDetailRecentEventsHidden;
  const hidden = isMonitorRecentEventsHidden(hiddenList, monitorId);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: queryKeys.monitorRecentEvents(currentProfile?.id, monitorId, count),
    queryFn: () => getEvents(getCurrentSession().client, getCurrentSession().profileId, { monitorId, limit: count, sort: 'StartDateTime', direction: 'desc' }),
    enabled: !!currentProfile && isAuthenticated && !hidden,
    refetchInterval: hidden ? false : bandwidth.monitorRecentEventsInterval,
  });

  const events = useMemo(() => (data?.events ?? []).slice(0, count), [data?.events, count]);

  const toggleHidden = () => {
    if (!currentProfile) return;
    updateProfileSettings(currentProfile.id, {
      monitorDetailRecentEventsHidden: toggleMonitorRecentEventsHidden(hiddenList, monitorId),
    });
  };

  return {
    events,
    isLoading,
    isError,
    isFetching,
    hidden,
    count,
    toggleHidden,
    refetch: () => { void refetch(); },
  };
}
