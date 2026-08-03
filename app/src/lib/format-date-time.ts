/**
 * Shared date/time formatting utility.
 *
 * All user-facing date/time display should use these functions
 * to respect the user's chosen format from Settings.
 */

import { format as dateFnsFormat } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { log, LogLevel } from './logger';

// The presets are declared here rather than in stores/settings, so this module
// does not depend on the store that stores its output (refs #281).
export type DateFormatPreset = 'MMM d, yyyy' | 'MMM d' | 'dd/MM/yyyy' | 'dd/MM' | 'custom';
export type TimeFormatPreset = '12h' | '24h' | 'custom';

export interface FormatSettings {
  dateFormat: DateFormatPreset;
  timeFormat: TimeFormatPreset;
  customDateFormat: string;
  customTimeFormat: string;
}

/** Resolve the date-fns format string for dates */
function resolveDatePattern(s: FormatSettings): string {
  if (s.dateFormat === 'custom') return s.customDateFormat || 'MMM d';
  return s.dateFormat || 'MMM d';
}

/** Resolve the date-fns format string for times */
function resolveTimePattern(s: FormatSettings): string {
  if (s.timeFormat === 'custom') return s.customTimeFormat || 'h:mm a';
  return (s.timeFormat || '12h') === '12h' ? 'h:mm:ss a' : 'HH:mm:ss';
}

/** Resolve time pattern without seconds */
function resolveTimePatternShort(s: FormatSettings): string {
  if (s.timeFormat === 'custom') return s.customTimeFormat || 'h:mm a';
  return (s.timeFormat || '12h') === '12h' ? 'h:mm a' : 'HH:mm';
}

/**
 * date-fns' `format` always reads a Date's LOCAL (browser) getters. When a
 * caller passes `timeZone`, shift `date` first so those local getters read
 * as that zone's wall clock instead - the standard trick for formatting an
 * arbitrary IANA zone with date-fns's own (non -tz) `format`.
 *
 * Only apply this to a value that is a TRUE instant (e.g. `Date.now()` or
 * `eventInstant()`'s result). Event rows/detail already display the
 * server-local wall-clock string as-is (parsed and re-formatted with the
 * SAME - browser - getters on both ends, so the digits round-trip
 * unchanged); passing a timezone there would convert those digits a second
 * time and corrupt them. Omitting `timeZone` is a no-op - existing call
 * sites are byte-identical (refs #337).
 */
function applyTz(date: Date, timeZone: string | undefined): Date {
  return timeZone ? toZonedTime(date, timeZone) : date;
}

/** Format a date (no time) according to user settings */
export function formatAppDate(date: Date, settings: FormatSettings, timeZone?: string): string {
  try {
    return dateFnsFormat(applyTz(date, timeZone), resolveDatePattern(settings));
  } catch (error) {
    log.time('Format failed, using fallback', LogLevel.DEBUG, { error });
    return dateFnsFormat(date, 'MMM d');
  }
}

/**
 * Format a short weekday name (e.g. "Mon").
 *
 * Weekday has no user-facing format preset, so this routes through the same
 * date-fns layer as the other helpers to keep weekday labels consistent with
 * the rest of the app rather than diverging on locale. The pattern is fixed,
 * so no per-setting fallback is needed.
 */
export function formatAppWeekday(date: Date): string {
  return dateFnsFormat(date, 'EEE');
}

/** Format time only (with seconds) according to user settings */
export function formatAppTime(date: Date, settings: FormatSettings, timeZone?: string): string {
  try {
    return dateFnsFormat(applyTz(date, timeZone), resolveTimePattern(settings));
  } catch (error) {
    log.time('Format failed, using fallback', LogLevel.DEBUG, { error });
    return dateFnsFormat(date, 'HH:mm:ss');
  }
}

/** Format time only (without seconds) according to user settings */
export function formatAppTimeShort(date: Date, settings: FormatSettings, timeZone?: string): string {
  try {
    return dateFnsFormat(applyTz(date, timeZone), resolveTimePatternShort(settings));
  } catch (error) {
    log.time('Format failed, using fallback', LogLevel.DEBUG, { error });
    return dateFnsFormat(date, 'HH:mm');
  }
}

/** Format date + time according to user settings */
export function formatAppDateTime(date: Date, settings: FormatSettings, timeZone?: string): string {
  try {
    const d = resolveDatePattern(settings);
    const t = resolveTimePattern(settings);
    return dateFnsFormat(applyTz(date, timeZone), `${d}, ${t}`);
  } catch (error) {
    log.time('Format failed, using fallback', LogLevel.DEBUG, { error });
    return dateFnsFormat(date, 'MMM d, HH:mm:ss');
  }
}

/** Format date + time (short, no seconds) according to user settings */
export function formatAppDateTimeShort(date: Date, settings: FormatSettings, timeZone?: string): string {
  try {
    const d = resolveDatePattern(settings);
    const t = resolveTimePatternShort(settings);
    return dateFnsFormat(applyTz(date, timeZone), `${d}, ${t}`);
  } catch (error) {
    log.time('Format failed, using fallback', LogLevel.DEBUG, { error });
    return dateFnsFormat(date, 'MMM d, HH:mm');
  }
}

/**
 * How long something has been running, as a stopwatch reading: `0:42`,
 * `4:07`, `1:02:33`.
 *
 * Digits and colons only, so it needs no translation and stays narrow enough
 * for a 320px live tile, which is what rules out date-fns' `formatDuration`
 * ("about 4 minutes"). The hours field appears only once there are hours, so
 * the common case is three characters wide.
 */
export function formatElapsedShort(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const paddedSeconds = String(seconds).padStart(2, '0');
  if (hours === 0) return `${minutes}:${paddedSeconds}`;
  return `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`;
}

/**
 * Validate a custom format string.
 * Returns the formatted preview string, or null if invalid.
 */
export function validateFormatString(pattern: string | undefined | null): string | null {
  if (!pattern || !pattern.trim()) return null;
  try {
    return dateFnsFormat(new Date(), pattern);
  } catch (error) {
    log.time('Format validation failed', LogLevel.DEBUG, { pattern, error });
    return null;
  }
}
