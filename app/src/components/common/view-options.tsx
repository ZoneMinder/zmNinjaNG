/**
 * Menu items for the view preferences every streaming screen carries.
 *
 * Feed fit and analysis frames are set once and then left alone, but they sat
 * in the header of four screens, competing for width with the things a person
 * actually reaches for. They live in a ⋮ menu now, and these are the pieces
 * each screen drops into its own.
 *
 * The analysis item shares its state with AnalysisFramesToggle through
 * useAnalysisFramesSetting, so the button in the views that keep one and the
 * item in the menus can never disagree about what the setting is.
 */

import { useTranslation } from 'react-i18next';
import { MoreVertical } from 'lucide-react';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from '../ui/dropdown-menu';
import { useAnalysisFramesSetting } from '../../hooks/useAnalysisFramesSetting';

/** The two the UI offers. Screens store wider types - monitors can also hold
 *  'flex' - so the value read in is loose and only the choice emitted is not. */
export type FeedFitChoice = 'contain' | 'cover';

interface ViewOptionsMenuProps {
  /** Prefix for this screen's test ids; the trigger appends `-menu`. */
  testId: string;
  children: React.ReactNode;
}

export function ViewOptionsMenu({ testId, children }: ViewOptionsMenuProps) {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 sm:h-9 sm:w-9"
          title={t('common.view_options')}
          aria-label={t('common.view_options')}
          data-testid={`${testId}-menu`}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

interface FeedFitItemsProps {
  /** The stored setting; anything outside the two simply checks neither. */
  value: string;
  onChange: (value: FeedFitChoice) => void;
  /** Screen prefix, so the ids match what the header control used to carry. */
  testIdPrefix: string;
}

export function FeedFitItems({ value, onChange, testIdPrefix }: FeedFitItemsProps) {
  const { t } = useTranslation();

  // No group heading: it read "Fit" over an option also called "Fit". The
  // items say what they do instead, which a menu has room for and a 100px
  // select never did. The dashboard dialogs keep the short words, where a
  // label of their own supplies the context.
  return (
    <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as FeedFitChoice)}>
      <DropdownMenuRadioItem value="contain" data-testid={`${testIdPrefix}-fit-contain`}>
        {t('common.fit_whole_image')}
      </DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="cover" data-testid={`${testIdPrefix}-fit-cover`}>
        {t('common.crop_to_fill')}
      </DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  );
}

interface AnalysisFramesItemProps {
  /** Set by views that stream whatever the profile's Streaming Mode says. */
  alwaysStreaming?: boolean;
}

export function AnalysisFramesItem({ alwaysStreaming = false }: AnalysisFramesItemProps) {
  const { isOn, unavailable, toggle } = useAnalysisFramesSetting({ alwaysStreaming });
  const { t } = useTranslation();

  return (
    <DropdownMenuCheckboxItem
      checked={isOn}
      disabled={unavailable}
      onSelect={(e) => {
        // Several of these get flipped in a row while judging a feed, so the
        // menu stays open, unlike the one-shot actions elsewhere.
        e.preventDefault();
        toggle();
      }}
      data-testid="analysis-frames-toggle"
    >
      {t('video.analysis_frames')}
    </DropdownMenuCheckboxItem>
  );
}

/** Re-exported so a screen composing a menu imports from one place. */
export { DropdownMenuSeparator as ViewOptionsSeparator };
