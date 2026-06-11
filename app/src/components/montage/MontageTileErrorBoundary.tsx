/**
 * Montage Tile Error Boundary
 *
 * Catches render errors inside a single montage tile so one broken
 * monitor does not unmount the whole grid. The failed tile shows a
 * compact fallback while the other tiles keep streaming.
 */

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { log, LogLevel } from '../../lib/logger';

interface Props {
  monitorId: string;
  monitorName: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

function TileErrorFallback({ monitorName }: { monitorName: string }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-1 bg-zinc-900 p-2 text-center"
      data-testid="montage-tile-error"
    >
      <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
      <div className="flex w-full min-w-0 justify-center">
        <span className="min-w-0 truncate text-xs font-medium text-zinc-200" title={monitorName}>
          {monitorName}
        </span>
      </div>
      <span className="text-xs text-zinc-400">{t('montage.tile_error')}</span>
    </div>
  );
}

export class MontageTileErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false };

  public static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    log.montageMonitor('Tile render error', LogLevel.ERROR, {
      monitorId: this.props.monitorId,
      monitorName: this.props.monitorName,
      error,
      componentStack: errorInfo.componentStack,
    });
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return <TileErrorFallback monitorName={this.props.monitorName} />;
    }
    return this.props.children;
  }
}
