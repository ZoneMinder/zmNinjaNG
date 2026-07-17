import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../system-prompt';

const base = {
  now: new Date('2026-07-16T22:00:00Z'),
  timezone: 'America/New_York',
  locale: 'de',
  zmVersion: '1.37.0',
  monitors: [{ id: '1', name: 'Front Door', func: 'Modect', enabled: true }],
};

describe('buildSystemPrompt', () => {
  it('includes date, timezone, locale instruction, and the monitor table', () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain('America/New_York');
    expect(p).toContain('Front Door');
    expect(p.toLowerCase()).toContain('de');
  });

  it('opens by naming itself Ninjii (refs #246)', () => {
    const p = buildSystemPrompt(base);
    expect(p.startsWith('You are Ninjii,')).toBe(true);
  });

  it('instructs the model never to ask for a monitor id', () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain('never ask for a monitor id');
    expect(p).toContain('WITHOUT a monitorId');
  });

  it('instructs the model to refer to monitors by name, not bare id', () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain('Refer to monitors by NAME, never by bare id.');
  });

  it('caps the monitor table at the configured limit', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      id: String(i),
      name: `M${i}`,
      func: 'Monitor',
      enabled: true,
    }));
    const p = buildSystemPrompt({ ...base, monitors: many });
    expect(p).not.toContain('M60');
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
    expect(p).toContain('call list_events with the matching range and/or objectType filter');
    expect(p).toContain('MUST be exactly the rows that call returned for that filter');
  });

  it('instructs the model to answer directly and never paste image links/ids, since the app shows thumbnails', () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain('never paste image links, URLs, or raw event ids');
  });

  it('redirects count_events to a rolling window only, not a calendar day', () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain('rolling window like "the last hour" or "the last 24 hours" (NOT a calendar day)');
  });

  it('never mentions a JSON tool-call contract or WebLLM-specific directives (model-agnostic prompt)', () => {
    const p = buildSystemPrompt(base);
    expect(p.toLowerCase()).not.toContain('"tool"');
    expect(p.toLowerCase()).not.toContain('"answer"');
    expect(p).not.toContain('/no_think');
  });
});
