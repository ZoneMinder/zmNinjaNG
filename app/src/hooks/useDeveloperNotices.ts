/**
 * Developer Notices Hook
 *
 * Fetches the notice feed via React Query and merges it with the local
 * read-state store. Filters out notices targeted at app versions newer
 * than the running build (so a notice annotated minAppVersion: 2.0.0
 * is hidden on 1.x). Sorts newest-first.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchDeveloperNotices, type DeveloperNotice } from '../api/developer-notices';
import { useDeveloperNoticeStore } from '../stores/developerNotices';
import { DEVELOPER_NOTICES } from '../lib/zmninja-ng-constants';
import { getAppVersion } from '../lib/version';
import { queryKeys } from '../lib/query/query-keys';

export interface DeveloperNoticeView extends DeveloperNotice {
  isRead: boolean;
}

/**
 * Compare semantic versions. Returns negative when a < b, 0 when equal,
 * positive when a > b. Ignores any pre-release / build suffix after the
 * first non-numeric character on a component.
 */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) => v.split('.').map((part) => parseInt(part, 10) || 0);
  const av = parse(a);
  const bv = parse(b);
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i++) {
    const diff = (av[i] ?? 0) - (bv[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function useDeveloperNotices() {
  const showNotices = useDeveloperNoticeStore((s) => s.showNotices);

  const query = useQuery({
    queryKey: queryKeys.developerNotices(),
    queryFn: fetchDeveloperNotices,
    staleTime: DEVELOPER_NOTICES.staleTimeMs,
    refetchInterval: DEVELOPER_NOTICES.pollIntervalMs,
    refetchOnWindowFocus: true,
    retry: 1,
    enabled: showNotices,
  });

  const readIds = useDeveloperNoticeStore((s) => s.readIds);
  const deletedIds = useDeveloperNoticeStore((s) => s.deletedIds);

  const notices = useMemo<DeveloperNoticeView[]>(() => {
    // react-query's `enabled: false` does not clear already-cached data, so
    // this gate must run before any filtering of the raw feed.
    if (!showNotices) return [];
    const feed = query.data ?? [];
    const appVersion = getAppVersion();
    const read = new Set(readIds);
    const deleted = new Set(deletedIds);
    return feed
      .filter((n) => import.meta.env.DEV || !n.minAppVersion || compareSemver(appVersion, n.minAppVersion) >= 0)
      .filter((n) => !deleted.has(n.id))
      .map((n) => ({ ...n, isRead: read.has(n.id) }))
      .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0));
  }, [query.data, readIds, deletedIds, showNotices]);

  const unreadCount = notices.reduce((n, v) => n + (v.isRead ? 0 : 1), 0);
  const criticalUnread = notices.filter((n) => n.severity === 'critical' && !n.isRead);

  return {
    notices,
    unreadCount,
    criticalUnread,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
