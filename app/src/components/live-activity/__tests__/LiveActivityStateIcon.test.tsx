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

  it('announces a post-alarm monitor', () => {
    render(<LiveActivityStateIcon state="alert" />);
    expect(screen.getByRole('img', { name: 'Alert' })).toBeInTheDocument();
  });

  it.each(['idle', 'prealarm', 'tape', 'unknown'] as const)(
    'announces %s as winding down',
    (state) => {
      render(<LiveActivityStateIcon state={state} />);
      expect(screen.getByRole('img', { name: 'Clearing' })).toBeInTheDocument();
    }
  );

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
