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
import { type ProfileId } from '../api/types';
import { AppearanceSection } from '../components/settings/AppearanceSection';
import { AllServersStreamingSection } from '../components/settings/AllServersStreamingSection';
import { AllServersPerformanceSection } from '../components/settings/AllServersPerformanceSection';
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

  // Server-scoped sections (connection/exclusions/streaming/playback/
  // assistant/advanced) need a real picked profile while aggregating - an
  // aggregate bucket makes no sense for per-server data. Picker defaults to
  // the first profile in scope (refs #337).
  const scope = useProfileScope();
  // What the aggregate sections call themselves. A group answers with its own
  // name; All Servers has none stored, so it uses the localized label.
  const aggregateName =
    (scope?.mode === 'all' ? scope.aggregateName : null) ?? t('profiles.all_servers');

  // View-level update helper: AppearanceSection and the aggregate sections.
  // Targets the active aggregate's own bucket while aggregating so
  // language/date-format/etc. stay editable there, and the current profile's
  // bucket otherwise (unchanged single-mode behavior). Every aggregate keeps
  // its own bucket, so a group's knobs never write All Servers'.
  const update = <K extends keyof ProfileSettings>(
    key: K,
    value: ProfileSettings[K]
  ) => {
    const targetId = scope?.mode === 'all' ? scope.aggregateId : currentProfile?.id;
    if (!targetId) return;
    updateSettings(targetId, { [key]: value });
  };

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
          {/* Governs every tile from every server in the aggregate; above the
              picker so it does not read as another row belonging to the picked
              profile. */}
          <AllServersStreamingSection
            value={settings.allModeViewMode}
            onChange={(value) => update('allModeViewMode', value)}
            name={aggregateName}
          />
          {/* Same reasoning, same placement: every knob in here bounds the
              aggregate as a whole, so it belongs above the picker too. */}
          <AllServersPerformanceSection settings={settings} update={update} name={aggregateName} />
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
