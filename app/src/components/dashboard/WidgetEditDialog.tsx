/**
 * Widget Edit Dialog Component
 *
 * Provides a dialog for editing existing dashboard widgets.
 * Features:
 * - Edit widget title
 * - Change monitor selection for monitor widgets
 * - Update widget settings
 * - Form validation
 */

import { useState, useEffect, useMemo } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '../ui/dialog';
import { Button } from '../ui/button';
import type { DashboardWidget } from '../../stores/dashboard';
import { useDashboardStore } from '../../stores/dashboard';
import { useQuery } from '@tanstack/react-query';
import { getMonitors } from '../../api/monitors';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Checkbox } from '../ui/checkbox';
import { ScrollArea } from '../ui/scroll-area';
import { useTranslation } from 'react-i18next';
import { filterEnabledMonitors } from '../../lib/filters';

interface WidgetEditDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    widget: DashboardWidget;
    profileId: string;
}

export function WidgetEditDialog({ open, onOpenChange, widget, profileId }: WidgetEditDialogProps) {
    const { t } = useTranslation();
    const [title, setTitle] = useState(widget.title);
    const [selectedMonitors, setSelectedMonitors] = useState<string[]>(
        widget.settings.monitorIds || (widget.settings.monitorId ? [widget.settings.monitorId] : [])
    );
    const updateWidget = useDashboardStore((state) => state.updateWidget);

    const { data: monitors } = useQuery({
        queryKey: ['monitors'],
        queryFn: getMonitors,
    });

    // Filter out deleted monitors
    const enabledMonitors = useMemo(() => {
        return monitors?.monitors ? filterEnabledMonitors(monitors.monitors) : [];
    }, [monitors?.monitors]);

    // Reset form when widget changes
    useEffect(() => {
        setTitle(widget.title);
        setSelectedMonitors(
            widget.settings.monitorIds || (widget.settings.monitorId ? [widget.settings.monitorId] : [])
        );
    }, [widget]);

    /**
     * Toggle monitor selection
     */
    const toggleMonitor = (monitorId: string) => {
        if (widget.type === 'events') {
            // Events widget only supports single monitor
            setSelectedMonitors([monitorId]);
        } else {
            // Monitor widget supports multiple monitors
            setSelectedMonitors((prev) =>
                prev.includes(monitorId)
                    ? prev.filter((id) => id !== monitorId)
                    : [...prev, monitorId]
            );
        }
    };

    /**
     * Handle saving widget updates
     */
    const handleSave = () => {
        const updatedSettings = { ...widget.settings };

        if (widget.type === 'monitor') {
            updatedSettings.monitorIds = selectedMonitors;
        } else if (widget.type === 'events') {
            updatedSettings.monitorId = selectedMonitors[0] || undefined;
        }

        updateWidget(profileId, widget.id, {
            title,
            settings: updatedSettings,
        });

        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md" data-testid="widget-edit-dialog">
                <DialogHeader>
                    <DialogTitle>{t('dashboard.edit_layout')}</DialogTitle>
                    <DialogDescription className="sr-only">
                        Edit dashboard widget settings.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* Widget Title */}
                    <div className="space-y-2">
                        <Label htmlFor="widget-title">{t('dashboard.widget_title')}</Label>
                        <Input
                            id="widget-title"
                            placeholder={t('dashboard.widget_title_placeholder')}
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            data-testid="widget-edit-title-input"
                        />
                    </div>

                    {/* Monitor Selection (for monitor and events widgets) */}
                    {(widget.type === 'monitor' || widget.type === 'events') && (
                        <div className="space-y-2">
                            <Label>
                                {widget.type === 'monitor'
                                    ? t('dashboard.select_monitors')
                                    : t('dashboard.select_monitor')}
                            </Label>
                            <ScrollArea className="h-48 border rounded-md p-4" data-testid="widget-edit-monitor-list">
                                {enabledMonitors.map((monitor) => (
                                    <div key={monitor.Monitor.Id} className="flex items-center space-x-2 mb-2">
                                        <Checkbox
                                            id={`monitor-${monitor.Monitor.Id}`}
                                            checked={selectedMonitors.includes(monitor.Monitor.Id)}
                                            onCheckedChange={() => toggleMonitor(monitor.Monitor.Id)}
                                            data-testid={`widget-edit-monitor-checkbox-${monitor.Monitor.Id}`}
                                        />
                                        <label
                                            htmlFor={`monitor-${monitor.Monitor.Id}`}
                                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                                        >
                                            {monitor.Monitor.Name}
                                        </label>
                                    </div>
                                ))}
                            </ScrollArea>
                            {widget.type === 'monitor' && selectedMonitors.length === 0 && (
                                <p className="text-xs text-muted-foreground text-red-500">
                                    {t('dashboard.monitor_required')}
                                </p>
                            )}
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="widget-edit-cancel-button">
                        {t('dashboard.cancel')}
                    </Button>
                    <Button
                        onClick={handleSave}
                        disabled={
                            (widget.type === 'monitor' && selectedMonitors.length === 0)
                        }
                        data-testid="widget-edit-save-button"
                    >
                        {t('common.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
