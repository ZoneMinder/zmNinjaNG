/**
 * Profile Switcher Component
 *
 * A dropdown menu component that allows users to switch between different
 * ZoneMinder profiles (servers). It displays the current profile and
 * provides options to add new profiles or switch to existing ones.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProfileStore } from '../stores/profile';
import { useShallow } from 'zustand/react/shallow';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Button } from './ui/button';
import { Check, ChevronDown, Server, Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { log, LogLevel } from '../lib/logger';
import { useTranslation } from 'react-i18next';

/**
 * ProfileSwitcher component.
 * Renders a button that opens a dropdown menu for profile management.
 */
export function ProfileSwitcher() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const profiles = useProfileStore((state) => state.profiles);
  const currentProfile = useProfileStore(
    useShallow((state) => {
      const { profiles, currentProfileId } = state;
      return profiles.find((p) => p.id === currentProfileId) || null;
    })
  );
  const switchProfile = useProfileStore((state) => state.switchProfile);
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Handles switching to a selected profile.
   *
   * @param profileId - The ID of the profile to switch to
   */
  const handleSwitch = async (profileId: string) => {
    if (profileId === currentProfile?.id) return;

    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) return;

    log.profile('Switching profile', LogLevel.INFO, {
      from: currentProfile?.name,
      to: profile.name,
      fromId: currentProfile?.id,
      toId: profileId
    });
    setIsLoading(true);
    const loadingToast = toast.loading(t('profiles.switching_to', { name: profile.name }));

    try {
      await switchProfile(profileId);

      // Success!
      log.profile('Profile switch successful', LogLevel.INFO, { profileName: profile.name, profileId });
      toast.dismiss(loadingToast);
      toast.success(t('profiles.switched_to', { name: profile.name }));

      setIsLoading(false);

      // Navigate to monitors to trigger data reload
      navigate('/monitors');
    } catch (error: any) {
      log.profileSwitcher('Profile switch failed', LogLevel.ERROR, {
        profileId,
        profileName: profile.name,
        error,
      });

      toast.dismiss(loadingToast);
      toast.error(t('profiles.switch_failed'), {
        description: error?.message || t('common.unknown_error'),
      });

      setIsLoading(false);
    }
  };

  const handleAddProfile = () => {
    navigate('/profiles?action=add-profile');
  };

  if (profiles.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="flex items-center gap-2 min-w-[200px] justify-between"
          disabled={isLoading}
        >
          <div className="flex items-center gap-2 min-w-0">
            {isLoading ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            ) : (
              <Server className="h-4 w-4 shrink-0" />
            )}
            <span className="truncate">{currentProfile?.name || t('profiles.select_profile')}</span>
          </div>
          {!isLoading && <ChevronDown className="h-4 w-4 opacity-50" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[250px]">
        <DropdownMenuLabel>{t('profiles.switch_profile')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {profiles.map((profile) => (
          <DropdownMenuItem
            key={profile.id}
            onClick={() => handleSwitch(profile.id)}
            className="flex items-center justify-between cursor-pointer"
          >
            <div className="flex flex-col gap-1">
              <span className="font-medium">{profile.name}</span>
              <span className="text-xs text-muted-foreground truncate">
                {(() => {
                  try {
                    return new URL(profile.portalUrl).hostname;
                  } catch {
                    return profile.portalUrl;
                  }
                })()}
              </span>
            </div>
            {currentProfile?.id === profile.id && (
              <Check className="h-4 w-4 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleAddProfile} className="cursor-pointer">
          <Plus className="h-4 w-4 mr-2" />
          {t('profiles.add_new_profile')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
