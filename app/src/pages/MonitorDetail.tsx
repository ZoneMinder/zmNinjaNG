/**
 * Monitor Detail Page
 *
 * Displays a live stream (or high-refresh snapshot) for a single monitor.
 * Includes PTZ controls (if applicable) and quick actions.
 */

import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getMonitor, getControl } from '../api/monitors';
import { getZones } from '../api/zones';
import { useCurrentProfile } from '../hooks/useCurrentProfile';
import { useAuthStore } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { Label } from '../components/ui/label';
import { ArrowLeft, Settings, Maximize2, Clock, AlertTriangle, Download, ChevronUp, ChevronDown, Layers } from 'lucide-react';
import { useState, useRef, useMemo } from 'react';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { downloadSnapshotFromElement } from '../lib/download';
import { useTranslation } from 'react-i18next';
import { useInsomnia } from '../hooks/useInsomnia';
import { PTZControls } from '../components/monitors/PTZControls';
import { VideoPlayer } from '../components/video/VideoPlayer';
import { ZoneOverlay } from '../components/video/ZoneOverlay';
import { log, LogLevel } from '../lib/logger';
import { parseMonitorRotation } from '../lib/monitor-rotation';

// Extracted hooks and components
import { usePTZControl, useAlarmControl, useModeControl, useMonitorNavigation } from './hooks';
import { MonitorSettingsDialog } from '../components/monitor-detail/MonitorSettingsDialog';
import { MonitorControlsCard } from '../components/monitor-detail/MonitorControlsCard';

