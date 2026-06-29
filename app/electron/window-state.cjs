// Electron window-state persistence helpers (refs #195).
//
// The desktop shell launched at a fixed size every time and forgot any resize.
// These helpers persist the window bounds to a JSON file in userData and validate
// a restored position against the connected displays so a window saved on a since
// disconnected monitor does not open off-screen.

const fs = require('node:fs');

/**
 * True when the saved bounds overlap the work area of at least one display.
 * Pure (displays passed in) so it can be unit-tested without Electron.
 */
function isBoundsVisible(bounds, displays) {
  if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return false;
  if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) return false;
  return displays.some((d) => {
    const wa = d.workArea;
    return (
      bounds.x < wa.x + wa.width &&
      bounds.x + bounds.width > wa.x &&
      bounds.y < wa.y + wa.height &&
      bounds.y + bounds.height > wa.y
    );
  });
}

/** Read saved state from `file`. Returns null when absent or malformed. */
function loadWindowState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof s.width === 'number' && typeof s.height === 'number') return s;
  } catch {
    // No usable saved state.
  }
  return null;
}

/** Write `state` to `file`. Failures are swallowed (state is best-effort). */
function saveWindowState(file, state) {
  try {
    fs.writeFileSync(file, JSON.stringify(state));
  } catch {
    // Ignore: persisting window state must never block quitting.
  }
}

module.exports = { isBoundsVisible, loadWindowState, saveWindowState };
