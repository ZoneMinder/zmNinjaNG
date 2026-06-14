/**
 * Hook for accessing date/time formatting functions with current user settings.
 */

import { useCallback } from 'react';
import { useCurrentProfile } from './useCurrentProfile';
import {
  formatAppDate,
  formatAppWeekday,
  formatAppTime,
  formatAppTimeShort,
  formatAppDateTime,
  formatAppDateTimeShort,
} from '../lib/format-date-time';

export function useDateTimeFormat() {
  const { settings } = useCurrentProfile();

  const fmtDate = useCallback(
    (date: Date) => formatAppDate(date, settings),
    [settings.dateFormat, settings.customDateFormat]
  );

  const fmtWeekday = useCallback((date: Date) => formatAppWeekday(date), []);

  const fmtTime = useCallback(
    (date: Date) => formatAppTime(date, settings),
    [settings.timeFormat, settings.customTimeFormat]
  );

  const fmtTimeShort = useCallback(
    (date: Date) => formatAppTimeShort(date, settings),
    [settings.timeFormat, settings.customTimeFormat]
  );

  const fmtDateTime = useCallback(
    (date: Date) => formatAppDateTime(date, settings),
    [settings.dateFormat, settings.timeFormat, settings.customDateFormat, settings.customTimeFormat]
  );

  const fmtDateTimeShort = useCallback(
    (date: Date) => formatAppDateTimeShort(date, settings),
    [settings.dateFormat, settings.timeFormat, settings.customDateFormat, settings.customTimeFormat]
  );

  const formatSettings = {
    dateFormat: settings.dateFormat,
    timeFormat: settings.timeFormat,
    customDateFormat: settings.customDateFormat,
    customTimeFormat: settings.customTimeFormat,
  };

  return { fmtDate, fmtWeekday, fmtTime, fmtTimeShort, fmtDateTime, fmtDateTimeShort, formatSettings };
}
