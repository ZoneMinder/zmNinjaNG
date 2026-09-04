/**
 * One info button per monitor that opens the facts a card face used to carry
 * as unlabelled badges: the capture pipeline (Capturing, Analysing, Recording,
 * Decoding on ZM 1.38+, Function before that), then resolution and frame
 * rate. Hover or tap, labelled, and Decoding finally has a home in the UI
 * (refs #467; on-demand decoding is behind #383 and #461).
 */
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu, Disc, Eye, Gauge, Info, Proportions, Video } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { HintButton } from '../ui/button';
import { cn } from '../../lib/utils';
import { ZM_DECODING_ALWAYS } from '../../lib/zm/zm-constants';
import type { Monitor } from '../../api/types';

/** Long enough to cross the gap between trigger and popover with a mouse. */
const HOVER_CLOSE_DELAY_MS = 150;

interface MonitorInfoPopoverProps {
  monitor: Monitor;
  /** Trigger sizing, so each surface keeps its own icon scale. */
  className?: string;
  iconClassName?: string;
}

interface InfoRow {
  key: string;
  icon: ReactNode;
  label: string;
  value: string;
  emphasis?: boolean;
}

export function MonitorInfoPopover({ monitor, className, iconClassName }: MonitorInfoPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // Mouse: open on hover, close a beat after leaving trigger and content, and
  // swallow the click that would otherwise toggle a hover-opened popover shut.
  // Touch and keyboard never enter here; Radix's own toggle serves them.
  const hoverOpenedRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };
  const hoverOpen = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    cancelClose();
    if (!open) hoverOpenedRef.current = true;
    setOpen(true);
  };
  const hoverClose = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    cancelClose();
    closeTimerRef.current = setTimeout(() => {
      hoverOpenedRef.current = false;
      setOpen(false);
    }, HOVER_CLOSE_DELAY_MS);
  };
  const iconClass = 'h-3 w-3';
  const splitFields = monitor.Capturing !== undefined;
  const decodesOnDemand = !!monitor.Decoding && monitor.Decoding !== ZM_DECODING_ALWAYS;
  const maxFps = monitor.MaxFPS && Number(monitor.MaxFPS) > 0 ? monitor.MaxFPS : t('monitors.unlimited');

  const pipeline: InfoRow[] = splitFields
    ? [
        { key: 'capturing', icon: <Video className={iconClass} />, label: t('monitors.capturing'), value: monitor.Capturing ?? '' },
        { key: 'analysing', icon: <Eye className={iconClass} />, label: t('monitors.analysing'), value: monitor.Analysing ?? '' },
        { key: 'recording', icon: <Disc className={iconClass} />, label: t('monitors.recording'), value: monitor.Recording ?? '' },
        { key: 'decoding', icon: <Cpu className={iconClass} />, label: t('monitors.decoding'), value: monitor.Decoding ?? '', emphasis: decodesOnDemand },
      ]
    : [{ key: 'function', icon: <Video className={iconClass} />, label: t('monitors.function'), value: monitor.Function ?? '' }];

  const stream: InfoRow[] = [
    { key: 'resolution', icon: <Proportions className={iconClass} />, label: t('monitors.resolution'), value: `${monitor.Width}x${monitor.Height}` },
    { key: 'max_fps', icon: <Gauge className={iconClass} />, label: t('monitors.max_fps'), value: maxFps },
  ];

  const renderRows = (rows: InfoRow[]) =>
    rows.map((row) => (
      <div key={row.key} className="contents">
        <span className="text-muted-foreground/70" aria-hidden="true">{row.icon}</span>
        <span className="text-muted-foreground">{row.label}</span>
        <span
          className={cn('text-right font-medium tabular-nums', row.emphasis && 'text-amber-600 dark:text-amber-400')}
          data-testid={`monitor-info-${row.key}`}
        >
          {row.value}
        </span>
      </div>
    ));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <HintButton
          type="button"
          className={cn('shrink-0 text-muted-foreground hover:text-foreground', className)}
          onClick={(e) => {
            e.stopPropagation();
            if (hoverOpenedRef.current) {
              hoverOpenedRef.current = false;
              e.preventDefault();
            }
          }}
          onPointerEnter={hoverOpen}
          onPointerLeave={hoverClose}
          title={t('monitors.info_button')}
          aria-label={t('monitors.info_button')}
          data-testid="monitor-info-btn"
        >
          <Info className={cn('h-3.5 w-3.5', iconClassName)} />
        </HintButton>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-64 p-0 text-xs"
        onClick={(e) => e.stopPropagation()}
        onPointerEnter={hoverOpen}
        onPointerLeave={hoverClose}
        data-testid="monitor-info-popover"
      >
        <div className="flex items-baseline gap-2 border-b px-3 py-2">
          <span className="min-w-0 flex-1 truncate font-semibold" title={monitor.Name}>{monitor.Name}</span>
          <span className="shrink-0 text-muted-foreground tabular-nums">#{monitor.Id}</span>
        </div>
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1.5 px-3 py-2">
          {renderRows(pipeline)}
          {decodesOnDemand && (
            <p className="col-span-3 -mt-0.5 text-[11px] leading-snug text-muted-foreground">
              {t('monitors.decoding_on_demand_note')}
            </p>
          )}
          <span className="col-span-3 my-0.5 border-t" aria-hidden="true" />
          {renderRows(stream)}
        </div>
      </PopoverContent>
    </Popover>
  );
}
