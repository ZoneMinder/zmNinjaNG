/**
 * One group's card on the Profiles page, in its own blue family so an
 * aggregate never reads as one more server card. Refs #337.
 *
 * Switching goes through a button, the same as a profile row: the card used to
 * switch on its own click, which meant a role="button" wrapping the edit and
 * delete buttons - invalid nesting that a screen reader flattens - and made a
 * stray tap while reading the member list move the whole app to another server.
 *
 * Lives here rather than inline in Profiles.tsx, which is already well over
 * the file-size rule.
 */

import { useTranslation } from 'react-i18next';
import { Check, Layers, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import type { VirtualProfile } from '../../api/types';
import { ServerUrlDisclosure, type ServerUrlRow } from './ServerUrlDisclosure';
import { ProfileActionsMenu } from './ProfileActionsMenu';

interface VirtualProfileCardProps {
  group: VirtualProfile;
  /** This group is the current selection. */
  isActive: boolean;
  /** A switch to this group is in flight. */
  isSwitching: boolean;
  /** Members this group can actually aggregate: `countActiveMembers`. Zero
   *  makes the card unswitchable, never unmanageable. */
  activeMemberCount: number;
  /** One row per member server: its name and portal address. Folded away by
   *  default - a group is chosen by name, and read for what it aggregates. */
  memberUrls: ServerUrlRow[];
  onSwitch: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function VirtualProfileCard({
  group,
  isActive,
  isSwitching,
  activeMemberCount,
  memberUrls,
  onSwitch,
  onEdit,
  onDelete,
}: VirtualProfileCardProps) {
  const { t } = useTranslation();
  // The stored membership, not the effective one: this names what the user
  // picked. A disabled member drops out of the aggregate on its own (scope
  // resolution filters it) and comes back when it is re-enabled.
  const memberCount = group.memberProfileIds.length;
  // With nothing left to aggregate, switching lands on empty screens with no
  // explanation, so the switch goes and the subtitle says why. Edit and delete
  // stay live: they are the only way out of the state.
  const canSwitch = activeMemberCount > 0;

  return (
    <div
      className={`flex items-center justify-between p-4 rounded-lg border border-blue-500/40 bg-blue-500/10 transition-colors mt-3 ${canSwitch ? '' : 'opacity-70'} ${isActive ? 'ring-1 ring-blue-500' : ''}`}
      data-testid={`profile-card-virtual-${group.id}`}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {/* Always present, empty when this group is not the current one, so
            selecting a card does not shift its contents sideways. */}
        <span className="w-4 shrink-0">
          {isActive && (
            <Check className="h-4 w-4 text-primary" data-testid="profile-active-indicator" />
          )}
        </span>
        <Layers className="h-5 w-5 text-blue-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate" title={group.name}>
            {group.name}
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {canSwitch
              ? t('profiles.group_member_count', { count: memberCount })
              : t('profiles.group_no_active_members')}
          </p>
          <ServerUrlDisclosure rows={memberUrls} testId={`profile-urls-virtual-${group.id}`} />
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {/* Absent rather than disabled when there is nothing to aggregate: a
            group whose members are all disabled or deleted would switch to
            empty screens, and the subtitle already says why. */}
        {canSwitch && !isActive && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onSwitch}
            data-testid={`profile-virtual-switch-${group.id}`}
          >
            {isSwitching ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t('profiles.switching')}
              </>
            ) : (
              t('profiles.switch')
            )}
          </Button>
        )}
        <ProfileActionsMenu targetId={`virtual-${group.id}`} onEdit={onEdit} onDelete={onDelete} />
      </div>
    </div>
  );
}
