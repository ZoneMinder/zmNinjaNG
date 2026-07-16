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
});
