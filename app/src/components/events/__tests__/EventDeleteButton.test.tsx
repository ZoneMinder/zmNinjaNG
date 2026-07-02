import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EventDeleteButton } from '../EventDeleteButton';

const deleteEvent = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../hooks/useDeleteEvent', () => ({
  useDeleteEvent: () => ({ deleteEvent, isDeleting: false }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

beforeEach(() => deleteEvent.mockClear());

describe('EventDeleteButton', () => {
  it('opens the confirm dialog and deletes on confirm', async () => {
    render(<EventDeleteButton eventId="42" eventName="Cam-42" monitorName="FrontDoor" />);
    fireEvent.click(screen.getByTestId('event-delete-button'));
    expect(screen.getByTestId('event-delete-dialog')).toBeTruthy();
    fireEvent.click(screen.getByTestId('event-delete-confirm'));
    expect(deleteEvent).toHaveBeenCalledWith('42');
  });

  it('does not delete when cancelled', () => {
    render(<EventDeleteButton eventId="42" eventName="Cam-42" monitorName="FrontDoor" />);
    fireEvent.click(screen.getByTestId('event-delete-button'));
    fireEvent.click(screen.getByTestId('event-delete-cancel'));
    expect(deleteEvent).not.toHaveBeenCalled();
  });

  it('stops click propagation so a parent row does not navigate', () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <EventDeleteButton eventId="42" eventName="Cam-42" />
      </div>
    );
    fireEvent.click(screen.getByTestId('event-delete-button'));
    expect(parentClick).not.toHaveBeenCalled();
  });
});
