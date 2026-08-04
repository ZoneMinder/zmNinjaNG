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
} from '../ui/dropdown-menu';

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
}

export function MontageKebabMenu({
  items,
  hiddenMonitorIds,
  onToggleVisibility,
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
        {items.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid="montage-kebab-visibility">
              {t('montage.menu_show_monitors')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-[min(60vh,24rem)] overflow-y-auto">
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
