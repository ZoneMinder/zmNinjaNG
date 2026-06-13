/**
 * Link href scheme allowlist.
 *
 * Guards anchor targets that originate outside the app (markdown link targets
 * and developer-notice links) so a `javascript:`, `data:`, or `vbscript:` URL
 * cannot end up in an executable href. Only http/https/mailto and
 * relative/anchor links are allowed.
 */

const SAFE_SCHEMES = ['http:', 'https:', 'mailto:'];

/**
 * Returns true when href is safe to place in an `<a href>`. Relative and
 * anchor links (no scheme) are allowed because they cannot carry script.
 */
export function isSafeLinkHref(href: string): boolean {
  // Browsers ignore ASCII whitespace and control characters inside a scheme
  // (e.g. "java\nscript:"), so strip them before detecting the scheme.
  const cleaned = Array.from(href)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      // Drop control chars and space (<= 0x20) and the C1 control range.
      return code > 0x20 && !(code >= 0x7f && code <= 0x9f);
    })
    .join('');
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(cleaned);
  if (!schemeMatch) {
    // No explicit scheme: relative path or anchor. Cannot execute script.
    return true;
  }
  const scheme = `${schemeMatch[1].toLowerCase()}:`;
  return SAFE_SCHEMES.includes(scheme);
}
