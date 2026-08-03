/**
 * useNotificationAllModeToasts Hook
 *
 * All-mode toast display (refs #337). Each connected profile's events honor
 * that profile's OWN showToasts/playSound settings - never the app's
 * "current" profile (there isn't one while aggregating: useCurrentProfile
 * resolves to null for the ALL_PROFILES_ID sentinel).
 *
 * Events arriving within NOTIFICATIONS_SERVICE.allModeBurstWindowMs of each
 * other collapse into one summary toast instead of one per event, so
 * aggregating several busy servers doesn't flood the screen. A single event
 * in the window still shows the normal per-event toast. At most one
 * notification sound plays per window.
 *
 * The all-mode mute toggle (settings store, ALL_PROFILES_ID bucket)
 * suppresses toasts and sound entirely; badge counts and history are
 * unaffected (addEvent, in stores/notifications.ts, always runs regardless).
 *
 * Single mode is untouched: this hook no-ops unless scope.mode is 'all'.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Bell } from 'lucide-react';
import { useNotificationStore, type NotificationEvent } from '../stores/notifications';
import { useProfileScope } from './useProfileScope';
import { getEventCauseIcon } from '../lib/event/event-icons';
import { playNotificationSound } from '../lib/event/notification-sound';
import { NOTIFICATIONS_SERVICE } from '../lib/zmninja-ng-constants';
import { log, LogLevel } from '../lib/logger';

interface BurstEntry {
  profileId: string;
  profileName: string;
  event: NotificationEvent;
  playSound: boolean;
}

export function useNotificationAllModeToasts(): void {
  const scope = useProfileScope();
  const navigate = useNavigate();
  const { t } = useTranslation();

  // Raw record select (not useShallow over a derived array): re-renders
  // whenever any profile's events change, same discipline as
  // NotificationOverview's profileSettings subscription.
  const profileEvents = useNotificationStore((s) => s.profileEvents);
  const getProfileSettings = useNotificationStore((s) => s.getProfileSettings);

  const lastSeenAtRef = useRef<Record<string, number>>({});
  const burstRef = useRef<BurstEntry[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushBurst = useCallback(() => {
    const collected = burstRef.current;
    burstRef.current = [];
    timerRef.current = null;
    if (collected.length === 0) return;

    if (collected.length === 1) {
      const { event, profileName } = collected[0];
      // ponytail: no thumbnail here (would need a fresh access token for
      // the OWNING profile, not the app's current one); ceiling: wire a
      // per-profile token lookup if this turns out to matter in practice.
      toast(
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">
            <Bell className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm">{event.MonitorName}</div>
            <div className="text-xs text-muted-foreground/70">{profileName}</div>
            {(() => {
              const CauseIcon = getEventCauseIcon(event.Cause);
              return (
                <div className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1">
                  <CauseIcon className="h-3 w-3" />
                  {event.Cause}
                </div>
              );
            })()}
          </div>
        </div>,
        {
          duration: 5000,
          action: event.EventId
            ? { label: t('common.view'), onClick: () => navigate(`/events/${event.EventId}`) }
            : undefined,
        }
      );
    } else {
      const servers = new Set(collected.map((c) => c.profileId)).size;
      toast(t('notifications.all_mode_burst_summary', { count: collected.length, servers }), {
        duration: 5000,
        action: { label: t('common.view'), onClick: () => navigate('/events') },
      });
    }

    if (collected.some((c) => c.playSound)) {
      playNotificationSound();
    }

    log.notifications('Showed All-mode toast', LogLevel.INFO, {
      count: collected.length,
      servers: new Set(collected.map((c) => c.profileId)).size,
    });
  }, [navigate, t]);

  useEffect(() => {
    if (!scope || scope.mode !== 'all') return;

    const newlyArrived: BurstEntry[] = [];
    for (const profile of scope.profiles) {
      const latest = profileEvents[profile.id]?.[0];
      if (!latest) continue;

      // receivedAt (not EventId) marks "new": EventId can be 0 for more than
      // one distinct event (issue #242), so it can't dedupe reliably here.
      const lastSeen = lastSeenAtRef.current[profile.id] ?? 0;
      if (latest.receivedAt <= lastSeen) continue;
      lastSeenAtRef.current[profile.id] = latest.receivedAt;

      const ownerSettings = getProfileSettings(profile.id);
      if (!ownerSettings.showToasts) continue;

      newlyArrived.push({
        profileId: profile.id,
        profileName: profile.name,
        event: latest,
        playSound: ownerSettings.playSound,
      });
    }

    // lastSeenAtRef is updated above regardless of mute, so nothing already
    // seen replays into a toast once the user unmutes.
    if (newlyArrived.length === 0 || scope.settings.allModeMuteToasts) return;

    burstRef.current.push(...newlyArrived);
    if (!timerRef.current) {
      timerRef.current = setTimeout(flushBurst, NOTIFICATIONS_SERVICE.allModeBurstWindowMs);
    }
  }, [profileEvents, scope, getProfileSettings, flushBurst]);
}
