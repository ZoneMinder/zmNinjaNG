import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EventDeleteButton } from '../EventDeleteButton';
import { useDeleteSelectionStore } from '../../../stores/deleteSelection';

beforeEach(() => useDeleteSelectionStore.getState().clear());

describe('EventDeleteButton', () => {
  it('toggles the event id in the selection store on click', () => {
    render(<EventDeleteButton eventId="42" />);
    fireEvent.click(screen.getByTestId('event-delete-button'));
    expect(useDeleteSelectionStore.getState().selectedIds).toEqual(['42']);
    fireEvent.click(screen.getByTestId('event-delete-button'));
    expect(useDeleteSelectionStore.getState().selectedIds).toEqual([]);
  });

  it('reflects the selected state via aria-pressed', () => {
    useDeleteSelectionStore.getState().toggle('42');
    render(<EventDeleteButton eventId="42" />);
    expect(screen.getByTestId('event-delete-button').getAttribute('aria-pressed')).toBe('true');
  });

  it('does not bubble the click to a parent row', () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <EventDeleteButton eventId="42" />
      </div>
    );
    fireEvent.click(screen.getByTestId('event-delete-button'));
    expect(parentClick).not.toHaveBeenCalled();
  });
});
