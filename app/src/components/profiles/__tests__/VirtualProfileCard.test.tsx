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

function renderCard(overrides: { activeMemberCount?: number } = {}) {
  return render(
    <VirtualProfileCard
      group={GROUP}
      isActive={false}
      isSwitching={false}
      activeMemberCount={overrides.activeMemberCount ?? 2}
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

  it('still switches when the card itself takes the key', async () => {
    const user = userEvent.setup();
    renderCard();

    screen.getByTestId(`profile-card-virtual-${GROUP.id}`).focus();
    await user.keyboard('{Enter}');

    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
  });

  // A group whose members are all disabled or deleted aggregates nothing, and
  // switching to it lands on empty screens with no way to tell why. The card
  // stays fully editable and deletable, which is the only way back.
  describe('with no active members', () => {
    it('refuses to switch by click or key', async () => {
      const user = userEvent.setup();
      renderCard({ activeMemberCount: 0 });

      const card = screen.getByTestId(`profile-card-virtual-${GROUP.id}`);
      await user.click(card);
      card.focus();
      await user.keyboard('{Enter}');

      expect(onSwitch).not.toHaveBeenCalled();
      expect(card).toHaveAttribute('aria-disabled', 'true');
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
});
