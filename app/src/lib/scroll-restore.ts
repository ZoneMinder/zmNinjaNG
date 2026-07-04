/**
 * Re-applies a saved scroll offset to a container while its content is still
 * growing after mount.
 *
 * A one-shot restore lands wrong when the page fills in after first paint: the
 * Events list renders a heatmap header and per-row tag chips from a separate
 * query, and monitor detail loads its recent-events list late, so at restore
 * time the container is shorter than its final height. Setting scrollTop once
 * then clamps to the short page, and as rows grow the target row drifts down
 * out of view (refs #197, #213).
 *
 * The offset is re-applied on every resize until it sticks, the user scrolls,
 * or maxMs elapses. Returns a cleanup that cancels the pending restore.
 */
export function restoreScrollWhileGrowing(el: HTMLElement, target: number, maxMs: number): () => void {
  const start = performance.now();
  let stopped = false;
  let observer: ResizeObserver | null = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    observer?.disconnect();
    el.removeEventListener('wheel', stop);
    el.removeEventListener('touchstart', stop);
    window.removeEventListener('keydown', stop);
  };

  const apply = () => {
    if (stopped) return;
    el.scrollTop = target;
    const reached = Math.abs(el.scrollTop - target) <= 1;
    if (reached || performance.now() - start > maxMs) stop();
  };

  // Don't fight the user if they scroll during the restore window.
  el.addEventListener('wheel', stop, { passive: true });
  el.addEventListener('touchstart', stop, { passive: true });
  window.addEventListener('keydown', stop);

  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => apply());
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
  }

  apply();
  const timer = window.setTimeout(stop, maxMs);

  return () => {
    window.clearTimeout(timer);
    stop();
  };
}
