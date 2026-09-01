/**
 * Resolves the camera a question refers to BEFORE the tool round runs
 * (refs #427).
 *
 * Observed live: "how many people came to my front door yesterday" queried
 * every monitor, got 3 person events on "Garage Outdoor", and answered "3
 * people came to your front door". No front-door monitor exists; the location
 * claim was copied from the user's words, and a prompt rule alone cannot stop
 * a small model doing that (see llm-models.md: prompt-only guardrails).
 *
 * Division of labor mirrors the timeframe stage: a deterministic scan owns
 * every mention code can decide (a monitor named verbatim, however the case
 * and spacing are mangled); the triage round decides only what code cannot,
 * which camera a PLACE word means ("front door" -> "Doorbell", in any
 * language), constrained to the real names plus NONE / NO_MATCH so nothing
 * can be hallucinated (see buildTriageSchema). The outcome becomes one system
 * line, exactly like the resolved-timeframes line.
 */
import { getMonitors } from '../../api/monitors';
import { getSession } from '../../services/sessions';
import { asProfileId } from '../../api/types';
import { normalizeMonitorName } from './monitor-ref';
import { scanTimeExpressions } from './timeframe-stage';
import { sanitizeModelText } from './sanitize';
import { isAbortError } from '../is-abort-error';
import type { AssistantProvider, TraceEntry } from './types';
import { buildContextualQuestion, type ParseContext } from './triage';
import { ASSISTANT } from '../zmninja-ng-constants';
import { log, LogLevel } from '../logger';

export interface MonitorRosterEntry {
  id: string;
  name: string;
}

/** One resolved place group: its label (the question's own words) and the
 *  monitors that watch it. "front vs back" is two groups (refs #446). */
export interface MonitorGroup {
  label: string;
  monitors: MonitorRosterEntry[];
}

/** What the question's place references resolved to: place GROUPS (one for
 *  most questions, several for a place comparison, refs #446), a place no
 *  monitor covers, or no place named at all. */
export type MonitorMentionResolution =
  | { kind: 'resolved'; groups: MonitorGroup[] }
  | { kind: 'no_match' }
  | { kind: 'none' };

/** The camera slots one coverage call produced. */
export interface ParsedMonitorSlots {
  groups?: Array<{ label: string; monitors: readonly string[] }>;
  noMatch?: boolean;
}

interface CachedRoster {
  roster: MonitorRosterEntry[];
  at: number;
}

/** Per profile, like the object-label cache: two installs reached from one app
 *  must not share a camera list. */
const cache = new Map<string, CachedRoster>();

export function __clearMonitorRosterCacheForTests(): void {
  cache.clear();
}

/**
 * The profile's monitor names and ids, cached per profile.
 *
 * Never throws: a failed request (or an aggregate profile id, which has no
 * session) yields an empty roster and the stage simply does not run, which is
 * exactly the pre-#427 behavior.
 */
