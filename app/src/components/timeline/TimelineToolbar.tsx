/**
 * TimelineToolbar
 *
 * Control row above the timeline canvas: zoom, brush-to-zoom, live mode,
 * center view, go to now, and the help popover.
 */

import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Crosshair, ZoomIn, ZoomOut, SkipForward, RectangleHorizontal, Info, Move, HandMetal, Radio, ChevronsUpDown } from 'lucide-react';

interface TimelineToolbarProps {
  brushMode: boolean;
  liveMode: boolean;
  onToggleBrush: () => void;
  onToggleLive: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCenter: () => void;
  onGoToNow: () => void;
  scrollPadOn: boolean;
  onToggleScrollPad: () => void;
}

export function TimelineToolbar({
  brushMode,
  liveMode,
  onToggleBrush,
  onToggleLive,
  onZoomIn,
  onZoomOut,
  onCenter,
  onGoToNow,
  scrollPadOn,
  onToggleScrollPad,
}: TimelineToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="mb-2 flex items-center justify-between">
      <div className="flex items-center gap-1">
        <Button
          variant={scrollPadOn ? 'default' : 'outline'}
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          onClick={onToggleScrollPad}
          title={t('common.scroll_buttons')}
          aria-label={t('common.scroll_buttons')}
          aria-pressed={scrollPadOn}
          data-testid="timeline-scroll-pad-toggle"
        >
          <ChevronsUpDown className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          onClick={onZoomIn}
          title={t('timeline.zoom_in')}
          data-testid="timeline-zoom-in-button"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          onClick={onZoomOut}
          title={t('timeline.zoom_out')}
          data-testid="timeline-zoom-out-button"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          variant={brushMode ? 'default' : 'outline'}
          aria-pressed={brushMode}
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          onClick={onToggleBrush}
          title={t('timeline.select_to_zoom')}
          data-testid="timeline-brush-zoom-button"
        >
          <RectangleHorizontal className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant={liveMode ? 'default' : 'outline'}
          aria-pressed={liveMode}
          size="icon"
          className={`h-6 w-6 ${liveMode ? 'text-red-50 bg-red-600 hover:bg-red-700' : 'text-muted-foreground'}`}
          onClick={onToggleLive}
          title={t('timeline.live')}
          data-testid="timeline-live-toggle"
        >
          <Radio className={`h-3.5 w-3.5 ${liveMode ? 'animate-pulse' : ''}`} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          onClick={onCenter}
          title={t('timeline.center_view')}
          data-testid="timeline-center-button"
        >
          <Crosshair className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          onClick={onGoToNow}
          title={t('timeline.go_to_now')}
          data-testid="timeline-go-to-now-button"
        >
          <SkipForward className="h-4 w-4" />
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              title={t('sidebar.help')}
              aria-label={t('sidebar.help')}
              data-testid="timeline-help-button"
            >
              <Info className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto text-xs space-y-1.5 p-3" side="bottom" align="end">
            {(() => {
              const hasPointer = window.matchMedia('(pointer: fine)').matches;
              const HelpRow = ({ icon, text }: { icon: React.ReactNode; text: string }) => (
                <div className="flex items-center gap-2 text-muted-foreground">{icon}{text}</div>
              );
              return (
                <>
                  <p className="font-medium text-foreground mb-2">{t('timeline.help.title')}</p>
                  <HelpRow icon={<Move className="h-3.5 w-3.5 shrink-0 text-foreground/60" />} text={t('timeline.help.navigate')} />
                  <HelpRow icon={<RectangleHorizontal className="h-3.5 w-3.5 shrink-0 text-foreground/60" />} text={t('timeline.help.brush')} />
                  {hasPointer && <HelpRow icon={<HandMetal className="h-3.5 w-3.5 shrink-0 text-foreground/60" />} text={t('timeline.help.shift_drag')} />}
                  <HelpRow icon={<span className="inline-block h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: '#00a8ff' }} />} text={t('timeline.help.scrubber')} />
                  <HelpRow icon={<Crosshair className="h-3.5 w-3.5 shrink-0 text-foreground/60" />} text={t('timeline.help.center')} />
                  <HelpRow icon={<SkipForward className="h-3.5 w-3.5 shrink-0 text-foreground/60" />} text={t('timeline.help.go_now')} />
                  <HelpRow icon={<Radio className="h-3.5 w-3.5 shrink-0 text-foreground/60" />} text={t('timeline.help.live')} />
                </>
              );
            })()}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
