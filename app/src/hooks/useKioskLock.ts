/**
 * Kiosk Lock Hook
 *
 * Shared logic for activating kiosk mode, including the first-time PIN set flow
 * and PIN change flow. Used by both the sidebar and fullscreen montage controls.
 */

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useKioskStore } from '../stores/kioskStore';
import { useSettingsStore } from '../stores/settings';
import { useProfileStore } from '../stores/profile';
import { hasPinStored, storePin } from '../lib/kioskPin';
import { useToast } from './use-toast';
import { log, LogLevel } from '../lib/logger';
import type { PinPadMode } from '../components/kiosk/PinPad';

interface UseKioskLockOptions {
  onLocked?: () => void;
}

export function useKioskLock(options?: UseKioskLockOptions) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const isLocked = useKioskStore((s) => s.isLocked);
  const kioskLock = useKioskStore((s) => s.lock);
  const currentProfileId = useProfileStore((s) => s.currentProfileId);
  const getProfileSettings = useSettingsStore((s) => s.getProfileSettings);
  const updateProfileSettings = useSettingsStore((s) => s.updateProfileSettings);

  const [showSetPin, setShowSetPin] = useState(false);
  const [setPinMode, setSetPinMode] = useState<PinPadMode>('set');
  const [pendingPin, setPendingPin] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [isChangingPin, setIsChangingPin] = useState(false);

  const activateKioskMode = useCallback(() => {
    if (!currentProfileId) return;
    const settings = getProfileSettings(currentProfileId);
    kioskLock(settings.insomnia);

    if (!settings.insomnia) {
      updateProfileSettings(currentProfileId, { insomnia: true });
    }

    options?.onLocked?.();
    toast({ title: t('kiosk.locked_toast') });
    log.kiosk('Kiosk mode activated', LogLevel.INFO);
  }, [currentProfileId, getProfileSettings, kioskLock, updateProfileSettings, options, toast, t]);

  const handleLockToggle = useCallback(async () => {
    if (isLocked) return;

    const hasPin = await hasPinStored();
    if (!hasPin) {
      setIsChangingPin(false);
      setSetPinMode('set');
      setPinError(null);
      setShowSetPin(true);
    } else {
      activateKioskMode();
    }
  }, [isLocked, activateKioskMode]);

  const handleChangePin = useCallback(() => {
    if (isLocked) return;
    setIsChangingPin(true);
    setSetPinMode('set');
    setPinError(null);
    setPendingPin(null);
    setShowSetPin(true);
  }, [isLocked]);

  const handleSetPinSubmit = useCallback(async (pin: string) => {
    if (setPinMode === 'set') {
      setPendingPin(pin);
      setSetPinMode('confirm');
      setPinError(null);
    } else if (setPinMode === 'confirm') {
      if (pin === pendingPin) {
        try {
          await storePin(pin);
          setShowSetPin(false);
          setPendingPin(null);
          if (isChangingPin) {
            setIsChangingPin(false);
            toast({ title: t('kiosk.pin_changed') });
            log.kiosk('Kiosk PIN changed', LogLevel.INFO);
          } else {
            activateKioskMode();
          }
        } catch {
          log.kiosk('Failed to store PIN', LogLevel.ERROR);
          setPinError(t('common.unknown_error'));
        }
      } else {
        setPinError(t('kiosk.pin_mismatch'));
        setSetPinMode('set');
        setPendingPin(null);
      }
    }
  }, [setPinMode, pendingPin, isChangingPin, activateKioskMode, toast, t]);

  const handleSetPinCancel = useCallback(() => {
    setShowSetPin(false);
    setPendingPin(null);
    setPinError(null);
    setIsChangingPin(false);
  }, []);

  return {
    isLocked,
    showSetPin,
    setPinMode,
    pinError,
    handleLockToggle,
    handleChangePin,
    handleSetPinSubmit,
    handleSetPinCancel,
  };
}
