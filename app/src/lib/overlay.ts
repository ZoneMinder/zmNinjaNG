/**
 * DOM overlay detection.
 *
 * Used by back/Escape handling to decide whether a key press should close an
 * open layer (let Radix handle it) or fall through to navigation.
 */

/** True when a Radix dialog/alert-dialog or a popper (popover/dropdown/select) is open. */
export function hasOpenOverlay(): boolean {
  return !!document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-radix-popper-content-wrapper]'
  );
}
