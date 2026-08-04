import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EventDeleteButton } from '../EventDeleteButton';
import { useDeleteSelectionStore, eventSelectionKey } from '../../../stores/deleteSelection';
import { asProfileId } from '../../../api/types';

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
