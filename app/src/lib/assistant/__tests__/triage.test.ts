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
 * The parse dimension (refs #432, #438). With a roster and the label
 * vocabulary, the triage round parses ROUTING slots: subject, objects
 * ("folks" means person, in any language), and the verbatim time phrases.
 * Camera coverage is deliberately NOT here any more: judged inside this
 * consolidated prompt it failed live twice and every wording rotated the
 * failures; a dedicated coverage call (monitor-stage.ts) measures 8/8 on
 * the same cases. Everything here is an enum or a copied string.
 */
describe('classifyRequest with a roster and vocabulary', () => {
  const roster = ['FrontDoor', 'Front Yard', 'Garage Outdoor'];
  const labels = ['car', 'person', 'truck'];
  const ask = (provider: AssistantProvider, question: string) =>
    classifyRequest(provider, question, new AbortController().signal, undefined, undefined, [], roster, labels);

  it('constrains subject and objects to the real values', async () => {
    const provider = providerSaying('{"kind":"ZONEMINDER","subject":"events","objects":["person"]}');
    const verdict = await ask(provider, 'How may folks came to the front of my house between mon and tue?');

    const [system, , , schema] = vi.mocked(provider.complete).mock.calls[0];
    expect(system).toContain('car, person, truck');
    expect(system).not.toContain('"covered"');
    // Time left this call entirely (refs #444): the windows interrogation
    // owns it on every backend.
    expect(system).not.toContain('"when"');
    expect(schema).toMatchObject({
      properties: {
        subject: { enum: ['events', 'monitors', 'server', 'groups', 'other'] },
        objects: { type: 'array', items: { enum: labels } },
      },
      required: ['continues', 'kind', 'subject', 'objects'],
    });
    expect((schema as { properties: object }).properties).not.toHaveProperty('monitors');
    expect((schema as { properties: object }).properties).not.toHaveProperty('when');
    expect(verdict).toEqual({ kind: 'zoneminder', subject: 'events', objects: ['person'] });
  });

  it('sends the unchanged prompt and schema when no roster is given', async () => {
    const provider = providerSaying('{"kind":"CHAT"}');
    const verdict = await classifyRequest(provider, 'hello', new AbortController().signal);

    const [system, , , schema] = vi.mocked(provider.complete).mock.calls[0];
    expect(system).not.toContain('Detected object labels');
    expect(schema).toMatchObject({ required: ['kind'] });
    expect(verdict).toEqual({ kind: 'chat' });
  });

  // An unconstrained backend can reply anything; values outside the enums
  // are dropped, never trusted.
  it('drops subjects and objects outside the enums', async () => {
    const provider = providerSaying('{"kind":"ZONEMINDER","subject":"weather","objects":["unicorn"]}');
    const verdict = await ask(provider, 'anything in the backyard');
    expect(verdict).toEqual({ kind: 'zoneminder', objects: [] });
  });

  // Refs #436: selecting the whole vocabulary is the creep signature.
  it('derives no filter when the model selects every recorded label', async () => {
    const provider = providerSaying(
      '{"kind":"ZONEMINDER","subject":"events","objects":["person","car","truck"],"when":["over the week"]}',
    );
    const verdict = await ask(provider, 'how busy was the front of my abode over the week?');
    expect(verdict.objects).toEqual([]);
  });

  it('keeps a proper subset as the filter', async () => {
    const provider = providerSaying(
      '{"kind":"ZONEMINDER","subject":"events","objects":["car","truck"],"when":["today"]}',
    );
    const verdict = await ask(provider, 'any vehicles today');
    expect(verdict.objects).toEqual(['car', 'truck']);
  });
});

/** Refs #436, observed live: "how busy" names no object, yet objects came
 *  back as the ENTIRE vocabulary, silently excluding no-detection events
 *  from a busyness summary. The whole vocabulary is the creep signature,
 *  mirror of the whole-roster monitors rule: no filter at all. */
describe('classifyRequest objects creep guard', () => {
  it('derives no filter when the model selects every recorded label', async () => {
    const provider = providerSaying(
      '{"kind":"ZONEMINDER","place":"front of my abode","covered":true,"monitors":["FrontDoor"],"subject":"events","objects":["person","car","truck"],"when":["over the week"]}',
    );
    const verdict = await classifyRequest(
      provider,
      'how busy was the front of my abode over the week?',
      new AbortController().signal,
      undefined,
      undefined,
      [],
      ['FrontDoor', 'Garage Outdoor'],
      ['car', 'person', 'truck'],
    );
    expect(verdict.objects).toEqual([]);
  });

  it('keeps a proper subset as the filter', async () => {
    const provider = providerSaying(
      '{"kind":"ZONEMINDER","place":"","covered":false,"monitors":[],"subject":"events","objects":["car","truck"],"when":["today"]}',
    );
    const verdict = await classifyRequest(
      provider,
      'any vehicles today',
      new AbortController().signal,
      undefined,
      undefined,
      [],
      ['FrontDoor'],
      ['car', 'person', 'truck'],
    );
    expect(verdict.objects).toEqual(['car', 'truck']);
  });
});

import { buildContextualQuestion, prevTurnFromThread } from '../triage';

/**
 * Refs #440, observed live: standalone "how today looking?" classified CHAT
 * and the tool-less turn fabricated a healthy-system report. Follow-ups and
 * app-default status questions.
 */
describe('contextual classification', () => {
  it('embeds the previous turn as structured facts, never answer prose', () => {
    const q = buildContextualQuestion('yes', {
      question: 'how was the rear of my house this week?',
      monitors: ['Backyard(JPEG)'],
      periods: ['this calendar week'],
      offer: 'Want a breakdown?',
    });
    expect(q).toContain('how was the rear of my house this week?');
    expect(q).toContain('Backyard(JPEG)');
    expect(q).toContain('this calendar week');
    expect(q).toContain('Want a breakdown?');
    expect(q.trim().endsWith('yes')).toBe(true);
  });

  it('returns the bare question without context', () => {
    expect(buildContextualQuestion('hello')).toBe('hello');
  });

  it('trims an oversized previous question', () => {
    const q = buildContextualQuestion('yes', { question: 'x'.repeat(2000) });
    expect(q.length).toBeLessThan(1000);
  });

  // Refs #446: the previous turn's structured facts come from the stored
  // turn state; the offer is the assistant's closing sentence only when it
  // asked something.
  it('builds the previous turn from the last exchange, offer only on a question', () => {
    const prev = prevTurnFromThread([
      { role: 'user', text: 'how was the rear this week?' },
      { role: 'assistant', text: 'Backyard had 86 events. Want a breakdown?' },
      { role: 'user', text: 'yes' },
    ]);
    expect(prev).toMatchObject({ question: 'how was the rear this week?', offer: 'Want a breakdown?' });

    const noOffer = prevTurnFromThread([
      { role: 'user', text: 'how was the rear this week?' },
      { role: 'assistant', text: 'Backyard had 86 events with a truck at noon.' },
      { role: 'user', text: 'anything else' },
    ]);
    expect(noOffer).toEqual({ question: 'how was the rear this week?' });
    expect(prevTurnFromThread([{ role: 'user', text: 'first ever' }])).toBeUndefined();
  });

  /** Refs #446: relatedness is ONE explicit judgment, decoded first; code
   *  gates all context on it. Implicit inheritance stole "truck", "Front
   *  Yard", and "today" from answer prose across three live transcripts. */
  it('decodes continues first and returns it on the verdict', async () => {
    const provider = providerSaying('{"continues":true,"kind":"ZONEMINDER","subject":"events","objects":[]}');
    const verdict = await classifyRequest(
      provider,
      'yes',
      new AbortController().signal,
      undefined,
      undefined,
      [],
      ['FrontDoor'],
      ['person'],
      { question: 'how was the rear this week?', offer: 'Want a breakdown?' },
    );
    const [, , , schema] = vi.mocked(provider.complete).mock.calls[0];
    const sch = schema as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(sch.properties)[0]).toBe('continues');
    expect(sch.required[0]).toBe('continues');
    expect(verdict.continues).toBe(true);
  });

  it('defaults continues to false when absent or unparseable', async () => {
    const provider = providerSaying('{"kind":"CHAT"}');
    const verdict = await classifyRequest(provider, 'hello', new AbortController().signal);
    expect(verdict.continues).toBeUndefined();
  });

  // A CHAT verdict whose own slots say the message is about the system is
  // self-contradictory; routing a real question to the tool-less lane is
  // the worse failure (it fabricates), so code flips it (refs #440).
  it('flips CHAT with a system subject to zoneminder', async () => {
    const provider = providerSaying('{"continues":false,"kind":"CHAT","subject":"events","objects":[]}');
    const verdict = await classifyRequest(
      provider,
      'how today looking?',
      new AbortController().signal,
      undefined,
      undefined,
      [],
      ['FrontDoor'],
      ['person'],
    );
    expect(verdict.kind).toBe('zoneminder');
  });

  it('leaves CHAT with subject other alone', async () => {
    const provider = providerSaying('{"continues":false,"kind":"CHAT","subject":"other","objects":[]}');
    const verdict = await classifyRequest(
      provider,
      'see you tomorrow',
      new AbortController().signal,
      undefined,
      undefined,
      [],
      ['FrontDoor'],
      ['person'],
    );
    expect(verdict.kind).toBe('chat');
  });

  it('forbids the chat lane from stating or offering system facts', () => {
    const prompt = buildNoToolPrompt('BASE', 'chat');
    expect(prompt).toContain('never state any camera, event, or server condition');
    expect(prompt).toContain('Never say you will check');
  });
});

