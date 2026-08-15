import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimelineToolbar } from '../TimelineToolbar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const base = {
  brushMode: false,
  liveMode: false,
  onToggleBrush: vi.fn(),
  onToggleLive: vi.fn(),
  onZoomIn: vi.fn(),
  onZoomOut: vi.fn(),
  onCenter: vi.fn(),
  onGoToNow: vi.fn(),
  scrollPadOn: false,
  onToggleScrollPad: vi.fn(),
};

describe('TimelineToolbar scroll pad control', () => {
  beforeEach(() => {
    // The help popover reads (pointer: fine); jsdom has no matchMedia.
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
  });

  it('is always available, so the pad can be summoned on any timeline', () => {
    render(<TimelineToolbar {...base} />);
    expect(screen.getByTestId('timeline-scroll-pad-toggle')).toBeInTheDocument();
  });

  it('toggles the pad when offered', async () => {
    const onToggleScrollPad = vi.fn();
    render(
      <TimelineToolbar {...base} onToggleScrollPad={onToggleScrollPad} />
    );

    const button = screen.getByTestId('timeline-scroll-pad-toggle');
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(button);
    expect(onToggleScrollPad).toHaveBeenCalledTimes(1);
  });

  it('reports the pad being on', () => {
    render(<TimelineToolbar {...base} scrollPadOn />);
    expect(screen.getByTestId('timeline-scroll-pad-toggle')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });
});
