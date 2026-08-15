import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NinjiiToolbarButton } from '../NinjiiToolbarButton';

const mocks = vi.hoisted(() => ({
  enabled: { value: true },
  inToolbar: { value: true },
  open: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../hooks/useAssistantEnabled', () => ({
  useAssistantEnabled: () => ({ enabled: mocks.enabled.value, profileId: 'p1' }),
}));

vi.mock('../../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => ({ settings: { assistantInToolbar: mocks.inToolbar.value } }),
}));

vi.mock('../../../stores/assistantPanel', () => ({
  useAssistantPanelStore: (selector: (s: { open: () => void }) => unknown) =>
    selector({ open: mocks.open }),
}));

describe('NinjiiToolbarButton', () => {
  beforeEach(() => {
    mocks.enabled.value = true;
    mocks.inToolbar.value = true;
    mocks.open.mockClear();
  });

  it('opens the assistant when tapped', async () => {
    render(<NinjiiToolbarButton />);

    await userEvent.click(screen.getByTestId('ninjii-toolbar-button'));

    expect(mocks.open).toHaveBeenCalledTimes(1);
  });

  it('stays away when the profile has not asked for it in the toolbar', () => {
    mocks.inToolbar.value = false;
    render(<NinjiiToolbarButton />);

    expect(screen.queryByTestId('ninjii-toolbar-button')).not.toBeInTheDocument();
  });

  it('stays away when the assistant is not configured in this scope', () => {
    // The setting alone is not enough: a group whose members have no assistant
    // configured would otherwise show a button that opens an empty panel.
    mocks.enabled.value = false;
    render(<NinjiiToolbarButton />);

    expect(screen.queryByTestId('ninjii-toolbar-button')).not.toBeInTheDocument();
  });
});
