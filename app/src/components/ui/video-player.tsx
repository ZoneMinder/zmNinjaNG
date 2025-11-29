import React, { useEffect, useRef } from 'react';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';

interface VideoPlayerProps {
  src: string;
  poster?: string;
  className?: string;
  autoPlay?: boolean;
  options?: any;
  onError?: (error: any) => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ src, poster, className, autoPlay, options, onError }) => {
  const videoRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);

  useEffect(() => {
    if (!videoRef.current) return;

    // Make sure Video.js player is only initialized once
    if (!playerRef.current) {
      const videoElement = document.createElement("video-js");
      videoElement.classList.add('vjs-big-play-centered');
      
      // Append to container
      videoRef.current.appendChild(videoElement);

      const player = playerRef.current = videojs(videoElement, {
        controls: true,
        autoplay: autoPlay,
        preload: 'auto',
        fluid: true,
        poster: poster,
        sources: [{
          src: src,
        }],
        ...options
      }, () => {
        // Player ready
      });

      player.on('error', () => {
        const error = player.error();
        console.error('VideoJS Error:', error);
        if (onError) {
          onError(error);
        }
      });

    } else {
      const player = playerRef.current;
      
      // Update player state
      if (autoPlay !== undefined) {
        player.autoplay(autoPlay);
      }
      
      if (src) {
        player.src({ src });
      }
      
      if (poster) {
        player.poster(poster);
      }
    }
  }, [src, poster, autoPlay, options, onError]);

  // Dispose the player on unmount
  useEffect(() => {
    return () => {
      if (playerRef.current && !playerRef.current.isDisposed()) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, []);

  return (
    <div data-vjs-player className={className}>
      <div ref={videoRef} className="w-full h-full" />
      <style>{`
        .video-js {
          width: 100%;
          height: 100%;
        }
      `}</style>
    </div>
  );
}

export default VideoPlayer;