export async function getMonitorRoster(profileId: string): Promise<MonitorRosterEntry[]> {
  const hit = cache.get(profileId);
  if (hit && Date.now() - hit.at < ASSISTANT.monitorRosterCacheMs) return hit.roster;

  try {
    const { monitors } = await getMonitors(getSession(asProfileId(profileId)).client, asProfileId(profileId));
    const roster = monitors.map((m) => ({ id: m.Monitor.Id, name: m.Monitor.Name }));
    cache.set(profileId, { roster, at: Date.now() });
    return roster;
  } catch (error) {
    log.assistant('Could not read the monitor roster', LogLevel.WARN, {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/** A name or question as lowercase word tokens: camelCase seams split
 *  ("FrontDoor" -> front, door) and anything non-alphanumeric separates.
 *  Token EQUALITY is the match unit, so "doorbell" never matches "door". */
function wordTokens(value: string): string[] {
  return value
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 0);
}

/**
 * Every monitor whose name appears in the question, in roster order.
 *
 * Two deterministic passes, either one a hit (refs #430):
 * - The whole name as a contiguous substring, on the same normalized key
 *   `resolveMonitorRef` uses for model-supplied names, so "FRONTDOOR" and
 *   "front-door" both find "Front Door". A name that normalizes to '' never
 *   matches: the empty string is a substring of everything.
 * - Every token of the name present among the question's tokens, so "front
 *   of my door" still finds "FrontDoor" with words intervening. All tokens,
 *   not some: "front of my door" must not match "Front Yard".
 */
export function scanMonitorMentions(question: string, roster: MonitorRosterEntry[]): MonitorRosterEntry[] {
  const haystack = normalizeMonitorName(question);
  const questionTokens = new Set(wordTokens(question));
  return roster.filter((entry) => {
    const needle = normalizeMonitorName(entry.name);
    if (needle.length > 0 && haystack.includes(needle)) return true;
    const tokens = wordTokens(entry.name);
    return tokens.length > 0 && tokens.every((token) => questionTokens.has(token));
  });
}

/**
 * The stage's verdict: the deterministic scan wins whenever it found
 * anything; otherwise the parse's roster-validated names decide, then its
 * noMatch flag; anything else resolves to none and injects nothing.
 */
export function resolveMonitorMention(
  scanHits: MonitorRosterEntry[],
  slots: ParsedMonitorSlots,
  roster: MonitorRosterEntry[],
): MonitorMentionResolution {
  if (scanHits.length > 0) {
    // Verbatim names are one group each: the user named those cameras.
    return { kind: 'resolved', groups: scanHits.map((entry) => ({ label: entry.name, monitors: [entry] })) };
  }
  const groups: MonitorGroup[] = [];
  for (const group of slots.groups ?? []) {
    const named = group.monitors
      .map((name) => roster.find((entry) => entry.name === name))
      .filter((entry): entry is MonitorRosterEntry => entry !== undefined);
    if (named.length > 0) groups.push({ label: group.label, monitors: named });
  }
  if (groups.length > 0) return { kind: 'resolved', groups };
  if (slots.noMatch) return { kind: 'no_match' };
  return { kind: 'none' };
}

/** The one system line handed to the answering model, mirroring
 *  buildTimeframeSystemLine, or '' when the question named no place.
 *  Model-facing (rule 5 exempt). */
export function buildMonitorSystemLine(resolution: MonitorMentionResolution): string {
  if (resolution.kind === 'resolved') {
    const listed = resolution.groups
      .map((group) => `${group.label} = ${group.monitors.map((m) => `"${m.name}" (monitorId "${m.id}")`).join(', ')}`)
      .join('; ');
    return (
      `Monitors for this question, already resolved: ${listed}. ` +
      'Attribute events to these monitors by name, under the place each belongs to.'
    );
  }
  if (resolution.kind === 'no_match') {
    return (
      'No monitor in this system matches the place this question names. Say plainly that no camera covers ' +
      'that place. If you still report events, attribute them to the monitor names in the tool result, ' +
      'never to the place the user named.'
    );
  }
  return '';
}

/** Model-facing (rule 5 exempt): the DEDICATED coverage interrogation
 *  (refs #438). Judged inside the consolidated parse prompt, place coverage
 *  failed live twice and every rewording rotated the failures; this focused
 *  prompt, same model, measures 8/8 across all of them. One question per
 *  judgment. */
export function buildCoveragePrompt(names: readonly string[]): string {
  return [
    'You match the places in one message to the security cameras of a home. Reply with ONLY one JSON object.',
    `Cameras: ${names.join(', ')}.`,
    'The message may include an earlier exchange for context: a place can come from it ("what about the garage?" after a garage answer).',
    '"groups": one object per DISTINCT place the message asks about, in ANY language ("Haust\u00fcr" and "jardin" name places too); [] only when it truly names none (time words such as today or yesterday are not places). A message comparing two places ("the front vs the back") is two groups. Each group:',
    '"place": that place\'s exact words from the message, copied.',
    '"covered": true when a listed camera means that place, in any language, or the place is an area containing a camera\'s own area; false when no listed camera truly watches it: a camera elsewhere on the property is false, never the closest one.',
    '"monitors": every listed camera that watches the place or sits inside it ([] when "covered" is false).',
  ].join('\n');
}

/** The coverage reply as a schema: monitors constrained to the real names,
 *  so nothing can be hallucinated. */
export function buildCoverageSchema(names: readonly string[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      groups: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            place: { type: 'string' },
            covered: { type: 'boolean' },
            monitors: { type: 'array', items: { type: 'string', enum: [...names] } },
          },
          required: ['place', 'covered', 'monitors'],
          additionalProperties: false,
        },
      },
    },
    required: ['groups'],
    additionalProperties: false,
  };
}

