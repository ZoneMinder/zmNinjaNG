/**
 * The create/edit form for a group of servers. What it owes the user: the
 * three ways a group can be invalid have to land in the dialog, next to the
 * fields, instead of throwing out of the store into a console. Refs #337.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VirtualProfileDialog } from '../VirtualProfileDialog';
import { mintVirtualProfileId } from '../../../api/types';
import type { Profile, ProfileId } from '../../../api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));

const addVirtualProfileMock = vi.fn(() => mintVirtualProfileId());
const updateVirtualProfileMock = vi.fn();
const profileExistsMock = vi.fn(() => false);

const useProfileStoreMock = vi.fn();
vi.mock('../../../stores/profile', () => ({
  useProfileStore: (selector: (state: unknown) => unknown) => selector(useProfileStoreMock()),
}));

const HOME: Profile = {
  id: 'p1' as ProfileId,
  name: 'Home',
  portalUrl: 'https://home.test',
  apiUrl: 'https://api.home.test',
  cgiUrl: 'https://home.test/cgi-bin',
  isDefault: true,
  createdAt: 1,
};
const OFFICE = { ...HOME, id: 'p2' as ProfileId, name: 'Office', isDefault: false, createdAt: 2 };

function storeState(profiles = [HOME, OFFICE]) {
  return {
    profiles,
    addVirtualProfile: addVirtualProfileMock,
    updateVirtualProfile: updateVirtualProfileMock,
    profileExists: profileExistsMock,
  };
}

describe('VirtualProfileDialog', () => {
  beforeEach(() => {
    addVirtualProfileMock.mockClear();
    updateVirtualProfileMock.mockClear();
    profileExistsMock.mockReset();
    profileExistsMock.mockReturnValue(false);
    useProfileStoreMock.mockReturnValue(storeState());
  });

  it('creates a group from the typed name and the checked members', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<VirtualProfileDialog group={null} onClose={onClose} />);

    await user.type(screen.getByTestId('virtual-profile-name'), 'Backyard');
    await user.click(screen.getByTestId('virtual-profile-member-p2'));
    await user.click(screen.getByTestId('virtual-profile-save'));

    expect(addVirtualProfileMock).toHaveBeenCalledWith('Backyard', ['p2']);
    expect(onClose).toHaveBeenCalled();
  });

  it('opens in edit mode with the group name and members already applied', async () => {
    const user = userEvent.setup();
    const group = { id: mintVirtualProfileId(), name: 'Backyard', memberProfileIds: ['p2' as ProfileId] };

    render(<VirtualProfileDialog group={group} onClose={vi.fn()} />);

    expect(screen.getByTestId('virtual-profile-name')).toHaveValue('Backyard');
    expect(screen.getByTestId('virtual-profile-member-p2')).toBeChecked();
    expect(screen.getByTestId('virtual-profile-member-p1')).not.toBeChecked();

    await user.click(screen.getByTestId('virtual-profile-member-p1'));
    await user.click(screen.getByTestId('virtual-profile-save'));

    expect(updateVirtualProfileMock).toHaveBeenCalledWith(group.id, {
      name: 'Backyard',
      memberProfileIds: ['p2', 'p1'],
    });
  });

  // A stored "Backyard " is indistinguishable on screen from a profile called
  // "Backyard", and the availability check compares untrimmed, so an untrimmed
  // save is how two identical-looking names get past it (spec section 6).
  it('trims the name before storing it and before checking availability', async () => {
    const user = userEvent.setup();

    render(<VirtualProfileDialog group={null} onClose={vi.fn()} />);

    await user.type(screen.getByTestId('virtual-profile-name'), '  Backyard  ');
    await user.click(screen.getByTestId('virtual-profile-member-p1'));
    await user.click(screen.getByTestId('virtual-profile-save'));

    expect(profileExistsMock).toHaveBeenCalledWith('Backyard', undefined);
    expect(addVirtualProfileMock).toHaveBeenCalledWith('Backyard', ['p1']);
  });

  it('refuses a blank name and writes nothing', async () => {
    const user = userEvent.setup();

    render(<VirtualProfileDialog group={null} onClose={vi.fn()} />);

    await user.type(screen.getByTestId('virtual-profile-name'), '   ');
    await user.click(screen.getByTestId('virtual-profile-member-p1'));
    await user.click(screen.getByTestId('virtual-profile-save'));

    expect(screen.getByTestId('virtual-profile-error')).toHaveTextContent(
      'profiles.group_name_required'
    );
    expect(addVirtualProfileMock).not.toHaveBeenCalled();
  });

  it('refuses a name another profile already uses', async () => {
    const user = userEvent.setup();
    profileExistsMock.mockReturnValue(true);

    render(<VirtualProfileDialog group={null} onClose={vi.fn()} />);

    await user.type(screen.getByTestId('virtual-profile-name'), 'Home');
    await user.click(screen.getByTestId('virtual-profile-member-p1'));
    await user.click(screen.getByTestId('virtual-profile-save'));

    expect(profileExistsMock).toHaveBeenCalledWith('Home', undefined);
    expect(screen.getByTestId('virtual-profile-error')).toHaveTextContent(
      'profiles.group_name_taken'
    );
    expect(addVirtualProfileMock).not.toHaveBeenCalled();
  });

  // A group keeps its own name across an edit, so the availability check has
  // to exclude it - otherwise saving an untouched group reports a clash with
  // itself.
  it('lets a group keep its own name while editing', async () => {
    const user = userEvent.setup();
    const group = { id: mintVirtualProfileId(), name: 'Backyard', memberProfileIds: ['p2' as ProfileId] };

    render(<VirtualProfileDialog group={group} onClose={vi.fn()} />);
    await user.click(screen.getByTestId('virtual-profile-save'));

    expect(profileExistsMock).toHaveBeenCalledWith('Backyard', group.id);
    expect(updateVirtualProfileMock).toHaveBeenCalled();
  });

  it('refuses a group with no members', async () => {
    const user = userEvent.setup();

    render(<VirtualProfileDialog group={null} onClose={vi.fn()} />);

    await user.type(screen.getByTestId('virtual-profile-name'), 'Backyard');
    await user.click(screen.getByTestId('virtual-profile-save'));

    expect(screen.getByTestId('virtual-profile-error')).toHaveTextContent(
      'profiles.group_members_required'
    );
    expect(addVirtualProfileMock).not.toHaveBeenCalled();
  });

  // Disabled profiles are legal members: scope resolution filters them out
  // while they stay disabled, and the group works again once re-enabled.
  it('offers a disabled profile as a member and marks it disabled', async () => {
    const user = userEvent.setup();
    useProfileStoreMock.mockReturnValue(storeState([HOME, { ...OFFICE, disabled: true }]));

    render(<VirtualProfileDialog group={null} onClose={vi.fn()} />);

    expect(screen.getByTestId('virtual-profile-member-row-p2')).toHaveTextContent(
      'profiles.disabled'
    );

    await user.type(screen.getByTestId('virtual-profile-name'), 'Backyard');
    await user.click(screen.getByTestId('virtual-profile-member-p2'));
    await user.click(screen.getByTestId('virtual-profile-save'));

    expect(addVirtualProfileMock).toHaveBeenCalledWith('Backyard', ['p2']);
  });

  // The dialog's own checks cannot see a group deleted in another tab; the
  // store throw is the only signal, and it has to reach the user.
  it('surfaces a store rejection the dialog could not predict', async () => {
    const user = userEvent.setup();
    const group = { id: mintVirtualProfileId(), name: 'Backyard', memberProfileIds: ['p2' as ProfileId] };
    updateVirtualProfileMock.mockImplementation(() => {
      throw new Error('Virtual profile not found');
    });
    const onClose = vi.fn();

    render(<VirtualProfileDialog group={group} onClose={onClose} />);
    await user.click(screen.getByTestId('virtual-profile-save'));

    expect(screen.getByTestId('virtual-profile-error')).toHaveTextContent(
      'Virtual profile not found'
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('titles itself for the mode it is in', () => {
    const { unmount } = render(<VirtualProfileDialog group={null} onClose={vi.fn()} />);
    expect(screen.getByTestId('virtual-profile-dialog')).toHaveTextContent(
      'profiles.group_create_title'
    );
    unmount();

    render(
      <VirtualProfileDialog
        group={{ id: mintVirtualProfileId(), name: 'Backyard', memberProfileIds: ['p2' as ProfileId] }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByTestId('virtual-profile-dialog')).toHaveTextContent(
      'profiles.group_edit_title'
    );
  });
});
