/**
 * useClampedNumberField Hook
 *
 * Local text draft for a store-backed numeric field, committed on blur (or
 * Enter) instead of on every keystroke. Extracted from
 * LiveActivitySettingsDialog so the All Servers performance section can bind
 * its number rows the same way (refs #337).
 *
 * Committing on every `onChange` has two problems. Binding the input straight
 * to the committed store number makes it impossible to clear: `Number('')` is
 * 0, so an empty or partial value would clamp to the minimum and redraw into
 * the input mid-edit. Committing a clamped value on every keystroke is also
 * self-defeating even with a local draft: the commit changes `storedValue`,
 * which resyncs the draft to the clamped string, so the NEXT keystroke
 * appends to that clamped string instead of what the user actually typed
 * (typing "12" one digit at a time: "1" commits and clamps to the minimum
 * "2", the draft resyncs to "2", and the next keystroke produces "22").
 *
 * Committing only on blur/Enter removes the loop entirely: `onChange` only
 * ever touches local state, so `storedValue` cannot change mid-edit and the
 * resync below cannot fire while the user is still typing.
 *
 * Deliberate policy for a genuine conflict, an external write landing while
 * the field has focus: the user's in-progress edit wins. `lastStoredValue`
 * (the last external value actually applied to the draft) is only advanced
 * together with applying it, never on its own, so a `storedValue` change
 * that arrives while focused leaves `lastStoredValue` stale rather than
 * marking that value as seen without ever showing it. On blur, `commit()`
 * writes whatever the user typed, superseding the value that arrived
 * mid-edit; the render right after that commit then sees its own new
 * `storedValue` differ from the still-stale `lastStoredValue` and applies
 * it (a no-op here, since it already matches the just-typed draft). Because
 * the two pieces of state always advance together, a field can never end up
 * permanently desynced: any external write that arrived mid-edit and was
 * superseded, or one that lands after the field is unfocused, is picked up
 * the next time this runs unfocused. That last part is also what makes the
 * reset buttons in the All Servers performance section work: the reset writes
 * the default to the store while the field is unfocused, and the resync below
 * pulls it into the draft.
 *
 * The resync itself runs during render rather than in a `useEffect`, per
 * React's documented pattern for "adjusting state when a prop changes"
 * (comparing against the last-seen prop value in state and calling
 * `setState` inline): it updates the draft before the browser paints the
 * stale value, where an effect-based resync would paint once with the old
 * draft and then again with the corrected one. Focus tracking uses state
 * rather than a ref for the same reason: the render-time guard below needs
 * to read it, and reading a ref during render is unsafe.
 */

import { useState, type KeyboardEvent } from 'react';

/**
 * Rounds as well as clamps, because every field bound to this hook counts
 * whole things: tiles, streams, seconds, minutes. Rounding matters beyond
 * taste, since the settings store rounds these values when it reads them
 * back. Committing a raw 2.5 would leave the store holding 2.5, every
 * consumer seeing 3, and this field showing 2.5 forever: `storedValue` never
 * changes, so the resync below has nothing to correct. Rounding here makes
 * the committed value the same number the store will hand back.
 */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function useClampedNumberField(
  storedValue: number,
  min: number,
  max: number,
  onCommit: (clamped: number) => void
) {
  const [draft, setDraft] = useState(() => String(storedValue));
  const [lastStoredValue, setLastStoredValue] = useState(storedValue);
  const [isFocused, setIsFocused] = useState(false);

  // Both pieces of state advance together, and only while unfocused: never
  // mark a value as seen (lastStoredValue) without also applying it (draft).
  if (storedValue !== lastStoredValue && !isFocused) {
    setLastStoredValue(storedValue);
    setDraft(String(storedValue));
  }

  const onChange = (raw: string) => {
    setDraft(raw);
  };

  const onFocus = () => {
    setIsFocused(true);
  };

  const commit = () => {
    const trimmed = draft.trim();
    const parsed = Number(trimmed);
    const clamped =
      trimmed === '' || !Number.isFinite(parsed) ? storedValue : clamp(parsed, min, max);
    setDraft(String(clamped));
    if (clamped !== storedValue) onCommit(clamped);
  };

  const onBlur = () => {
    setIsFocused(false);
    commit();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
  };

  return { draft, onChange, onFocus, onBlur, onKeyDown };
}
