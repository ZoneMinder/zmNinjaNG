/**
 * ZMS Event Player Component
 *
 * Provides video playback controls for ZoneMinder events using ZMS streaming.
 * Includes play/pause, speed controls, frame navigation, and alarm frames display.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import { EventProgressBar } from './EventProgressBar';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  VideoOff,
} from 'lucide-react';
import { getEventImageUrl } from '../../api/events';
import { useTranslation } from 'react-i18next';
import { httpGet } from '../../lib/http';
import { log, LogLevel } from '../../lib/logger';
import { getEventZmsUrl, getZmsControlUrl } from '../../lib/zm/url-builder';
import { ZMS_COMMANDS, zmsCommandName } from '../../lib/zm/zm-constants';
import { EVENT_SEEK_FLUSH_DELAY_MS } from '../../lib/zmninja-ng-constants';
import { sendDelayedCmdQuit, cancelPendingQuit } from '../../lib/zm/zms-quit';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';
import { useZoomPan } from '../../hooks/useZoomPan';
import { ZoomControls } from '../ui/zoom-controls';
import { useBandwidthSettings } from '../../hooks/useBandwidthSettings';
import { useFreshAccessToken } from '../../hooks/useFreshAccessToken';

interface ZmsEventPlayerProps {
  portalUrl: string;
  eventId: string;
  token?: string;
  apiUrl?: string;
  totalFrames: number;
  alarmFrames: number;
  alarmFrameId?: string;
  maxScoreFrameId?: string;
  eventLength: number; // Event duration in seconds
  minStreamingPort?: number;
  monitorId?: string;
  className?: string;
}

export function ZmsEventPlayer({
  portalUrl,
  eventId,
  token,
  apiUrl,
  totalFrames,
  alarmFrames,
  alarmFrameId,
  maxScoreFrameId,
  eventLength,
  minStreamingPort,
  monitorId,
  className,
}: ZmsEventPlayerProps) {
  const { t } = useTranslation();
  const bandwidth = useBandwidthSettings();
  const { isFresh: isAccessTokenFresh } = useFreshAccessToken();
  const { settings } = useCurrentProfile();
  const [currentFrame, setCurrentFrame] = useState(1);
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(100); // 100 = 1x speed

  // Duration in seconds as reported by the running ZMS stream. The DB event
  // Length and the stream's own duration can disagree (variable capture rate,
  // still-recording events), so seeks must use this value, not eventLength,
  // or the playhead lands at the wrong spot (refs #196).
  const [streamDuration, setStreamDuration] = useState<number | null>(null);
  const effectiveDuration = streamDuration && streamDuration > 0 ? streamDuration : eventLength;

  // While the user drags the scrub bar, the status poll must not write the
  // playhead back from the stream: that fight makes the cursor and video jump
  // around mid-drag (refs #196). Each scrub position is sent as a CMD_SEEK.
  const isScrubbingRef = useRef(false);

  // Pending "flush" repeat of the last settled seek. A paused/idle zms shows a
  // lone seek's frame ~5s late (see EVENT_SEEK_FLUSH_DELAY_MS); repeating the
  // seek makes a second frame flush the first. Kept in a ref so a newer seek can
  // cancel a still-pending flush (refs #196).
  const seekFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Unique connection key for this stream, stable for the component's lifetime.
  // Speed changes are sent as CMD_VARPLAY over this same connkey instead of
  // restarting the stream with a new one.
  const connKey = useMemo(
    () => Math.floor(Math.random() * 1000000).toString(),
    []
  );

  // Calculate alarm frame positions for progress bar
  const alarmFramePositions = useMemo(() => {
    const positions = [];

    // Add first alarm frame
    if (alarmFrameId) {
      const frameNum = parseInt(alarmFrameId);
      positions.push({
        frameId: frameNum,
        position: (frameNum / totalFrames) * 100,
      });
    }

    // Add max score frame if different
    if (maxScoreFrameId && maxScoreFrameId !== alarmFrameId) {
      const frameNum = parseInt(maxScoreFrameId);
      positions.push({
        frameId: frameNum,
        position: (frameNum / totalFrames) * 100,
      });
    }

    return positions;
  }, [alarmFrameId, maxScoreFrameId, totalFrames]);

  // Build ZMS stream URL. Starts at 1x (rate 100); speed changes go through
  // CMD_VARPLAY so the img src never changes after mount.
  const zmsUrl = useMemo(() => {
    if (!isAccessTokenFresh) return '';
    return getEventZmsUrl(portalUrl, eventId, {
      token,
      apiUrl,
      frame: 1,
      rate: 100,
      maxfps: 30,
      replay: 'single',
      connkey: connKey,
      minStreamingPort,
      monitorId,
    });
  }, [portalUrl, apiUrl, eventId, connKey, token, minStreamingPort, monitorId, isAccessTokenFresh]);

  // Send control command to the stream
  const sendCommand = useCallback(async (cmd: number, opts?: { offset?: number; rate?: number }) => {
    const url = getZmsControlUrl(portalUrl, cmd, connKey, {
      token,
      apiUrl,
      offset: opts?.offset,
      rate: opts?.rate,
      minStreamingPort,
      monitorId,
    });

    // The seek/control request hits ZMS server-side (visible in ZM logs as
    // command=14&offset=...), so log it client-side too (refs #196). Token is
    // omitted; the URL would otherwise leak it. offset is only set for Seek and
    // rate only for VarPlay, so they are undefined for Play/Pause.
    log.zmsEventPlayer(`Sending stream command: ${zmsCommandName(cmd)}`, LogLevel.DEBUG, {
      command: cmd,
      commandName: zmsCommandName(cmd),
      offset: opts?.offset,
      rate: opts?.rate,
      connkey: connKey,
    });

    try {
      await httpGet(url);
    } catch (err) {
      log.zmsEventPlayer('Stream command failed', LogLevel.ERROR, {
        command: cmd,
        connkey: connKey,
        error: err,
      });
    }
  }, [portalUrl, apiUrl, connKey, token, minStreamingPort, monitorId]);

  // Send CMD_QUIT on unmount so the nph-zms process exits instead of idling.
  // Params are kept in a ref so the cleanup closure is never stale.
  // CMD_QUIT follows the same timeout as the rest of the app's HTTP. 0 disables.
  const cmdQuitTimeoutMs = settings.apiTimeoutSeconds > 0 ? settings.apiTimeoutSeconds * 1000 : undefined;
  const quitParamsRef = useRef({ portalUrl, token, apiUrl, connKey, minStreamingPort, monitorId, eventId, cmdQuitTimeoutMs });
  useEffect(() => {
    quitParamsRef.current = { portalUrl, token, apiUrl, connKey, minStreamingPort, monitorId, eventId, cmdQuitTimeoutMs };
  }, [portalUrl, token, apiUrl, connKey, minStreamingPort, monitorId, eventId, cmdQuitTimeoutMs]);

  // Only quit a stream that actually started: the img onLoad flips this flag.
  // Guards against killing nothing (token never fresh, stream failed) and
  // against StrictMode's dev double-mount quitting the surviving mount's stream.
  const streamStartedRef = useRef(false);

  useEffect(() => {
    // A remount that reuses the connkey (StrictMode dev double-mount) cancels
    // the quit scheduled by the previous cleanup.
    cancelPendingQuit(quitParamsRef.current.connKey);

    return () => {
      if (!streamStartedRef.current) return;
      const p = quitParamsRef.current;
      const url = getZmsControlUrl(p.portalUrl, ZMS_COMMANDS.cmdQuit, p.connKey, {
        token: p.token,
        apiUrl: p.apiUrl,
        minStreamingPort: p.minStreamingPort,
        monitorId: p.monitorId,
      });
      // Delayed fire-and-forget: release the server process unless a remount
      // cancels the quit within the grace window
      sendDelayedCmdQuit(url, p.connKey, {
        timeoutMs: p.cmdQuitTimeoutMs,
        logContext: { eventId: p.eventId },
      });
    };
  }, []); // Empty deps = only run on unmount

  // Poll stream status to track playback position.
  // Uses an AbortController shared with all in-flight httpGet calls so unmount
  // (or pause) immediately cancels pending requests and prevents setState on an
  // unmounted component.
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isPlaying) return;

    const controller = new AbortController();
    const { signal } = controller;

    const tick = async () => {
      if (signal.aborted) return;
      // Don't query or move the playhead mid-scrub: the drag owns the position.
      if (isScrubbingRef.current) return;
      const url = getZmsControlUrl(portalUrl, ZMS_COMMANDS.cmdQuery, connKey, { token, apiUrl, minStreamingPort, monitorId });
      try {
        const resp = await httpGet<{ status?: { progress?: number; duration?: number } }>(url, { signal });
        if (signal.aborted || isScrubbingRef.current) return;
        const status = resp.data?.status;
        if (status && typeof status.progress === 'number' && typeof status.duration === 'number' && status.duration > 0) {
          setStreamDuration(status.duration);
          const fraction = status.progress / status.duration;
          const frame = Math.max(1, Math.round(fraction * totalFrames));
          setCurrentFrame(frame);

          if (fraction >= 0.99) {
            sendCommand(ZMS_COMMANDS.cmdPause);
            setIsPlaying(false);
            setCurrentFrame(totalFrames);
          }
        }
      } catch (err) {
        if (signal.aborted) return;
        log.zmsEventPlayer('Status query failed', LogLevel.DEBUG, { error: err });
      }
    };

    pollTimer.current = setInterval(tick, bandwidth.zmsStatusInterval);

    return () => {
      controller.abort();
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [isPlaying, bandwidth.zmsStatusInterval, portalUrl, connKey, token, apiUrl, totalFrames, minStreamingPort, monitorId, sendCommand]);

  // Calculate time offset from frame number. Uses the stream-reported duration
  // so the seek lands where the progress bar says it will (refs #196).
  const frameToOffset = useCallback((frame: number) => {
    return (frame / totalFrames) * effectiveDuration;
  }, [totalFrames, effectiveDuration]);

  // Handle play/pause
  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      sendCommand(ZMS_COMMANDS.cmdPause);
      setIsPlaying(false);
    } else {
      sendCommand(ZMS_COMMANDS.cmdPlay);
      setIsPlaying(true);
    }
  }, [isPlaying, sendCommand]);

  // Change playback speed with CMD_VARPLAY on the existing connkey, matching
  // ZoneMinder's own event UI. zms resumes playing after a VARPLAY.
  const changeSpeed = useCallback((rate: number) => {
    setPlaybackSpeed(rate);
    sendCommand(ZMS_COMMANDS.cmdVarPlay, { rate });
    setIsPlaying(true);
  }, [sendCommand]);

  // Handle frame navigation
  const goToFrame = useCallback((frame: number) => {
    const newFrame = Math.max(1, Math.min(frame, totalFrames));
    setCurrentFrame(newFrame);

    // Seek to offset in seconds
    const offset = frameToOffset(newFrame);
    // Log the frame->offset translation and which duration drove it, so a seek
    // that lands at the wrong spot can be traced to the inputs (refs #196).
    log.zmsEventPlayer('Seeking to frame', LogLevel.DEBUG, {
      frame: newFrame,
      totalFrames,
      offset,
      effectiveDuration,
      streamDuration,
      eventLength,
      usingStreamDuration: streamDuration != null && streamDuration > 0,
    });
    sendCommand(ZMS_COMMANDS.cmdSeek, { offset });

    // MJPEG in an <img> renders a frame only when the next multipart boundary
    // arrives, and a paused/idle zms only emits its next frame on the 5s
    // keepalive, so a lone seek's frame lands ~5s late. Newer zms sends the
    // sought frame twice to fix this; older servers (ZM 1.36) do not, so repeat
    // the seek to force a second, flushing frame. Skip it when the stream is
    // confirmed to be advancing on its own: a played frame already flushes the
    // seek, and repeating would yank playback backward (refs #196).
    if (seekFlushTimerRef.current) {
      clearTimeout(seekFlushTimerRef.current);
      seekFlushTimerRef.current = null;
    }
    const streamAdvancing = isPlaying && streamDuration != null && streamDuration > 0;
    if (!streamAdvancing) {
      seekFlushTimerRef.current = setTimeout(() => {
        seekFlushTimerRef.current = null;
        sendCommand(ZMS_COMMANDS.cmdSeek, { offset });
      }, EVENT_SEEK_FLUSH_DELAY_MS);
    }
  }, [totalFrames, frameToOffset, sendCommand, effectiveDuration, streamDuration, eventLength, isPlaying]);

  // Cancel any pending seek-flush repeat on unmount.
  useEffect(() => {
    return () => {
      if (seekFlushTimerRef.current) clearTimeout(seekFlushTimerRef.current);
    };
  }, []);

  const seekBack = useCallback(() => {
    // Seek back 5 seconds
    const targetOffset = Math.max(0, frameToOffset(currentFrame) - 5);
    const targetFrame = Math.max(1, Math.round((targetOffset / effectiveDuration) * totalFrames));
    goToFrame(targetFrame);
  }, [currentFrame, frameToOffset, effectiveDuration, totalFrames, goToFrame]);

  const seekForward = useCallback(() => {
    // Seek forward 5 seconds
    const targetOffset = Math.min(effectiveDuration, frameToOffset(currentFrame) + 5);
    const targetFrame = Math.min(totalFrames, Math.round((targetOffset / effectiveDuration) * totalFrames));
    goToFrame(targetFrame);
  }, [currentFrame, frameToOffset, effectiveDuration, totalFrames, goToFrame]);

  const goToStart = useCallback(() => {
    goToFrame(1);
  }, [goToFrame]);

  const goToEnd = useCallback(() => {
    goToFrame(totalFrames);
  }, [goToFrame, totalFrames]);

  // Grab the scrub bar: just silence the status poll so it does not write the
  // playhead back mid-drag. Each scrub position is a CMD_SEEK; ZMS handles the
  // seek without a surrounding pause/play, so we do not send them (refs #196).
  const handleScrubStart = useCallback(() => {
    isScrubbingRef.current = true;
  }, []);

  // Release: re-enable the status poll. Playback state is unchanged by scrubbing.
  const handleScrubEnd = useCallback(() => {
    isScrubbingRef.current = false;
  }, []);

  // Jump to alarm frame
  const jumpToAlarmFrame = useCallback(() => {
    if (alarmFrameId) {
      goToFrame(parseInt(alarmFrameId));
    }
  }, [alarmFrameId, goToFrame]);

  // Jump to max score frame
  const jumpToMaxScoreFrame = useCallback(() => {
    if (maxScoreFrameId) {
      goToFrame(parseInt(maxScoreFrameId));
    }
  }, [maxScoreFrameId, goToFrame]);

  // Speed presets
  // Pinch-to-zoom and pan for ZMS image
  const zoomPan = useZoomPan({ maxScale: 4 });

  const speedPresets = [
    { label: '0.25x', value: 25 },
    { label: '0.5x', value: 50 },
    { label: '1x', value: 100 },
    { label: '2x', value: 200 },
    { label: '4x', value: 400 },
  ];

  return (
    <div className={className}>
      {/* Video Display */}
      <Card
        ref={zoomPan.ref}
        className="overflow-hidden shadow-2xl border-0 ring-1 ring-border/20 bg-black touch-none relative"
      >
        <div className="aspect-video relative bg-black">
          {/* No-video placeholder: behind the stream, only visible when image fails */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
            <VideoOff className="h-10 w-10 text-muted-foreground/30" />
          </div>
          <div ref={zoomPan.innerRef} className="relative z-10">
            <img
              src={zmsUrl}
              alt={t('event_detail.event_playback')}
              className="w-full h-full object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              onLoad={(e) => {
                streamStartedRef.current = true;
                (e.target as HTMLImageElement).style.display = '';
              }}
            />
          </div>

          {/* Status Badge */}
          <div className="absolute top-4 left-4 z-10">
            <Badge variant="secondary" className="gap-2 bg-blue-500/80 text-white hover:bg-blue-500">
              <AlertCircle className="h-3 w-3" />
              {t('event_detail.zms_playback')}
            </Badge>
          </div>
        </div>
        <ZoomControls zoomPan={zoomPan} className="bottom-2 left-2" />
      </Card>

      {/* Playback Controls */}
      <Card className="p-4 space-y-4 bg-card/95 backdrop-blur">
        {/* Transport Controls */}
        <div className="flex items-center justify-center gap-2">
          {/* Jump to start */}
          <Button
            variant="outline"
            size="icon"
            onClick={goToStart}
            disabled={currentFrame <= 1}
            title={t('event_detail.go_to_start')}
            data-testid="zms-go-to-start"
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          {/* Seek back 5s */}
          <Button
            variant="outline"
            size="sm"
            onClick={seekBack}
            disabled={currentFrame <= 1}
            title={t('event_detail.rewind')}
            className="gap-1"
            data-testid="zms-seek-back"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="text-xs">{t('event_detail.seek_back')}</span>
          </Button>
          {/* Play/Pause */}
          <Button
            variant="default"
            size="icon"
            onClick={togglePlayPause}
            title={isPlaying ? t('event_detail.pause') : t('event_detail.play')}
            data-testid="zms-play-pause"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          {/* Seek forward 5s */}
          <Button
            variant="outline"
            size="sm"
            onClick={seekForward}
            disabled={currentFrame >= totalFrames}
            title={t('event_detail.fast_forward')}
            className="gap-1"
            data-testid="zms-seek-forward"
          >
            <span className="text-xs">{t('event_detail.seek_forward')}</span>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {/* Jump to end */}
          <Button
            variant="outline"
            size="icon"
            onClick={goToEnd}
            disabled={currentFrame >= totalFrames}
            title={t('event_detail.go_to_end')}
            data-testid="zms-go-to-end"
          >
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>

        {/* Progress Bar with Alarm Frames */}
        <EventProgressBar
          currentFrame={currentFrame}
          totalFrames={totalFrames}
          alarmFrames={alarmFramePositions}
          onSeek={goToFrame}
          duration={effectiveDuration}
          onScrubStart={handleScrubStart}
          onScrubEnd={handleScrubEnd}
        />

        {/* Speed Controls */}
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">
            {t('event_detail.playback_speed')}
          </label>
          <div className="flex gap-2 justify-center flex-wrap">
            {speedPresets.map((preset) => (
              <Button
                key={preset.value}
                variant={playbackSpeed === preset.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => changeSpeed(preset.value)}
                data-testid={`zms-speed-${preset.value}`}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Quick Jump Buttons */}
        {(alarmFrameId || maxScoreFrameId) && (
          <div className="flex gap-2 justify-center flex-wrap">
            {alarmFrameId && (
              <Button
                variant="outline"
                size="sm"
                onClick={jumpToAlarmFrame}
                className="gap-2"
                data-testid="zms-quick-jump-alarm-frame"
              >
                <AlertCircle className="h-4 w-4 text-destructive" />
                {t('event_detail.first_alarm_frame')}
              </Button>
            )}
            {maxScoreFrameId && (
              <Button
                variant="outline"
                size="sm"
                onClick={jumpToMaxScoreFrame}
                className="gap-2"
                data-testid="zms-quick-jump-max-score-frame"
              >
                <AlertCircle className="h-4 w-4 text-yellow-500" />
                {t('event_detail.max_score_frame')}
              </Button>
            )}
          </div>
        )}

        {/* Alarm Frames Info */}
        {alarmFrames > 0 && (
          <div className="text-center text-sm text-muted-foreground">
            {t('event_detail.alarm_frames_count', { count: alarmFrames, total: totalFrames })}
          </div>
        )}
      </Card>

      {/* Alarm Frames Timeline */}
      {alarmFrames > 0 && alarmFrameId && (
        <Card className="p-4 mt-4">
          <h3 className="text-sm font-semibold mb-3">{t('event_detail.alarm_frames')}</h3>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {/* First alarm frame */}
            <button
              type="button"
              className="flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={jumpToAlarmFrame}
              data-testid="zms-jump-to-alarm-frame"
            >
              <img
                src={isAccessTokenFresh ? getEventImageUrl(portalUrl, eventId, parseInt(alarmFrameId), {
                  token,
                  width: 120,
                  apiUrl,
                  minStreamingPort,
                  monitorId,
                }) : undefined}
                alt={t('event_detail.first_alarm_frame')}
                className="w-30 h-20 object-cover rounded border-2 border-destructive"
              />
              <p className="text-xs text-center mt-1 text-muted-foreground">
                {t('event_detail.frame')} {alarmFrameId}
              </p>
            </button>

            {/* Max score frame if different from alarm frame */}
            {maxScoreFrameId && maxScoreFrameId !== alarmFrameId && (
              <button
                type="button"
                className="flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                onClick={jumpToMaxScoreFrame}
                data-testid="zms-jump-to-max-score-frame"
              >
                <img
                  src={isAccessTokenFresh ? getEventImageUrl(portalUrl, eventId, parseInt(maxScoreFrameId), {
                    token,
                    width: 120,
                    apiUrl,
                    minStreamingPort,
                    monitorId,
                  }) : undefined}
                  alt={t('event_detail.max_score_frame')}
                  className="w-30 h-20 object-cover rounded border-2 border-yellow-500"
                />
                <p className="text-xs text-center mt-1 text-muted-foreground">
                  {t('event_detail.frame')} {maxScoreFrameId}
                </p>
              </button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
