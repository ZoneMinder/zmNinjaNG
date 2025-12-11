/**
 * ZMS Event Player Component
 *
 * Provides video playback controls for ZoneMinder events using ZMS streaming.
 * Includes play/pause, speed controls, frame navigation, and alarm frames display.
 */

import { useState, useCallback, useMemo } from 'react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import { EventProgressBar } from './EventProgressBar';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Rewind,
  FastForward,
  AlertCircle,
} from 'lucide-react';
import { getEventImageUrl } from '../../api/events';
import { useTranslation } from 'react-i18next';
import { Platform } from '../../lib/platform';
import { CapacitorHttp } from '@capacitor/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

// ZoneMinder stream command constants
const ZM_CMD = {
  PAUSE: 1,
  PLAY: 2,
  STOP: 3,
  FASTFWD: 4,
  SLOWFWD: 5,
  SLOWREV: 6,
  FASTREV: 7,
  PREV: 12,
  NEXT: 13,
  SEEK: 14,
  QUERY: 99,
} as const;

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
  className,
}: ZmsEventPlayerProps) {
  const { t } = useTranslation();
  const [currentFrame, setCurrentFrame] = useState(1);
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(100); // 100 = 1x speed

  // Generate unique connection key for this stream (regenerate on speed change)
  const connKey = useMemo(
    () => Math.floor(Math.random() * 1000000).toString(),
    [playbackSpeed]
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

  // Prepare base URL
  const baseUrl = useMemo(() => {
    let url = portalUrl;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `http://${url}`;
    }
    if (apiUrl && apiUrl.startsWith('http://')) {
      url = url.replace(/^https:\/\//, 'http://');
    } else if (apiUrl && apiUrl.startsWith('https://')) {
      url = url.replace(/^http:\/\//, 'https://');
    }
    return url;
  }, [portalUrl, apiUrl]);

  // Build ZMS stream URL
  const zmsUrl = useMemo(() => {
    const params = new URLSearchParams({
      mode: 'jpeg',
      source: 'event',
      event: eventId,
      frame: '1',
      rate: playbackSpeed.toString(),
      maxfps: '30',
      replay: 'single',
      connkey: connKey,
      ...(token && { token }),
    });

    return `${baseUrl}/cgi-bin/nph-zms?${params.toString()}`;
  }, [baseUrl, eventId, playbackSpeed, connKey, token]);

  // Send control command to the stream
  const sendCommand = useCallback(async (cmd: number, offset?: number) => {
    const params = new URLSearchParams({
      command: cmd.toString(),
      connkey: connKey,
      view: 'request',
      request: 'stream',
      ...(token && { token }),
      ...(offset !== undefined && { offset: offset.toString() }),
    });

    const fullUrl = `${baseUrl}/index.php?${params.toString()}`;

    try {
      if (Platform.isNative) {
        // Use Capacitor HTTP on mobile
        await CapacitorHttp.get({ url: fullUrl });
      } else if (Platform.isTauri) {
        // Use Tauri fetch on desktop
        await tauriFetch(fullUrl);
      } else if (Platform.shouldUseProxy) {
        // Use proxy in dev mode
        await fetch(`http://localhost:3001/proxy/index.php?${params.toString()}`, {
          headers: { 'X-Target-Host': baseUrl },
        });
      } else {
        // Direct fetch in production web
        await fetch(fullUrl);
      }
    } catch (err) {
      console.error('Stream command failed:', err);
    }
  }, [baseUrl, connKey, token]);

  // Calculate time offset from frame number
  const frameToOffset = useCallback((frame: number) => {
    return (frame / totalFrames) * eventLength;
  }, [totalFrames, eventLength]);

  // Handle play/pause
  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      sendCommand(ZM_CMD.PAUSE);
      setIsPlaying(false);
    } else {
      sendCommand(ZM_CMD.PLAY);
      setIsPlaying(true);
    }
  }, [isPlaying, sendCommand]);

  // Handle frame navigation
  const goToFrame = useCallback((frame: number) => {
    const newFrame = Math.max(1, Math.min(frame, totalFrames));
    setCurrentFrame(newFrame);

    // Seek to offset in seconds
    const offset = frameToOffset(newFrame);
    sendCommand(ZM_CMD.SEEK, offset);
  }, [totalFrames, frameToOffset, sendCommand]);

  const stepBackward = useCallback(() => {
    sendCommand(ZM_CMD.PREV);
    setCurrentFrame((prev) => Math.max(1, prev - 1));
  }, [sendCommand]);

  const stepForward = useCallback(() => {
    sendCommand(ZM_CMD.NEXT);
    setCurrentFrame((prev) => Math.min(totalFrames, prev + 1));
  }, [sendCommand, totalFrames]);

  const jumpBackward = useCallback(() => {
    goToFrame(currentFrame - 10);
  }, [currentFrame, goToFrame]);

  const jumpForward = useCallback(() => {
    goToFrame(currentFrame + 10);
  }, [currentFrame, goToFrame]);

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
      <Card className="overflow-hidden shadow-2xl border-0 ring-1 ring-border/20 bg-black">
        <div className="aspect-video relative bg-black">
          <img
            src={zmsUrl}
            alt={t('event_detail.event_playback')}
            className="w-full h-full object-contain"
          />

          {/* Status Badge */}
          <div className="absolute top-4 left-4">
            <Badge variant="secondary" className="gap-2 bg-blue-500/80 text-white hover:bg-blue-500">
              <AlertCircle className="h-3 w-3" />
              {t('event_detail.zms_playback')}
            </Badge>
          </div>
        </div>
      </Card>

      {/* Playback Controls */}
      <Card className="p-4 space-y-4 bg-card/95 backdrop-blur">
        {/* Transport Controls */}
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={jumpBackward}
            disabled={currentFrame <= 1}
            title={t('event_detail.rewind')}
          >
            <Rewind className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={stepBackward}
            disabled={currentFrame <= 1}
            title={t('event_detail.previous_frame')}
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            variant="default"
            size="icon"
            onClick={togglePlayPause}
            title={isPlaying ? t('event_detail.pause') : t('event_detail.play')}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={stepForward}
            disabled={currentFrame >= totalFrames}
            title={t('event_detail.next_frame')}
          >
            <SkipForward className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={jumpForward}
            disabled={currentFrame >= totalFrames}
            title={t('event_detail.fast_forward')}
          >
            <FastForward className="h-4 w-4" />
          </Button>
        </div>

        {/* Progress Bar with Alarm Frames */}
        <EventProgressBar
          currentFrame={currentFrame}
          totalFrames={totalFrames}
          alarmFrames={alarmFramePositions}
          onSeek={goToFrame}
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
                onClick={() => setPlaybackSpeed(preset.value)}
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
            <div
              className="flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={jumpToAlarmFrame}
            >
              <img
                src={getEventImageUrl(portalUrl, eventId, 'alarm', {
                  token,
                  width: 120,
                  apiUrl,
                })}
                alt={t('event_detail.first_alarm_frame')}
                className="w-30 h-20 object-cover rounded border-2 border-destructive"
              />
              <p className="text-xs text-center mt-1 text-muted-foreground">
                {t('event_detail.frame')} {alarmFrameId}
              </p>
            </div>

            {/* Max score frame if different from alarm frame */}
            {maxScoreFrameId && maxScoreFrameId !== alarmFrameId && (
              <div
                className="flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                onClick={jumpToMaxScoreFrame}
              >
                <img
                  src={getEventImageUrl(portalUrl, eventId, parseInt(maxScoreFrameId), {
                    token,
                    width: 120,
                    apiUrl,
                  })}
                  alt={t('event_detail.max_score_frame')}
                  className="w-30 h-20 object-cover rounded border-2 border-yellow-500"
                />
                <p className="text-xs text-center mt-1 text-muted-foreground">
                  {t('event_detail.frame')} {maxScoreFrameId}
                </p>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
