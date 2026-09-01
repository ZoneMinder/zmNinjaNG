import { describe, it, expect, vi } from 'vitest';
import { parseRequestKind, classifyRequest, buildNoToolPrompt } from '../triage';
import type { AssistantProvider } from '../types';

function providerSaying(text: string): AssistantProvider {
  return { complete: vi.fn().mockResolvedValue({ text }) } as unknown as AssistantProvider;
}

describe('parseRequestKind', () => {
  it('reads the three kinds', () => {
    expect(parseRequestKind('ZONEMINDER')).toBe('zoneminder');
    expect(parseRequestKind('ACTION')).toBe('action');
    expect(parseRequestKind('CHAT')).toBe('chat');
  });

  // The on-device paths wrap every reply in the JSON answer envelope and small
  // models add punctuation, so the keyword is matched inside whatever arrives
  // rather than requiring a clean one-word reply.
  it('finds the keyword inside a wrapped or punctuated reply', () => {
    expect(parseRequestKind('{"answer":"CHAT"}')).toBe('chat');
    expect(parseRequestKind('chat.')).toBe('chat');
    expect(parseRequestKind('The answer is ACTION')).toBe('action');
  });

  // Misrouting a real question to the no-tools path answers it with no data at
  // all, which is worse than letting small talk reach the tool loop.
  it('defaults to zoneminder when the reply says nothing useful', () => {
    expect(parseRequestKind('')).toBe('zoneminder');
    expect(parseRequestKind('I am not sure what you mean')).toBe('zoneminder');
  });

  it('prefers zoneminder when more than one keyword appears', () => {
    expect(parseRequestKind('not CHAT, this is ZONEMINDER')).toBe('zoneminder');
  });

  // A schema-constrained backend replies with exactly this shape (see
  // TRIAGE_SCHEMA); it is read before the loose substring match, so a stray
  // keyword inside a longer JSON string cannot outvote the verdict field.
  it('reads the constrained {"kind":...} verdict first', () => {
    expect(parseRequestKind('{"kind":"CHAT"}')).toBe('chat');
    expect(parseRequestKind('{"kind":"ACTION"}')).toBe('action');
    expect(parseRequestKind('{"kind":"ZONEMINDER"}')).toBe('zoneminder');
  });
});

describe('classifyRequest', () => {
  // `complete`, not `chat`: through `chat` the provider paths wrap the
  // call in the agent's tool catalog, few-shot block and JSON output contract,
  // and the classifier answers like an assistant instead of classifying.
  it('uses a plain completion, with the triage prompt as the system message', async () => {
    const provider = providerSaying('CHAT');
    await classifyRequest(provider, 'hello', new AbortController().signal);

    const [system, text, , schema] = vi.mocked(provider.complete).mock.calls[0];
    expect(system).toContain('ZONEMINDER');
    expect(text).toBe('hello');
    // The verdict schema rides along so a backend that can constrain
    // generation returns exactly {"kind":"..."} instead of prose.
    expect(schema).toMatchObject({ properties: { kind: { enum: ['ZONEMINDER', 'ACTION', 'CHAT'] } } });
  });

  // The boundary that failed on Apple Foundation Models (refs #270): casual
  // count and presence questions triaged as CHAT or ACTION, and the tool-less
  // turn then answered "No information available" with no way back. Taught as
  // shapes in the ZONEMINDER list; an appended block of "message -> VERDICT"
  // examples measured worse (see the prompt comment).
  it('teaches the count and presence shapes that fix the casual-phrasing boundary', async () => {
    const provider = providerSaying('ZONEMINDER');
    await classifyRequest(provider, 'how many people came today', new AbortController().signal);

    const [system] = vi.mocked(provider.complete).mock.calls[0];
    expect(system).toContain('"how many <thing> came <any period>"');
    expect(system).toContain('"did anyone come by"');
    expect(system).not.toContain('-> ZONEMINDER');
  });

  // Superlative/statistic questions ("busiest hour", "most active camera",
  // "quietest day") are ZONEMINDER events questions (refs #270). Taught as the
  // "rank" verb in the ZONEMINDER template, not as example instances, which
  // over-broadened. On Apple Foundation Models "what was my busiest hour"
  // triaged ACTION and the tool-less turn then fabricated an hour.
  it('teaches the rank verb that covers superlative and statistic questions', async () => {
    const provider = providerSaying('ZONEMINDER');
    await classifyRequest(provider, 'what was my busiest hour', new AbortController().signal);

    const [system] = vi.mocked(provider.complete).mock.calls[0];
    expect(system).toContain('summarize, recap, count, rank, list, look up, check, or view');
  });

  // A triage outage must degrade to the previous behaviour (everything reaches
  // the tool loop), never to an assistant that cannot answer questions.
  it('falls back to zoneminder when the provider throws', async () => {
    const provider = { complete: vi.fn().mockRejectedValue(new Error('offline')) } as unknown as AssistantProvider;
    await expect(classifyRequest(provider, 'is the server ok', new AbortController().signal)).resolves.toMatchObject({
      kind: 'zoneminder',
    });
  });

  it('propagates an abort instead of swallowing it as a classification', async () => {
    const provider = {
      complete: vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')),
    } as unknown as AssistantProvider;
    await expect(classifyRequest(provider, 'hello', new AbortController().signal)).rejects.toThrow('Aborted');
  });

  it('reads the keyword out of a wrapped reply', async () => {
    await expect(
      classifyRequest(providerSaying('{"answer":"CHAT"}'), 'hi', new AbortController().signal),
    ).resolves.toMatchObject({ kind: 'chat' });
  });
});

