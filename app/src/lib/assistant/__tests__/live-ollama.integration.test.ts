// @vitest-environment node
/**
 * Live integration check for the real agent loop against a real Ollama server
 * (refs #259). Skipped unless LIVE_OLLAMA is set: CI has no model server, and
 * unit tests already cover every path with the mock provider. Run manually
 * when touching prompting, providers, or the loop:
 *
 *   LIVE_OLLAMA=http://192.168.50.11:11434/v1 LIVE_OLLAMA_MODEL=llama3.2:latest npx vitest run src/lib/assistant/__tests__/live-ollama.integration.test.ts
 *
 * Tool executors are stubbed with fixture data (the live server is an LLM
 * host, not a ZoneMinder), so this exercises: triage -> system prompt ->
 * native tool calling -> loop gates -> answer grounding, end to end.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Platform } from '../../platform';
import { runAssistantTurn } from '../agent';
import { TOOLS } from '../tools';
import { buildSystemPrompt } from '../system-prompt';
import { classifyRequest } from '../triage';
import { OpenAiProvider } from '../providers/openai';
import type { AssistantHost, AssistantMessage, ToolDefinition } from '../types';
import { asProfileId } from '../../../api/types';

const BASE = process.env.LIVE_OLLAMA;
const MODEL = process.env.LIVE_OLLAMA_MODEL ?? 'llama3.2:latest';

const FIXTURE_EVENTS = JSON.stringify({
  summary: '3 events between 2026-07-20 00:00:00 and 2026-07-20 12:00:00. By monitor: Front Door 2, Garage 1. Detected: person 2, car 1.',
  window: { from: '2026-07-20 00:00:00', to: '2026-07-20 12:00:00' },
  matchCount: 3,
  countsByMonitor: { 'Front Door': 2, Garage: 1 },
  objectCounts: { person: 2, car: 1 },
  events: [
    { id: '101', monitor: 'Front Door', start: '2026-07-20 08:00:00', durationSec: 30, objects: ['person'] },
    { id: '102', monitor: 'Front Door', start: '2026-07-20 09:10:00', durationSec: 25, objects: ['person'] },
    { id: '103', monitor: 'Garage', start: '2026-07-20 10:30:00', durationSec: 40, objects: ['car'] },
  ],
});

/** The real tool definitions (names, descriptions, schemas all live), with
 *  execution stubbed to fixtures. */
function fixtureTools(): ToolDefinition[] {
  return TOOLS.map((tool) => ({
    ...tool,
    execute: async () => ({ output: tool.name === 'list_events' ? FIXTURE_EVENTS : '{"note":"fixture"}' }),
  }));
}

/** LIVE_OLLAMA_DEBUG=1 prints each loop step, for diagnosing a live failure. */
const host: AssistantHost = {
  navigate: () => {},
  onActivity: (activity) => {
    if (process.env.LIVE_OLLAMA_DEBUG) {
      process.stderr.write(`ACTIVITY ${JSON.stringify(activity).slice(0, 300)}\n`);
    }
  },
};

describe.skipIf(!BASE)('live Ollama integration', () => {
  beforeAll(() => {
    // Under vitest the web platform reports dev mode and lib/http rewrites
    // absolute URLs to the (not running) dev CORS proxy; this test talks to
    // the LAN server directly.
    vi.spyOn(Platform, 'shouldUseProxy', 'get').mockReturnValue(false);
  });

  const provider = () =>
    new OpenAiProvider({ baseUrl: BASE!, model: MODEL, temperature: 0 });

  it('classifies a greeting as chat', async () => {
    const kind = await classifyRequest(provider(), 'hello there!', new AbortController().signal);
    expect(kind).toBe('chat');
  }, 120_000);

  it('answers a summary question from the fixture data, grounded', async () => {
    const history: AssistantMessage[] = [{ role: 'user', text: 'summarize today' }];
    const system = buildSystemPrompt({
      now: new Date(),
      timezone: 'America/New_York',
      locale: 'en-US',
      zmVersion: '1.37.5',
      objectLabels: ['person', 'car'],
    });
    const out = await runAssistantTurn({
      provider: provider(),
      host,
      ctx: { profileId: asProfileId('live'), queryClient: {} as never, host, question: 'summarize today' },
      history,
      system,
      signal: new AbortController().signal,
      tools: fixtureTools(),
    });

    const answer = out[out.length - 1];
    expect(answer.role).toBe('assistant');
    // Grounded in the fixture: the real counts, no denial, no raw JSON dump.
    expect(answer.text).toMatch(/\b3\b/);
    expect(answer.text?.trim().startsWith('{')).toBe(false);
  }, 240_000);
});
