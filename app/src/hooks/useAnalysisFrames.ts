/**
 * Analysis-frame toggling for one live MJPEG stream.
 *
 * ZoneMinder exposes the analysis image (motion overlay, zone boxes) two ways.
 * The `analysis=1` parameter on the nph-zms URL is read once at process start
 * (src/zms.cpp), so changing it means tearing the stream down and building a
 * new one. CMD_ANALYZE_ON/OFF on the stream's command socket changes a running
 * process (src/zm_monitorstream.cpp), which is what a toggle wants: the frames
 * swap in place, with no restart and no gap.
 *
 * The catch is that the setting lives in the zms process, not in ZoneMinder,
 * and this app mints a new process constantly: an error backoff, a manual
 * retry, and a visibility resume each regenerate the connkey, and every fresh
 * process starts on normal frames. So the command is applied twice: when the
 * user flips the toggle, and again on the first frame of every connection that
 * has not had it applied yet. The first frame, rather than the connkey being
 * minted, because `zms-<connkey>w.sock` does not exist until the process is up.
 *
 * Snapshot mode gets nothing. `MonitorStream::SingleImage` reads the capture
 * buffer directly and never looks at the frame type, so neither the parameter
 * nor the command can put an overlay on a single image.
 */

import { useEffect, useRef } from 'react';
import { httpGet } from '../lib/http';
import { getZmsControlUrl } from '../lib/zm/url-builder';
import { ZMS_COMMANDS } from '../lib/zm/zm-constants';
import { log, LogLevel } from '../lib/logger';

export interface UseAnalysisFramesOptions {
  monitorId: string;
  /** Portal URL of the server this stream runs on. */
  portalUrl: string | undefined;
  /** Auth token appended to the command request. */
  accessToken: string | null;
  /** The connection this stream currently owns. 0 means none yet. */
  connKey: number;
  /** Commands only reach a live nph-zms process, so streaming mode only. */
  viewMode: 'streaming' | 'snapshot';
  /** False while the owning stream is torn down; no commands are sent. */
  enabled: boolean;
  /** The user's toggle: whether this stream should serve analysis frames. */
  showAnalysis: boolean;
  /** Base port for multi-port streaming (port = minStreamingPort + monitorId). */
  minStreamingPort?: number;
  /** Profile's API request timeout in seconds. 0 disables it. */
  apiTimeoutSeconds: number;
}

export interface UseAnalysisFramesReturn {
  /**
   * Call from the stream's load handler. Applies the toggle to a connection
   * that has not had it applied yet, and no-ops otherwise: a multipart MJPEG
   * `<img>` fires `load` per frame on some engines, and an unguarded send
   * would be one request per frame per tile.
   */
  applyOnStreamLoad: () => void;
}

/** What was last sent, and for which connection. */
interface AppliedState {
  connKey: number;
  on: boolean;
}

export function useAnalysisFrames({
  monitorId,
  portalUrl,
  accessToken,
  connKey,
  viewMode,
  enabled,
  showAnalysis,
  minStreamingPort,
  apiTimeoutSeconds,
}: UseAnalysisFramesOptions): UseAnalysisFramesReturn {
  const appliedRef = useRef<AppliedState>({ connKey: 0, on: false });

  // The send path reads props through a ref so the toggle effect below can
  // depend on `showAnalysis` alone. Depending on the rest would re-run it on
  // every connkey change, which is exactly the case the load handler owns.
  const stateRef = useRef({
    monitorId,
    portalUrl,
    accessToken,
    connKey,
    viewMode,
    enabled,
    showAnalysis,
    minStreamingPort,
    apiTimeoutSeconds,
  });
  // Declared before the toggle effect so it has already refreshed the snapshot
  // by the time that effect runs: effects in one commit fire in declaration
  // order, and a flip must be sent against the values of the render it flipped.
  useEffect(() => {
    stateRef.current = {
      monitorId,
      portalUrl,
      accessToken,
      connKey,
      viewMode,
      enabled,
      showAnalysis,
      minStreamingPort,
      apiTimeoutSeconds,
    };
  });

  const apply = (): void => {
    const s = stateRef.current;
    if (!s.enabled || s.viewMode !== 'streaming' || !s.portalUrl || s.connKey === 0) return;

    const applied = appliedRef.current;
    if (applied.connKey === s.connKey && applied.on === s.showAnalysis) return;

    // A connection we have never touched is already serving normal frames, so
    // turning analysis off on it would cost a request per tile per reconnect
    // and change nothing. Record the state and send nothing.
    if (applied.connKey !== s.connKey && !s.showAnalysis) {
      appliedRef.current = { connKey: s.connKey, on: false };
      return;
    }

    appliedRef.current = { connKey: s.connKey, on: s.showAnalysis };

    const command = s.showAnalysis ? ZMS_COMMANDS.cmdAnalyzeOn : ZMS_COMMANDS.cmdAnalyzeOff;
    const url = getZmsControlUrl(s.portalUrl, command, s.connKey.toString(), {
      token: s.accessToken || undefined,
      minStreamingPort: s.minStreamingPort,
      monitorId: s.monitorId,
    });

    log.dedupe('analysis-frames-command', 3000, (suffix) =>
      log.monitor(`Setting analysis frames ${s.showAnalysis ? 'on' : 'off'}${suffix}`, LogLevel.DEBUG, {
        monitorId: s.monitorId,
        connkey: s.connKey,
      }),
    );

    httpGet(url, { timeoutMs: s.apiTimeoutSeconds > 0 ? s.apiTimeoutSeconds * 1000 : undefined }).catch(() => {
      // The stream may have died between the frame and this request. The next
      // connection re-applies from its own first frame.
    });
  };

  // Flipping the toggle acts on the stream the user is watching right now.
  // Mount is not a flip: a stream that starts with the setting already on has
  // no command socket yet, so the load handler applies it instead.
  const prevShowRef = useRef(showAnalysis);
  useEffect(() => {
    if (prevShowRef.current === showAnalysis) return;
    prevShowRef.current = showAnalysis;
    apply();
  }, [showAnalysis]);

  return { applyOnStreamLoad: apply };
}
