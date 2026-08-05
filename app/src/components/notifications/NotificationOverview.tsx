/**
 * Notification Overview
 *
 * All-mode-only: a per-profile summary list shown above the profile picker
 * on NotificationSettings so it's clear notifications are scoped per profile,
 * not one config applying everywhere (refs #337). Read-only display of each
 * profile's stored settings; clicking a row drives the same picker state the
 * page's ProfilePicker uses.
 */

import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { useNotificationStore } from '../../stores/notifications';
import type { ConnectionState } from '../../types/notifications';
import type { Profile, ProfileId } from '../../api/types';

/** Maps a live ES connection state to the same status copy/variant the
 *  NotificationSettings page's own connection badge uses, so the overview
 *  row and the detail page never disagree on wording (refs #337). */
function connectionStatusKey(state: ConnectionState): string {
  switch (state) {
    case 'connected':
      return 'notification_settings.status_connected';
    case 'connecting':
    case 'authenticating':
      return 'notification_settings.status_connecting';
    case 'error':
      return 'notification_settings.status_error';
    default:
      return 'notification_settings.status_disconnected';
  }
}

function connectionBadgeVariant(state: ConnectionState): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (state) {
    case 'connected':
      return 'default';
    case 'connecting':
    case 'authenticating':
      return 'secondary';
    case 'error':
      return 'destructive';
    default:
      return 'outline';
  }
}

export interface NotificationOverviewProps {
  profiles: Profile[];
  activeProfileId: ProfileId | undefined;
  onSelect: (profileId: ProfileId) => void;
}

export function NotificationOverview({ profiles, activeProfileId, onSelect }: NotificationOverviewProps) {
  const { t } = useTranslation();
  // Subscribes to the raw settings record (re-renders only when it actually
  // changes) and reads through the stable getProfileSettings action to merge
  // defaults per profile. A useShallow selector that mapped profiles to an
  // array of getProfileSettings() results would loop forever instead: that
  // call returns a freshly-spread object every time, so the array's elements
  // are never reference-equal to their previous render's, and shallow
  // equality is element-by-element reference comparison for arrays.
  useNotificationStore((s) => s.profileSettings);
  const getProfileSettings = useNotificationStore((s) => s.getProfileSettings);
  // Per-profile live connection state for the ES-mode dot below (refs #337).
  const connections = useNotificationStore(useShallow((s) => s.connections));

  return (
    <Card data-testid="notification-overview">
      <CardHeader>
        <CardTitle>{t('notification_settings.overview_title')}</CardTitle>
        <CardDescription>{t('notification_settings.overview_desc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {profiles.map((profile) => {
          const settings = getProfileSettings(profile.id);
          const mode = settings.notificationMode || 'es';
          const isActive = profile.id === activeProfileId;
          const hostLabel = mode === 'direct'
            ? t('notification_settings.overview_direct_mode_host')
            : (settings.host || t('notification_settings.overview_no_host'));
          const connectionState = connections[profile.id] ?? 'disconnected';
          const showConnectionStatus = mode === 'es' && settings.enabled;

          return (
            <button
              key={profile.id}
              type="button"
              onClick={() => onSelect(profile.id)}
              aria-current={isActive ? 'true' : undefined}
              data-testid={`notification-overview-row-${profile.id}`}
              className={`w-full flex items-center justify-between gap-3 p-3 rounded-lg border text-left transition-colors ${
                isActive ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm truncate" title={profile.name}>{profile.name}</div>
                <div className="text-xs text-muted-foreground truncate" title={hostLabel}>{hostLabel}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {showConnectionStatus && (
                  <Badge
                    variant={connectionBadgeVariant(connectionState)}
                    data-testid={`notification-overview-connection-${profile.id}`}
                  >
                    {t(connectionStatusKey(connectionState))}
                  </Badge>
                )}
                <Badge variant="outline" data-testid="notification-overview-mode">
                  {t(`notification_settings.mode_${mode}`)}
                </Badge>
                <Badge variant={settings.enabled ? 'default' : 'secondary'} data-testid="notification-overview-status">
                  {t(settings.enabled ? 'notification_settings.overview_enabled' : 'notification_settings.overview_disabled')}
                </Badge>
              </div>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}