export default function MonitorDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  // Local UI state
  const [isContinuous, setIsContinuous] = useState(true);
  const [showPTZ, setShowPTZ] = useState(true);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [showZones, setShowZones] = useState(false);
  const [scale, setScale] = useState(100);
  const mediaRef = useRef<HTMLImageElement | HTMLVideoElement>(null);

  // Navigation state
  const referrer = location.state?.from as string | undefined;

  // Profile and settings
  const { currentProfile, settings } = useCurrentProfile();
  const accessToken = useAuthStore((state) => state.accessToken);
  const updateSettings = useSettingsStore((state) => state.updateProfileSettings);

  // Keep screen awake when Insomnia is enabled
  useInsomnia({ enabled: settings.insomnia });

  // Fetch monitor data
  const { data: monitor, isLoading, error, refetch } = useQuery({
    queryKey: ['monitor', id],
    queryFn: () => getMonitor(id!),
    enabled: !!id,
  });

  // Fetch control capabilities if monitor is controllable
  const { data: controlData } = useQuery({
    queryKey: ['control', monitor?.Monitor.ControlId],
    queryFn: () => getControl(monitor!.Monitor.ControlId!),
    enabled: !!monitor?.Monitor.ControlId && monitor.Monitor.Controllable === '1',
  });

  // Fetch zones when showZones is enabled
  const { data: zones = [], isLoading: isZonesLoading } = useQuery({
    queryKey: ['zones', id],
    queryFn: () => getZones(id!),
    enabled: !!id && showZones,
  });

  // Custom hooks for extracted logic
  const { swipeNavigation, isSliding } = useMonitorNavigation({
    currentMonitorId: id,
    cycleSeconds: settings.monitorDetailCycleSeconds,
  });

  const { handlePTZCommand } = usePTZControl({
    portalUrl: currentProfile?.portalUrl || '',
    monitorId: monitor?.Monitor.Id || '',
    accessToken,
    isContinuous,
  });

  const {
    hasAlarmStatus,
    displayAlarmArmed,
    alarmStatusLabel,
    isAlarmLoading,
    isAlarmUpdating,
    alarmBorderClass,
    handleAlarmToggle,
  } = useAlarmControl({
    monitorId: monitor?.Monitor.Id,
  });

  const { isModeUpdating, handleModeChange } = useModeControl({
    monitorId: monitor?.Monitor.Id,
    currentFunction: monitor?.Monitor.Function,
    onSuccess: refetch,
  });

  // Computed values
  const rotationStatus = useMemo(() => {
    const rotation = parseMonitorRotation(monitor?.Monitor.Orientation);
    switch (rotation.kind) {
      case 'flip_horizontal':
        return t('monitor_detail.rotation_flip_horizontal');
      case 'flip_vertical':
        return t('monitor_detail.rotation_flip_vertical');
      case 'degrees':
        return t('monitor_detail.rotation_degrees', { degrees: rotation.degrees });
      case 'unknown':
        return t('common.unknown');
      case 'none':
      default:
        return t('monitor_detail.rotation_none');
    }
  }, [monitor?.Monitor.Orientation, t]);

  const orientedResolution = useMemo(() => {
    const width = Number(monitor?.Monitor.Width);
    const height = Number(monitor?.Monitor.Height);

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return `${monitor?.Monitor.Width ?? ''}${monitor?.Monitor.Width ? 'x' : ''}${monitor?.Monitor.Height ?? ''}`;
    }

    const rotation = parseMonitorRotation(monitor?.Monitor.Orientation);
    if (rotation.kind === 'degrees') {
      const normalized = ((rotation.degrees % 360) + 360) % 360;
      if (normalized === 90 || normalized === 270) {
        return `${height}x${width}`;
      }
    }

    return `${width}x${height}`;
  }, [monitor?.Monitor.Height, monitor?.Monitor.Orientation, monitor?.Monitor.Width]);

  // Settings handlers
  const handleFeedFitChange = (value: string) => {
    if (!currentProfile) return;
    updateSettings(currentProfile.id, {
      monitorDetailFeedFit: value as typeof settings.monitorDetailFeedFit,
    });
  };

  const handleCycleSecondsChange = (value: string) => {
    if (!currentProfile) return;
    const parsedValue = Number(value);
    updateSettings(currentProfile.id, {
      monitorDetailCycleSeconds: Number.isFinite(parsedValue) ? parsedValue : 0,
    });
  };

  // Log monitor status for debugging
  if (monitor?.Monitor) {
    log.monitorDetail('Monitor loaded in Single View', LogLevel.INFO, {
      id: monitor.Monitor.Id,
      name: monitor.Monitor.Name,
      controllable: monitor.Monitor.Controllable,
    });
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <div className="h-8 w-32 bg-muted rounded animate-pulse" />
        <div className="aspect-video w-full max-w-4xl bg-muted rounded-xl animate-pulse" />
      </div>
    );
  }

  // Error state
  if (error || !monitor || !currentProfile) {
    return (
      <div className="p-8">
        <div className="p-4 bg-destructive/10 text-destructive rounded-lg flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          {t('monitor_detail.load_error')}
        </div>
        <Button onClick={() => (referrer ? navigate(referrer) : navigate(-1))} className="mt-4">
          {t('common.go_back')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-2 sm:p-3 border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-2 sm:gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => (referrer ? navigate(referrer) : navigate(-1))}
            aria-label={t('common.go_back')}
            className="h-8 w-8"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-sm sm:text-base font-semibold">{monitor.Monitor.Name}</h1>
            <div className="flex items-center gap-1.5 text-[10px] sm:text-xs text-muted-foreground">
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  monitor.Monitor.Function !== 'None' ? 'bg-green-500' : 'bg-red-500'
                )}
              />
              <span className="hidden sm:inline">{monitor.Monitor.Function}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/events?monitorId=${monitor.Monitor.Id}`)}
            className="h-8 sm:h-9"
            title={t('monitor_detail.events')}
          >
            <Clock className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">{t('monitor_detail.events')}</span>
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground hidden md:inline">
              {t('monitor_detail.feed_fit')}
            </span>
            <Select value={settings.monitorDetailFeedFit} onValueChange={handleFeedFitChange}>
              <SelectTrigger className="h-8 sm:h-9 w-[170px]" data-testid="monitor-detail-fit-select">
                <SelectValue placeholder={t('monitor_detail.feed_fit')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="contain" data-testid="monitor-detail-fit-contain">
                  {t('monitor_detail.fit_contain')}
                </SelectItem>
                <SelectItem value="cover" data-testid="monitor-detail-fit-cover">
                  {t('monitor_detail.fit_cover')}
                </SelectItem>
                <SelectItem value="fill" data-testid="monitor-detail-fit-fill">
                  {t('monitor_detail.fit_fill')}
                </SelectItem>
                <SelectItem value="none" data-testid="monitor-detail-fit-none">
                  {t('monitor_detail.fit_none')}
                </SelectItem>
                <SelectItem value="scale-down" data-testid="monitor-detail-fit-scale-down">
                  {t('monitor_detail.fit_scale_down')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('monitor_detail.settings')}
            className="h-8 w-8 sm:h-9 sm:w-9"
            onClick={() => setShowSettingsDialog(true)}
            data-testid="monitor-detail-settings"
          >
            <Settings className="h-4 w-4 sm:h-5 sm:w-5" />
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-2 sm:p-3 md:p-4 flex flex-col items-center justify-center bg-muted/10">
        <Card
          {...swipeNavigation.bind()}
          className={cn(
            'relative w-full max-w-5xl aspect-video bg-black overflow-hidden shadow-2xl border-0 touch-pan-y transition-shadow',
            isSliding && 'monitor-slide-in',
            alarmBorderClass
          )}
        >
          <VideoPlayer
            monitor={monitor.Monitor}
            profile={currentProfile}
            externalMediaRef={mediaRef}
            objectFit={settings.monitorDetailFeedFit}
            showStatus={true}
            className="data-[testid=monitor-player]"
          />
          <ZoneOverlay
            zones={zones}
            monitorWidth={Number(monitor.Monitor.Width) || 1920}
            monitorHeight={Number(monitor.Monitor.Height) || 1080}
            rotation={parseMonitorRotation(monitor.Monitor.Orientation)}
            monitorId={monitor.Monitor.Id}
            visible={showZones && !isZonesLoading}
          />
        </Card>

        {/* Video Controls Bar */}
        <div className="w-full max-w-5xl mt-2 px-2 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                if (mediaRef.current) {
                  downloadSnapshotFromElement(mediaRef.current, monitor.Monitor.Name)
                    .then(() =>
                      toast.success(t('monitor_detail.snapshot_saved', { name: monitor.Monitor.Name }))
                    )
                    .catch(() => toast.error(t('monitor_detail.snapshot_failed')));
                }
              }}
              title={t('monitor_detail.save_snapshot')}
              aria-label={t('monitor_detail.save_snapshot')}
              data-testid="snapshot-button"
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => navigate(`/events?monitorId=${monitor.Monitor.Id}`)}
              title={t('monitor_detail.view_events')}
              aria-label={t('monitor_detail.view_events')}
            >
              <Clock className="h-4 w-4" />
            </Button>
            <Button
              variant={showZones ? 'secondary' : 'ghost'}
              size="icon"
              className="h-8 w-8"
              onClick={() => setShowZones(!showZones)}
              title={showZones ? t('monitor_detail.hide_zones') : t('monitor_detail.show_zones')}
              aria-label={showZones ? t('monitor_detail.hide_zones') : t('monitor_detail.show_zones')}
              data-testid="zone-toggle-button"
            >
              <Layers className={cn('h-4 w-4', isZonesLoading && 'animate-pulse')} />
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setScale(scale === settings.streamScale ? 150 : settings.streamScale)}
            >
              {scale}%
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t('monitor_detail.maximize')}>
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* PTZ Controls */}
        {monitor.Monitor.Controllable === '1' && (
          <div className="mt-8 w-full max-w-md flex flex-col items-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowPTZ(!showPTZ)}
              className="mb-4 text-muted-foreground hover:text-foreground"
            >
              {showPTZ ? t('ptz.hide_controls') : t('ptz.show_controls')}
              {showPTZ ? <ChevronUp className="ml-2 h-4 w-4" /> : <ChevronDown className="ml-2 h-4 w-4" />}
            </Button>

            {showPTZ && (
              <div className="w-full flex flex-col items-center gap-4">
                {controlData?.control.Control.CanMoveCon === '1' && (
                  <div className="flex items-center space-x-2">
                    <Switch id="continuous-mode" checked={isContinuous} onCheckedChange={setIsContinuous} />
                    <Label htmlFor="continuous-mode">{t('ptz.continuous_movement')}</Label>
                  </div>
                )}
                <PTZControls
                  onCommand={handlePTZCommand}
                  className="w-full"
                  control={controlData?.control.Control}
                />
              </div>
            )}
          </div>
        )}

        {/* Monitor Controls Card */}
        <div className="w-full max-w-5xl mt-8">
          <MonitorControlsCard
            hasAlarmStatus={hasAlarmStatus}
            displayAlarmArmed={displayAlarmArmed}
            alarmStatusLabel={alarmStatusLabel}
            isAlarmLoading={isAlarmLoading}
            isAlarmUpdating={isAlarmUpdating}
            onAlarmToggle={handleAlarmToggle}
            currentFunction={monitor.Monitor.Function}
            isModeUpdating={isModeUpdating}
            onModeChange={handleModeChange}
          />
        </div>
      </div>

      {/* Settings Dialog */}
      <MonitorSettingsDialog
        open={showSettingsDialog}
        onOpenChange={setShowSettingsDialog}
        monitor={monitor.Monitor}
        cycleSeconds={settings.monitorDetailCycleSeconds}
        onCycleSecondsChange={handleCycleSecondsChange}
        feedFit={settings.monitorDetailFeedFit}
        orientedResolution={orientedResolution}
        rotationStatus={rotationStatus}
      />
    </div>
  );
}
