/**
 * Grid Layout Controls
 *
 * Montage wrapper around GridColumnsMenu.
 * Adds save/load/delete layout menu sections and dialogs.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '../ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { LayoutDashboard, Grid2x2, Grid3x3, GripVertical, LayoutGrid, Save, Trash2, Bookmark } from 'lucide-react';
import { toast } from 'sonner';
import type { Layout } from 'react-grid-layout';
import { GridColumnsMenu, CustomColumnsDialog } from '../common/GridColumnsMenu';

interface SavedLayout {
  name: string;
  layout: Layout[];
  displayCols: number;
}

interface GridLayoutControlsProps {
  isMobile: boolean;
  gridCols: number;
  activeLayoutName: string | null;
  onApplyGridLayout: (cols: number) => void;
  savedLayouts: SavedLayout[];
  onSaveLayout: (name: string) => void;
  onLoadLayout: (saved: SavedLayout) => void;
  onDeleteLayout: (index: number) => void;
}

export function GridLayoutControls({
  isMobile,
  gridCols,
  activeLayoutName,
  onApplyGridLayout,
  savedLayouts,
  onSaveLayout,
  onLoadLayout,
  onDeleteLayout,
}: GridLayoutControlsProps) {
  const { t } = useTranslation();
  const [isCustomGridDialogOpen, setIsCustomGridDialogOpen] = useState(false);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [customCols, setCustomCols] = useState<string>(gridCols.toString());
  const [saveName, setSaveName] = useState('');

  const handleCustomGridSubmit = () => {
    const cols = parseInt(customCols, 10);

    if (isNaN(cols) || cols < 1 || cols > 10) {
      toast.error(t('montage.invalid_columns'));
      return;
    }

    onApplyGridLayout(cols);
    setIsCustomGridDialogOpen(false);
  };

  const handleSaveSubmit = () => {
    const name = saveName.trim();
    if (!name) {
      toast.error(t('montage.save_name_required'));
      return;
    }
    onSaveLayout(name);
    setSaveName('');
    setIsSaveDialogOpen(false);
    toast.success(t('montage.layout_saved', { name }));
  };

  const handleDeleteLayout = (index: number, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onDeleteLayout(index);
    toast.success(t('montage.layout_deleted', { name }));
  };

  const presets = [
    { cols: 1, icon: LayoutGrid, label: t('montage.1col'), testId: 'montage-grid-preset-1' },
    { cols: 2, icon: Grid2x2, label: t('montage.2col'), testId: 'montage-grid-preset-2' },
    { cols: 3, icon: Grid3x3, label: t('montage.3col'), testId: 'montage-grid-preset-3' },
    { cols: 4, icon: LayoutGrid, label: t('montage.4col'), testId: 'montage-grid-preset-4' },
    { cols: 5, icon: LayoutGrid, label: t('montage.5col'), testId: 'montage-grid-preset-5' },
  ];

  return (
    <>
      <GridColumnsMenu
        isMobile={isMobile}
        gridCols={gridCols}
        title={t('montage.layout')}
        triggerIcon={LayoutDashboard}
        triggerLabel={activeLayoutName || `${gridCols} ${t('montage.columns_label')}`}
        triggerTestId="montage-layout-trigger"
        showGridColsAttr
        presets={presets}
        customIcon={GripVertical}
        customLabel={t('montage.custom')}
        onApplyGridLayout={onApplyGridLayout}
        onCustomSelect={() => setIsCustomGridDialogOpen(true)}
        renderSheetExtras={(closeSheet) => (
          <>
            {savedLayouts.length > 0 && (
              <>
                <div className="text-xs font-medium text-muted-foreground pt-2 px-1">
                  {t('montage.saved_layouts')}
                </div>
                {savedLayouts.map((saved, index) => (
                  <div key={index} className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      onClick={() => {
                        onLoadLayout(saved);
                        closeSheet();
                      }}
                      className="justify-start flex-1"
                      data-testid={`montage-load-layout-sheet-${index}`}
                    >
                      <Bookmark className="h-4 w-4 mr-2" />
                      {saved.name}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-destructive shrink-0"
                      aria-label={`${t('common.delete')}: ${saved.name}`}
                      onClick={(e) => handleDeleteLayout(index, saved.name, e)}
                      data-testid={`montage-delete-layout-sheet-${index}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </>
            )}
            <Button
              variant="outline"
              onClick={() => {
                closeSheet();
                setIsSaveDialogOpen(true);
              }}
              className="justify-start"
              data-testid="montage-save-layout-sheet-trigger"
            >
              <Save className="h-4 w-4 mr-2" />
              {t('montage.save_layout')}
            </Button>
          </>
        )}
        renderMenuExtras={() => (
          <>
            {savedLayouts.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs">
                  {t('montage.saved_layouts')}
                </DropdownMenuLabel>
                {savedLayouts.map((saved, index) => (
                  <DropdownMenuItem
                    key={index}
                    onClick={() => onLoadLayout(saved)}
                    className="flex items-center justify-between"
                    data-testid={`montage-load-layout-menu-${index}`}
                  >
                    <span className="flex items-center">
                      <Bookmark className="h-4 w-4 mr-2" />
                      {saved.name}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-destructive hover:text-destructive ml-2 shrink-0"
                      aria-label={`${t('common.delete')}: ${saved.name}`}
                      onClick={(e) => handleDeleteLayout(index, saved.name, e)}
                      data-testid={`montage-delete-layout-menu-${index}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </DropdownMenuItem>
                ))}
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setIsSaveDialogOpen(true)} data-testid="montage-save-layout-menu-trigger">
              <Save className="h-4 w-4 mr-2" />
              {t('montage.save_layout')}
            </DropdownMenuItem>
          </>
        )}
      />
      <CustomColumnsDialog
        open={isCustomGridDialogOpen}
        onOpenChange={setIsCustomGridDialogOpen}
        value={customCols}
        onValueChange={setCustomCols}
        onSubmit={handleCustomGridSubmit}
        title={t('montage.custom_grid_title')}
        description={t('montage.custom_grid_desc')}
        columnsLabel={t('montage.columns_label')}
        applyLabel={t('montage.apply')}
      />
      <SaveLayoutDialog
        open={isSaveDialogOpen}
        onOpenChange={setIsSaveDialogOpen}
        name={saveName}
        setName={setSaveName}
        onSubmit={handleSaveSubmit}
      />
    </>
  );
}

interface SaveLayoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  setName: (value: string) => void;
  onSubmit: () => void;
}

function SaveLayoutDialog({
  open,
  onOpenChange,
  name,
  setName,
  onSubmit,
}: SaveLayoutDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('montage.save_layout')}</DialogTitle>
          <DialogDescription>{t('montage.save_layout_desc')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="layout-name">{t('montage.layout_name')}</Label>
            <Input
              id="layout-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSubmit();
              }}
              placeholder={t('montage.layout_name_placeholder')}
              autoFocus
              data-testid="montage-save-layout-name-input"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="montage-save-layout-cancel">
            {t('common.cancel')}
          </Button>
          <Button onClick={onSubmit} data-testid="montage-save-layout-confirm">
            <Save className="h-4 w-4 mr-2" />
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
