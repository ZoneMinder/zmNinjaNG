/**
 * Fullscreen Overlay
 *
 * Header overlay shown in fullscreen mode with controls.
 */

import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { RefreshCw, LayoutDashboard, Pencil, Minimize, X } from 'lucide-react';

interface FullscreenOverlayProps {
  isEditMode: boolean;
  onEditModeToggle: () => void;
  onRefetch: () => void;
  onExitFullscreen: () => void;
  onClose: () => void;
}

export function FullscreenOverlay({
  isEditMode,
  onEditModeToggle,
  onRefetch,
  onExitFullscreen,
  onClose,
}: FullscreenOverlayProps) {
  const { t } = useTranslation();

  return (
    <div className="absolute top-0 left-0 right-0 z-50 bg-black/90 backdrop-blur-md border-b border-white/10">
      <div className="flex items-center justify-between p-2 sm:p-3 flex-wrap gap-2">
        <h2 className="text-white font-semibold flex items-center gap-2 text-sm sm:text-base">
          <LayoutDashboard className="h-4 w-4 sm:h-5 sm:w-5" />
          {t('montage.title')}
        </h2>
        <div className="flex items-center gap-1 sm:gap-2">
          <Button
            onClick={onRefetch}
            variant="ghost"
            size="sm"
            className="text-white hover:bg-white/10 h-8 sm:h-9"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            onClick={onEditModeToggle}
            variant={isEditMode ? 'default' : 'ghost'}
            size="sm"
            className="text-white hover:bg-white/10 h-8 sm:h-9"
            title={isEditMode ? t('montage.done_editing') : t('montage.edit_layout')}
            data-testid="montage-edit-toggle"
          >
            <Pencil className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">
              {isEditMode ? t('montage.done_editing') : t('montage.edit_layout')}
            </span>
          </Button>
          <Button
            onClick={onExitFullscreen}
            variant="default"
            size="sm"
            className="bg-red-600 hover:bg-red-700 text-white h-8 sm:h-9"
            title={t('montage.exit_fullscreen')}
          >
            <Minimize className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">{t('montage.exit')}</span>
          </Button>
          {window.innerWidth >= 768 && (
            <Button
              onClick={onClose}
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/10 h-8 w-8 sm:h-9 sm:w-9"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
