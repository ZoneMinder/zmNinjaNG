import { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { isTauri } from '@tauri-apps/api/core';
import { getApiClient } from '../../api/client';
import { cn } from '../../lib/utils';

interface SecureImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  fallbackSrc?: string;
}

export function SecureImage({ src, fallbackSrc, className, alt, ...props }: SecureImageProps) {
  const [imageSrc, setImageSrc] = useState<string>(src);
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const isNative = Capacitor.isNativePlatform();
    const isTauriApp = isTauri();

    // If not native/Tauri, just use the src directly
    if (!isNative && !isTauriApp) {
      setImageSrc(src);
      setIsLoading(false);
      return;
    }

    // If native/Tauri, fetch as blob to bypass CORS
    let objectUrl: string | null = null;

    const fetchImage = async () => {
      try {
        setIsLoading(true);
        
        const client = getApiClient();
        const response = await client.get(src, { 
          responseType: 'blob' 
        });
        
        if (mountedRef.current && response.data) {
          const blob = response.data as Blob;
          objectUrl = URL.createObjectURL(blob);
          setImageSrc(objectUrl);
        }
      } catch (error) {
        console.error('Failed to fetch secure image:', error);
        if (mountedRef.current) {
          // Fallback to original src if blob fetch fails, 
          // maybe it works directly (e.g. if it's a public URL)
          setImageSrc(src);
        }
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
        }
      }
    };

    fetchImage();

    return () => {
      mountedRef.current = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [src]);

  const handleError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (fallbackSrc && imageSrc !== fallbackSrc) {
      setImageSrc(fallbackSrc);
    } else if (props.onError) {
      props.onError(e);
    }
  };

  return (
    <img
      src={imageSrc}
      alt={alt}
      className={cn(
        className,
        isLoading && "animate-pulse bg-muted"
      )}
      onError={handleError}
      {...props}
    />
  );
}