describe('buildNoToolPrompt', () => {
  it('keeps the base prompt and tells a chat turn not to call a tool', () => {
    const prompt = buildNoToolPrompt('BASE PROMPT', 'chat');
    expect(prompt).toContain('BASE PROMPT');
    expect(prompt).toContain('not about this ZoneMinder installation');
    expect(prompt).toContain('Never call a tool');
  });

  // The softer chat policy (refs #270, pipeline-v2): a brief helpful general
  // answer, one identity mention, a warm reply to small talk, no hard refusal.
  it('gives a brief general answer with one identity mention and warm small talk', () => {
    const prompt = buildNoToolPrompt('BASE PROMPT', 'chat');
    expect(prompt).toContain('Give a brief, helpful general answer');
    expect(prompt).toContain("you are an AI assistant for the user's ZoneMinder system");
    expect(prompt).toContain('gets one short warm reply');
    expect(prompt).toContain('never invent any camera,');
  });

  it('tells an action turn to refuse and say where to do it by hand', () => {
    const prompt = buildNoToolPrompt('BASE PROMPT', 'action');
    expect(prompt).toContain('cannot be undone');
    expect(prompt).toContain('Monitors screen');
  });

  // An action turn refused the change and then invented "Server is healthy.
  // FPS: 1.0. Health: 100%" (refs #270). No tool runs on this turn.
  it('forbids an action turn from stating system facts it never retrieved', () => {
    const prompt = buildNoToolPrompt('BASE PROMPT', 'action');
    expect(prompt).toContain('Never state any system fact, count, status, or health figure');
    expect(prompt).toContain('you have retrieved nothing');
  });
});

/**
 * Refs #337, observed live: "compare warehouse and cabin" triaged CHAT, because
 * nothing in the triage prompt said those two words are the user's own
 * servers. The turn then ran with no tools and answered with a greeting. The
 * roster has to reach the classifier, not just the answering prompt.
 */
describe('classifyRequest inside a server group', () => {
  it('names the servers in scope so a question naming one is about this system', async () => {
    const provider = providerSaying('ZONEMINDER');
    await classifyRequest(provider, 'compare warehouse and cabin', new AbortController().signal, undefined, undefined, [
      'cabin',
      'warehouse',
    ]);

    const [system] = vi.mocked(provider.complete).mock.calls[0];
    expect(system).toContain('cabin, warehouse');
  });

  it('sends the unchanged prompt when there is no group', async () => {
    const provider = providerSaying('CHAT');
    await classifyRequest(provider, 'hello', new AbortController().signal, undefined, undefined, ['cabin']);
    const [withOne] = vi.mocked(provider.complete).mock.calls[0];

    const bare = providerSaying('CHAT');
    await classifyRequest(bare, 'hello', new AbortController().signal);
    const [withNone] = vi.mocked(bare.complete).mock.calls[0];

    expect(withOne).toBe(withNone);
  });
});

/**
 * Refs #427, observed live: "how many people came to my front door yesterday"
 * was answered as "3 people came to your front door" from events on a monitor
 * called "Garage Outdoor". The triage round is the one model call that can
 * decide, in any language, which camera a question refers to, so when the
 * caller hands it the monitor roster it classifies that too, constrained to
 * the real names plus NONE and NO_MATCH so nothing can be hallucinated.
 */
