/**
 * ZM Notifications API
 *
 * Manages FCM push token registration via ZoneMinder's Notifications REST API.
 * Used in Direct ZM notification mode (no Event Server websocket needed).
 * See ZoneMinder PR #4685 for server-side implementation.
 */

import type { ApiClient } from './client';
import { log, LogLevel } from '../lib/logger';
import { validateApiResponse } from '../lib/zm/api-validator';
import { ZMNotificationResponseSchema } from './types';

export interface ZMNotification {
  Id: number;
  UserId: number | null;
  Token: string;
  Platform: 'android' | 'ios' | 'web';
  MonitorList: string | null;
  Interval: number;
  PushState: 'enabled' | 'disabled';
  AppVersion: string | null;
  BadgeCount: number;
  LastNotifiedAt: string | null;
  CreatedOn: string;
  UpdatedOn: string;
}

interface NotificationResponse {
  notification: { Notification: ZMNotification };
}

/**
 * Register or upsert an FCM token with the ZM server.
 * If the token already exists, updates the existing row.
 */
export async function registerToken(
  client: ApiClient,
  params: {
    token: string;
    platform: 'android' | 'ios' | 'web';
    monitorList?: string;
    interval?: number;
    pushState?: 'enabled' | 'disabled';
    appVersion?: string;
    profile?: string;
  }
): Promise<ZMNotification> {
  log.api('Registering notification token via ZM API', LogLevel.INFO, {
    platform: params.platform,
    profile: params.profile,
  });

  const formData = new URLSearchParams();
  formData.append('Notification[Token]', params.token);
  formData.append('Notification[Platform]', params.platform);
  if (params.monitorList !== undefined) formData.append('Notification[MonitorList]', params.monitorList);
  if (params.interval !== undefined) formData.append('Notification[Interval]', String(params.interval));
  if (params.pushState) formData.append('Notification[PushState]', params.pushState);
  if (params.appVersion) formData.append('Notification[AppVersion]', params.appVersion);
  if (params.profile) formData.append('Notification[Profile]', params.profile.slice(0, 128));

  const resp = await client.postForm<NotificationResponse>('/notifications.json', formData);
  return validateApiResponse(ZMNotificationResponseSchema, resp.data, {
    endpoint: '/notifications.json',
    method: 'POST',
  }).notification.Notification;
}

/**
 * Update an existing notification registration (monitor list, interval, push state).
 * Only send fields you want to change.
 */
export async function updateNotification(
  client: ApiClient,
  id: number,
  params: Partial<{
    monitorList: string;
    interval: number;
    pushState: 'enabled' | 'disabled';
    badgeCount: number;
  }>
): Promise<ZMNotification> {
  log.api('Updating notification via ZM API', LogLevel.INFO, { id });

  const formData = new URLSearchParams();
  if (params.monitorList !== undefined) formData.append('Notification[MonitorList]', params.monitorList);
  if (params.interval !== undefined) formData.append('Notification[Interval]', String(params.interval));
  if (params.pushState !== undefined) formData.append('Notification[PushState]', params.pushState);
  if (params.badgeCount !== undefined) formData.append('Notification[BadgeCount]', String(params.badgeCount));

  const resp = await client.putForm<NotificationResponse>(`/notifications/${id}.json`, formData);
  return validateApiResponse(ZMNotificationResponseSchema, resp.data, {
    endpoint: `/notifications/${id}.json`,
    method: 'PUT',
  }).notification.Notification;
}

/**
 * Delete a notification registration.
 */
export async function deleteNotification(client: ApiClient, id: number): Promise<void> {
  log.api('Deleting notification via ZM API', LogLevel.INFO, { id });

  await client.delete(`/notifications/${id}.json`);
}

/**
 * Check if the ZM server supports the Notifications API.
 * Returns true on 200 (even if empty list), false on 404.
 */
export async function checkNotificationsApiSupport(client: ApiClient): Promise<boolean> {
  try {
    await client.get('/notifications.json');
    return true;
  } catch (e: unknown) {
    const error = e as { status?: number; response?: { status?: number } };
    if (error?.status === 404 || error?.response?.status === 404) return false;
    throw e;
  }
}
