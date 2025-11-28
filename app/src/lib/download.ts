/**
 * Download utilities for snapshots and videos
 * Works cross-platform (web browser and mobile apps)
 */

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { log } from './logger';

/**
 * Download a file from a URL
 * For web: triggers browser download
 * For mobile: saves to Downloads directory with media scan
 */
export async function downloadFile(url: string, filename: string): Promise<void> {
  const isNative = Capacitor.isNativePlatform();

  try {
    if (isNative) {
      // Mobile: Use native HTTP to bypass CORS and network restrictions
      log.info('[Download] Downloading via native HTTP', { component: 'Download', url });

      const response = await CapacitorHttp.get({
        url: url,
        responseType: 'blob',
      });

      if (response.status !== 200) {
        throw new Error(`Failed to download: HTTP ${response.status}`);
      }

      // CapacitorHttp returns blob data as base64 string
      const base64Data = response.data as string;

      const result = await Filesystem.writeFile({
        path: filename,
        data: base64Data,
        directory: Directory.Documents,
      });

      log.info('[Download] File saved to mobile storage', {
        component: 'Download',
        path: result.uri,
        filename
      });
    } else {
      // Web: Use traditional fetch + blob download
      const isDev = import.meta.env.DEV;
      let fetchUrl = url;

      if (isDev && (url.startsWith('http://') || url.startsWith('https://'))) {
        // Use the image proxy for cross-origin URLs in dev mode
        fetchUrl = `http://localhost:3001/image-proxy?url=${encodeURIComponent(url)}`;
        log.info('[Download] Using proxy for CORS', { component: 'Download', url: fetchUrl });
      }

      const response = await fetch(fetchUrl);
      if (!response.ok) {
        throw new Error(`Failed to download: ${response.statusText}`);
      }

      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up blob URL
      window.URL.revokeObjectURL(blobUrl);

      log.info('[Download] File downloaded via browser', { component: 'Download', filename });
    }
  } catch (error) {
    log.error('[Download] Failed to download file', { component: 'Download', url }, error);
    throw error;
  }
}

/**
 * Download a snapshot from a data URL or image URL
 * @param imageUrl - URL or data URL of the image
 * @param monitorName - Name of the monitor for filename
 */
export async function downloadSnapshot(imageUrl: string, monitorName: string): Promise<void> {
  const isNative = Capacitor.isNativePlatform();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `${monitorName}_${timestamp}.jpg`;

  // If it's a data URL
  if (imageUrl.startsWith('data:')) {
    if (isNative) {
      // Mobile: Save data URL directly
      const base64 = imageUrl.split(',')[1];
      const result = await Filesystem.writeFile({
        path: filename,
        data: base64,
        directory: Directory.Documents,
      });
      log.info('[Download] Snapshot saved from data URL', {
        component: 'Download',
        path: result.uri,
        filename
      });
    } else {
      // Web: Traditional download
      const link = document.createElement('a');
      link.href = imageUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    return;
  }

  // Otherwise fetch and download
  await downloadFile(imageUrl, filename);
}

/**
 * Capture current frame from an img element and download
 * @param imgElement - The image element to capture
 * @param monitorName - Name of the monitor for filename
 */
export async function downloadSnapshotFromElement(
  imgElement: HTMLImageElement,
  monitorName: string
): Promise<void> {
  const isNative = Capacitor.isNativePlatform();

  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `${monitorName}_${timestamp}.jpg`;
    const imageUrl = imgElement.src;

    // If it's a data URL
    if (imageUrl.startsWith('data:')) {
      if (isNative) {
        // Mobile: Save data URL to filesystem
        const base64 = imageUrl.split(',')[1];
        const result = await Filesystem.writeFile({
          path: filename,
          data: base64,
          directory: Directory.Documents,
        });

        log.info('[Download] Snapshot saved from data URL', {
          component: 'Download',
          path: result.uri,
          filename
        });
      } else {
        // Web: Traditional download
        const link = document.createElement('a');
        link.href = imageUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      return;
    }

    // For cross-origin images, use downloadFile which handles both platforms
    await downloadFile(imageUrl, filename);
  } catch (error) {
    log.error('[Download] Failed to capture snapshot', { component: 'Download' }, error);
    throw error;
  }
}

/**
 * Get event video download URL from ZoneMinder
 * ZoneMinder provides videos in different formats based on event storage
 */
export function getEventVideoDownloadUrl(
  portalUrl: string,
  eventId: string,
  token?: string
): string {
  // ZoneMinder video export endpoint
  // This tries to get the video file directly (mp4, avi, or mjpeg)
  const params = new URLSearchParams({
    view: 'video',
    eid: eventId,
    ...(token && { token }),
  });

  return `${portalUrl}/index.php?${params.toString()}`;
}

/**
 * Download event video
 * @param portalUrl - ZoneMinder portal URL
 * @param eventId - Event ID
 * @param eventName - Event name for filename
 * @param token - Optional auth token
 */
export async function downloadEventVideo(
  portalUrl: string,
  eventId: string,
  eventName: string,
  token?: string
): Promise<void> {
  const videoUrl = getEventVideoDownloadUrl(portalUrl, eventId, token);

  // Sanitize event name for filename
  const sanitizedName = eventName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

  // Try to download with appropriate extension
  // ZoneMinder may return mp4, avi, or mjpeg depending on storage format
  const filename = `Event_${eventId}_${sanitizedName}_${timestamp}.mp4`;

  try {
    await downloadFile(videoUrl, filename);
  } catch (error) {
    console.error('[Download] Failed to download video:', error);
    throw error;
  }
}

/**
 * Download event image/snapshot (for events with only JPEG frames, no video)
 * @param imageUrl - Full URL to the event image
 * @param eventId - Event ID
 * @param eventName - Event name for filename
 */
export async function downloadEventImage(
  imageUrl: string,
  eventId: string,
  eventName: string
): Promise<void> {
  // Sanitize event name for filename
  const sanitizedName = eventName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `Event_${eventId}_${sanitizedName}_${timestamp}.jpg`;

  try {
    await downloadFile(imageUrl, filename);
  } catch (error) {
    console.error('[Download] Failed to download event image:', error);
    throw error;
  }
}
