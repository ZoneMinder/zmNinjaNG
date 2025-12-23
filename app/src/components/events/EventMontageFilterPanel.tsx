/**
 * Event Montage Filter Panel
 *
 * Collapsible filter panel for event montage views with monitor selection,
 * cause filtering, and date range selection.
 */

import { useState } from 'react';
import { Filter, ChevronDown, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Checkbox } from '../ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { QuickDateRangeButtons } from '../ui/quick-date-range-buttons';
import { formatLocalDateTime } from '../../lib/time';
import type { Monitor } from '../../api/types';

interface EventMontageFilterPanelProps {
  monitors: Array<{ Monitor: Monitor }>;
  selectedMonitorIds: string[];
  selectedCause: string;
  startDate: string;
  endDate: string;
  uniqueCauses: string[];
  onMonitorToggle: (monitorId: string) => void;
  onSelectAllMonitors: () => void;
  onCauseChange: (cause: string) => void;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  onClearFilters: () => void;
  hasActiveFilters: boolean;
}

export const EventMontageFilterPanel = ({
  monitors,
  selectedMonitorIds,
  selectedCause,
  startDate,
  endDate,
  uniqueCauses,
  onMonitorToggle,
  onSelectAllMonitors,
  onCauseChange,
  onStartDateChange,
  onEndDateChange,
  onClearFilters,
  hasActiveFilters,
}: EventMontageFilterPanelProps) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4" />
            <span className="font-medium">{t('eventMontage.filters')}</span>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={onClearFilters} className="h-6 px-2">
                <X className="h-3 w-3 mr-1" />
                {t('eventMontage.clear_all')}
              </Button>
            )}
          </div>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ChevronDown
                className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
              />
            </Button>
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent>
          <div className="mt-4 space-y-4">
            {/* Monitor Selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">{t('eventMontage.monitors')}</Label>
                <Button variant="link" size="sm" onClick={onSelectAllMonitors} className="h-auto p-0">
                  {selectedMonitorIds.length === monitors.length
                    ? t('eventMontage.deselect_all')
                    : t('eventMontage.select_all')}
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                {monitors.map((m) => (
                  <div key={m.Monitor.Id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`monitor-${m.Monitor.Id}`}
                      checked={selectedMonitorIds.includes(m.Monitor.Id)}
                      onCheckedChange={() => onMonitorToggle(m.Monitor.Id)}
                    />
                    <label
                      htmlFor={`monitor-${m.Monitor.Id}`}
                      className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      {m.Monitor.Name}
                    </label>
                  </div>
                ))}
              </div>
            </div>

            {/* Cause Filter */}
            {uniqueCauses.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="cause-filter" className="text-sm">
                  {t('eventMontage.cause')}
                </Label>
                <Select value={selectedCause} onValueChange={onCauseChange}>
                  <SelectTrigger id="cause-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('eventMontage.all_causes')}</SelectItem>
                    {uniqueCauses.map((cause) => (
                      <SelectItem key={cause} value={cause}>
                        {cause}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Date Range */}
            <div className="space-y-2">
              <Label className="text-sm">{t('eventMontage.date_range')}</Label>
              <div className="grid grid-cols-1 gap-2">
                <div>
                  <Label htmlFor="start-date" className="text-xs text-muted-foreground">
                    {t('eventMontage.start_date')}
                  </Label>
                  <Input
                    id="start-date"
                    type="datetime-local"
                    value={startDate}
                    onChange={(e) => onStartDateChange(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="end-date" className="text-xs text-muted-foreground">
                    {t('eventMontage.end_date')}
                  </Label>
                  <Input
                    id="end-date"
                    type="datetime-local"
                    value={endDate}
                    onChange={(e) => onEndDateChange(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Quick Date Ranges */}
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">{t('events.quick_ranges')}</Label>
              <QuickDateRangeButtons
                onRangeSelect={({ start, end }) => {
                  onStartDateChange(formatLocalDateTime(start));
                  onEndDateChange(formatLocalDateTime(end));
                }}
              />
            </div>
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};
