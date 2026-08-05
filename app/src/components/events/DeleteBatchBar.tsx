/**
 * Floating bar shown while events are queued for bulk deletion (refs #213).
 * Rendered once app-wide; hidden when the selection is empty.
 */
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { useDeleteSelectionStore } from '../../stores/deleteSelection';
import { useBulkDeleteEvents } from '../../hooks/useBulkDeleteEvents';

export function DeleteBatchBar() {
  const { t } = useTranslation();
  const selectedKeys = useDeleteSelectionStore((s) => s.selectedKeys);
  const clear = useDeleteSelectionStore((s) => s.clear);
  const remove = useDeleteSelectionStore((s) => s.remove);
  const { deleteEvents, isDeleting } = useBulkDeleteEvents();

  if (selectedKeys.length === 0) return null;

  // Drop only what actually got deleted, so a profile whose deletes failed
  // keeps its events queued for a retry (refs #337).
  const onDelete = async () => {
    remove(await deleteEvents(selectedKeys));
  };

  return (
    <div
      className="fixed left-1/2 top-[calc(3.5rem+var(--sai-top,env(safe-area-inset-top)))] z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-background/95 px-4 py-2 shadow-lg backdrop-blur"
      role="region"
      aria-label={t('events.delete_selected', { count: selectedKeys.length })}
      data-testid="delete-batch-bar"
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <Trash2 className="h-4 w-4 text-destructive" />
        {t('events.delete_selected', { count: selectedKeys.length })}
      </span>
      <Button variant="ghost" size="sm" onClick={clear} data-testid="delete-batch-cancel">
        {t('common.cancel')}
      </Button>
      <Button
        size="sm"
        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onClick={onDelete}
        disabled={isDeleting}
        data-testid="delete-batch-confirm"
      >
        {t('common.delete')}
      </Button>
    </div>
  );
}
