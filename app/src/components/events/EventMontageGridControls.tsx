/**
 * Event Montage Grid Controls
 *
 * Wrapper around GridColumnsMenu for the event montage, events, and monitors views.
 * Grid state and custom column validation live in the caller (useEventMontageGrid).
 */

import { LayoutGrid } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { GridColumnsMenu, CustomColumnsDialog } from '../common/GridColumnsMenu';

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
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640); // sm breakpoint
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const presets = [1, 2, 3, 4, 5].map((cols) => ({
    cols,
    icon: LayoutGrid,
    label: t('eventMontage.columns', { count: cols }),
  }));

  return (
    <>
      <GridColumnsMenu
        isMobile={isMobile}
        gridCols={gridCols}
        title={t('eventMontage.grid_layout')}
        triggerIcon={LayoutGrid}
        triggerLabel={t('eventMontage.columns', { count: gridCols })}
        presets={presets}
        customIcon={LayoutGrid}
        customLabel={`${t('eventMontage.custom')}...`}
        onApplyGridLayout={onApplyGridLayout}
        onCustomSelect={() => onCustomGridDialogOpenChange(true)}
      />
      <CustomColumnsDialog
        open={isCustomGridDialogOpen}
        onOpenChange={onCustomGridDialogOpenChange}
        value={customCols}
        onValueChange={onCustomColsChange}
        onSubmit={onCustomGridSubmit}
        title={t('eventMontage.custom_grid_title')}
        description={t('eventMontage.custom_grid_desc')}
        columnsLabel={t('eventMontage.columns_label')}
        applyLabel={t('common.apply')}
      />
    </>
  );
};
