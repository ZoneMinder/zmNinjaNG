/**
 * Shared assistant window chrome (refs #246).
 *
 * The desktop card and the mobile sheet are different shells but share the same
 * controls: which backend label to show, and clear / minimize / close. This
 * keeps that logic in one place so the two shells only differ in layout, not
 * behavior.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';
import { useAssistantStore } from '../../stores/assistant';
import { useAssistantPanelStore } from '../../stores/assistantPanel';
import { ASSISTANT } from '../../lib/zmninja-ng-constants';

export interface AssistantChrome {
  /** Model + where it runs, e.g. "Qwen3 1.7B · On-device". Empty when nothing
   *  is configured yet. */
  backendLabel: string;
  /** Wipe the current profile's conversation and live activity. */
  clear: () => void;
  minimize: () => void;
  close: () => void;
  running: boolean;
  /** Clear is a no-op with an empty thread or a turn in flight. */
  canClear: boolean;
}

export function useAssistantChrome(): AssistantChrome {
  const { t } = useTranslation();
  const { currentProfile, settings } = useCurrentProfile();
  const profileId = currentProfile?.id;

  const running = useAssistantStore((s) => s.running);
  const threadLength = useAssistantStore((s) => (profileId ? (s.threads[profileId]?.length ?? 0) : 0));
  const reset = useAssistantStore((s) => s.reset);
  const clearActivities = useAssistantStore((s) => s.clearActivities);
  const minimize = useAssistantPanelStore((s) => s.minimize);
  const close = useAssistantPanelStore((s) => s.close);

  const backendLabel = useMemo(() => {
    const mode =
      settings.assistantBackend === 'ollama'
        ? t('settings.assistant.backend_ollama')
        : t('settings.assistant.backend_on_device');
    const model =
      settings.assistantBackend === 'ollama'
        ? settings.assistantOllamaModel
        : (ASSISTANT.webllmModels.find((m) => m.id === settings.assistantModelId)?.label ??
          settings.assistantModelId);
    return model ? `${model} · ${mode}` : mode;
  }, [settings.assistantBackend, settings.assistantModelId, settings.assistantOllamaModel, t]);

  return {
    backendLabel,
    clear: () => {
      if (!profileId) return;
      reset(profileId);
      clearActivities();
    },
    minimize,
    close,
    running,
    canClear: threadLength > 0 && !running,
  };
}
