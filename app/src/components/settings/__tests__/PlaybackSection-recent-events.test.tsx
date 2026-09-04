import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlaybackSection } from '../PlaybackSection';
import { DEFAULT_SETTINGS } from '../../../stores/settings';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: string) => d ?? k }),
}));

describe('PlaybackSection recent-events count', () => {
  const profile = { id: 'p1' } as never;

  it('renders the current count and writes changes', () => {
    const updateSettings = vi.fn();
    render(
      <PlaybackSection
        settings={{ ...DEFAULT_SETTINGS, monitorDetailRecentEventsCount: 5 }}
        update={vi.fn()}
        currentProfile={profile}
        updateSettings={updateSettings}
      />
    );
    const input = screen.getByTestId('settings-monitor-recent-events-count') as HTMLInputElement;
    expect(input.value).toBe('5');
    fireEvent.change(input, { target: { value: '8' } });
    expect(updateSettings).toHaveBeenCalledWith('p1', { monitorDetailRecentEventsCount: 8 });
  });

  it('applies a preset on click', () => {
    const updateSettings = vi.fn();
    render(
      <PlaybackSection
        settings={{ ...DEFAULT_SETTINGS }}
        update={vi.fn()}
        currentProfile={profile}
        updateSettings={updateSettings}
      />
    );
    fireEvent.click(screen.getByTestId('monitor-recent-events-count-preset-10'));
    expect(updateSettings).toHaveBeenCalledWith('p1', { monitorDetailRecentEventsCount: 10 });
  });

  it('clamps a typed value above the max down to 50', () => {
    const updateSettings = vi.fn();
    render(
      <PlaybackSection
        settings={{ ...DEFAULT_SETTINGS }}
        update={vi.fn()}
        currentProfile={profile}
        updateSettings={updateSettings}
      />
    );
    const input = screen.getByTestId('settings-monitor-recent-events-count') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '244' } });
    expect(updateSettings).toHaveBeenCalledWith('p1', { monitorDetailRecentEventsCount: 50 });
  });

  it('writes the open-events-in-fullscreen switch (refs #462, #463)', () => {
    const update = vi.fn();
    render(
      <PlaybackSection
        settings={{ ...DEFAULT_SETTINGS }}
        update={update}
        currentProfile={profile}
        updateSettings={vi.fn()}
      />
    );
    const toggle = screen.getByTestId('settings-event-fullscreen-switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(update).toHaveBeenCalledWith('eventPlaybackFullscreen', true);
  });
});
