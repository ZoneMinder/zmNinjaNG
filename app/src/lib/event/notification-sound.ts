/**
 * Notification sound
 *
 * Plays a short beep via the Web Audio API when a live event notification
 * arrives. Shared by NotificationHandler (single/current-profile toasts)
 * and useNotificationAllModeToasts (All-mode burst toasts, refs #337) so
 * both play the exact same tone.
 */

import { log, LogLevel } from '../logger';

export function playNotificationSound(): void {
  try {
    // Create a simple beep sound using Web Audio API
    const audioContext = new (window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800; // 800 Hz tone
    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
  } catch (error) {
    log.notifications('Failed to play notification sound', LogLevel.ERROR, error);
  }
}
