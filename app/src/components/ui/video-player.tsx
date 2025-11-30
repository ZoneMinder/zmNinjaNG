/**
 * Video Player Component
 *
 * A wrapper around Video.js to provide a consistent video playback experience.
 * Handles HLS streams, authenticated requests (via hooks), and cleanup.
 */

import { useEffect, useRef, useState } from 'react';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';

// Define Player type from the videojs function return type
// This avoids deep imports which can be problematic with some bundlers
type Player = ReturnType<typeof videojs>;
import { cn } from '../../lib/utils';

interface VideoPlayerProps {
  /** The source URL of the video stream */
  src: string;
  /** The MIME type of the video (e.g., 'application/x-mpegURL') */
  type?: string;
  /** Optional poster image URL */
  poster?: string;
  /** Additional CSS classes */
  className?: string;
  /** Autoplay behavior */
  autoplay?: boolean | 'muted' | 'play' | 'any';
  /** Whether to show controls */
  controls?: boolean;
  /** Whether to mute the video */
  muted?: boolean;
  /** Aspect ratio (e.g., '16:9') */
  aspectRatio?: string;
  /** Callback when player is ready */
  onReady?: (player: Player) => void;
  /** Callback on error */
  onError?: (error: any) => void;
}

/**
 * VideoPlayer component.
 *
 * @param props - Component properties
 * @param props.src - Video source URL
 * @param props.type - Video MIME type
 * @param props.poster - Poster image URL
 * @param props.className - CSS class names
 * @param props.autoplay - Autoplay setting
 * @param props.controls - Show controls
 * @param props.muted - Mute video
 * @param props.aspectRatio - Aspect ratio
 * @param props.onReady - Ready callback
 * @param props.onError - Error callback
 */
export function VideoPlayer({
  src,
  type = 'application/x-mpegURL',
  poster,
  className,
  autoplay = false,
  controls = true,
  muted = true,
  aspectRatio = '16:9',
  onReady,
  onError
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Make sure Video.js player is only initialized once
    if (!playerRef.current) {
      // The Video.js player needs to be _inside_ the component el for React 18 Strict Mode. 
      const videoElement = document.createElement("video-js");

      videoElement.classList.add('vjs-big-play-centered');

      if (videoRef.current) {
        videoRef.current.appendChild(videoElement);
      }

      const player = playerRef.current = videojs(videoElement, {
        autoplay,
        controls,
        responsive: true,
        fluid: true,
        muted,
        aspectRatio,
        poster,
        sources: [{
          src,
          type
        }],
        html5: {
          vhs: {
            overrideNative: true
          },
          nativeAudioTracks: false,
          nativeVideoTracks: false
        }
      }, () => {
        videojs.log('player is ready');
        onReady && onReady(player);
      });

      // Handle errors
      player.on('error', () => {
        const err = player.error();
        console.error('VideoJS Error:', err);
        setError(err?.message || 'An unknown error occurred');
        if (onError) onError(err);
      });

    } else {
      const player = playerRef.current;

      // Update player if props change
      player.autoplay(autoplay);
      player.src([{ src, type }]);
      if (poster) player.poster(poster);
    }
  }, [src, type, poster, autoplay, controls, muted, aspectRatio, onReady, onError]);

  // Dispose the player on unmount
  useEffect(() => {
    const player = playerRef.current;

    return () => {
      if (player && !player.isDisposed()) {
        player.dispose();
        playerRef.current = null;
      }
    };
  }, [playerRef]);

  if (error) {
    return (
      <div className={cn("flex items-center justify-center bg-black/10 text-destructive p-4 rounded-md", className)}>
        <p>Error loading video: {error}</p>
      </div>
    );
  }

  return (
    <div data-vjs-player className={cn(className)}>
      <div ref={videoRef} />
    </div>
  );
}

