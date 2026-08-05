/**
 * Notification History Page
 *
 * Displays a list of past notifications. Single mode: the current profile's
 * bucket. All mode: the union of every scope profile's bucket, newest first,
 * with a profile chip per row and per-row actions acting on the OWNING
 * profile's bucket (refs #337).
 *
 * Allows users to view event details, mark as read, or clear history.
 */

import { useState, useMemo, useCallback } from 'react';
import { useNotificationStore } from '../stores/notifications';
import { useShallow } from 'zustand/react/shallow';
import { useCurrentProfile } from '../hooks/useCurrentProfile';
import { useProfileScope } from '../hooks/useProfileScope';
import { NotificationHistoryItem, type HistoryEvent } from '../components/notifications/NotificationHistoryItem';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { Bell, Trash2, CheckCheck, AlertCircle } from 'lucide-react';
import { isToday, isYesterday, startOfWeek, startOfMonth } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { NotificationBadge } from '../components/NotificationBadge';
import { PageContainer } from '../components/common/PageContainer';
import { EmptyState } from '../components/ui/empty-state';

// Stable empty reference for the no-profile case, so the selector below does
// not return a fresh array each render.
const EMPTY_EVENTS: HistoryEvent[] = [];

export default function NotificationHistory() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { currentProfile } = useCurrentProfile();
  const scope = useProfileScope();
  const isAllMode = scope?.mode === 'all';
  const markEventRead = useNotificationStore((s) => s.markEventRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const clearEvents = useNotificationStore((s) => s.clearEvents);
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);

  // Every real profile in scope: [currentProfile] in single mode, every
  // scope profile in All mode - same "profiles is always an array" idiom
  // useProfileScope documents, so one code path covers both modes.
  const scopeProfiles = useMemo(
    () => (isAllMode ? scope.profiles : currentProfile ? [currentProfile] : []),
    [isAllMode, scope, currentProfile]
  );

  // Subscribe to the RAW per-profile event arrays only - not a derived,
  // freshly-allocated union. A selector that builds a new array/object every
  // call defeats useShallow's element-wise Object.is compare (every element
  // differs every time) and useSyncExternalStore loops forever (refs #337).
  const buckets = useNotificationStore(
    useShallow((s) => scopeProfiles.map((p) => s.profileEvents[p.id] ?? EMPTY_EVENTS))
  );

  // Tag/merge/sort OUTSIDE the store subscription, in a plain useMemo keyed
  // on the stable bucket references.
  const events = useMemo<HistoryEvent[]>(
    () =>
      scopeProfiles
        .flatMap((p, i) => buckets[i].map((e) => ({ ...e, profileId: p.id, profileName: p.name })))
        .sort((a, b) => b.receivedAt - a.receivedAt),
    [buckets, scopeProfiles]
  );
  const unreadCount = useMemo(() => events.filter((e) => !e.read).length, [events]);

  const handleViewEvent = useCallback(
    (event: HistoryEvent) => {
      // Id 0 is a notification with no ZM event: nothing to open (issue #242).
      if (event.EventId <= 0) return;
      markEventRead(event.profileId, event.EventId);
      navigate(isAllMode ? `/all/events/${event.profileId}/${event.EventId}` : `/events/${event.EventId}`);
    },
    [markEventRead, navigate, isAllMode]
  );

  const handleMarkRead = useCallback(
    (event: HistoryEvent) => markEventRead(event.profileId, event.EventId),
    [markEventRead]
  );

  const handleMarkAllRead = () => {
    scopeProfiles.forEach((p) => markAllRead(p.id));
  };

  const handleClearEvents = () => {
    scopeProfiles.forEach((p) => clearEvents(p.id));
  };

  type DateSection = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'older';

  const getDateSection = useCallback((timestamp: number): DateSection => {
    const date = new Date(timestamp);
    if (isToday(date)) return 'today';
    if (isYesterday(date)) return 'yesterday';
    const now = new Date();
    if (date >= startOfWeek(now, { weekStartsOn: 1 })) return 'this_week';
    if (date >= startOfMonth(now)) return 'this_month';
    return 'older';
  }, []);

  const groupedEvents = useMemo(() => {
    const sections: { key: DateSection; label: string; events: typeof events }[] = [
      { key: 'today', label: t('notification_history.today'), events: [] },
      { key: 'yesterday', label: t('notification_history.yesterday'), events: [] },
      { key: 'this_week', label: t('notification_history.this_week'), events: [] },
      { key: 'this_month', label: t('notification_history.this_month'), events: [] },
      { key: 'older', label: t('notification_history.older'), events: [] },
    ];
    for (const event of events) {
      const section = getDateSection(event.receivedAt);
      sections.find((s) => s.key === section)!.events.push(event);
    }
    return sections.filter((s) => s.events.length > 0);
  }, [events, getDateSection, t]);

  // Early return if no profile at all (both modes: All mode always has
  // scopeProfiles.length > 0 when it renders at all - useProfileScope
  // collapses to null otherwise).
  if (scopeProfiles.length === 0) {
    return (
      <div className="p-4">
        <div className="flex items-center justify-center min-h-[300px]">
          <div className="text-center space-y-2">
            <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto" />
            <h2 className="text-base font-semibold">{t('notification_history.no_profile')}</h2>
            <p className="text-sm text-muted-foreground">{t('notification_history.select_profile_first')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <PageContainer
      spacing="none"
      className="space-y-3 sm:space-y-4"
      data-testid="notification-history"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-base sm:text-lg font-bold tracking-tight">
            {t('notification_history.title')}
          </h1>
          <NotificationBadge />
        </div>
        <div className="flex gap-1.5">
          {unreadCount > 0 && (
            <Button variant="outline" onClick={handleMarkAllRead} size="sm" className="h-8">
              <CheckCheck className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">{t('notification_history.mark_all_read')}</span>
            </Button>
          )}
          {events.length > 0 && (
            <Button variant="destructive" onClick={() => setIsClearDialogOpen(true)} size="sm" className="h-8" data-testid="clear-history-button">
              <Trash2 className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">{t('notification_history.clear_all')}</span>
            </Button>
          )}
        </div>
      </div>

      {events.length === 0 ? (
        <Card data-testid="notification-history-empty">
          <CardContent className="py-4">
            <EmptyState
              icon={Bell}
              title={t('notification_history.no_notifications')}
              description={t('notification_history.no_notifications_desc')}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-0" data-testid="notification-history-list">
          {groupedEvents.map((section) => (
            <div key={section.key}>
              {/* Section header: bubble + line */}
              <div className="flex items-center gap-3 my-3" data-testid={`section-${section.key}`}>
                <span className="text-[11px] font-medium text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full shrink-0">
                  {section.label}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>
              {/* Events in section */}
              <div className="border rounded-md divide-y overflow-hidden">
                {section.events.map((event) => (
                  <NotificationHistoryItem
                    key={`${event.profileId}-${event.EventId}-${event.receivedAt}`}
                    event={event}
                    showProfileChip={isAllMode}
                    onView={handleViewEvent}
                    onMarkRead={handleMarkRead}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {events.length > 0 && (
        <div className="text-center text-xs text-muted-foreground">
          {t('notification_history.showing_count', { count: events.length })}
        </div>
      )}

      <AlertDialog open={isClearDialogOpen} onOpenChange={setIsClearDialogOpen}>
        <AlertDialogContent data-testid="clear-history-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('notification_history.clear_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('notification_history.clear_confirm_desc', { count: events.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="clear-history-cancel">{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearEvents}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="clear-history-confirm"
            >
              {t('notification_history.clear_all')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
