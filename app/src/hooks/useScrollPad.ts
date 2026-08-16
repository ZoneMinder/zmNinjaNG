/**
 * Whether the scroll pad is on screen, and how to flip it.
 *
 * Remembered per profile rather than per page visit. On a tablet the video
 * owns every drag that lands on it, so the pad is wanted for good; asking
 * again on each visit was the whole friction.
 *
 * There used to be a measurement here - how much of the scrollport the zoom
 * and pan surface covered - which decided for the user. It was wrong twice:
 * first as a free-pixel threshold the player's 100svh-7rem cap could never
 * satisfy, then as a coverage ratio that still cannot see that a thumb lands
 * on the video rather than on the strip beside it. A remembered switch, with
 * its button in the toolbar, needs no such guess. The one automatic case left
 * is montage edit mode, which is a fact rather than a measurement: a drag
 * there reorders tiles instead of scrolling, so the caller passes `forceOn`.
 */

import { useCallback } from 'react';
import { useCurrentProfile } from './useCurrentProfile';
import { useProfileStore } from '../stores/profile';
import { useSettingsStore } from '../stores/settings';

export function useScrollPad(forceOn = false): [boolean, () => void] {
  const { settings } = useCurrentProfile();
  // Write target: the real profile in single mode, the active aggregate's id
  // while aggregating, matching the bucket `settings` reads (refs #337).
  const currentProfileId = useProfileStore((state) => state.currentProfileId);
  const updateSettings = useSettingsStore((state) => state.updateProfileSettings);

  const stored = settings.showScrollPad;

  const toggle = useCallback(() => {
    if (!currentProfileId) return;
    updateSettings(currentProfileId, { showScrollPad: !stored });
  }, [currentProfileId, stored, updateSettings]);

  return [stored || forceOn, toggle];
}
