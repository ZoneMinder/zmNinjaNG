/**
 * Profile Switcher Component
 *
 * A dropdown menu component that allows users to switch between different
 * ZoneMinder profiles (servers). It displays the current profile and
 * provides options to add new profiles or switch to existing ones.
 */

import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProfileStore } from '../stores/profile';
import { useShallow } from 'zustand/react/shallow';
import { log, LogLevel } from '../lib/logger';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Button } from './ui/button';
import { Check, ChevronDown, Server, Plus, Loader2, Layers } from 'lucide-react';
import { toast } from 'sonner';
import { ALL_PROFILES_ID, isAggregateProfileId } from '../api/types';
import { useAggregateLabel } from '../hooks/useAggregateLabel';

import { useTranslation } from 'react-i18next';

/**
 * ProfileSwitcher component.
 * Renders a button that opens a dropdown menu for profile management.
 */
export function ProfileSwitcher() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  // Disabled profiles are unselectable (switchProfile rejects them) so they
  // are hidden from the switcher entirely rather than shown muted - this
  // dropdown has no existing muted/disabled item styling to reuse, and a
  // profile the user can't act on has no reason to occupy a row here.
  // useShallow so an unrelated store update doesn't force a re-render off a
  // freshly-allocated (but element-wise identical) filtered array. Refs #337.
  const profiles = useProfileStore(useShallow((state) => state.profiles.filter((p) => !p.disabled)));
  const currentProfileId = useProfileStore((state) => state.currentProfileId);
  // Any aggregate hides the single-profile label; which aggregate decides what
  // the trigger says. The All Servers row's own tick asks the narrower
  // question, so a group never marks it as the current selection (refs #337).
  const isAggregate = isAggregateProfileId(currentProfileId);
  const aggregateLabel = useAggregateLabel();
  const currentProfile = useProfileStore(
    useShallow((state) => {
      const { profiles, currentProfileId } = state;
      return profiles.find((p) => p.id === currentProfileId) || null;
    })
  );
  const switchProfile = useProfileStore((state) => state.switchProfile);
  const [isLoading, setIsLoading] = useState(false);
  const switchAbortRef = useRef<AbortController | null>(null);

  const handleSwitch = async (profileId: string) => {
    const isAggregateTarget = isAggregateProfileId(profileId);
    const profile = profiles.find((p) => p.id === profileId);
    if (!isAggregateTarget && !profile) return;
    const name = isAggregateTarget ? aggregateLabel(profileId) : profile!.name;

    // Abort any in-flight switch
    if (switchAbortRef.current) switchAbortRef.current.abort();
    const abort = new AbortController();
    switchAbortRef.current = abort;

    toast.dismiss();
    setIsLoading(true);
    const loadingToast = toast.loading(t('profiles.switching_to', { name }));

    try {
      await switchProfile(profileId);
      if (abort.signal.aborted) return;

      toast.dismiss(loadingToast);
      toast.success(t('profiles.switched_to', { name }));
      setIsLoading(false);
      navigate('/monitors');
    } catch (error: unknown) {
      if (abort.signal.aborted) return;

      toast.dismiss(loadingToast);
      const message = error instanceof Error ? error.message : String(error);
      toast.error(t('profiles.switch_failed'), {
        description: message || t('common.unknown_error'),
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
          variant="ghost"
          className="flex items-center gap-2 w-full justify-between focus-visible:ring-0 focus-visible:ring-offset-0"
          data-testid="profile-switcher-trigger"
        >
          <div className="flex items-center gap-2 min-w-0">
            {isLoading ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            ) : (
              <Server className="h-4 w-4 shrink-0" />
            )}
            <span className="truncate">
              {isAggregate
                ? aggregateLabel(currentProfileId)
                : currentProfile?.name || t('profiles.select_profile')}
            </span>
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
            data-testid={`profile-switcher-item-${profile.id}`}
          >
            <div className="flex flex-col gap-1">
              <span className="font-medium">{profile.name}</span>
              <span className="text-xs text-muted-foreground truncate">
                {(() => {
                  try {
                    return new URL(profile.portalUrl).hostname;
                  } catch (error) {
                    log.profile('URL hostname parse failed', LogLevel.DEBUG, { error });
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
        {/* Placed after the real profiles for consistency with the Profiles
            page card order (refs #337 round 2). */}
        {profiles.length >= 2 && (
          <DropdownMenuItem
            onClick={() => handleSwitch(ALL_PROFILES_ID)}
            className="flex items-center justify-between cursor-pointer"
            data-testid="profile-switcher-all"
          >
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{t('profiles.all_servers')}</span>
            </div>
            {currentProfileId === ALL_PROFILES_ID && (
              <Check className="h-4 w-4 text-primary" data-testid="profile-switcher-all-active" />
            )}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleAddProfile} className="cursor-pointer" data-testid="profile-switcher-add-profile">
          <Plus className="h-4 w-4 mr-2" />
          {t('profiles.add_new_profile')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
