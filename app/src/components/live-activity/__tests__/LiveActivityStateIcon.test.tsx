import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveActivityStateIcon } from '../LiveActivityStateIcon';
import enTranslation from '../../../locales/en/translation.json';

// Resolve against the real English strings rather than echoing the key, so a
// wrong or missing locale key fails here instead of passing on a fabricated
// value.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key.split('.').reduce<unknown>(
        (node, part) =>
          typeof node === 'object' && node !== null
            ? (node as Record<string, unknown>)[part]
            : undefined,
        enTranslation
      ) as string,
  }),
}));

describe('LiveActivityStateIcon', () => {
  it('announces an alarming monitor', () => {
    render(<LiveActivityStateIcon state="alarm" />);
    expect(screen.getByRole('img', { name: 'Alarmed' })).toBeInTheDocument();
  });

  // prealarm rides with alert, not with the quiet states: both mean ZoneMinder
  // is part way into an alarm decision.
  it.each(['alert', 'prealarm'] as const)('announces %s as a part-way alarm', (state) => {
    render(<LiveActivityStateIcon state={state} />);
    expect(screen.getByRole('img', { name: 'Alert' })).toBeInTheDocument();
  });

  it.each(['idle', 'tape', 'unknown'] as const)('announces %s as winding down', (state) => {
    render(<LiveActivityStateIcon state={state} />);
    expect(screen.getByRole('img', { name: 'Clearing' })).toBeInTheDocument();
  });

  // Cooling tiles are drawn at full colour now, so this glyph is the only
  // thing telling a user the tile is on its way out.
  it('uses a different glyph for a part-way alarm than for cooling', () => {
    const { container: partway } = render(<LiveActivityStateIcon state="alert" />);
    const { container: cooling } = render(<LiveActivityStateIcon state="idle" />);
    expect(partway.querySelector('svg')?.innerHTML).not.toBe(
      cooling.querySelector('svg')?.innerHTML
    );
  });

  it('repeats the state as a hover title, since the word is otherwise gone', () => {
    render(<LiveActivityStateIcon state="alarm" />);
    expect(screen.getByRole('img', { name: 'Alarmed' })).toHaveAttribute('title', 'Alarmed');
  });

  it('uses a different glyph for alarming than for cooling', () => {
    const { container: alarming } = render(<LiveActivityStateIcon state="alarm" />);
    const { container: cooling } = render(<LiveActivityStateIcon state="idle" />);
    expect(alarming.querySelector('svg')?.innerHTML).not.toBe(
      cooling.querySelector('svg')?.innerHTML
    );
  });
});
