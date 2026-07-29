/**
 * Finding and hiding a password stored as URL userinfo (refs #307).
 *
 * ZoneMinder keeps a camera's password inside `Monitor.Path`
 * (`rtsp://admin:secret@cam/live`) and repeats it in `Monitor.Options` and in
 * the ffmpeg command line it writes to its own logs. Neither `URL` parsing nor
 * the log sanitizer's key rules can help there: the credential is a substring
 * of a value whose key says nothing sensitive, under a scheme `URL` handling
 * in the sanitizer never looked at.
 *
 * One regex, shared by the log sanitizer and the monitor settings UI, so the
 * two cannot disagree about where a password lives.
 */

/**
 * `scheme://user:password@` is the userinfo of any scheme, not just http(s).
 *
 * Username and password stop at `/` and `@` so a colon later in the path or
 * query (`?mail=a:b@c.com`, or a `host:port` followed by a path) cannot be
 * mistaken for a credential. The username excludes `:` as well so the capture
 * ends at the first colon, which is the separator the URL grammar defines.
 */
const URL_CREDENTIAL_RE = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s/@:]+):([^\s/@]*)@/g;

/** Shown in place of a password in the UI. Distinct from the log sanitizer's
 *  `[REDACTED]`: this one has to read as a value in a text field. */
export const PASSWORD_MASK = '●●●●●●●●';

/**
 * Replaces the password of every `scheme://user:password@host` in `text`.
 *
 * The username and host survive: they are what makes a log line or a settings
 * field useful, and neither is the secret.
 */
export function maskUrlCredentials(text: string, mask: string = PASSWORD_MASK): string {
  return text.replace(URL_CREDENTIAL_RE, (_match, prefix: string) => `${prefix}:${mask}@`);
}

/**
 * Undoes {@link maskUrlCredentials} for a value the user may have edited.
 *
 * A field showing a masked URL still has to be editable: changing the host must
 * not wipe the password the user cannot see. So a mask that survived the edit
 * means "keep what was there", while anything else the user typed is the new
 * password and is kept verbatim.
 */
export function restoreUrlCredentials(
  edited: string,
  original: string,
  mask: string = PASSWORD_MASK,
): string {
  if (!edited.includes(mask)) return edited;
  const originalPassword = new RegExp(URL_CREDENTIAL_RE.source).exec(original)?.[2];
  if (!originalPassword) return edited;
  return edited.split(`:${mask}@`).join(`:${originalPassword}@`);
}
