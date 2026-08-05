import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MontageKebabMenu, type MontageVisibilityItem } from '../MontageKebabMenu';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Single mode: bare monitor ids, no owning-server label.
const items: MontageVisibilityItem[] = [
  { id: '1', name: 'Front Door' },
  { id: '2', name: 'Backyard' },
  { id: '3', name: 'Garage' },
];

// All mode: composite profileId:monitorId ids, one label per owning server.
// Both servers expose a monitor with the raw id "1" - the collision the
// composite id exists to keep apart (refs #337).
const allModeItems: MontageVisibilityItem[] = [
  { id: 'profile-1:1', name: 'Front Door', profileChip: 'Home' },
  { id: 'profile-2:1', name: 'Lobby Cam', profileChip: 'Office' },
];

describe('MontageKebabMenu', () => {
  const onToggleVisibility = vi.fn();

  beforeEach(() => {
    onToggleVisibility.mockClear();
  });

  it('renders the kebab trigger button', () => {
    render(
      <MontageKebabMenu
        items={items}
        hiddenMonitorIds={[]}
        onToggleVisibility={onToggleVisibility}
      />
    );
    expect(screen.getByTestId('montage-kebab-menu')).toBeInTheDocument();
  });

  it('opens menu and shows the visibility entry', async () => {
    const user = userEvent.setup();
    render(
      <MontageKebabMenu
        items={items}
        hiddenMonitorIds={[]}
        onToggleVisibility={onToggleVisibility}
      />
    );
    await user.click(screen.getByTestId('montage-kebab-menu'));
    expect(screen.getByTestId('montage-kebab-visibility')).toBeInTheDocument();
  });

  it('shows a checkbox per monitor, checked when visible, unchecked when hidden', async () => {
    const user = userEvent.setup();
    render(
      <MontageKebabMenu
        items={items}
        hiddenMonitorIds={['2']}
        onToggleVisibility={onToggleVisibility}
      />
    );
    await user.click(screen.getByTestId('montage-kebab-menu'));
    await user.hover(screen.getByTestId('montage-kebab-visibility'));

    const cb1 = await screen.findByTestId('montage-visibility-1');
    const cb2 = await screen.findByTestId('montage-visibility-2');
    const cb3 = await screen.findByTestId('montage-visibility-3');

    expect(cb1).toHaveAttribute('data-state', 'checked');
    expect(cb2).toHaveAttribute('data-state', 'unchecked');
    expect(cb3).toHaveAttribute('data-state', 'checked');
  });

  it('calls onToggleVisibility with the monitor id when a checkbox is toggled', async () => {
    const user = userEvent.setup();
    render(
      <MontageKebabMenu
        items={items}
        hiddenMonitorIds={[]}
        onToggleVisibility={onToggleVisibility}
      />
    );
    await user.click(screen.getByTestId('montage-kebab-menu'));
    await user.hover(screen.getByTestId('montage-kebab-visibility'));
    const cb2 = await screen.findByTestId('montage-visibility-2');
    // userEvent.click triggers focus/blur that collapses the Radix submenu in jsdom
    // before the select event fires. Use pointer press without pointer move instead.
    await user.pointer({ target: cb2, keys: '[MouseLeft]' });
    expect(onToggleVisibility).toHaveBeenCalledWith('2');
  });

  it('hides the visibility submenu when there are zero monitors', async () => {
    const user = userEvent.setup();
    render(
      <MontageKebabMenu
        items={[]}
        hiddenMonitorIds={[]}
        onToggleVisibility={onToggleVisibility}
      />
    );
    await user.click(screen.getByTestId('montage-kebab-menu'));
    expect(screen.queryByTestId('montage-kebab-visibility')).not.toBeInTheDocument();
  });

  it('renders items in the order given, since the page owns the sort', async () => {
    const user = userEvent.setup();
    render(
      <MontageKebabMenu
        items={[
          { id: '11', name: 'A-First' },
          { id: '12', name: 'B-Middle' },
          { id: '10', name: 'Z-Last' },
        ]}
        hiddenMonitorIds={[]}
        onToggleVisibility={onToggleVisibility}
      />
    );
    await user.click(screen.getByTestId('montage-kebab-menu'));
    await user.hover(screen.getByTestId('montage-kebab-visibility'));

    const entries = await screen.findAllByTestId(/^montage-visibility-/);
    expect(entries.map((el) => el.textContent)).toEqual(['A-First', 'B-Middle', 'Z-Last']);
  });

  // All mode: two servers can expose the same raw monitor id and the same
  // monitor name, so the list has to say which server each entry belongs to
  // and toggle by the composite id (refs #337).
  it('All mode labels each entry with its owning server', async () => {
    const user = userEvent.setup();
    render(
      <MontageKebabMenu
        items={allModeItems}
        hiddenMonitorIds={[]}
        onToggleVisibility={onToggleVisibility}
      />
    );
    await user.click(screen.getByTestId('montage-kebab-menu'));
    await user.hover(screen.getByTestId('montage-kebab-visibility'));

    expect(await screen.findByTestId('montage-visibility-chip-profile-1:1')).toHaveTextContent('Home');
    expect(await screen.findByTestId('montage-visibility-chip-profile-2:1')).toHaveTextContent('Office');
  });

  it('All mode checks each entry by composite id, so a colliding raw id stays independent', async () => {
    const user = userEvent.setup();
    render(
      <MontageKebabMenu
        items={allModeItems}
        hiddenMonitorIds={['profile-1:1']}
        onToggleVisibility={onToggleVisibility}
      />
    );
    await user.click(screen.getByTestId('montage-kebab-menu'));
    await user.hover(screen.getByTestId('montage-kebab-visibility'));

    expect(await screen.findByTestId('montage-visibility-profile-1:1')).toHaveAttribute(
      'data-state',
      'unchecked'
    );
    expect(await screen.findByTestId('montage-visibility-profile-2:1')).toHaveAttribute(
      'data-state',
      'checked'
    );
  });

  it('All mode toggles with the composite id, not the raw monitor id', async () => {
    const user = userEvent.setup();
    render(
      <MontageKebabMenu
        items={allModeItems}
        hiddenMonitorIds={[]}
        onToggleVisibility={onToggleVisibility}
      />
    );
    await user.click(screen.getByTestId('montage-kebab-menu'));
    await user.hover(screen.getByTestId('montage-kebab-visibility'));
    const entry = await screen.findByTestId('montage-visibility-profile-2:1');
    await user.pointer({ target: entry, keys: '[MouseLeft]' });
    expect(onToggleVisibility).toHaveBeenCalledWith('profile-2:1');
  });

  it('single mode renders no server label', async () => {
    const user = userEvent.setup();
    render(
      <MontageKebabMenu
        items={items}
        hiddenMonitorIds={[]}
        onToggleVisibility={onToggleVisibility}
      />
    );
    await user.click(screen.getByTestId('montage-kebab-menu'));
    await user.hover(screen.getByTestId('montage-kebab-visibility'));
    await screen.findByTestId('montage-visibility-1');
    expect(screen.queryAllByTestId(/^montage-visibility-chip-/)).toHaveLength(0);
  });
});
