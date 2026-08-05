/**
 * Create or edit a group of servers (a virtual profile): a name plus the real
 * profiles it aggregates. Refs #337.
 *
 * Not ProfileForm: that form is shaped around one server connection (URLs,
 * credentials, discovery, certificate trust) and a group has none of those -
 * it only names a subset of profiles that already exist.
 *
 * Mounted only while open, so opening it is what seeds the fields from the
 * group being edited; there is no effect syncing props into state.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useProfileStore } from '../../stores/profile';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import type { ProfileId, VirtualProfile } from '../../api/types';

interface VirtualProfileDialogProps {
  /** The group to edit, or null to create one. */
  group: VirtualProfile | null;
  /** Called on save and on cancel; the parent unmounts this dialog. */
  onClose: () => void;
}

export function VirtualProfileDialog({ group, onClose }: VirtualProfileDialogProps) {
  const { t } = useTranslation();
  // Real profiles only - the store's virtual slice is a separate list, so a
  // group can never be offered as a member of another group.
  const profiles = useProfileStore(useShallow((state) => state.profiles));
  const profileExists = useProfileStore((state) => state.profileExists);
  const addVirtualProfile = useProfileStore((state) => state.addVirtualProfile);
  const updateVirtualProfile = useProfileStore((state) => state.updateVirtualProfile);

  const [name, setName] = useState(group?.name ?? '');
  const [memberIds, setMemberIds] = useState<ProfileId[]>(group?.memberProfileIds ?? []);
  const [error, setError] = useState<string | null>(null);

  const toggleMember = (id: ProfileId) => {
    setMemberIds((ids) => (ids.includes(id) ? ids.filter((m) => m !== id) : [...ids, id]));
  };

  const handleSave = () => {
    // Trimmed before anything looks at it: availability compares untrimmed,
    // so "Backyard " would pass a check that "Backyard" fails and then sit in
    // the switcher looking identical to the profile it collides with.
    const trimmedName = name.trim();

    // The same three rules the store enforces, checked here so the message is
    // localized and lands in the dialog. The store's copies are the ones that
    // actually hold the invariant (any caller can reach the action); these
    // exist because an English throw is not a user-facing error.
    if (trimmedName.length === 0) {
      setError(t('profiles.group_name_required'));
      return;
    }
    if (profileExists(trimmedName, group?.id)) {
      setError(t('profiles.group_name_taken'));
      return;
    }
    if (memberIds.length === 0) {
      setError(t('profiles.group_members_required'));
      return;
    }

    try {
      if (group) {
        updateVirtualProfile(group.id, { name: trimmedName, memberProfileIds: memberIds });
      } else {
        addVirtualProfile(trimmedName, memberIds);
      }
      onClose();
    } catch (err) {
      // What the checks above cannot see: a group deleted in another tab, a
      // member profile that disappeared between opening and saving.
      setError(err instanceof Error ? err.message : t('common.error'));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]" data-testid="virtual-profile-dialog">
        <DialogHeader>
          <DialogTitle>
            {group ? t('profiles.group_edit_title') : t('profiles.group_create_title')}
          </DialogTitle>
          <DialogDescription>{t('profiles.group_dialog_desc')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="virtual-profile-name">{t('profiles.group_name')}*</Label>
            <Input
              id="virtual-profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="virtual-profile-name"
            />
          </div>

          <div className="grid gap-2">
            <Label>{t('profiles.group_members')}*</Label>
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {profiles.map((profile) => (
                <div
                  key={profile.id}
                  className="flex items-center gap-2 min-w-0"
                  data-testid={`virtual-profile-member-row-${profile.id}`}
                >
                  <Checkbox
                    id={`virtual-profile-member-${profile.id}`}
                    checked={memberIds.includes(profile.id)}
                    onCheckedChange={() => toggleMember(profile.id)}
                    data-testid={`virtual-profile-member-${profile.id}`}
                  />
                  <Label
                    htmlFor={`virtual-profile-member-${profile.id}`}
                    className="flex items-center gap-2 min-w-0 cursor-pointer font-normal"
                  >
                    <span className="truncate" title={profile.name}>
                      {profile.name}
                    </span>
                    {/* Disabled profiles stay selectable: scope resolution
                        filters them while they are off, and the group works
                        again the moment one is re-enabled. */}
                    {profile.disabled && (
                      <Badge variant="outline" className="text-xs shrink-0">
                        {t('profiles.disabled')}
                      </Badge>
                    )}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive" data-testid="virtual-profile-error">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="virtual-profile-cancel">
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} data-testid="virtual-profile-save">
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