/** The place groups out of one coverage reply, every guard in code and per
 *  group (refs #430, #432, #446): names filtered to the roster; a
 *  contradiction (covered false with real names) and a whole-roster
 *  selection both drop that group; a place that is only time words is no
 *  place. noMatch only when nothing resolved and some group named an
 *  uncovered real place. */
export function deriveMonitorGroups(
  raw: { groups?: unknown },
  names: readonly string[],
): ParsedMonitorSlots {
  if (!Array.isArray(raw.groups)) return {};
  const groups: Array<{ label: string; monitors: string[] }> = [];
  let sawUncoveredPlace = false;
  for (const item of raw.groups) {
    if (item === null || typeof item !== 'object') continue;
    const g = item as { place?: unknown; covered?: unknown; monitors?: unknown };
    const named = Array.isArray(g.monitors)
      ? g.monitors.filter((m): m is string => typeof m === 'string' && names.includes(m))
      : [];
    if (g.covered === true && named.length > 0 && named.length < names.length) {
      const label = typeof g.place === 'string' && g.place.trim().length > 0 ? g.place.trim() : `place ${groups.length + 1}`;
      groups.push({ label, monitors: named });
      continue;
    }
    if (g.covered === false && named.length === 0) {
      const place = typeof g.place === 'string' ? g.place : '';
      const rest = scanTimeExpressions(place).reduce((text, phrase) => text.replace(phrase, ' '), place);
      if (/[\p{L}\p{N}]/u.test(rest)) sawUncoveredPlace = true;
    }
  }
  if (groups.length > 0) return { groups };
  return sawUncoveredPlace ? { noMatch: true } : { groups: [] };
}

/**
 * One focused model call resolving which cameras the question's place means
 * (refs #438). Runs only when the deterministic scan found nothing; a failed
 * call degrades to empty slots, which is exactly the pre-coverage behavior.
 */
export async function resolveCoverage(
  question: string,
  roster: MonitorRosterEntry[],
  provider: AssistantProvider,
  signal: AbortSignal,
  onTrace?: (entry: TraceEntry) => void,
  /** The previous exchange, so a follow-up's place resolves (refs #440). */
  context?: ParseContext,
): Promise<ParsedMonitorSlots> {
  if (roster.length === 0) return {};
  const names = roster.map((entry) => entry.name);
  try {
    const result = await provider.complete(buildCoveragePrompt(names), buildContextualQuestion(question, context), signal, buildCoverageSchema(names));
    if (result.exchange) {
      onTrace?.({ kind: 'exchange', exchange: { ...result.exchange, backend: `${result.exchange.backend} (coverage)` } });
    }
    return deriveMonitorGroups(JSON.parse(sanitizeModelText(result.text, 'coverage')) as Record<string, unknown>, names);
  } catch (error) {
    if (isAbortError(error)) throw error;
    log.assistant('Coverage call failed; running unpinned', LogLevel.WARN, {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

/**
 * What the time call may inherit (refs #446): the follow-up context, except
 * when coverage resolved a PLACE COMPARISON (two or more groups). Measured
 * 2/2: handed the previous turn's period, the windows call splits a spatial
 * comparison across time ("front today" vs "back last week"); a multi-group
 * question compares places, so its period must come from the message alone.
 * Deterministic bookkeeping over the model's own coverage output.
 */
export function contextForTimeCall<T>(followUp: T | undefined, resolution: MonitorMentionResolution): T | undefined {
  if (resolution.kind === 'resolved' && resolution.groups.length >= 2) return undefined;
  return followUp;
}
