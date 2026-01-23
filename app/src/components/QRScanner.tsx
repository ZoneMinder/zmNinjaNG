/**
 * QR Scanner Component
 *
 * A dialog-based QR code scanner that uses:
 * - Native barcode scanning on iOS/Android (capacitor-barcode-scanner)
 * - Web-based scanning on desktop (html5-qrcode)
 *
 * Used for scanning profile QR codes to import ZoneMinder server configurations.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import type { Html5Qrcode as Html5QrcodeType } from 'html5-qrcode';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Camera, CameraOff, Loader2, AlertCircle } from 'lucide-react';
import { log, LogLevel } from '../lib/logger';

interface QRScannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (data: string) => void;
}

const SCANNER_ID = 'qr-scanner-region';

// Scanner state constants (from html5-qrcode)
const SCANNER_STATE = {
  NOT_STARTED: 0,
  SCANNING: 1,
  PAUSED: 2,
};

export function QRScanner({ open, onOpenChange, onScan }: QRScannerProps) {
  const { t } = useTranslation();
  const scannerRef = useRef<Html5QrcodeType | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const isNative = Capacitor.isNativePlatform();

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        const state = scannerRef.current.getState();
        if (state === SCANNER_STATE.SCANNING || state === SCANNER_STATE.PAUSED) {
          await scannerRef.current.stop();
        }
      } catch (e) {
        log.profile('Error stopping QR scanner', LogLevel.WARN, e);
      }
      scannerRef.current = null;
    }
  }, []);

  // Native scanner for iOS/Android
  const startNativeScanner = useCallback(async () => {
    setIsStarting(true);
    setError(null);

    try {
      const { BarcodeScanner } = await import('capacitor-barcode-scanner');

      setIsStarting(false);

      // Start scanning - this opens native camera UI and handles permissions
      const result = await BarcodeScanner.scan();

      if (result.result && result.code) {
        log.profile('QR code scanned (native)', LogLevel.INFO);
        onScan(result.code);
        onOpenChange(false);
      } else {
        // User cancelled or no content
        onOpenChange(false);
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      log.profile('Native QR scanner failed', LogLevel.ERROR, e);

      if (
        errorMessage.toLowerCase().includes('permission') ||
        errorMessage.toLowerCase().includes('denied') ||
        errorMessage.toLowerCase().includes('camera')
      ) {
        setHasPermission(false);
        setError('camera_permission_denied');
      } else {
        setError('camera_error');
      }
      setIsStarting(false);
    }
  }, [onScan, onOpenChange]);

  // Web scanner for desktop browsers
  const startWebScanner = useCallback(async () => {
    setIsStarting(true);
    setError(null);

    try {
      // Clean up any existing scanner
      await stopScanner();

      // Wait for DOM element to be ready
      await new Promise((resolve) => setTimeout(resolve, 100));

      const element = document.getElementById(SCANNER_ID);
      if (!element) {
        throw new Error('Scanner element not found');
      }

      // Dynamic import to avoid SSR/bundling issues
      const { Html5Qrcode } = await import('html5-qrcode');
      const scanner = new Html5Qrcode(SCANNER_ID);
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1,
        },
        (decodedText) => {
          log.profile('QR code scanned (web)', LogLevel.INFO);
          onScan(decodedText);
          onOpenChange(false);
        },
        () => {
          // QR code scan failure - this fires continuously while scanning, ignore
        }
      );

      setHasPermission(true);
      log.profile('Web QR scanner started', LogLevel.INFO);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      log.profile('Web QR scanner failed to start', LogLevel.ERROR, e);

      // Check for permission denied
      if (
        errorMessage.includes('Permission') ||
        errorMessage.includes('NotAllowedError') ||
        errorMessage.includes('denied')
      ) {
        setHasPermission(false);
        setError('camera_permission_denied');
      } else if (errorMessage.includes('NotFoundError') || errorMessage.includes('no camera')) {
        setError('camera_not_found');
      } else {
        setError('camera_error');
      }
    } finally {
      setIsStarting(false);
    }
  }, [onScan, onOpenChange, stopScanner]);

  const startScanner = useCallback(async () => {
    if (isNative) {
      await startNativeScanner();
    } else {
      await startWebScanner();
    }
  }, [isNative, startNativeScanner, startWebScanner]);

  // Start scanner when dialog opens
  useEffect(() => {
    if (open) {
      startScanner();
    } else {
      if (!isNative) {
        stopScanner();
      }
      setError(null);
      setHasPermission(null);
    }

    return () => {
      if (!isNative) {
        stopScanner();
      }
    };
  }, [open, isNative, startScanner, stopScanner]);

  // For native platforms, we don't show the dialog UI - the native scanner takes over
  // But we still need to show errors
  if (isNative && !error) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="qr-scanner-dialog"
        aria-describedby="qr-scanner-description"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            {t('qr_scanner.title')}
          </DialogTitle>
          <DialogDescription id="qr-scanner-description">
            {t('qr_scanner.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Scanner viewport (web only) */}
          {!isNative && (
            <div
              id={SCANNER_ID}
              className="relative w-full aspect-square bg-muted rounded-lg overflow-hidden"
              data-testid="qr-scanner-viewport"
            >
              {isStarting && (
                <div className="absolute inset-0 flex items-center justify-center bg-muted">
                  <div className="text-center space-y-2">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">{t('qr_scanner.starting')}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error display */}
          {error && !isStarting && (
            <div className="flex items-center justify-center bg-muted rounded-lg p-6">
              <div className="text-center space-y-3">
                {hasPermission === false ? (
                  <CameraOff className="h-12 w-12 mx-auto text-destructive" />
                ) : (
                  <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
                )}
                <p className="text-sm text-destructive font-medium">
                  {t(`qr_scanner.errors.${error}`)}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={startScanner}
                  data-testid="qr-scanner-retry"
                >
                  {t('qr_scanner.retry')}
                </Button>
              </div>
            </div>
          )}

          {!isNative && !error && (
            <p className="text-xs text-center text-muted-foreground">{t('qr_scanner.hint')}</p>
          )}

          <Button
            variant="outline"
            className="w-full"
            onClick={() => onOpenChange(false)}
            data-testid="qr-scanner-cancel"
          >
            {t('common.cancel')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
