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

  it('instructs the model to call list_events with range/objectType for day- or object-type-specific questions', () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain('call list_events with range and/or objectType');
    expect(p).toContain('Describe only rows that query returned');
  });

  it('instructs the model to answer directly and never paste image links/ids, since the app shows thumbnails', () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain('Never show image links, URLs, or raw ids');
  });

  it('redirects count_events to a rolling window only, not a calendar day', () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain('rolling summaries such as "last 24 hours"');
  });

  it('never mentions a JSON tool-call contract or WebLLM-specific directives (model-agnostic prompt)', () => {
    const p = buildSystemPrompt(base);
    expect(p.toLowerCase()).not.toContain('"tool"');
    expect(p.toLowerCase()).not.toContain('"answer"');
    expect(p).not.toContain('/no_think');
  });
});
