/**
 * Answer-quality eval cases: a question plus the tool result that answers it,
 * and what the prose must and must not say (refs #270).
 *
 * Lifted out of `scripts/prompt-eval.mts` so the HTTP harness and the on-device
 * runner score the SAME list, for the reason `contract-eval-cases.ts` and
 * `time-eval-cases.ts` were: a second copy drifts and then measures a bug the app
 * does not have.
 *
 * This is the stage that catches the worst class of failure the assistant has, and
 * the one neither system model had ever been scored on. The tool-contract eval asks
 * "did it fetch the right thing"; this asks "having fetched it, did it tell the
 * truth about it". Every check is a fault seen live: counts invented rather than
 * read, monitor names invented, the data denied while rows sat in the result, and
 * the raw tool JSON handed back as if it were an answer.
 */

export interface AnswerCase {
  q: string;
  /** The tool result the model is answering from, verbatim from a live transcript. */
  result: string;
  /** Every one must hold for the answer to score. */
  checks: { name: string; ok: (a: string) => boolean }[];
}

const lower = (s: string) => s.toLowerCase();
const deniesData = (a: string) => /\b(none|no events|nothing (was )?found|not found|no matches)\b/i.test(a);

// Verbatim from a live transcript.
export const TODAY_RESULT =
  '{"summary":"5 events between 2026-07-20 00:00:00 and 2026-07-20 09:31:51. By monitor: FrontDoor 2, Front Yard 2, Garage Outdoor 1. Detected: person 4, car 1.","window":{"from":"2026-07-20 00:00:00","to":"2026-07-20 09:31:51"},"matchCount":5,"countsByMonitor":{"FrontDoor":2,"Front Yard":2,"Garage Outdoor":1},"objectCounts":{"person":4,"car":1},"events":[{"id":"253363","monitor":"FrontDoor","start":"2026-07-20 08:36:33","durationSec":30.02,"objects":["person"]},{"id":"253362","monitor":"Front Yard","start":"2026-07-20 08:36:21","durationSec":30.06,"objects":["person"]},{"id":"253361","monitor":"Front Yard","start":"2026-07-20 08:35:45","durationSec":30.03,"objects":["person"]},{"id":"253360","monitor":"FrontDoor","start":"2026-07-20 08:35:19","durationSec":30,"objects":["person"]},{"id":"253359","monitor":"Garage Outdoor","start":"2026-07-20 08:20:59","durationSec":30,"objects":["car"]}]}';

// TODAY_RESULT with the busiestHour/countsByHour fields list_events now
// reports (refs #264), and one row moved out of the busy hour so the SHOW
// directive has a real subset to select: four rows in 08:00, one in 09:00.
export const BUSIEST_RESULT = TODAY_RESULT.replace(
  '"matchCount":5,',
  '"matchCount":5,"busiestHour":{"label":"2026-07-20 08:00:00","count":4},"countsByHour":{"2026-07-20 08:00:00":4,"2026-07-20 09:00:00":1},',
).replace('"start":"2026-07-20 08:20:59"', '"start":"2026-07-20 09:31:00"');

export const EMPTY_RESULT =
  '{"summary":"No events between 2026-07-20 00:00:00 and 2026-07-20 09:31:51.","window":{"from":"2026-07-20 00:00:00","to":"2026-07-20 09:31:51"},"matchCount":0,"countsByMonitor":{},"objectCounts":{},"events":[]}';

export const ANSWER_CASES: AnswerCase[] = [
  {
    q: 'summarize today',
    result: TODAY_RESULT,
    checks: [
      { name: 'total', ok: (a) => /\b5\b/.test(a) },
      { name: 'per-monitor', ok: (a) => /\b2\b/.test(a) && /\b1\b/.test(a) },
      { name: 'names-real', ok: (a) => !/EXAMPLE_|Backyard|Front Gate|Driveway/i.test(a) },
      { name: 'no-denial', ok: (a) => !deniesData(a) },
      { name: 'objects', ok: (a) => lower(a).includes('person') || lower(a).includes('people') },
      { name: 'not-json', ok: (a) => !a.trim().startsWith('{') },
    ],
  },
  {
    q: 'how many people came today',
    result: TODAY_RESULT,
    checks: [
      { name: 'person-count', ok: (a) => /\b4\b/.test(a) },
      { name: 'no-denial', ok: (a) => !deniesData(a) },
      { name: 'not-json', ok: (a) => !a.trim().startsWith('{') },
    ],
  },
  {
    q: 'what was my busiest hour today',
    result: BUSIEST_RESULT,
    checks: [
      // The hour itself, however phrased: card narrowing is id-driven (SHOW),
      // so exact label quoting stopped being load-bearing.
      { name: 'names-hour', ok: (a) => /8:00|08:00|8 ?am/i.test(a) },
      { name: 'count', ok: (a) => /\b4\b/.test(a) },
      { name: 'no-denial', ok: (a) => !deniesData(a) },
      { name: 'not-json', ok: (a) => !a.trim().startsWith('{') },
      // The SHOW directive (refs #264): the busy hour's ids selected, the
      // 09:00 stray excluded, so only the answer's cards render.
      { name: 'show-subset', ok: (a) => /SHOW: ?events=/.test(a) && a.includes('253363') && !/SHOW:[^\n]*253359/.test(a) },
    ],
  },
  {
    q: 'summarize today',
    result: EMPTY_RESULT,
    checks: [
      // The honest empty answer: it MUST say nothing was found.
      { name: 'says-empty', ok: (a) => deniesData(a) },
      { name: 'no-invented-rows', ok: (a) => !/FrontDoor|Garage|person|car\b/i.test(a) },
    ],
  },
];
