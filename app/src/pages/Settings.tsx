/**
 * Settings Page
 *
 * Three-section flat settings layout: Appearance, Streaming & Playback, Advanced.
 * Each section is extracted into its own component under components/settings/.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NotificationBadge } from '../components/NotificationBadge';
import { PageContainer } from '../components/common/PageContainer';
import { ProfilePicker } from '../components/profile-picker';
import { useSettingsStore } from '../stores/settings';
import { useCurrentProfile, useProfileById } from '../hooks/useCurrentProfile';
import { useProfileScope } from '../hooks/useProfileScope';
import { ALL_PROFILES_ID, type ProfileId } from '../api/types';
import { AppearanceSection } from '../components/settings/AppearanceSection';
import { AllServersStreamingSection } from '../components/settings/AllServersStreamingSection';
import { LiveStreamingSection } from '../components/settings/LiveStreamingSection';
import { PlaybackSection } from '../components/settings/PlaybackSection';
import { AssistantSection } from '../components/settings/AssistantSection';
import { AdvancedSection } from '../components/settings/AdvancedSection';
import { HiddenMonitorsSection } from '../components/settings/HiddenMonitorsSection';
import type { ProfileSettings } from '../stores/settings';

export default function Settings() {
  const { t } = useTranslation();
  const { currentProfile, settings, isAllMode } = useCurrentProfile();
  const updateSettings = useSettingsStore((state) => state.updateProfileSettings);

  // View-level (ALL bucket) update helper: AppearanceSection only. Targets
  // the ALL_PROFILES_ID sentinel bucket in All mode so language/date-format/
  // etc. stay editable there, and the current profile's bucket otherwise
  // (unchanged single-mode behavior).
  const update = <K extends keyof ProfileSettings>(
    key: K,
    value: ProfileSettings[K]
  ) => {
    const targetId = isAllMode ? ALL_PROFILES_ID : currentProfile?.id;
    if (!targetId) return;
    updateSettings(targetId, { [key]: value });
  };

  // Server-scoped sections (connection/exclusions/streaming/playback/
  // assistant/advanced) need a real picked profile in All mode - the ALL
  // bucket makes no sense for per-server data. Picker defaults to the first
  // profile in scope (refs #337).
  const scope = useProfileScope();
  const [pickedProfileId, setPickedProfileId] = useState<ProfileId | undefined>(undefined);
  const defaultPickedId = isAllMode ? (pickedProfileId ?? scope?.profiles[0]?.id) : undefined;
  const { profile: pickedProfile, settings: pickedSettings } = useProfileById(defaultPickedId);
  const serverScopedProfile = isAllMode ? pickedProfile : currentProfile;
  const serverScopedSettings = isAllMode ? pickedSettings : settings;

  const updateServerScoped = <K extends keyof ProfileSettings>(
    key: K,
    value: ProfileSettings[K]
  ) => {
    if (!serverScopedProfile) return;
    updateSettings(serverScopedProfile.id, { [key]: value });
  };

  return (
    <PageContainer spacing="loose">
      {/* Page header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-base sm:text-lg font-bold tracking-tight">{t('settings.title')}</h1>
          <NotificationBadge />
        </div>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 hidden sm:block">
          {t('settings.subtitle')}
        </p>
      </div>

      <AppearanceSection settings={settings} update={update} />

      {isAllMode && (
        <>
          {/* Governs every tile from every server; above the picker so it does
              not read as another row belonging to the picked profile. */}
          <AllServersStreamingSection
            value={settings.allModeViewMode}
            onChange={(value) => update('allModeViewMode', value)}
          />
          <ProfilePicker
            profiles={scope?.profiles ?? []}
            value={defaultPickedId}
            onChange={setPickedProfileId}
          />
        </>
      )}

      <LiveStreamingSection
        settings={serverScopedSettings}
        update={updateServerScoped}
        currentProfile={serverScopedProfile}
        updateSettings={updateSettings}
      />
      <PlaybackSection
        settings={serverScopedSettings}
        update={updateServerScoped}
        currentProfile={serverScopedProfile}
        updateSettings={updateSettings}
      />
      <HiddenMonitorsSection
        settings={serverScopedSettings}
        currentProfile={serverScopedProfile}
        updateSettings={updateSettings}
      />
      <AssistantSection
        settings={serverScopedSettings}
        update={updateServerScoped}
        currentProfile={serverScopedProfile}
        updateSettings={updateSettings}
      />
      <AdvancedSection
        settings={serverScopedSettings}
        currentProfile={serverScopedProfile}
        updateSettings={updateSettings}
      />
    </PageContainer>
  );
}
