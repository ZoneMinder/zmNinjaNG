/**
 * The create/edit form for a group of servers. What it owes the user: the
 * three ways a group can be invalid have to land in the dialog, next to the
 * fields, instead of throwing out of the store into a console. Refs #337.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { VirtualProfileDialog } from '../VirtualProfileDialog';
import { mintVirtualProfileId } from '../../../api/types';
import type { ProfileId } from '../../../api/types';
import { useProfileStore } from '../../../stores/profile';
import { seedProfiles, resetProfileFixture, makeProfile } from '../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../tests/fake-store-gates';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));

const HOME = makeProfile('p1', { name: 'Home', isDefault: true });
const OFFICE = makeProfile('p2', { name: 'Office' });

function seedVirtualProfileFixture(profiles = [HOME, OFFICE]) {
  seedProfiles(profiles);
}

describe('VirtualProfileDialog', () => {
  beforeEach(() => {
    seedVirtualProfileFixture();
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('creates a group from the typed name and the checked members', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const addVirtualProfileSpy = vi.spyOn(useProfileStore.getState(), 'addVirtualProfile');

    render(<VirtualProfileDialog group={null} onClose={onClose} />);

    await user.type(screen.getByTestId('virtual-profile-name'), 'Backyard');
    await user.click(screen.getByTestId('virtual-profile-member-p2'));
    await user.click(screen.getByTestId('virtual-profile-save'));

    expect(addVirtualProfileSpy).toHaveBeenCalledWith('Backyard', ['p2']);
    expect(onClose).toHaveBeenCalled();
    expect(useProfileStore.getState().virtualProfiles?.[0]).toMatchObject({
      name: 'Backyard',
      memberProfileIds: ['p2'],
    });
  });

  it('opens in edit mode with the group name and members already applied', async () => {
    const user = userEvent.setup();
    const group = { id: mintVirtualProfileId(), name: 'Backyard', memberProfileIds: ['p2' as ProfileId] };
    useProfileStore.setState({ virtualProfiles: [group] });
    const updateVirtualProfileSpy = vi.spyOn(useProfileStore.getState(), 'updateVirtualProfile');

    render(<VirtualProfileDialog group={group} onClose={vi.fn()} />);

    expect(screen.getByTestId('virtual-profile-name')).toHaveValue('Backyard');
    expect(screen.getByTestId('virtual-profile-member-p2')).toBeChecked();
    expect(screen.getByTestId('virtual-profile-member-p1')).not.toBeChecked();

    await user.click(screen.getByTestId('virtual-profile-member-p1'));
    await user.click(screen.getByTestId('virtual-profile-save'));

    expect(updateVirtualProfileSpy).toHaveBeenCalledWith(group.id, {
      name: 'Backyard',
      memberProfileIds: ['p2', 'p1'],
    });
  });

  // A stored "Backyard " is indistinguishable on screen from a profile called
  // "Backyard", and the availability check compares untrimmed, so an untrimmed
  // save is how two identical-looking names get past it (spec section 6).
  it('trims the name before storing it and before checking availability', async () => {
    const user = userEvent.setup();
    const profileExistsSpy = vi.spyOn(useProfileStore.getState(), 'profileExists');
    const addVirtualProfileSpy = vi.spyOn(useProfileStore.getState(), 'addVirtualProfile');

    render(<VirtualProfileDialog group={null} onClose={vi.fn()} />);

    await user.type(screen.getByTestId('virtual-profile-name'), '  Backyard  ');
    await user.click(screen.getByTestId('virtual-profile-member-p1'));
    await user.click(screen.getByTestId('virtual-profile-save'));

    expect(profileExistsSpy).toHaveBeenCalledWith('Backyard', undefined);
    expect(addVirtualProfileSpy).toHaveBeenCalledWith('Backyard', ['p1']);
  });

  it('refuses a blank name and writes nothing', async () => {
    const user = userEvent.setup();
    const addVirtualProfileSpy = vi.spyOn(useProfileStore.getState(), 'addVirtualProfile');

    render(<VirtualProfileDialog group={null} onClose={vi.fn()} />);

    await user.type(screen.getByTestId('virtual-profile-name'), '   ');
    await user.click(screen.getByTestId('virtual-profile-member-p1'));
    await user.click(screen.getByTestId('virtual-profile-save'));

    expect(screen.getByTestId('virtual-profile-error')).toHaveTextContent(
      'profiles.group_name_required'
    );
    expect(addVirtualProfileSpy).not.toHaveBeenCalled();
  });

  it('refuses a name another profile already uses', async () => {
    const user = userEvent.setup();
    const profileExistsSpy = vi.spyOn(useProfileStore.getState(), 'profileExists');
    const addVirtualProfileSpy = vi.spyOn(useProfileStore.getState(), 'addVirtualProfile');

    render(<VirtualProfileDialog group={null} onClose={vi.fn()} />);

    // 'Home' is HOME's own real name, seeded above - a genuine clash.
    await user.type(screen.getByTestId('virtual-profile-name'), 'Home');
    await user.click(screen.getByTestId('virtual-profile-member-p1'));
    await user.click(screen.getByTestId('virtual-profile-save'));

    expect(profileExistsSpy).toHaveBeenCalledWith('Home', undefined);
    expect(screen.getByTestId('virtual-profile-error')).toHaveTextContent(
      'profiles.group_name_taken'
    );
    expect(addVirtualProfileSpy).not.toHaveBeenCalled();
  });

  // A group keeps its own name across an edit, so the availability check has
  // to exclude it - otherwise saving an untouched group reports a clash with
  // itself.
  it('lets a group keep its own name while editing', async () => {
    const user = userEvent.setup();
    const group = { id: mintVirtualProfileId(), name: 'Backyard', memberProfileIds: ['p2' as ProfileId] };
    useProfileStore.setState({ virtualProfiles: [group] });
    const profileExistsSpy = vi.spyOn(useProfileStore.getState(), 'profileExists');
    const updateVirtualProfileSpy = vi.spyOn(useProfileStore.getState(), 'updateVirtualProfile');

    render(<VirtualProfileDialog group={group} onClose={vi.fn()} />);
    await user.click(screen.getByTestId('virtual-profile-save'));

    expect(profileExistsSpy).toHaveBeenCalledWith('Backyard', group.id);
    expect(updateVirtualProfileSpy).toHaveBeenCalled();
  });

  it('refuses a group with no members', async () => {
    const user = userEvent.setup();
    const addVirtualProfileSpy = vi.spyOn(useProfileStore.getState(), 'addVirtualProfile');

    render(<VirtualProfileDialog group={null} onClose={vi.fn()} />);

    await user.type(screen.getByTestId('virtual-profile-name'), 'Backyard');
    await user.click(screen.getByTestId('virtual-profile-save'));

    expect(screen.getByTestId('virtual-profile-error')).toHaveTextContent(
      'profiles.group_members_required'
    );
    expect(addVirtualProfileSpy).not.toHaveBeenCalled();
  });

  // Disabled profiles are legal members: scope resolution filters them out
  // while they stay disabled, and the group works again once re-enabled.
  it('offers a disabled profile as a member and marks it disabled', async () => {
    const user = userEvent.setup();
    seedVirtualProfileFixture([HOME, makeProfile('p2', { name: 'Office', disabled: true })]);
    const addVirtualProfileSpy = vi.spyOn(useProfileStore.getState(), 'addVirtualProfile');

    render(<VirtualProfileDialog group={null} onClose={vi.fn()} />);

    expect(screen.getByTestId('virtual-profile-member-row-p2')).toHaveTextContent(
      'profiles.disabled'
    );

    await user.type(screen.getByTestId('virtual-profile-name'), 'Backyard');
    await user.click(screen.getByTestId('virtual-profile-member-p2'));
    await user.click(screen.getByTestId('virtual-profile-save'));

    expect(addVirtualProfileSpy).toHaveBeenCalledWith('Backyard', ['p2']);
  });

  // The dialog's own checks cannot see a group deleted in another tab; the
  // store throw is the only signal, and it has to reach the user. This group
  // is never added to the real store's virtualProfiles, so updateVirtualProfile
  // throws its own real "not found" error - no fabricated throw needed.
  it('surfaces a store rejection the dialog could not predict', async () => {
    const user = userEvent.setup();
    const group = { id: mintVirtualProfileId(), name: 'Backyard', memberProfileIds: ['p2' as ProfileId] };
    const onClose = vi.fn();

    render(<VirtualProfileDialog group={group} onClose={onClose} />);
    await user.click(screen.getByTestId('virtual-profile-save'));

    expect(screen.getByTestId('virtual-profile-error')).toHaveTextContent(
      `Virtual profile ${group.id} not found`
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
