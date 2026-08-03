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

/**
 * @param timeZone Optional IANA zone to render true-instant Dates in (e.g. an
 * All-mode owning profile's timezone), instead of the viewer's browser zone.
 * Omit for existing call sites - see the `applyTz` doc comment in
 * lib/format-date-time.ts for when passing this is (and isn't) correct.
 */
export function useDateTimeFormat(timeZone?: string) {
  const { settings } = useCurrentProfile();

  const fmtDate = useCallback(
    (date: Date) => formatAppDate(date, settings, timeZone),
    [settings.dateFormat, settings.customDateFormat, timeZone]
  );

  const fmtWeekday = useCallback((date: Date) => formatAppWeekday(date), []);

  const fmtTime = useCallback(
    (date: Date) => formatAppTime(date, settings, timeZone),
    [settings.timeFormat, settings.customTimeFormat, timeZone]
  );

  const fmtTimeShort = useCallback(
    (date: Date) => formatAppTimeShort(date, settings, timeZone),
    [settings.timeFormat, settings.customTimeFormat, timeZone]
  );

  const fmtDateTime = useCallback(
    (date: Date) => formatAppDateTime(date, settings, timeZone),
    [settings.dateFormat, settings.timeFormat, settings.customDateFormat, settings.customTimeFormat, timeZone]
  );

  const fmtDateTimeShort = useCallback(
    (date: Date) => formatAppDateTimeShort(date, settings, timeZone),
    [settings.dateFormat, settings.timeFormat, settings.customDateFormat, settings.customTimeFormat, timeZone]
  );

  const formatSettings = {
    dateFormat: settings.dateFormat,
    timeFormat: settings.timeFormat,
    customDateFormat: settings.customDateFormat,
    customTimeFormat: settings.customTimeFormat,
  };

  return { fmtDate, fmtWeekday, fmtTime, fmtTimeShort, fmtDateTime, fmtDateTimeShort, formatSettings };
}
