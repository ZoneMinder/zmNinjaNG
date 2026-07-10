/**
 * Watermark date arithmetic for the monitor "new events since last visit" badge.
 *
 * See stores/monitorSeen.ts for what a watermark is and why it is never a
 * local Date.now(). This module only does the date math needed to turn a
 * watermark into a list-page date filter (refs #239).
 */

const ZM_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

/**
 * ZM stores second granularity. The events list filters with `>=` while the
 * badge counts with `>`, so the list's lower bound is the watermark plus one
 * second. Input and output are ZM `YYYY-MM-DD HH:mm:ss` local-time strings.
 */
export function nextSecondAfter(zmDateTime: string): string {
  const match = ZM_DATETIME_RE.exec(zmDateTime);
  if (!match) return zmDateTime;

  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  if (isNaN(date.getTime())) return zmDateTime;

  date.setSeconds(date.getSeconds() + 1);

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
