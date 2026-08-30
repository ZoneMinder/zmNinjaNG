import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { NinjiiToolbarButton } from '../NinjiiToolbarButton';
import { seedProfiles, resetProfileFixture } from '../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../tests/fake-store-gates';

const mocks = vi.hoisted(() => ({
  enabled: { value: true },
  open: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../hooks/useAssistantEnabled', () => ({
  useAssistantEnabled: () => ({ enabled: mocks.enabled.value, profileId: 'p1' }),
}));

vi.mock('../../../stores/assistantPanel', () => ({
  useAssistantPanelStore: (selector: (s: { open: () => void }) => unknown) =>
    selector({ open: mocks.open }),
}));

describe('NinjiiToolbarButton', () => {
  beforeEach(() => {
    mocks.enabled.value = true;
    mocks.open.mockClear();
    seedProfiles(['p1'], { settings: { p1: { assistantInToolbar: true } } });
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('opens the assistant when tapped', async () => {
    render(<NinjiiToolbarButton />);

    await userEvent.click(screen.getByTestId('ninjii-toolbar-button'));

    expect(mocks.open).toHaveBeenCalledTimes(1);
  });

  it('stays away when the profile has not asked for it in the toolbar', () => {
    seedProfiles(['p1'], { settings: { p1: { assistantInToolbar: false } } });
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
