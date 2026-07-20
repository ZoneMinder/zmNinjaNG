import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssistantAdvancedSection } from '../AssistantAdvancedSection';
import { DEFAULT_SETTINGS } from '../../../stores/settings';
import { ASSISTANT } from '../../../lib/zmninja-ng-constants';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const settings = { ...DEFAULT_SETTINGS };

function renderSection(update = vi.fn()) {
  render(<AssistantAdvancedSection settings={settings} update={update} />);
  return update;
}

describe('AssistantAdvancedSection', () => {
  it('starts collapsed so the dials are out of the way of normal setup', () => {
    renderSection();
    expect(screen.getByTestId('assistant-advanced-toggle')).toBeInTheDocument();
    expect(screen.queryByTestId('assistant-temperature')).not.toBeInTheDocument();
  });

  it('reveals all three dials and the note when opened', () => {
    renderSection();
    fireEvent.click(screen.getByTestId('assistant-advanced-toggle'));
    expect(screen.getByTestId('assistant-temperature')).toBeInTheDocument();
    expect(screen.getByTestId('assistant-timeout')).toBeInTheDocument();
    expect(screen.getByTestId('assistant-history-turns')).toBeInTheDocument();
    // The note is the whole reason temperature is safe to expose.
    expect(screen.getByTestId('assistant-advanced-note')).toBeInTheDocument();
  });

  it('defaults temperature to the measured value', () => {
    renderSection();
    fireEvent.click(screen.getByTestId('assistant-advanced-toggle'));
    expect(screen.getByTestId('assistant-temperature')).toHaveValue(ASSISTANT.assistantTemperature);
  });

  it('clamps a temperature above the maximum instead of sending it on', () => {
    const update = renderSection();
    fireEvent.click(screen.getByTestId('assistant-advanced-toggle'));
    fireEvent.change(screen.getByTestId('assistant-temperature'), { target: { value: '5' } });
    expect(update).toHaveBeenCalledWith('assistantTemperature', ASSISTANT.assistantTemperatureMax);
  });

  it('clamps a timeout below the minimum, so a typo cannot wedge the assistant', () => {
    const update = renderSection();
    fireEvent.click(screen.getByTestId('assistant-advanced-toggle'));
    fireEvent.change(screen.getByTestId('assistant-timeout'), { target: { value: '1' } });
    expect(update).toHaveBeenCalledWith('assistantTimeoutSec', ASSISTANT.assistantTimeoutSecMin);
  });

  // Number('') is 0, not NaN, so clearing the field is a valid value (remember
  // nothing) rather than the fallback path.
  it('treats a cleared history field as remembering nothing', () => {
    const update = renderSection();
    fireEvent.click(screen.getByTestId('assistant-advanced-toggle'));
    fireEvent.change(screen.getByTestId('assistant-history-turns'), { target: { value: '' } });
    expect(update).toHaveBeenCalledWith('assistantHistoryTurns', 0);
  });

});
