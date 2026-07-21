/**
 * Writes the counts sentence for an event result, in code (refs #246).
 *
 * `matchCount` and `countsByMonitor` were already supplied as data, and the
 * prompt already said those numbers ARE the counts. A 3B model asked to
 * "summarize today" still walked the five rows and enumerated them one by one,
 * never quoting either field. Handing a model numbers and asking it to phrase
 * them is still asking it to derive something; handing it the finished sentence
 * is not.
 *
 * So the sentence is written here and put first in the result. The model's job
 * drops from "tally these rows and describe them" to "repeat this line and add
 * detail", which is the difference between arithmetic it does badly and copying
 * it does well.
 *
 * Every number in here comes from the rows the model is actually shown, so the
 * sentence can never describe more than the model can see.
 */

/** One event row as it appears in a `list_events` result. */
interface SummaryRow {
  monitor?: unknown;
  objects?: unknown;
}

/** `{"a":2,"b":1}` becomes `a 2, b 1`, highest first so the busiest monitor or
 *  the most common detection leads. Ties keep insertion order, which for rows
 *  sorted newest-first means the most recent leads. */
function describeCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([name, count]) => `${name} ${count}`)
    .join(', ');
}

/** Tallies the detected labels across the shown rows. A row can carry several
 *  (one event detecting both a person and a car counts once for each). */
export function countObjects(rows: readonly SummaryRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const objects = Array.isArray(row.objects) ? row.objects : [];
    for (const label of objects) {
      const name = String(label);
      counts[name] = (counts[name] ?? 0) + 1;
    }
  }
  return counts;
}

/** Exactly what `list_events` reports: a `{from,to}` pair when a time filter
 *  was applied, or the sentence it uses to say none was. Either is accepted so
 *  the summary can never describe a window the query did not use. */
export type ResultWindow = { from?: string | null; to?: string | null } | string | undefined;

/**
 * The finished sentence, for the model to quote rather than reconstruct.
 *
 * `partial` marks a result whose rows were capped, so the model says so instead
 * of presenting a truncated list as the whole picture.
 */
export function buildResultSummary(params: {
  window: ResultWindow;
  matchCount: number;
  countsByMonitor: Record<string, number>;
  objectCounts: Record<string, number>;
  partial: boolean;
  /** The hour with the most SHOWN rows, when the caller computed one:
   *  "busiest hour" is arithmetic over timestamps, which is exactly the kind
   *  of derivation the model gets wrong, so it is supplied as a finished
   *  clause instead (refs #264). */
  busiestHour?: { label: string; count: number };
}): string {
  const { window, matchCount, countsByMonitor, objectCounts, partial, busiestHour } = params;

  // A string window means no time filter was applied. Saying so is the point:
  // told only a count, the model named a period it had never queried.
  const range =
    typeof window === 'string'
      ? ` across ${window}`
      : window?.from && window?.to
        ? ` between ${window.from} and ${window.to}`
        : '';

  if (matchCount === 0) return `No events${range}.`;

  const parts: string[] = [`${matchCount} ${matchCount === 1 ? 'event' : 'events'}${range}.`];

  const byMonitor = describeCounts(countsByMonitor);
  if (byMonitor) parts.push(`By monitor: ${byMonitor}.`);

  const byObject = describeCounts(objectCounts);
  if (byObject) parts.push(`Detected: ${byObject}.`);

  if (busiestHour) {
    parts.push(`Busiest hour: ${busiestHour.label} (${busiestHour.count} ${busiestHour.count === 1 ? 'event' : 'events'}).`);
  }

  if (partial) {
    parts.push('This is a partial result: more events matched than are listed here.');
  }

  return parts.join(' ');
}
