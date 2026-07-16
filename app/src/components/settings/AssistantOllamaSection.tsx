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
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { PasswordInput } from '../ui/password-input';
import { RowLabel } from './SettingsLayout';
import { ASSISTANT } from '../../lib/zmninja-ng-constants';
import { httpGet } from '../../lib/http';
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

  const handleTestConnection = useCallback(async () => {
    setTesting(true);
    try {
      const key = apiKeyDraft || (currentProfile ? await getSecureValue(apiKeyStorageKey(currentProfile.id)) : null);
      const baseUrl = settings.assistantOllamaBaseUrl.replace(/\/+$/, '');
      await httpGet(`${baseUrl}/models`, {
        headers: key ? { Authorization: `Bearer ${key}` } : undefined,
        timeoutMs: ASSISTANT.requestTimeoutMs,
        intent: 'Assistant Ollama test connection',
      });
      if (mountedRef.current) {
        toast({ title: t('settings.assistant.ollama_test_ok') });
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
  }, [apiKeyDraft, currentProfile, settings.assistantOllamaBaseUrl, t, toast]);

  return (
    <>
      <div className="px-4 py-3 space-y-2">
        <RowLabel label={t('settings.assistant.ollama_url')} />
        <Input
          value={settings.assistantOllamaBaseUrl}
          onChange={(e) => update('assistantOllamaBaseUrl', e.target.value)}
          placeholder={ASSISTANT.defaultOllamaBaseUrl}
          className="w-full sm:w-80"
          data-testid="assistant-ollama-url"
        />
      </div>

      <div className="px-4 py-3 space-y-2">
        <RowLabel label={t('settings.assistant.ollama_model')} />
        <Input
          value={settings.assistantOllamaModel}
          onChange={(e) => update('assistantOllamaModel', e.target.value)}
          placeholder={t('settings.assistant.ollama_model_placeholder')}
          className="w-full sm:w-64"
          data-testid="assistant-ollama-model"
        />
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
