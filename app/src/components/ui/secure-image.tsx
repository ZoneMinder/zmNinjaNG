import { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { getApiClient } from '../../api/client';
import { cn } from '../../lib/utils';

interface SecureImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  fallbackSrc?: string;
}

export function SecureImage({ src, fallbackSrc, className, alt, ...props }: SecureImageProps) {
  const [imageSrc, setImageSrc] = useState<string>(src);
  const isNative = Capacitor.isNativePlatform();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Cleanup blob URL if we created one
      if (imageSrc && imageSrc.startsWith('blob:')) {
        URL.revokeObjectURL(imageSrc);
      }
    };
  }, []);

  useEffect(() => {
    // Default to using the src directly
    setImageSrc(src);
    
    // Only attempt native fetch if we specifically want to force it or as a fallback
    // For now, we'll rely on the standard img tag behavior which seems to work for the user
    // The native fetch logic is preserved below but disabled by default to fix the regression
  }, [src]);

  /* 
  // Previous logic that forced native fetch - disabled because it caused NSURLErrorDomain errors
  useEffect(() => {
    if (!isNative || !src || !src.startsWith('http')) {
      setImageSrc(src);
      return;
    }
    // ... native fetch logic ...
  }, [src, isNative, fallbackSrc]);
  */

  const handleError = async (e: React.SyntheticEvent<HTMLImageElement>) => {
    // If we already tried fallback or native fetch, stop
    if (imageSrc === fallbackSrc) {
      if (props.onError) props.onError(e);
      return;
    }

    // If standard load failed, try native fetch as a backup mechanism
    // This helps with CORS or specific SSL issues that WebView might block but Native might allow
    // (though in this specific case, Native seems to be the one failing)
    if (isNative && src.startsWith('http') && imageSrc === src) {
      try {
        const client = getApiClient();
        const response = await client.get(src, { responseType: 'blob' });
        if (mountedRef.current && response.data) {
          const blobUrl = URL.createObjectURL(response.data);
          setImageSrc(blobUrl);
          return; // Success, don't trigger parent onError yet
        }
      } catch (err) {
        console.error('Native fallback fetch failed:', err);
      }
    }

    // If native fallback also failed (or wasn't attempted), try the provided fallbackSrc
    if (fallbackSrc && imageSrc !== fallbackSrc) {
      setImageSrc(fallbackSrc);
      return;
    }
    
    // Finally delegate to parent
    if (props.onError) {
      props.onError(e);
    }
  };

  return (
    <img
      src={imageSrc}
      alt={alt}
      className={cn(className)}
      onError={handleError}
      {...props}
    />
  );
}
