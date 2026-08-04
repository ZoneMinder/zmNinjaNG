import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeleteBatchBar } from '../DeleteBatchBar';
import { useDeleteSelectionStore, eventSelectionKey } from '../../../stores/deleteSelection';
import { asProfileId } from '../../../api/types';

const P1 = asProfileId('p1');
const P2 = asProfileId('p2');

const deleteEvents = vi.fn().mockResolvedValue([]);
vi.mock('../../../hooks/useBulkDeleteEvents', () => ({
  useBulkDeleteEvents: () => ({ deleteEvents, isDeleting: false }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: { count?: number }) => `${k}:${o?.count ?? ''}` }),
}));

beforeEach(() => {
  useDeleteSelectionStore.getState().clear();
  deleteEvents.mockClear();
  deleteEvents.mockResolvedValue([]);
});

describe('DeleteBatchBar', () => {
  it('is hidden when the selection is empty', () => {
    render(<DeleteBatchBar />);
    expect(screen.queryByTestId('delete-batch-bar')).toBeNull();
  });

  it('shows the count and clears on cancel', () => {
    useDeleteSelectionStore.getState().toggle('1');
    useDeleteSelectionStore.getState().toggle('2');
    render(<DeleteBatchBar />);
    expect(screen.getByTestId('delete-batch-bar')).toBeTruthy();
    expect(screen.getByText(/delete_selected:2/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('delete-batch-cancel'));
    expect(useDeleteSelectionStore.getState().selectedKeys).toEqual([]);
  });

  it('deletes the selected keys on confirm', () => {
    useDeleteSelectionStore.getState().toggle('7');
    render(<DeleteBatchBar />);
    fireEvent.click(screen.getByTestId('delete-batch-confirm'));
    expect(deleteEvents).toHaveBeenCalledWith(['7']);
  });

  it('keeps the events that failed to delete selected', async () => {
    const kept = eventSelectionKey(P2, '2');
    useDeleteSelectionStore.getState().toggle(eventSelectionKey(P1, '1'));
    useDeleteSelectionStore.getState().toggle(kept);
    deleteEvents.mockResolvedValue([eventSelectionKey(P1, '1')]);

    render(<DeleteBatchBar />);
    fireEvent.click(screen.getByTestId('delete-batch-confirm'));

    await waitFor(() =>
      expect(useDeleteSelectionStore.getState().selectedKeys).toEqual([kept]));
    expect(screen.getByText(/delete_selected:1/)).toBeTruthy();
  });
});
