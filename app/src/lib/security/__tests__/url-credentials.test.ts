/**
 * Credential-in-URL masking (security-critical, refs #307).
 *
 * ZoneMinder stores a camera's password inside `Monitor.Path` as URL userinfo
 * (`rtsp://admin:secret@cam/live`) and pastes that same string into the ffmpeg
 * command line it writes to its own logs. These helpers are the one place that
 * knows how to find that segment, shared by the log sanitizer and the monitor
 * settings UI so the two cannot drift apart.
 */

import { describe, it, expect } from 'vitest';
import {
  maskUrlCredentials,
  restoreUrlCredentials,
  PASSWORD_MASK,
} from '../url-credentials';

describe('maskUrlCredentials', () => {
  it('masks the password of an rtsp URL, keeping user and host readable', () => {
    expect(maskUrlCredentials('rtsp://admin:S3cret@192.168.1.9:554/h264')).toBe(
      `rtsp://admin:${PASSWORD_MASK}@192.168.1.9:554/h264`,
    );
  });

  it.each(['http', 'https', 'rtsp', 'rtsps', 'rtmp', 'onvif'])(
    'masks the %s scheme',
    (scheme) => {
      const masked = maskUrlCredentials(`${scheme}://admin:S3cret@cam/live`);
      expect(masked).not.toContain('S3cret');
      expect(masked).toContain('admin');
    },
  );

  it('masks a credential embedded mid-string, as in an ffmpeg option list', () => {
    const masked = maskUrlCredentials('-rtsp_transport tcp -i rtsp://admin:S3cret@cam/live');
    expect(masked).toBe(`-rtsp_transport tcp -i rtsp://admin:${PASSWORD_MASK}@cam/live`);
  });

  it('masks every credential when a string carries more than one', () => {
    const masked = maskUrlCredentials('rtsp://a:one@h1/ and rtsp://b:two@h2/');
    expect(masked).not.toContain('one');
    expect(masked).not.toContain('two');
  });

  it('uses a caller-supplied mask so logs and UI can differ', () => {
    expect(maskUrlCredentials('rtsp://admin:S3cret@cam/live', '[REDACTED]')).toBe(
      'rtsp://admin:[REDACTED]@cam/live',
    );
  });

  it('leaves a URL with no userinfo alone', () => {
    expect(maskUrlCredentials('rtsp://cam.lan:554/h264')).toBe('rtsp://cam.lan:554/h264');
  });

  it('leaves a user-only URL alone: there is no password to hide', () => {
    expect(maskUrlCredentials('rtsp://admin@cam.lan/h264')).toBe('rtsp://admin@cam.lan/h264');
  });

  it('does not mistake an @ in the path or query for userinfo', () => {
    const url = 'https://zm.lan/zm/index.php?view=watch&mail=a:b@c.com';
    expect(maskUrlCredentials(url)).toBe(url);
  });

  it('passes through a string with no URL in it', () => {
    expect(maskUrlCredentials('nothing to see here')).toBe('nothing to see here');
  });
});

describe('restoreUrlCredentials', () => {
  const original = 'rtsp://admin:S3cret@cam.lan:554/h264';
  const masked = maskUrlCredentials(original);

  it('round-trips an untouched masked value back to the original', () => {
    expect(restoreUrlCredentials(masked, original)).toBe(original);
  });

  it('keeps the real password when the user edits the host around the mask', () => {
    const edited = masked.replace('cam.lan', 'newcam.lan');
    expect(restoreUrlCredentials(edited, original)).toBe(
      'rtsp://admin:S3cret@newcam.lan:554/h264',
    );
  });

  it('takes a typed password over the original when the mask is gone', () => {
    const edited = 'rtsp://admin:brandNew@cam.lan:554/h264';
    expect(restoreUrlCredentials(edited, original)).toBe(edited);
  });

  it('leaves the value alone when the original had no password to restore', () => {
    const edited = `rtsp://admin:${PASSWORD_MASK}@cam.lan/h264`;
    expect(restoreUrlCredentials(edited, 'rtsp://cam.lan/h264')).toBe(edited);
  });
});
