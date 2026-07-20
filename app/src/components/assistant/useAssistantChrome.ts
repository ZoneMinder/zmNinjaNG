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
import { Platform } from '../../lib/platform';

/** Marks the point the model can no longer see (agent.ts's
 *  sliceAfterContextBoundary), and is rendered as a divider by AskPanel. */
const CONTEXT_CLEARED_MANUAL_KEY = 'assistant.context_cleared_manual';

export interface AssistantChrome {
  /** Model + where it runs, e.g. "Qwen3 1.7B · On-device". Empty when nothing
   *  is configured yet. */
  backendLabel: string;
  /** Wipe the current profile's conversation and live activity, and release
   *  the on-device model's memory. */
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
  const append = useAssistantStore((s) => s.append);
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
      // A note rather than an empty panel: a conversation vanishing with no
      // explanation reads as a bug, and this is also the boundary the model
      // cannot see past (agent.ts slices the history here).
      append(profileId, { role: 'assistant', text: `__i18n:${CONTEXT_CLEARED_MANUAL_KEY}`, contextBoundary: true });
    },
    minimize,
    close,
    running,
    // Enabled with an empty thread too: with nothing to clear there may still
    // be a loaded model to release.
    canClear: !running && (threadLength > 0 || Platform.isNative),
  };
}
