import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeleteBatchBar } from '../DeleteBatchBar';
import { useDeleteSelectionStore } from '../../../stores/deleteSelection';

const deleteEvents = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../hooks/useBulkDeleteEvents', () => ({
  useBulkDeleteEvents: () => ({ deleteEvents, isDeleting: false }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: { count?: number }) => `${k}:${o?.count ?? ''}` }),
}));

beforeEach(() => {
  useDeleteSelectionStore.getState().clear();
  deleteEvents.mockClear();
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
    expect(useDeleteSelectionStore.getState().selectedIds).toEqual([]);
  });

  it('deletes the selected ids on confirm', () => {
    useDeleteSelectionStore.getState().toggle('7');
    render(<DeleteBatchBar />);
    fireEvent.click(screen.getByTestId('delete-batch-confirm'));
    expect(deleteEvents).toHaveBeenCalledWith(['7']);
  });
});
