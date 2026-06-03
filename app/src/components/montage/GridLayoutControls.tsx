/**
 * Grid Layout Controls
 *
 * Mobile: Sheet with grid options + saved layouts
 * Desktop: DropdownMenu for column selection + saved layouts
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
  DropdownMenuLabel,
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
import { LayoutDashboard, Grid2x2, Grid3x3, GripVertical, LayoutGrid, Save, Trash2, Bookmark } from 'lucide-react';
import { toast } from 'sonner';
import type { Layout } from 'react-grid-layout';

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
  const [isGridSheetOpen, setIsGridSheetOpen] = useState(false);
  const [isCustomGridDialogOpen, setIsCustomGridDialogOpen] = useState(false);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [customCols, setCustomCols] = useState<string>(gridCols.toString());
  const [saveName, setSaveName] = useState('');

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

  const presetItems = [
    { cols: 1, icon: LayoutGrid, label: t('montage.1col') },
    { cols: 2, icon: Grid2x2, label: t('montage.2col') },
    { cols: 3, icon: Grid3x3, label: t('montage.3col') },
    { cols: 4, icon: LayoutGrid, label: t('montage.4col') },
    { cols: 5, icon: LayoutGrid, label: t('montage.5col') },
  ];

  if (isMobile) {
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          title={t('montage.layout')}
          className="h-8 sm:h-9"
          data-testid="montage-layout-trigger"
          data-grid-cols={gridCols}
          onClick={() => setIsGridSheetOpen(true)}
        >
          <LayoutDashboard className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">
            {activeLayoutName || `${gridCols} ${t('montage.columns_label')}`}
          </span>
        </Button>
        <Sheet open={isGridSheetOpen} onOpenChange={setIsGridSheetOpen}>
          <SheetContent side="bottom">
            <SheetHeader>
              <SheetTitle>{t('montage.layout')}</SheetTitle>
            </SheetHeader>
            <div className="grid gap-2 py-4">
              {presetItems.map(({ cols, icon: Icon, label }) => (
                <Button
                  key={cols}
                  variant={gridCols === cols ? 'default' : 'outline'}
                  data-testid={`montage-grid-preset-${cols}`}
                  onClick={() => handleGridSelection(cols)}
                  className="justify-start"
                >
                  <Icon className="h-4 w-4 mr-2" />
                  {label}
                </Button>
              ))}
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
                          setIsGridSheetOpen(false);
                        }}
                        className="justify-start flex-1"
                      >
                        <Bookmark className="h-4 w-4 mr-2" />
                        {saved.name}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-destructive shrink-0"
                        onClick={(e) => handleDeleteLayout(index, saved.name, e)}
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
                  setIsGridSheetOpen(false);
                  setIsSaveDialogOpen(true);
                }}
                className="justify-start"
              >
                <Save className="h-4 w-4 mr-2" />
                {t('montage.save_layout')}
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

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            title={t('montage.layout')}
            className="h-8 sm:h-9"
            data-testid="montage-layout-trigger"
            data-grid-cols={gridCols}
          >
            <LayoutDashboard className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">
              {activeLayoutName || `${gridCols} ${t('montage.columns_label')}`}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {presetItems.map(({ cols, icon: Icon, label }) => (
            <DropdownMenuItem
              key={cols}
              data-testid={`montage-grid-preset-${cols}`}
              onClick={() => onApplyGridLayout(cols)}
            >
              <Icon className="h-4 w-4 mr-2" />
              {label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setIsCustomGridDialogOpen(true)}>
            <GripVertical className="h-4 w-4 mr-2" />
            {t('montage.custom')}
          </DropdownMenuItem>

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
                >
                  <span className="flex items-center">
                    <Bookmark className="h-4 w-4 mr-2" />
                    {saved.name}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-destructive hover:text-destructive ml-2 shrink-0"
                    onClick={(e) => handleDeleteLayout(index, saved.name, e)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </DropdownMenuItem>
              ))}
            </>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setIsSaveDialogOpen(true)}>
            <Save className="h-4 w-4 mr-2" />
            {t('montage.save_layout')}
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
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onSubmit}>
            <Save className="h-4 w-4 mr-2" />
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
