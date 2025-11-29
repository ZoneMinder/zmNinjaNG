import { useState, useEffect } from 'react';
import { cn } from '../../lib/utils';

interface SecureImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  fallbackSrc?: string;
}

export function SecureImage({ src, fallbackSrc, className, alt, ...props }: SecureImageProps) {
  const [imageSrc, setImageSrc] = useState<string>(src);

  useEffect(() => {
    setImageSrc(src);
  }, [src]);

  const handleError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    // If a fallback source is provided via props, use it
    if (fallbackSrc && imageSrc !== fallbackSrc) {
      setImageSrc(fallbackSrc);
      return;
    }
    
    // Otherwise delegate to the parent's onError handler
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
