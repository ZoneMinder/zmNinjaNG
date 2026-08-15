/**
 * The rarely-used half of a profile or group card, behind one control.
 *
 * Switching is what a card is for and stays a button; editing a URL, disabling
 * a server, and deleting are occasional, and four icons per row left the list
 * looking like a toolbar with a name attached. The menu items keep the test
 * ids the buttons had, so what identifies an action does not depend on where
 * it is drawn.
 */

import { useTranslation } from 'react-i18next';
import { MoreVertical, Edit, Power, PowerOff, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../ui/dropdown-menu';

interface ProfileActionsMenuProps {
  /** Suffix for this row's test ids: the profile or group id. */
  targetId: string;
  onEdit: () => void;
  /** Absent on a group, and on the last profile, which cannot be deleted. */
  onDelete?: () => void;
  /** Absent on a group: only a real server connection can be disabled. */
  onToggleDisabled?: () => void;
  disabled?: boolean;
}

export function ProfileActionsMenu({
  targetId,
  onEdit,
  onDelete,
  onToggleDisabled,
  disabled = false,
}: ProfileActionsMenuProps) {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title={t('profiles.more_actions')}
          aria-label={t('profiles.more_actions')}
          data-testid={`profile-actions-menu-${targetId}`}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit} data-testid={`profile-edit-button-${targetId}`}>
          <Edit className="h-4 w-4" />
          {t('common.edit')}
        </DropdownMenuItem>

        {onToggleDisabled && (
          <DropdownMenuItem
            onSelect={onToggleDisabled}
            data-testid={`profile-disable-toggle-${targetId}`}
          >
            {disabled ? <Power className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
            {disabled ? t('profiles.enable') : t('profiles.disable')}
          </DropdownMenuItem>
        )}

        {onDelete && (
          <DropdownMenuItem
            onSelect={onDelete}
            className="text-destructive focus:text-destructive"
            data-testid={`profile-delete-button-${targetId}`}
          >
            <Trash2 className="h-4 w-4" />
            {t('common.delete')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
