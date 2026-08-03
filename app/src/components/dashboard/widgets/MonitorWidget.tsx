/**
 * Monitor Widget Component
 *
 * Displays live monitor streams in dashboard widgets.
 * Features:
 * - Single or multiple monitor display
 * - Automatic grid layout for multiple monitors
 * - Respects user streaming vs snapshot preferences
 * - Periodic refresh in snapshot mode
 * - Error handling and offline states
 * - Stream URL generation with auth tokens
 * - Hover overlay with monitor name
 */

import { useMemo, memo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getMonitor, getMonitors } from '../../../api/monitors';
import { getSession } from '../../../services/sessions';
import { queryKeys } from '../../../lib/query/query-keys';
import type { MonitorFeedFit } from '../../../stores/settings';
import type { ProfileId } from '../../../api/types';
import { LiveMonitorPlayer } from '../../monitors/LiveMonitorPlayer';
import { MonitorHoverPreview } from '../../monitors/MonitorHoverPreview';
import { useProfileById } from '../../../hooks/useCurrentProfile';
import { AlertTriangle } from 'lucide-react';
import { Skeleton } from '../../ui/skeleton';
import { useTranslation } from 'react-i18next';
import { calculateGridDimensions } from '../../../lib/grid-utils';
import { filterEnabledMonitors } from '../../../lib/monitor/filters';
import { activateOnEnterOrSpace } from '../../../lib/utils';

interface MonitorWidgetProps {
    /** Array of monitor IDs to display */
    monitorIds: string[];
    objectFit?: MonitorFeedFit;
    /** Pins this widget to one profile's session - a monitorId only means
     *  something on one server. Set in All mode (widget.settings.profileId,
     *  chosen via the edit dialog, or the first profile in scope);
     *  undefined in single mode (resolves to the current profile, exactly
     *  as before). */
    profileId?: ProfileId;
}

/**
 * Single Monitor Display Component
 * Renders a single monitor stream with error handling
 * Respects streaming vs snapshot settings from user preferences
 */
function SingleMonitor({ monitorId, objectFit, profileId }: { monitorId: string; objectFit: MonitorFeedFit; profileId?: ProfileId }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { profile: currentProfile, settings } = useProfileById(profileId);
    const [protocol, setProtocol] = useState('MJPEG');
    const { data: monitor, isLoading, error } = useQuery({
        queryKey: queryKeys.monitor(currentProfile?.id, monitorId),
        queryFn: () => getMonitor(getSession(currentProfile!.id).client, monitorId),
        enabled: !!monitorId && !!currentProfile,
    });

    if (isLoading) {
        return <Skeleton className="w-full h-full" />;
    }

    if (error || !monitor) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground bg-muted/30 p-4 text-center">
                <AlertTriangle className="h-8 w-8 mb-2 opacity-50" />
                <span className="text-xs">{t('dashboard.offline')}</span>
            </div>
        );
    }

    if (monitor.Monitor.Deleted === true) {
        return null;
    }

    const monitorPath = profileId ? `/all/monitors/${profileId}/${monitor.Monitor.Id}` : `/monitors/${monitor.Monitor.Id}`;

    return (
        <div
            className="w-full h-full bg-black relative group overflow-hidden cursor-pointer"
            role="button"
            tabIndex={0}
            aria-label={monitor.Monitor.Name}
            onClick={() => navigate(monitorPath, { state: { from: '/dashboard' } })}
            onKeyDown={activateOnEnterOrSpace(() => navigate(monitorPath, { state: { from: '/dashboard' } }))}
        >
            {settings.hoverPreview.dashboard ? (
                <MonitorHoverPreview monitor={monitor.Monitor} profileId={profileId}>
                    <LiveMonitorPlayer
                        monitor={monitor.Monitor}
                        profile={currentProfile}
                        profileId={profileId}
                        className="w-full h-full"
                        objectFit={objectFit}
                        onProtocolChange={setProtocol}
                    />
                </MonitorHoverPreview>
            ) : (
                <LiveMonitorPlayer
                    monitor={monitor.Monitor}
                    profile={currentProfile}
                    profileId={profileId}
                    className="w-full h-full"
                    objectFit={objectFit}
                    onProtocolChange={setProtocol}
                />
            )}
            {settings.showProtocolLabel && (
                <span className="absolute bottom-1 right-1 z-10 text-[9px] px-1 py-0.5 rounded bg-black/50 text-white/90 font-medium pointer-events-none">
                    {protocol}
                </span>
            )}
            {profileId && currentProfile && (
                <span
                    className="absolute top-1 left-1 z-10 text-[9px] px-1 py-0.5 rounded bg-black/50 text-white/90 font-medium truncate max-w-[100px] pointer-events-none"
                    title={currentProfile.name}
                    data-testid="widget-profile-chip"
                >
                    {currentProfile.name}
                </span>
            )}
            <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                <p className="text-white text-xs font-medium truncate">{monitor.Monitor.Name}</p>
            </div>
        </div>
    );
}

export const MonitorWidget = memo(function MonitorWidget({ monitorIds, objectFit = 'contain', profileId }: MonitorWidgetProps) {
    const { t } = useTranslation();
    const { profile: currentProfile } = useProfileById(profileId);

    // Fetch all monitors to check which ones are deleted
    const { data: monitorsData } = useQuery({
        queryKey: queryKeys.monitors(currentProfile?.id),
        queryFn: () => getMonitors(getSession(currentProfile!.id).client, currentProfile!.id),
        enabled: !!currentProfile,
    });

    // Filter out deleted monitors
    const activeMonitorIds = useMemo(() => {
        if (!monitorsData?.monitors) return monitorIds;

        const enabledMonitors = filterEnabledMonitors(monitorsData.monitors);
        const enabledIds = new Set(enabledMonitors.map(m => m.Monitor.Id));

        return monitorIds.filter(id => enabledIds.has(id));
    }, [monitorIds, monitorsData?.monitors]);

    if (!monitorIds || monitorIds.length === 0) {
        return (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                {t('dashboard.no_monitors_selected')}
            </div>
        );
    }

    if (activeMonitorIds.length === 0) {
        return (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                {t('dashboard.no_monitors_available')}
            </div>
        );
    }

    if (activeMonitorIds.length === 1) {
        return <SingleMonitor monitorId={activeMonitorIds[0]} objectFit={objectFit} profileId={profileId} />;
    }

    // Calculate optimal grid layout for multiple monitors
    const { cols, rows } = calculateGridDimensions(activeMonitorIds.length);

    return (
        <div
            className="w-full h-full flex flex-wrap bg-black"
        >
            {activeMonitorIds.map((id) => (
                <div
                    key={id}
                    className="relative overflow-hidden"
                    style={{
                        width: `${100 / cols}%`,
                        height: `${100 / rows}%`,
                    }}
                >
                    <SingleMonitor monitorId={id} objectFit={objectFit} profileId={profileId} />
                </div>
            ))}
        </div>
    );
});
