import { MoreVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { Button } from '../ui/button';
import { ProfileChip } from '../ui/profile-chip';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from '../ui/dropdown-menu';
import { FeedFitItems, AnalysisFramesItem, type FeedFitChoice } from '../common/view-options';

/** One entry in the show-monitors list. */
export interface MontageVisibilityItem {
  /** Toggle key: the bare monitor id in single mode, the composite
   *  profileId:monitorId tile id in All mode, where two servers can expose
   *  the same raw monitor id (refs #337). */
  id: string;
  name: string;
  /** Owning server label, All mode only. */
  profileChip?: string;
}

interface MontageKebabMenuProps {
  /** Already sorted by the page, which knows the server order. */
  items: MontageVisibilityItem[];
  hiddenMonitorIds: string[];
  onToggleVisibility: (id: string) => void;
  /** Whether the scroll pad is currently on screen. */
  scrollPadOn: boolean;
  onToggleScrollPad: () => void;
  feedFit: string;
  onFeedFitChange: (value: FeedFitChoice) => void;
}

export function MontageKebabMenu({
  items,
  hiddenMonitorIds,
  onToggleVisibility,
  scrollPadOn,
  onToggleScrollPad,
  feedFit,
  onFeedFitChange,
}: MontageKebabMenuProps) {
  const { t } = useTranslation();

  const hiddenSet = useMemo(() => new Set(hiddenMonitorIds), [hiddenMonitorIds]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 sm:h-9 px-2"
          aria-label={t('montage.menu_more')}
          title={t('montage.menu_more')}
          data-testid="montage-kebab-menu"
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* Set once and then left alone, so they belong here rather than in a
            header that has to fit a group filter, layouts, edit, fullscreen
            and refresh besides. */}
        <FeedFitItems value={feedFit} onChange={onFeedFitChange} testIdPrefix="montage" />
        <DropdownMenuSeparator />
        <AnalysisFramesItem />
        {/* Edit mode turns the pad on by itself, since a drag there reorders
            tiles rather than scrolling. This entry covers the rest: a grid
            taller than the screen on a touch device, where the tiles are the
            only surface a finger can land on (refs #365). */}
        {/* Closes on select, unlike the visibility entries below: this is one
            switch, not a list you tick through. */}
        <DropdownMenuCheckboxItem
          checked={scrollPadOn}
          onSelect={onToggleScrollPad}
          data-testid="montage-kebab-scroll-pad"
        >
          {t('common.scroll_buttons')}
        </DropdownMenuCheckboxItem>
        {items.length > 0 && <DropdownMenuSeparator />}
        {items.length > 0 && (
          <DropdownMenuSub>
            {/* inset: a sub-trigger has no indicator, so without it this text
                starts 24px left of every checkable item above it. */}
            <DropdownMenuSubTrigger inset data-testid="montage-kebab-visibility">
              {t('montage.menu_show_monitors')}
            </DropdownMenuSubTrigger>
            {/* Bounded width, or the submenu grows to the longest monitor
                name and the entry's `truncate` never engages - a name long
                enough would push the panel past the 320px floor the project
                sizes labels against. The title attribute carries the full
                name for anything the ellipsis eats. */}
            <DropdownMenuSubContent className="max-w-[15rem] max-h-[min(60vh,24rem)] overflow-y-auto">
              {items.map((item) => (
                <DropdownMenuCheckboxItem
                  key={item.id}
                  checked={!hiddenSet.has(item.id)}
                  onSelect={(e) => {
                    e.preventDefault();
                    onToggleVisibility(item.id);
                  }}
                  data-testid={`montage-visibility-${item.id}`}
                >
                  <span className="truncate min-w-0" title={item.name}>
                    {item.name}
                  </span>
                  {item.profileChip && (
                    <ProfileChip
                      name={item.profileChip}
                      testId={`montage-visibility-chip-${item.id}`}
                      className="ml-1.5"
                    />
                  )}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
