/**
 * Event Montage Grid Controls
 *
 * Dropdown menu and dialog for configuring grid layout in montage views.
 */

import { LayoutGrid } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '../ui/dropdown-menu';

interface EventMontageGridControlsProps {
  gridCols: number;
  customCols: string;
  isCustomGridDialogOpen: boolean;
  onApplyGridLayout: (cols: number) => void;
  onCustomColsChange: (value: string) => void;
  onCustomGridDialogOpenChange: (open: boolean) => void;
  onCustomGridSubmit: () => void;
}

export const EventMontageGridControls = ({
  gridCols,
  customCols,
  isCustomGridDialogOpen,
  onApplyGridLayout,
  onCustomColsChange,
  onCustomGridDialogOpenChange,
  onCustomGridSubmit,
}: EventMontageGridControlsProps) => {
  const { t } = useTranslation();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" title={t('eventMontage.grid_layout')} className="h-8 sm:h-9">
            <LayoutGrid className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">{t('eventMontage.columns', { count: gridCols })}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onApplyGridLayout(1)}>
            <LayoutGrid className="h-4 w-4 mr-2" />
            {t('eventMontage.columns', { count: 1 })}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onApplyGridLayout(2)}>
            <LayoutGrid className="h-4 w-4 mr-2" />
            {t('eventMontage.columns', { count: 2 })}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onApplyGridLayout(3)}>
            <LayoutGrid className="h-4 w-4 mr-2" />
            {t('eventMontage.columns', { count: 3 })}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onApplyGridLayout(4)}>
            <LayoutGrid className="h-4 w-4 mr-2" />
            {t('eventMontage.columns', { count: 4 })}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onApplyGridLayout(5)}>
            <LayoutGrid className="h-4 w-4 mr-2" />
            {t('eventMontage.columns', { count: 5 })}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onCustomGridDialogOpenChange(true)}>
            <LayoutGrid className="h-4 w-4 mr-2" />
            {t('eventMontage.custom')}...
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={isCustomGridDialogOpen} onOpenChange={onCustomGridDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('eventMontage.custom_grid_title')}</DialogTitle>
            <DialogDescription>{t('eventMontage.custom_grid_desc')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="custom-cols">{t('eventMontage.columns_label')}</Label>
              <Input
                id="custom-cols"
                type="number"
                min="1"
                max="10"
                value={customCols}
                onChange={(e) => onCustomColsChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    onCustomGridSubmit();
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onCustomGridDialogOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={onCustomGridSubmit}>{t('common.apply')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
