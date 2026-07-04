/**
 * TimelineFiltersPanel
 *
 * Collapsible filter card for the Timeline page: date range, monitor
 * selection, cause filter, object detection toggle, and quick ranges.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Filter, ScanSearch, X, ChevronDown } from 'lucide-react';
import { QuickDateRangeButtons } from '../ui/quick-date-range-buttons';
import { MonitorFilterPopoverContent } from '../filters/MonitorFilterPopover';
import { CAUSE_ALL, TIMELINE_CAUSE_OPTIONS } from '../../lib/event/timeline-cause-filter';
import { formatLocalDateTime } from '../../lib/time';
import type { MonitorData } from '../../api/types';
import type { UseTimelineFiltersReturn } from '../../hooks/useTimelineFilters';

interface TimelineFiltersPanelProps {
  filters: UseTimelineFiltersReturn;
  /** Effective start date (filter input or default). */
  startDate: string;
  /** Effective end date (filter input or default). */
  endDate: string;
  monitors: MonitorData[];
}

export function TimelineFiltersPanel({ filters, startDate, endDate, monitors }: TimelineFiltersPanelProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const {
    selectedMonitorIds, onlyDetectedObjects, causeFilter, activeQuickRange,
    setSelectedMonitorIds, setStartDateInput, setEndDateInput, setOnlyDetectedObjects, setCauseFilter, setActiveQuickRange,
    clearFilters, activeFilterCount,
  } = filters;

  return (
    <Card>
      <button
        type="button"
        className="w-full flex items-center justify-between px-6 pt-4 pb-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        data-testid="timeline-filters-toggle"
      >
        <span className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5" />
          {t('events.filters')}
          {activeFilterCount > 0 && (
            <span className="text-[10px] bg-primary/15 text-primary rounded-full px-1.5 py-0.5">{activeFilterCount}</span>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
      </button>
      {!collapsed && <CardContent className="pt-2 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="startDate" className="text-xs">{t('timeline.start_date')}</Label>
            <Input
              id="startDate"
              type="datetime-local"
              value={startDate}
              onChange={(e) => { setStartDateInput(e.target.value); setActiveQuickRange(null); }}
              data-testid="timeline-start-date"
            />
          </div>
          <div>
            <Label htmlFor="endDate" className="text-xs">{t('timeline.end_date')}</Label>
            <Input
              id="endDate"
              type="datetime-local"
              value={endDate}
              onChange={(e) => { setEndDateInput(e.target.value); setActiveQuickRange(null); }}
              data-testid="timeline-end-date"
            />
          </div>
          <div>
            <Label className="text-xs">{t('timeline.monitors')}</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between" data-testid="timeline-monitor-filter">
                  {selectedMonitorIds.length === 0
                    ? t('timeline.all_monitors')
                    : t('timeline.monitors_selected', { count: selectedMonitorIds.length })}
                  <Filter className="h-4 w-4 ml-2" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[calc(100vw-2rem)] sm:w-80 max-w-sm">
                <MonitorFilterPopoverContent
                  monitors={monitors}
                  selectedMonitorIds={selectedMonitorIds}
                  onSelectionChange={setSelectedMonitorIds}
                  idPrefix="timeline"
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
        {/* Cause Filter */}
        <div className="flex items-center justify-between p-3 rounded-md border bg-card">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="timeline-cause-filter" className="cursor-pointer">
              {t('timeline.cause_filter')}
            </Label>
          </div>
          <Select
            value={causeFilter || CAUSE_ALL}
            onValueChange={(value) => setCauseFilter(value === CAUSE_ALL ? '' : value)}
          >
            <SelectTrigger id="timeline-cause-filter" className="h-8 w-[170px]" data-testid="timeline-cause-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMELINE_CAUSE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} data-testid={`timeline-cause-${opt.value}`}>
                  {t(opt.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* Object Detection Filter */}
        <div className="flex items-center justify-between p-3 rounded-md border bg-card">
          <div className="flex items-center gap-2">
            <ScanSearch className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="timeline-only-detected" className="cursor-pointer">
              {t('events.filter.onlyDetectedObjects')}
            </Label>
          </div>
          <Switch
            id="timeline-only-detected"
            checked={onlyDetectedObjects}
            onCheckedChange={setOnlyDetectedObjects}
            data-testid="timeline-detected-objects-toggle"
          />
        </div>

        {/* Quick Date Ranges + Clear */}
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <Label className="text-xs text-muted-foreground">{t('events.quick_ranges')}</Label>
            <QuickDateRangeButtons
              activeHours={activeQuickRange}
              onRangeSelect={({ start, end, hours }) => {
                setStartDateInput(formatLocalDateTime(start));
                setEndDateInput(formatLocalDateTime(end));
                setActiveQuickRange(hours);
              }}
            />
          </div>
          {activeFilterCount > 0 && (
            <Button variant="ghost" size="icon" onClick={() => { clearFilters(); setActiveQuickRange(null); }} className="text-muted-foreground h-7 w-7" title={t('common.clear')} data-testid="timeline-clear-filters">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>}
    </Card>
  );
}
