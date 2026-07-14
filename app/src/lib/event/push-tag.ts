/**
 * Recover the ZoneMinder event id that zmeventnotificationNg encodes in the
 * Android notification tag.
 *
 * On Android, `getDeliveredNotifications()` drops the FCM `data` payload (see
 * the plugin docs), so when the app reads a tray notification on cold start the
 * `eid` in `data` is gone. In stacked mode the ES sets the notification tag to
 * `zmninja_<eid>_<event_type>` (issue #242 / zmeventnotificationNg#30), so the
 * tag is where the event id survives. The replace-mode constant tag
 * (`zmninjapush`) carries no id and yields null.
 */
export function parseEidFromPushTag(tag?: string | null): string | null {
  if (!tag) return null;
  const match = /^zmninja_(\d+)(?:_|$)/.exec(tag);
  return match ? match[1] : null;
}
