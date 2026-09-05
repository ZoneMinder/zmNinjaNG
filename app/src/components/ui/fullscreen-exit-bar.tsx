import { useTranslation } from 'react-i18next';
import { Minimize2 } from 'lucide-react';
import { Button } from './button';

interface FullscreenExitBarProps {
  title: string;
  onExit: () => void;
  /** Prefix for the bar and button test ids, e.g. `monitor-detail`. */
  testIdPrefix: string;
}

/**
 * The strip along the top of an app-level (CSS) fullscreen page: the subject's
 * name and the one way out. Shared by Monitor Detail and ZMS event playback.
 * Landscape corners: Android reports no side inset, and the rounded corner
 * then swallowed the Exit button, so the end padding is never under 1.25rem.
 */
export function FullscreenExitBar({ title, onExit, testIdPrefix }: FullscreenExitBarProps) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 bg-black/50 backdrop-blur-sm pl-[max(1.25rem,var(--sai-left,env(safe-area-inset-left)))] pr-[max(1.25rem,var(--sai-right,env(safe-area-inset-right)))] pt-[var(--sai-top,env(safe-area-inset-top))]"
      data-testid={`${testIdPrefix}-fullscreen-toolbar`}
    >
      <div className="h-[var(--fullscreen-toolbar-h)] flex items-center justify-between px-3">
        <span className="text-white/70 font-medium text-xs truncate min-w-0" title={title}>
          {title}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="bg-red-600/80 hover:bg-red-600 text-white h-7 px-2 text-xs"
          onClick={onExit}
          aria-label={t('monitor_detail.exit_fullscreen')}
          data-testid={`${testIdPrefix}-exit-fullscreen`}
        >
          <Minimize2 className="h-3.5 w-3.5 mr-1" />
          {t('monitor_detail.exit')}
        </Button>
      </div>
    </div>
  );
}
