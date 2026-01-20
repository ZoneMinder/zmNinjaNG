/**
 * Grid Layout Controls
 *
 * Mobile: Sheet with grid options
 * Desktop: DropdownMenu for column selection
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '../ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../ui/sheet';
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
import { LayoutDashboard, Grid2x2, Grid3x3, GripVertical, LayoutGrid } from 'lucide-react';
import { toast } from 'sonner';

interface GridLayoutControlsProps {
  isMobile: boolean;
  gridCols: number;
  onApplyGridLayout: (cols: number) => void;
}

export function GridLayoutControls({
  isMobile,
  gridCols,
  onApplyGridLayout,
}: GridLayoutControlsProps) {
  const { t } = useTranslation();
  const [isGridSheetOpen, setIsGridSheetOpen] = useState(false);
  const [isCustomGridDialogOpen, setIsCustomGridDialogOpen] = useState(false);
  const [customCols, setCustomCols] = useState<string>(gridCols.toString());

  const handleGridSelection = (cols: number) => {
    onApplyGridLayout(cols);
    setIsGridSheetOpen(false);
  };

  const handleCustomGridSubmit = () => {
    const cols = parseInt(customCols, 10);

    if (isNaN(cols) || cols < 1 || cols > 10) {
      toast.error(t('montage.invalid_columns'));
      return;
    }

    onApplyGridLayout(cols);
    setIsCustomGridDialogOpen(false);
  };

  if (isMobile) {
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          title={t('montage.layout')}
          className="h-8 sm:h-9"
          onClick={() => setIsGridSheetOpen(true)}
        >
          <LayoutDashboard className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">
            {gridCols} {t('montage.columns_label')}
          </span>
        </Button>
        <Sheet open={isGridSheetOpen} onOpenChange={setIsGridSheetOpen}>
          <SheetContent side="bottom">
            <SheetHeader>
              <SheetTitle>{t('montage.layout')}</SheetTitle>
            </SheetHeader>
            <div className="grid gap-2 py-4">
              <Button
                variant={gridCols === 1 ? 'default' : 'outline'}
                onClick={() => handleGridSelection(1)}
                className="justify-start"
              >
                <LayoutGrid className="h-4 w-4 mr-2" />
                {t('montage.1col')}
              </Button>
              <Button
                variant={gridCols === 2 ? 'default' : 'outline'}
                onClick={() => handleGridSelection(2)}
                className="justify-start"
              >
                <Grid2x2 className="h-4 w-4 mr-2" />
                {t('montage.2col')}
              </Button>
              <Button
                variant={gridCols === 3 ? 'default' : 'outline'}
                onClick={() => handleGridSelection(3)}
                className="justify-start"
              >
                <Grid3x3 className="h-4 w-4 mr-2" />
                {t('montage.3col')}
              </Button>
              <Button
                variant={gridCols === 4 ? 'default' : 'outline'}
                onClick={() => handleGridSelection(4)}
                className="justify-start"
              >
                <LayoutGrid className="h-4 w-4 mr-2" />
                {t('montage.4col')}
              </Button>
              <Button
                variant={gridCols === 5 ? 'default' : 'outline'}
                onClick={() => handleGridSelection(5)}
                className="justify-start"
              >
                <LayoutGrid className="h-4 w-4 mr-2" />
                {t('montage.5col')}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setIsGridSheetOpen(false);
                  setIsCustomGridDialogOpen(true);
                }}
                className="justify-start"
              >
                <GripVertical className="h-4 w-4 mr-2" />
                {t('montage.custom')}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
        <CustomColumnsDialog
          open={isCustomGridDialogOpen}
          onOpenChange={setIsCustomGridDialogOpen}
          customCols={customCols}
          setCustomCols={setCustomCols}
          onSubmit={handleCustomGridSubmit}
        />
      </>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" title={t('montage.layout')} className="h-8 sm:h-9">
            <LayoutDashboard className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">
              {gridCols} {t('montage.columns_label')}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onApplyGridLayout(1)}>
            <LayoutGrid className="h-4 w-4 mr-2" />
            {t('montage.1col')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onApplyGridLayout(2)}>
            <Grid2x2 className="h-4 w-4 mr-2" />
            {t('montage.2col')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onApplyGridLayout(3)}>
            <Grid3x3 className="h-4 w-4 mr-2" />
            {t('montage.3col')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onApplyGridLayout(4)}>
            <LayoutGrid className="h-4 w-4 mr-2" />
            {t('montage.4col')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onApplyGridLayout(5)}>
            <LayoutGrid className="h-4 w-4 mr-2" />
            {t('montage.5col')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setIsCustomGridDialogOpen(true)}>
            <GripVertical className="h-4 w-4 mr-2" />
            {t('montage.custom')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CustomColumnsDialog
        open={isCustomGridDialogOpen}
        onOpenChange={setIsCustomGridDialogOpen}
        customCols={customCols}
        setCustomCols={setCustomCols}
        onSubmit={handleCustomGridSubmit}
      />
    </>
  );
}

interface CustomColumnsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customCols: string;
  setCustomCols: (value: string) => void;
  onSubmit: () => void;
}

function CustomColumnsDialog({
  open,
  onOpenChange,
  customCols,
  setCustomCols,
  onSubmit,
}: CustomColumnsDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('montage.custom_grid_title')}</DialogTitle>
          <DialogDescription>{t('montage.custom_grid_desc')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="custom-cols">{t('montage.columns_label')}</Label>
            <Input
              id="custom-cols"
              type="number"
              min="1"
              max="10"
              value={customCols}
              onChange={(e) => setCustomCols(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onSubmit();
                }
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onSubmit}>{t('montage.apply')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
