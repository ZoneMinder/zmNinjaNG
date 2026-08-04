/**
 * All Servers Performance Section Tests (refs #337)
 *
 * The section is the one place every All-mode tuning knob is editable, so what
 * matters here is what each row writes to the ALL bucket: the committed value,
 * the clamp when a typed value is out of range, and the reset that puts the
 * shipped default back. The store itself is a spy - where the write lands is
 * Settings.tsx's job and is covered there.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AllServersPerformanceSection } from '../AllServersPerformanceSection';
import { DEFAULT_SETTINGS } from '../../../stores/settings';
import type { ProfileSettings } from '../../../stores/settings';
import { ALL_MODE_PERFORMANCE } from '../../../lib/zmninja-ng-constants';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));

// Radix Select needs pointer geometry jsdom does not provide; the stub keeps
// the value visible and exposes one button that picks the other tuning mode.
vi.mock('../../ui/select', () => ({
  Select: ({ value, onValueChange }: { value: string; onValueChange: (v: string) => void }) => (
    <button data-testid="all-mode-stream-tuning-select" onClick={() => onValueChange('reduced')}>
      {value}
    </button>
  ),
  SelectContent: () => null,
  SelectItem: () => null,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

const update = vi.fn();

function renderSection(overrides: Partial<ProfileSettings> = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...overrides };
  return render(<AllServersPerformanceSection settings={settings} update={update} />);
}

/** Types into a committed-on-blur number field the way a user does. */
function typeAndBlur(testId: string, value: string) {
  const input = screen.getByTestId(testId);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
  return input;
}

describe('AllServersPerformanceSection (refs #337)', () => {
  beforeEach(() => {
    update.mockClear();
  });

  it('writes a typed stream cap to the ALL bucket when the field commits', () => {
    renderSection();
    typeAndBlur('all-mode-max-streams-input', '4');
    expect(update).toHaveBeenCalledWith('allModeMaxStreams', 4);
  });

  it('clamps a cap typed above the ceiling, and shows the clamped value back', () => {
    renderSection();
    const input = typeAndBlur('all-mode-max-streams-input', '5000');
    expect(update).toHaveBeenCalledWith('allModeMaxStreams', ALL_MODE_PERFORMANCE.maxStreams);
    expect(input).toHaveValue(ALL_MODE_PERFORMANCE.maxStreams);
  });

  it('clamps a cap typed below the floor', () => {
    renderSection();
    typeAndBlur('all-mode-max-streams-input', '0');
    expect(update).toHaveBeenCalledWith('allModeMaxStreams', ALL_MODE_PERFORMANCE.minStreams);
  });

  it('rounds a fractional entry to what the store will actually hold', () => {
    // mergeProfileSettings rounds on read, so a raw 2.5 written here comes
    // back as 3 for every consumer while the field, whose storedValue never
    // changed, keeps showing 2.5. Rounding at commit keeps the two the same
    // number.
    renderSection();
    const input = typeAndBlur('all-mode-max-streams-input', '2.5');
    expect(update).toHaveBeenCalledWith('allModeMaxStreams', 3);
    expect(input).toHaveValue(3);
  });

  it('edits the burst window in seconds, not milliseconds', () => {
    renderSection();
    expect(screen.getByTestId('all-mode-burst-window-input')).toHaveValue(
      DEFAULT_SETTINGS.allModeBurstSeconds
    );
    typeAndBlur('all-mode-burst-window-input', '8');
    expect(update).toHaveBeenCalledWith('allModeBurstSeconds', 8);
  });

  it('puts the shipped default back when a knob is reset', () => {
    renderSection({ allModeMaxWatched: 3 });
    fireEvent.click(screen.getByTestId('all-mode-max-watched-reset'));
    expect(update).toHaveBeenCalledWith('allModeMaxWatched', DEFAULT_SETTINGS.allModeMaxWatched);
  });

  it('offers no reset for a knob already sitting at its default', () => {
    renderSection();
    expect(screen.queryByTestId('all-mode-max-watched-reset')).not.toBeInTheDocument();
    expect(screen.queryByTestId('all-mode-poll-floor-reset')).not.toBeInTheDocument();
  });

  it('resets a changed poll floor independently of the other knobs', () => {
    renderSection({ allModePollFloorSeconds: 45, allModeMaxStreams: 2 });
    fireEvent.click(screen.getByTestId('all-mode-poll-floor-reset'));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      'allModePollFloorSeconds',
      DEFAULT_SETTINGS.allModePollFloorSeconds
    );
  });

  it('switches stream tuning on', () => {
    renderSection();
    fireEvent.click(screen.getByTestId('all-mode-stream-tuning-select'));
    expect(update).toHaveBeenCalledWith('allModeStreamTuning', 'reduced');
  });

  it('toggles pausing hidden streams', () => {
    renderSection();
    fireEvent.click(screen.getByTestId('all-mode-pause-hidden-switch'));
    expect(update).toHaveBeenCalledWith('allModePauseHidden', true);
  });

  it('toggles viewport gating', () => {
    renderSection();
    fireEvent.click(screen.getByTestId('all-mode-viewport-gating-switch'));
    expect(update).toHaveBeenCalledWith('allModeViewportGating', true);
  });

  it('treats 0 idle minutes as a real value rather than a floor to clamp away', () => {
    renderSection({ allModeIdleMinutes: 30 });
    typeAndBlur('all-mode-idle-minutes-input', '0');
    expect(update).toHaveBeenCalledWith('allModeIdleMinutes', 0);
  });
});
