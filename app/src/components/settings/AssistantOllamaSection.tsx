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
import {
  listOpenAiModels,
  probeToolSupport,
  suggestOllamaBaseUrl,
} from '../../lib/assistant/providers/openai';
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
  // Which half of the test is running, shown beneath the model row. The probe
  // stage can take a minute against a model Ollama has not loaded yet, so the
  // user gets to see what is being waited on rather than a frozen button.
  const [testStage, setTestStage] = useState<'connecting' | 'probing' | null>(null);
  const [testSeconds, setTestSeconds] = useState(0);
  // null: never fetched yet (or the last fetch failed). []: fetched, server
  // has no models registered. Both fall back to the manual text input below.
  const [models, setModels] = useState<string[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);

  // Set on every mount, not just at ref creation: StrictMode mounts, unmounts
  // and remounts, and a ref that is only ever cleared by the cleanup stays
  // false for the remounted component's whole life, silently dropping every
  // state update guarded by it.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
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

  useEffect(() => {
    if (!testStage) {
      setTestSeconds(0);
      return;
    }
    const started = Date.now();
    const id = setInterval(() => setTestSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [testStage]);

  // An unset URL is not an error: it resolves to the profile's own ZoneMinder
  // host, since a self-hosted Ollama usually lives on that machine. localhost
  // would be the phone itself on mobile, which never runs Ollama.
  const suggestedBaseUrl = useMemo(
    () => suggestOllamaBaseUrl(currentProfile?.apiUrl) ?? ASSISTANT.defaultOllamaBaseUrl,
    [currentProfile?.apiUrl],
  );
  const effectiveBaseUrl = settings.assistantOllamaBaseUrl || suggestedBaseUrl;

  const handleTestModel = useCallback(async () => {
    setTesting(true);
    setTestStage('connecting');
    // Which half failed decides what the user is told. An unreachable server
    // and a reachable server running a model that cannot call tools are
    // different problems with different fixes, and one generic "test failed"
    // toast pointed at neither.
    let reachable = false;
    try {
      const key = await getEffectiveApiKey();
      const baseUrl = effectiveBaseUrl.replace(/\/+$/, '');
      // A plain reachability probe (GET /models), not a chat turn (refs #246):
      // `testConnectionTimeoutMs` (8s) instead of the 120s `requestTimeoutMs`
      // that a real generation needs, so an unreachable host fails fast
      // instead of leaving the button reading "Testing…" for two minutes.
      await listOpenAiModels(baseUrl, key, ASSISTANT.testConnectionTimeoutMs);
      reachable = true;
      // The stage matters to the user, not just to us: the next step can sit
      // for a minute while Ollama loads the model, and a button stuck on
      // "Testing…" for that long reads as a hang.
      if (mountedRef.current) setTestStage('probing');

      // Reachability is only half the question. A reachable server can still
      // be useless here: gemma2 is rejected outright ("does not support
      // tools") and qwen2.5-coder answers in prose and never calls anything,
      // so the assistant silently never fetches. Neither is guessable from the
      // model's name, and both are one request away from being known.
      const model = settings.assistantOllamaModel;
      const support = model ? await probeToolSupport(baseUrl, model, key) : undefined;

      if (mountedRef.current) {
        if (support === 'timeout') {
          toast({
            title: t('settings.assistant.ollama_model_timeout_title', { model }),
            description: t('settings.assistant.ollama_model_timeout_desc', {
              seconds: Math.round(ASSISTANT.modelProbeTimeoutMs / 1000),
              command: `ollama run ${model}`,
            }),
            variant: 'destructive',
          });
        } else if (support === 'unsupported' || support === 'no-tool-call') {
          toast({
            title: t('settings.assistant.ollama_no_tools_title', { model }),
            description: t('settings.assistant.ollama_no_tools_desc', {
              model: ASSISTANT.recommendedOllamaModel,
            }),
            variant: 'destructive',
          });
        } else {
          toast({
            title: t('settings.assistant.ollama_test_ok'),
            description: support === 'supported' ? t('settings.assistant.ollama_tools_ok', { model }) : undefined,
          });
        }
      }
    } catch (error) {
      log.assistant('Ollama model test failed', LogLevel.WARN, {
        reachable,
        message: error instanceof Error ? error.message : String(error),
      });
      if (mountedRef.current) {
        toast({
          title: reachable
            ? t('settings.assistant.ollama_model_failed')
            : t('settings.assistant.ollama_unreachable'),
          description: resolveQueryError(error, t, { fallbackKey: 'assistant.error_generic' }),
          variant: 'destructive',
        });
      }
    } finally {
      if (mountedRef.current) {
        setTesting(false);
        setTestStage(null);
      }
    }
  }, [getEffectiveApiKey, effectiveBaseUrl, settings.assistantOllamaModel, t, toast]);

  // Fetches the model list from the server for the picker below. A failure
  // here is non-fatal (rule 32 toast, not an error wall): the manual text
  // input keeps working, so this never blocks configuring the backend.
  const loadModels = useCallback(async () => {
    if (!effectiveBaseUrl) return;
    setLoadingModels(true);
    try {
      const key = await getEffectiveApiKey();
      const baseUrl = effectiveBaseUrl.replace(/\/+$/, '');
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
  }, [getEffectiveApiKey, effectiveBaseUrl, t, toast]);

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
  /** Whether the server already serves the recommended model. Ollama reports
   *  ids with a tag (`llama3.2:latest`, `llama3.2:3b`), and any tag of it is
   *  the same recommendation, so this matches the name before the colon. */
  const hasRecommendedModel = useMemo(
    () => (models ?? []).some((m) => m.split(':')[0] === ASSISTANT.recommendedOllamaModel),
    [models],
  );

  const selectableModels = useMemo(() => {
    if (!models) return [];
    const saved = settings.assistantOllamaModel;
    if (saved && !models.includes(saved)) return [...models, saved];
    return models;
  }, [models, settings.assistantOllamaModel]);

  return (
    <>
      <div className="px-4 py-3 space-y-2">
          <RowLabel
            label={t('settings.assistant.ollama_url')}
            desc={t('settings.assistant.ollama_url_hint')}
          />
        {/* Show the ZM-derived suggestion as real editable text, not a grey
            placeholder the user would have to retype from scratch to tweak.
            Empty stored value still resolves the same way at use time
            (effectiveBaseUrl below), so clearing the field re-shows the
            suggestion. */}
        <Input
          value={settings.assistantOllamaBaseUrl || suggestedBaseUrl}
          onChange={(e) => update('assistantOllamaBaseUrl', e.target.value)}
          onBlur={() => void loadModels()}
          placeholder={suggestedBaseUrl}
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
              {/* Beside the model control, not in a section of its own: it
                  tests the chosen model, so it belongs where the model is
                  chosen. */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={testing || !settings.assistantOllamaModel}
                onClick={() => void handleTestModel()}
                data-testid="assistant-ollama-test"
              >
                {testing ? t('settings.assistant.ollama_testing') : t('settings.assistant.ollama_test')}
              </Button>
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
              {/* Beside the model control, not in a section of its own: it
                  tests the chosen model, so it belongs where the model is
                  chosen. */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={testing || !settings.assistantOllamaModel}
                onClick={() => void handleTestModel()}
                data-testid="assistant-ollama-test"
              >
                {testing ? t('settings.assistant.ollama_testing') : t('settings.assistant.ollama_test')}
              </Button>
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
          {testStage && (
            <p
              className="text-xs text-muted-foreground"
              role="status"
              data-testid="assistant-ollama-test-status"
            >
              {testStage === 'connecting'
                ? t('settings.assistant.ollama_test_connecting')
                : t('settings.assistant.ollama_test_probing', {
                    model: settings.assistantOllamaModel,
                  })}{' '}
              {t('settings.assistant.ollama_test_elapsed', { seconds: testSeconds })}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {t('settings.assistant.ollama_model_hint', { model: ASSISTANT.recommendedOllamaModel })}
          </p>
          {/* Only once the server has actually answered: before that `models`
              is null and "not installed" would be a guess, not a fact. */}
          {models !== null && !hasRecommendedModel && (
            <p className="text-xs text-muted-foreground" data-testid="assistant-ollama-recommended-missing">
              {t('settings.assistant.ollama_recommended_missing', {
                command: `ollama pull ${ASSISTANT.recommendedOllamaModel}`,
              })}
            </p>
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

      <div className="px-4 py-3 space-y-1">
        <p className="text-xs text-muted-foreground">{t('settings.assistant.ollama_note')}</p>
        <p className="text-xs text-muted-foreground">{t('settings.assistant.ollama_privacy')}</p>
      </div>
    </>
  );
}
