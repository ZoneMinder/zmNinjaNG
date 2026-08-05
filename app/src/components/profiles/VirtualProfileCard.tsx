/**
 * One group's card on the Profiles page: the same blue family as the All
 * Servers card, because a group aggregates the same way and All Servers is
 * just the built-in group. Refs #337.
 *
 * Lives here rather than inline in Profiles.tsx, which is already well over
 * the file-size rule.
 */

import { useTranslation } from 'react-i18next';
import { Check, Edit, Layers, Loader2, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import type { VirtualProfile } from '../../api/types';

interface VirtualProfileCardProps {
  group: VirtualProfile;
  /** This group is the current selection. */
  isActive: boolean;
  /** A switch to this group is in flight. */
  isSwitching: boolean;
  onSwitch: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function VirtualProfileCard({
  group,
  isActive,
  isSwitching,
  onSwitch,
  onEdit,
  onDelete,
}: VirtualProfileCardProps) {
  const { t } = useTranslation();
  // The stored membership, not the effective one: this names what the user
  // picked. A disabled member drops out of the aggregate on its own (scope
  // resolution filters it) and comes back when it is re-enabled.
  const memberCount = group.memberProfileIds.length;

  return (
    <div
      className={`flex items-center justify-between p-4 rounded-lg border border-blue-500/40 bg-blue-500/10 hover:bg-blue-500/15 transition-colors cursor-pointer mt-3 ${isActive ? 'ring-1 ring-blue-500' : ''}`}
      data-testid={`profile-card-virtual-${group.id}`}
      onClick={onSwitch}
      onKeyDown={(e) => {
        // Only the card's own keys. Enter and Space on the buttons inside it
        // bubble up here, and preventDefault would cancel the activation the
        // button was about to perform, switching profiles instead of editing.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSwitch();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {isActive && (
          <Check className="h-4 w-4 text-primary shrink-0" data-testid="profile-active-indicator" />
        )}
        <Layers className="h-5 w-5 text-blue-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate" title={group.name}>
            {group.name}
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {t('profiles.group_member_count', { count: memberCount })}
          </p>
          <p
            className="text-xs text-muted-foreground/80 truncate"
            title={t('profiles.group_resource_note')}
          >
            {t('profiles.group_resource_note')}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isSwitching && <Loader2 className="h-4 w-4 animate-spin" />}
        {/* The card itself switches, so both buttons have to stop the click
            from reaching it. */}
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          title={t('common.edit')}
          aria-label={t('common.edit')}
          data-testid={`profile-virtual-edit-${group.id}`}
        >
          <Edit className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="text-destructive hover:text-destructive"
          title={t('common.delete')}
          aria-label={t('common.delete')}
          data-testid={`profile-virtual-delete-${group.id}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
