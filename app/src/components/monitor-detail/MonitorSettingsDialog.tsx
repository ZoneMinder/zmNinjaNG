/**
 * Monitor Settings Dialog
 *
 * Displays monitor information and cycle settings in a dialog.
 */

import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import type { Monitor } from '../../api/types';

interface MonitorSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  monitor: Monitor;
  cycleSeconds: number;
  onCycleSecondsChange: (value: string) => void;
  feedFit: string;
  orientedResolution: string;
  rotationStatus: string;
}

export function MonitorSettingsDialog({
  open,
  onOpenChange,
  monitor,
  cycleSeconds,
  onCycleSecondsChange,
  feedFit,
  orientedResolution,
  rotationStatus,
}: MonitorSettingsDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl w-[calc(100%-1.5rem)] max-h-[90vh] overflow-y-auto"
        data-testid="monitor-settings-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t('monitor_detail.settings_title')}</DialogTitle>
          <DialogDescription>{t('monitor_detail.settings_desc')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="border-muted/60 shadow-sm sm:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">{t('monitor_detail.cycle_title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="space-y-2" data-testid="monitor-detail-cycle-setting">
                <Label htmlFor="monitor-cycle-select" className="text-sm">
                  {t('monitor_detail.cycle_label')}
                </Label>
                <Select value={String(cycleSeconds)} onValueChange={onCycleSecondsChange}>
                  <SelectTrigger
                    id="monitor-cycle-select"
                    className="h-8"
                    data-testid="monitor-detail-cycle-select"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0" data-testid="monitor-detail-cycle-option-off">
                      {t('monitor_detail.cycle_off')}
                    </SelectItem>
                    <SelectItem value="5" data-testid="monitor-detail-cycle-option-5">
                      {t('monitor_detail.cycle_seconds', { seconds: 5 })}
                    </SelectItem>
                    <SelectItem value="10" data-testid="monitor-detail-cycle-option-10">
                      {t('monitor_detail.cycle_seconds', { seconds: 10 })}
                    </SelectItem>
                    <SelectItem value="15" data-testid="monitor-detail-cycle-option-15">
                      {t('monitor_detail.cycle_seconds', { seconds: 15 })}
                    </SelectItem>
                    <SelectItem value="30" data-testid="monitor-detail-cycle-option-30">
                      {t('monitor_detail.cycle_seconds', { seconds: 30 })}
                    </SelectItem>
                    <SelectItem value="60" data-testid="monitor-detail-cycle-option-60">
                      {t('monitor_detail.cycle_seconds', { seconds: 60 })}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t('monitor_detail.cycle_help')}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-muted/60 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">{t('monitor_detail.overview_title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('monitors.id')}</span>
                <span className="font-medium">{monitor.Id}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('monitors.type')}</span>
                <span className="font-medium">{monitor.Type}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('monitors.function')}</span>
                <span className="font-medium">{monitor.Function}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('common.enabled')}</span>
                <Badge variant={monitor.Enabled === '1' ? 'secondary' : 'outline'}>
                  {monitor.Enabled === '1' ? t('common.enabled') : t('common.disabled')}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('monitors.controllable')}</span>
                <Badge variant={monitor.Controllable === '1' ? 'secondary' : 'outline'}>
                  {monitor.Controllable === '1' ? t('common.yes') : t('common.no')}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="border-muted/60 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">{t('monitor_detail.video_title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('monitors.resolution')}</span>
                <span className="font-medium">{orientedResolution}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('monitors.colours')}</span>
                <span className="font-medium">{monitor.Colours}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('monitors.max_fps')}</span>
                <span className="font-medium">{monitor.MaxFPS || t('monitors.unlimited')}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('monitors.alarm_max_fps')}</span>
                <span className="font-medium">{monitor.AlarmMaxFPS || t('monitors.same_as_max_fps')}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-muted/60 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">{t('monitor_detail.rotation_label')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between" data-testid="monitor-rotation">
                <span className="text-muted-foreground">{t('monitor_detail.rotation_label')}</span>
                <span className="font-medium">{rotationStatus}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('monitor_detail.feed_fit')}</span>
                <span className="font-medium">
                  {t(`monitor_detail.fit_${feedFit.replace('-', '_')}`)}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
