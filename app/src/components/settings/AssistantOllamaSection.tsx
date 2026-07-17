/**
 * Ollama (OpenAI-compatible) backend settings (refs #246)
 *
 * Rendered by `AssistantSection.tsx` when `settings.assistantBackend ===
 * 'ollama'`. Base URL and model name are plain profile settings; the
 * optional API key never touches `ProfileSettings` (it would be persisted in
 * plaintext, rule 7) and instead lives in `lib/security/secureStorage.ts`
 * under `${ASSISTANT.apiKeyStoragePrefix}${profileId}`. The input never
 * shows the stored value back: only whether one is currently set (`hasKey`),
 * mirroring how a password field behaves elsewhere in this app.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { PasswordInput } from '../ui/password-input';
import { RefreshButton } from '../common/RefreshButton';
import { RowLabel } from './SettingsLayout';
import { ASSISTANT } from '../../lib/zmninja-ng-constants';
import { listOpenAiModels } from '../../lib/assistant/providers/openai';
import { getSecureValue, setSecureValue, removeSecureValue, hasSecureValue } from '../../lib/security/secureStorage';
import { resolveQueryError } from '../../lib/query/query-error';
import { useToast } from '../../hooks/use-toast';
import { log, LogLevel } from '../../lib/logger';
import type { Profile } from '../../api/types';
import type { ProfileSettings } from '../../stores/settings';

export interface AssistantOllamaSectionProps {
  settings: ProfileSettings;
  update: <K extends keyof ProfileSettings>(key: K, value: ProfileSettings[K]) => void;
  currentProfile: Profile | null;
}

function apiKeyStorageKey(profileId: string): string {
  return `${ASSISTANT.apiKeyStoragePrefix}${profileId}`;
}

export function AssistantOllamaSection({ settings, update, currentProfile }: AssistantOllamaSectionProps) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [testing, setTesting] = useState(false);
  // null: never fetched yet (or the last fetch failed). []: fetched, server
  // has no models registered. Both fall back to the manual text input below.
  const [models, setModels] = useState<string[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!currentProfile) return;
    let cancelled = false;
    hasSecureValue(apiKeyStorageKey(currentProfile.id))
      .then((v) => {
        if (!cancelled) setHasKey(v);
      })
      .catch((error) => {
        log.assistant('hasSecureValue check for Ollama API key failed', LogLevel.ERROR, { error });
      });
    return () => {
      cancelled = true;
    };
  }, [currentProfile]);

  const handleKeyBlur = useCallback(async () => {
    if (!currentProfile || !apiKeyDraft) return;
    try {
      await setSecureValue(apiKeyStorageKey(currentProfile.id), apiKeyDraft);
      if (mountedRef.current) {
        setHasKey(true);
        setApiKeyDraft('');
      }
    } catch (error) {
      log.assistant('Failed to save the Ollama API key', LogLevel.ERROR, { error });
      toast({
        title: t('common.error'),
        description: resolveQueryError(error, t, { fallbackKey: 'assistant.error_generic' }),
        variant: 'destructive',
      });
    }
  }, [currentProfile, apiKeyDraft, t, toast]);

  const handleClearKey = useCallback(async () => {
    if (!currentProfile) return;
    await removeSecureValue(apiKeyStorageKey(currentProfile.id));
    if (mountedRef.current) {
      setHasKey(false);
      setApiKeyDraft('');
    }
  }, [currentProfile]);

  // Shared by the test-connection call and the model-list fetch: the draft
  // (unsaved) key field wins if the user just typed one, otherwise fall back
  // to whatever is already persisted in secure storage for this profile.
  const getEffectiveApiKey = useCallback(async (): Promise<string | undefined> => {
    if (apiKeyDraft) return apiKeyDraft;
    if (!currentProfile) return undefined;
    const stored = await getSecureValue(apiKeyStorageKey(currentProfile.id));
    return stored ?? undefined;
  }, [apiKeyDraft, currentProfile]);

  const handleTestConnection = useCallback(async () => {
    setTesting(true);
    try {
      const key = await getEffectiveApiKey();
      const baseUrl = settings.assistantOllamaBaseUrl.replace(/\/+$/, '');
      // A plain reachability probe (GET /models), not a chat turn (refs #246):
      // `testConnectionTimeoutMs` (8s) instead of the 120s `requestTimeoutMs`
      // that a real generation needs, so an unreachable host fails fast
      // instead of leaving the button reading "Testing…" for two minutes.
      const list = await listOpenAiModels(baseUrl, key, ASSISTANT.testConnectionTimeoutMs);
      if (mountedRef.current) {
        toast({
          title:
            list.length > 0
              ? t('settings.assistant.ollama_test_ok_models', { count: list.length })
              : t('settings.assistant.ollama_test_ok'),
        });
      }
    } catch (error) {
      log.assistant('Ollama test connection failed', LogLevel.WARN, { error });
      if (mountedRef.current) {
        toast({
          title: t('common.error'),
          description: resolveQueryError(error, t, { fallbackKey: 'assistant.error_generic' }),
          variant: 'destructive',
        });
      }
    } finally {
      if (mountedRef.current) setTesting(false);
    }
  }, [getEffectiveApiKey, settings.assistantOllamaBaseUrl, t, toast]);

  // Fetches the model list from the server for the picker below. A failure
  // here is non-fatal (rule 32 toast, not an error wall): the manual text
  // input keeps working, so this never blocks configuring the backend.
  const loadModels = useCallback(async () => {
    if (!settings.assistantOllamaBaseUrl) return;
    setLoadingModels(true);
    try {
      const key = await getEffectiveApiKey();
      const baseUrl = settings.assistantOllamaBaseUrl.replace(/\/+$/, '');
      const list = await listOpenAiModels(baseUrl, key);
      if (mountedRef.current) setModels(list);
    } catch (error) {
      log.assistant('Fetching the Ollama model list failed', LogLevel.WARN, { error });
      if (mountedRef.current) {
        toast({
          title: t('common.error'),
          description: resolveQueryError(error, t, { fallbackKey: 'assistant.error_generic' }),
          variant: 'destructive',
        });
      }
    } finally {
      if (mountedRef.current) setLoadingModels(false);
    }
  }, [getEffectiveApiKey, settings.assistantOllamaBaseUrl, t, toast]);

  // Runs once on mount, i.e. when this sub-section first appears (either on
  // initial render with backend already 'ollama', or right after the parent
  // switches the backend picker to Ollama, which mounts this component for
  // the first time). Deliberately NOT keyed on `assistantOllamaBaseUrl`: that
  // would re-fire on every keystroke in the URL field. The URL input's
  // `onBlur` below is the other trigger, matching how `handleKeyBlur` commits
  // the API key field only on blur rather than on every change.
  useEffect(() => {
    void loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The saved model always appears in the picker even if the server didn't
  // return it (e.g. it was unloaded, or the value was typed in manually
  // before ever fetching), so switching to the dropdown never silently
  // discards a working manual entry.
  const selectableModels = useMemo(() => {
    if (!models) return [];
    const saved = settings.assistantOllamaModel;
    if (saved && !models.includes(saved)) return [...models, saved];
    return models;
  }, [models, settings.assistantOllamaModel]);

  return (
    <>
      <div className="px-4 py-3 space-y-2">
        <RowLabel label={t('settings.assistant.ollama_url')} />
        <Input
          value={settings.assistantOllamaBaseUrl}
          onChange={(e) => update('assistantOllamaBaseUrl', e.target.value)}
          onBlur={() => void loadModels()}
          placeholder={ASSISTANT.defaultOllamaBaseUrl}
          className="w-full sm:w-80"
          data-testid="assistant-ollama-url"
        />
      </div>

      <div className="px-4 py-3 space-y-2">
        {selectableModels.length > 0 ? (
          <>
            <RowLabel label={t('settings.assistant.select_model')} />
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="text-sm bg-background border rounded px-2 py-1.5 w-full sm:w-64"
                value={settings.assistantOllamaModel}
                onChange={(e) => update('assistantOllamaModel', e.target.value)}
                data-testid="assistant-ollama-model-select"
              >
                {selectableModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <RefreshButton
                onRefresh={() => void loadModels()}
                isLoading={loadingModels}
                label={t('settings.assistant.load_models')}
                data-testid="assistant-ollama-refresh-models"
                aria-label={t('settings.assistant.load_models')}
              />
            </div>
          </>
        ) : (
          <>
            <RowLabel label={t('settings.assistant.ollama_model')} />
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={settings.assistantOllamaModel}
                onChange={(e) => update('assistantOllamaModel', e.target.value)}
                placeholder={t('settings.assistant.ollama_model_placeholder')}
                className="w-full sm:w-64"
                data-testid="assistant-ollama-model"
              />
              <RefreshButton
                onRefresh={() => void loadModels()}
                isLoading={loadingModels}
                label={t('settings.assistant.load_models')}
                data-testid="assistant-ollama-refresh-models"
                aria-label={t('settings.assistant.load_models')}
              />
            </div>
            {models !== null && models.length === 0 && (
              <p className="text-xs text-muted-foreground" data-testid="assistant-ollama-no-models">
                {t('settings.assistant.no_models')}
              </p>
            )}
          </>
        )}

        {selectableModels.length > 0 && (
          <div className="space-y-1 pt-1">
            <RowLabel label={t('settings.assistant.model_manual')} />
            <Input
              value={settings.assistantOllamaModel}
              onChange={(e) => update('assistantOllamaModel', e.target.value)}
              placeholder={t('settings.assistant.ollama_model_placeholder')}
              className="w-full sm:w-64"
              data-testid="assistant-ollama-model"
            />
          </div>
        )}
      </div>

      <div className="px-4 py-3 space-y-2">
        <RowLabel
          label={t('settings.assistant.ollama_key')}
          desc={hasKey ? t('settings.assistant.ollama_key_set') : undefined}
        />
        <div className="flex flex-wrap items-center gap-2">
          <PasswordInput
            value={apiKeyDraft}
            onChange={(e) => setApiKeyDraft(e.target.value)}
            onBlur={() => void handleKeyBlur()}
            placeholder={t('settings.assistant.ollama_key_placeholder')}
            className="w-full sm:w-64"
            data-testid="assistant-ollama-key"
          />
          {hasKey && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleClearKey()}
              data-testid="assistant-ollama-key-clear"
            >
              {t('settings.assistant.ollama_key_clear')}
            </Button>
          )}
        </div>
      </div>

      <div className="px-4 py-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={testing || !settings.assistantOllamaBaseUrl}
          onClick={() => void handleTestConnection()}
          data-testid="assistant-ollama-test"
        >
          {testing ? t('settings.assistant.ollama_testing') : t('settings.assistant.ollama_test')}
        </Button>
      </div>

      <div className="px-4 py-3 space-y-1">
        <p className="text-xs text-muted-foreground">{t('settings.assistant.ollama_note')}</p>
        <p className="text-xs text-muted-foreground">{t('settings.assistant.ollama_privacy')}</p>
      </div>
    </>
  );
}
