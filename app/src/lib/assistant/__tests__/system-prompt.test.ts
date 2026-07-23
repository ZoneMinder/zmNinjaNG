import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../system-prompt';

const base = {
  now: new Date('2026-07-16T22:00:00Z'),
  timezone: 'America/New_York',
  locale: 'de',
  zmVersion: '1.37.0',
};

describe('buildSystemPrompt', () => {
  it('includes date, timezone, locale instruction, and monitor-resolution guidance', () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain('America/New_York');
    expect(p.toLowerCase()).toContain('de');
    expect(p).toContain('list_monitors');
  });

  // An on-device turn introduced itself as "Ninjiing": the doubled "i" is not
  // a clean token boundary for a small model, so the exact spelling is stated
  // as a rule rather than left to be copied (refs #246).
  it('pins the exact spelling of its name so a small model cannot inflect it', () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain('spelled exactly "Ninjii" and never changes');
    expect(p).toContain('never add letters or endings');
  });

  it('opens by naming itself Ninjii (refs #246)', () => {
    const p = buildSystemPrompt(base);
    expect(p.startsWith('You are Ninjii,')).toBe(true);
  });

  it('instructs the model never to ask for a monitor id', () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain('Never ask the user for an id');
    expect(p).toContain('monitorId is omitted');
  });

  it('instructs the model to refer to monitors by name, not bare id', () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain('State monitor names');
  });

  it('states today\'s calendar date as a plain wall-clock string in the profile timezone (refs #246)', () => {
    // 2026-07-16T22:00:00Z is 2026-07-16 18:00 in America/New_York: same
    // calendar day as the UTC instant, so this only asserts the label is
    // present and human-readable, not a cross-day case (event-range.test.ts
    // already covers timezone day-boundary crossing for the resolver itself).
    const p = buildSystemPrompt(base);
    expect(p).toContain("Today's date is Thursday, 2026-07-16 in timezone America/New_York");
  });

  it('teaches phrase copying, with interpretation done by the app (refs #265)', () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain("COPY the user's own time words");
    expect(p).toContain('`when`');
    expect(p).toContain('Describe only rows the query returned');
  });

  // The model echoes the user's phrasing accurately and does date arithmetic
  // badly, so the prompt has to send it to `when` rather than to a timestamp.
  it('forbids computing timestamps outright', () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain('Never compute timestamps yourself');
  });

  it('instructs the model to answer directly and never paste image links/ids, since the app shows thumbnails', () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain('Never show image links, URLs, or raw ids');
  });

  it('offers count_events for bare rolling totals', () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain('count_events is cheaper');
  });

  // Triage normally keeps small talk away from this prompt; this line is what
  // answers it when triage misses or fails open (refs #270). The scope half of
  // the policy is in triage.ts's tool-less prompt, which is measured there:
  // every wording of it here cost tool-selection accuracy.
  it('tells the model to answer small talk warmly', () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain('Greetings, thanks, and small talk get a short warm reply');
  });

  it('never mentions a JSON tool-call contract or WebLLM-specific directives (model-agnostic prompt)', () => {
    const p = buildSystemPrompt(base);
    expect(p.toLowerCase()).not.toContain('"tool"');
    expect(p.toLowerCase()).not.toContain('"answer"');
    expect(p).not.toContain('/no_think');
  });
});
