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
import { ASSISTANT } from '../zmninja-ng-constants';
import { log, LogLevel } from '../logger';

export interface MonitorRosterEntry {
  id: string;
  name: string;
}

/** What the question's place reference resolved to: a SET of real monitors
 *  ("front of my house" means several cameras, refs #432), a place no
 *  monitor covers, or no place named at all. */
export type MonitorMentionResolution =
  | { kind: 'resolved'; monitors: MonitorRosterEntry[] }
  | { kind: 'no_match' }
  | { kind: 'none' };

/** The camera slots one triage parse produced (a structural slice of
 *  triage.ts's TriageVerdict, restated here so the module graph stays
 *  acyclic: triage cannot be imported without importing what it imports). */
export interface ParsedMonitorSlots {
  monitors?: readonly string[];
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
  if (scanHits.length > 0) return { kind: 'resolved', monitors: scanHits };
  const named = (slots.monitors ?? [])
    .map((name) => roster.find((entry) => entry.name === name))
    .filter((entry): entry is MonitorRosterEntry => entry !== undefined);
  if (named.length > 0) return { kind: 'resolved', monitors: named };
  if (slots.noMatch) return { kind: 'no_match' };
  return { kind: 'none' };
}

/** The one system line handed to the answering model, mirroring
 *  buildTimeframeSystemLine, or '' when the question named no place.
 *  Model-facing (rule 5 exempt). */
export function buildMonitorSystemLine(resolution: MonitorMentionResolution): string {
  if (resolution.kind === 'resolved') {
    const listed = resolution.monitors.map((m) => `"${m.name}" (monitorId "${m.id}")`).join(', ');
    const these = resolution.monitors.length === 1 ? 'this monitor' : 'these monitors';
    return (
      `Monitors for this question, already resolved: ${listed}. ` +
      `The place the question asks about is ${these}; pass the monitorId to event tools and attribute events to ${these} by name.`
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