describe('classifyRequest with a monitor roster', () => {
  it('names the cameras in the prompt and constrains the monitor field to them', async () => {
    const provider = providerSaying('{"kind":"ZONEMINDER","place":"driveway","covered":true,"monitor":"Driveway"}');
    const verdict = await classifyRequest(
      provider,
      'anything on the driveway today',
      new AbortController().signal,
      undefined,
      undefined,
      [],
      ['Driveway', 'Front Door'],
    );

    const [system, , , schema] = vi.mocked(provider.complete).mock.calls[0];
    expect(system).toContain('Driveway, Front Door');
    expect(schema).toMatchObject({
      properties: { monitor: { enum: ['NONE', 'Driveway', 'Front Door'] }, covered: { type: 'boolean' } },
      required: ['kind', 'place', 'covered', 'monitor'],
    });
    expect(verdict).toEqual({ kind: 'zoneminder', monitor: 'Driveway' });
  });

  it('sends the unchanged prompt and schema when no roster is given', async () => {
    const provider = providerSaying('{"kind":"CHAT"}');
    const verdict = await classifyRequest(provider, 'hello', new AbortController().signal);

    const [system, , , schema] = vi.mocked(provider.complete).mock.calls[0];
    expect(system).not.toContain("This system's cameras are");
    expect(schema).toMatchObject({ required: ['kind'] });
    expect((schema as { properties: object }).properties).not.toHaveProperty('monitor');
    expect(verdict).toEqual({ kind: 'chat', monitor: undefined });
  });

  // NO_MATCH is derived in code from place + covered, never decoded from a
  // name enum: asked to choose from the names directly, the model substituted
  // the nearest camera for a place the list lacks (measured 12/16, see
  // buildTriageSchema).
  it('reports NO_MATCH when a named place is covered by no camera', async () => {
    const provider = providerSaying('{"kind":"ZONEMINDER","place":"front door","covered":false,"monitor":"NONE"}');
    const verdict = await classifyRequest(
      provider,
      'how many people came to my front door',
      new AbortController().signal,
      undefined,
      undefined,
      [],
      ['Garage Outdoor'],
    );
    expect(verdict).toEqual({ kind: 'zoneminder', monitor: 'NO_MATCH' });
  });

  it('reports NONE when the question names no place at all', async () => {
    const provider = providerSaying('{"kind":"ZONEMINDER","place":"","covered":false,"monitor":"NONE"}');
    const verdict = await classifyRequest(
      provider,
      'summarize today',
      new AbortController().signal,
      undefined,
      undefined,
      [],
      ['Garage Outdoor'],
    );
    expect(verdict).toEqual({ kind: 'zoneminder', monitor: 'NONE' });
  });

  // Refs #430, observed live: {"place":"front of my door","covered":false,
  // "monitor":"FrontDoor"}: the model denied coverage while naming the
  // right monitor. A contradictory verdict is uncertainty, and asserting
  // "no camera covers that place" about a camera the model itself named is
  // the worst outcome; NONE (no injected line) is the safe read.
  it('resolves a covered:false verdict that still names a real monitor to NONE', async () => {
    const provider = providerSaying('{"kind":"ZONEMINDER","place":"front of my door","covered":false,"monitor":"FrontDoor"}');
    const verdict = await classifyRequest(
      provider,
      'how many people came to the front of my door yesterday?',
      new AbortController().signal,
      undefined,
      undefined,
      [],
      ['FrontDoor', 'Garage Outdoor'],
    );
    expect(verdict).toEqual({ kind: 'zoneminder', monitor: 'NONE' });
  });

  // An unconstrained backend can reply anything; a monitor value outside the
  // enum must arrive as undefined, never as a trusted name.
  it('drops a monitor value that is not in the roster', async () => {
    const provider = providerSaying('{"kind":"ZONEMINDER","place":"backyard","covered":true,"monitor":"Backyard"}');
    const verdict = await classifyRequest(
      provider,
      'anything in the backyard',
      new AbortController().signal,
      undefined,
      undefined,
      [],
      ['Garage Outdoor'],
    );
    expect(verdict).toEqual({ kind: 'zoneminder', monitor: undefined });
  });
});
