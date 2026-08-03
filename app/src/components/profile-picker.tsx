/**
 * Profile Picker
 *
 * Compact profile selector for server-scoped pages/sections in All mode
 * (Server, Logs, NotificationSettings, Settings' server-scoped block, the
 * run-state control). Controlled: callers own the picked ProfileId and
 * default it to the first profile in scope (refs #337).
 */

import { useTranslation } from 'react-i18next';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import type { Profile, ProfileId } from '../api/types';

export interface ProfilePickerProps {
  profiles: Profile[];
  value: ProfileId | undefined;
  onChange: (profileId: ProfileId) => void;
  className?: string;
}

export function ProfilePicker({ profiles, value, onChange, className }: ProfilePickerProps) {
  const { t } = useTranslation();

  return (
    <Select value={value ?? ''} onValueChange={(v) => onChange(v as ProfileId)}>
      <SelectTrigger className={className ?? 'w-48'} data-testid="page-profile-picker">
        <SelectValue placeholder={t('profile_picker.label')} />
      </SelectTrigger>
      <SelectContent>
        {profiles.map((profile) => (
          <SelectItem key={profile.id} value={profile.id} data-testid={`page-profile-picker-option-${profile.id}`}>
            {profile.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
