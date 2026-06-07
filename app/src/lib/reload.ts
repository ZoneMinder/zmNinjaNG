/**
 * App reload helper.
 *
 * Reloads the current window. On Electron this reloads the renderer window, on
 * mobile the Capacitor WebView, and on web the browser tab. Used by the refresh
 * controls so a refresh is a full reload (re-bootstrap, re-auth, re-fetch, and
 * fresh streams) rather than a partial query refetch.
 */
export function reloadApp(): void {
  window.location.reload();
}
