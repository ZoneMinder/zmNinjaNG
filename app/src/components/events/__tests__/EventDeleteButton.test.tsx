import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EventDeleteButton } from '../EventDeleteButton';
import { useDeleteSelectionStore, eventSelectionKey } from '../../../stores/deleteSelection';
import { asProfileId } from '../../../api/types';

// Permission probe (refs #344); tests set the verdict they need.
let mockEventsPermission: string | undefined;
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    permissions: mockEventsPermission === undefined ? undefined : { events: mockEventsPermission },
    isLoading: false,
  }),
}));

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

const P1 = asProfileId('p1');
const P2 = asProfileId('p2');

beforeEach(() => useDeleteSelectionStore.getState().clear());

describe('EventDeleteButton', () => {
  it('toggles the event id in the selection store on click', () => {
    render(<EventDeleteButton eventId="42" />);
    fireEvent.click(screen.getByTestId('event-delete-button'));
    expect(useDeleteSelectionStore.getState().selectedKeys).toEqual(['42']);
    fireEvent.click(screen.getByTestId('event-delete-button'));
    expect(useDeleteSelectionStore.getState().selectedKeys).toEqual([]);
  });

  it('reflects the selected state via aria-pressed', () => {
    useDeleteSelectionStore.getState().toggle('42');
    render(<EventDeleteButton eventId="42" />);
    expect(screen.getByTestId('event-delete-button').getAttribute('aria-pressed')).toBe('true');
  });

  it('does not bubble the click to a parent row', () => {
    const parentClick = vi.fn();
    render(
      <div role="presentation" onClick={parentClick}>
        <EventDeleteButton eventId="42" />
      </div>
    );
    fireEvent.click(screen.getByTestId('event-delete-button'));
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('selecting one profile\'s event leaves the same raw id on another profile unselected', () => {
    render(
      <>
        <EventDeleteButton eventId="1234" profileId={P1} />
        <EventDeleteButton eventId="1234" profileId={P2} />
      </>
    );
    const [first, second] = screen.getAllByTestId('event-delete-button');
    fireEvent.click(first);
    expect(first.getAttribute('aria-pressed')).toBe('true');
    expect(second.getAttribute('aria-pressed')).toBe('false');
    expect(useDeleteSelectionStore.getState().selectedKeys).toEqual([eventSelectionKey(P1, '1234')]);
  });
});

/**
 * Queueing an event for deletion needs Events: Edit (refs #344).
 *
 * Greying beats hiding here: the button is what tells an administrator their
 * account is short a permission. It must still explain itself, which is why it
 * is aria-disabled rather than disabled - a disabled button would receive no
 * click and show no hint.
 */
describe('EventDeleteButton without permission to delete', () => {
  beforeEach(() => {
    mockEventsPermission = undefined;
    useDeleteSelectionStore.getState().clear();
  });

  it('greys the control and refuses to queue the event', () => {
    mockEventsPermission = 'View';

    render(<EventDeleteButton eventId="42" profileId={P1} />);
    const button = screen.getByTestId('event-delete-button');
    expect(button).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(button);

    expect(useDeleteSelectionStore.getState().selectedKeys).toEqual([]);
  });

  it('still queues when the account may delete', () => {
    mockEventsPermission = 'Edit';

    render(<EventDeleteButton eventId="42" profileId={P1} />);
    fireEvent.click(screen.getByTestId('event-delete-button'));

    expect(useDeleteSelectionStore.getState().selectedKeys).toEqual([eventSelectionKey(P1, '42')]);
  });

  it('still queues while the permission is unknown', () => {
    render(<EventDeleteButton eventId="42" profileId={P1} />);
    fireEvent.click(screen.getByTestId('event-delete-button'));

    expect(useDeleteSelectionStore.getState().selectedKeys).toEqual([eventSelectionKey(P1, '42')]);
  });
});
