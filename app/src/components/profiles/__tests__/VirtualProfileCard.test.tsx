/**
 * The group card is a clickable div (it switches to the group) with two
 * buttons inside it. That combination is the whole hazard: a keydown on a
 * button bubbles to the card, and the card's handler used to preventDefault
 * it, cancelling the button's own activation and switching profiles instead
 * of editing. Keyboard and mouse have to agree on what each target does.
 * Refs #337.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VirtualProfileCard } from '../VirtualProfileCard';
import { mintVirtualProfileId } from '../../../api/types';
import type { ProfileId } from '../../../api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));

const GROUP = {
  id: mintVirtualProfileId(),
  name: 'Backyard',
  memberProfileIds: ['p1' as ProfileId, 'p2' as ProfileId],
};

const onSwitch = vi.fn();
const onEdit = vi.fn();
const onDelete = vi.fn();

function renderCard(
  overrides: { activeMemberCount?: number; memberUrls?: { label: string; url: string }[] } = {}
) {
  return render(
    <VirtualProfileCard
      group={GROUP}
      isActive={false}
      isSwitching={false}
      activeMemberCount={overrides.activeMemberCount ?? 2}
      memberUrls={overrides.memberUrls ?? []}
      onSwitch={onSwitch}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  );
}

describe('VirtualProfileCard', () => {
  beforeEach(() => {
    onSwitch.mockClear();
    onEdit.mockClear();
    onDelete.mockClear();
  });

  it('edits from the keyboard without switching profiles', async () => {
    const user = userEvent.setup();
    renderCard();

    screen.getByTestId(`profile-virtual-edit-${GROUP.id}`).focus();
    await user.keyboard('{Enter}');

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('deletes from the keyboard without switching profiles', async () => {
    const user = userEvent.setup();
    renderCard();

    screen.getByTestId(`profile-virtual-delete-${GROUP.id}`).focus();
    await user.keyboard(' ');

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('switches from its own button, like a profile row', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByTestId(`profile-virtual-switch-${GROUP.id}`));

    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('does not switch when the card body is clicked', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByTestId(`profile-card-virtual-${GROUP.id}`));

    // The card is a container, not a control: a stray tap on it while reading
    // the member list should not move the whole app to another server.
    expect(onSwitch).not.toHaveBeenCalled();
  });

  // A group whose members are all disabled or deleted aggregates nothing, and
  // switching to it lands on empty screens with no way to tell why. The card
  // stays fully editable and deletable, which is the only way back.
  describe('with no active members', () => {
    it('offers no switch at all', () => {
      renderCard({ activeMemberCount: 0 });

      expect(screen.queryByTestId(`profile-virtual-switch-${GROUP.id}`)).not.toBeInTheDocument();
    });

    it('says so instead of counting members', () => {
      renderCard({ activeMemberCount: 0 });

      const card = screen.getByTestId(`profile-card-virtual-${GROUP.id}`);
      expect(card).toHaveTextContent('profiles.group_no_active_members');
      expect(card).not.toHaveTextContent('profiles.group_member_count');
    });

    it('keeps edit and delete working', async () => {
      const user = userEvent.setup();
      renderCard({ activeMemberCount: 0 });

      await user.click(screen.getByTestId(`profile-virtual-edit-${GROUP.id}`));
      await user.click(screen.getByTestId(`profile-virtual-delete-${GROUP.id}`));

      expect(onEdit).toHaveBeenCalledTimes(1);
      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(onSwitch).not.toHaveBeenCalled();
    });
  });

  it('counts its members while at least one is active', () => {
    renderCard({ activeMemberCount: 1 });

    expect(screen.getByTestId(`profile-card-virtual-${GROUP.id}`)).toHaveTextContent(
      'profiles.group_member_count:{"count":2}'
    );
  });

  it('names the servers it aggregates, once opened', async () => {
    renderCard({
      memberUrls: [
        { label: 'Home', url: 'https://home.example.com/zm' },
        { label: 'Office', url: 'https://office.example.com/zm' },
      ],
    });

    // Folded away: the card is about the group, not its plumbing.
    expect(screen.queryByText('https://home.example.com/zm')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId(`profile-urls-virtual-${GROUP.id}-toggle`));
    expect(screen.getByText('https://home.example.com/zm')).toBeInTheDocument();
    expect(screen.getByText('https://office.example.com/zm')).toBeInTheDocument();
  });

  it('opening the addresses does not switch to the group', async () => {
    renderCard({ memberUrls: [{ label: 'Home', url: 'https://home.example.com/zm' }] });

    await userEvent.click(screen.getByTestId(`profile-urls-virtual-${GROUP.id}-toggle`));
    expect(onSwitch).not.toHaveBeenCalled();
  });
});
