/**
 * AskPanel: the in-app assistant conversation UI (refs #246).
 *
 * Renders the per-profile thread from `stores/assistant.ts`, drives one
 * `runAssistantTurn` per send, and shows the `AssistantConfirmCard` whenever
 * `useAssistantHost`'s `confirm()` is pending. Two forward contracts from the
 * agent loop (lib/assistant/agent.ts) land here:
 *
 * - A leading `__i18n:<key>` on an assistant message's `text` is a sentinel
 *   (currently only the iteration-cap message) that must be localized with
 *   `t(key)` instead of rendered as literal/markdown text.
 * - Aborting (or unmounting mid-turn) must resolve any pending confirm as
 *   `false` and abort the in-flight `AbortController`, so the loop's
 *   `signal.aborted` checks unwind it instead of leaving it hung.
 */
import { useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Send, Square } from 'lucide-react';
import { getVersion } from '../../api/auth';
import type { MonitorsResponse } from '../../api/types';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';
import { runAssistantTurn } from '../../lib/assistant/agent';
import { getAssistantProvider } from '../../lib/assistant/providers/provider';
import { buildSystemPrompt } from '../../lib/assistant/system-prompt';
import { getToolByName } from '../../lib/assistant/tools';
import type { ToolContext } from '../../lib/assistant/types';
import { log, LogLevel } from '../../lib/logger';
import { Markdown } from '../../lib/markdown';
import { queryKeys } from '../../lib/query/query-keys';
import { resolveQueryError } from '../../lib/query/query-error';
import { cn } from '../../lib/utils';
import { useAssistantStore } from '../../stores/assistant';
import { Button } from '../ui/button';
import { ErrorBanner } from '../ui/query-state';
import { AssistantConfirmCard } from './AssistantConfirmCard';
import { useAssistantHost } from './useAssistantHost';

/** The agent loop never renders text itself; it only ever emits this prefix
 *  (see agent.ts's ITERATION_CAP_KEY) to hand the localization job to us. */
const I18N_SENTINEL = '__i18n:';

/** Thrown verbatim by providers/provider.ts's real (non-test-mode) path. */
const PROVIDER_NOT_AVAILABLE_MESSAGE = 'On-device model backend is not available yet.';

function renderAssistantText(text: string | undefined, t: TFunction) {
  if (!text) return null;
  if (text.startsWith(I18N_SENTINEL)) {
    return <p className="text-sm">{t(text.slice(I18N_SENTINEL.length))}</p>;
  }
  return <Markdown source={text} />;
}

export function AskPanel() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { currentProfile } = useCurrentProfile();
  const profileId = currentProfile?.id;

  const { host, pendingConfirm, resolveConfirm } = useAssistantHost();

  const thread = useAssistantStore((s) => (profileId ? (s.threads[profileId] ?? []) : []));
  const running = useAssistantStore((s) => s.running);
  const activities = useAssistantStore((s) => s.activities);
  const append = useAssistantStore((s) => s.append);
  const setRunning = useAssistantStore((s) => s.setRunning);
  const clearActivities = useAssistantStore((s) => s.clearActivities);

  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Abort any in-flight turn and decline any pending confirm on unmount, so a
  // closed panel never leaves the agent loop (or a stuck confirm Promise) alive.
  useEffect(() => {
    return () => {
      resolveConfirm(false);
      abortControllerRef.current?.abort();
    };
  }, [resolveConfirm]);

  const handleAbort = () => {
    resolveConfirm(false);
    abortControllerRef.current?.abort();
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !profileId || running) return;

    setInput('');
    setError(null);
    setNotConfigured(false);
    append(profileId, { role: 'user', text });
    setRunning(true);
    clearActivities();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const provider = getAssistantProvider();

      let zmVersion = '';
      try {
        zmVersion = (await getVersion()).version;
      } catch (e) {
        log.assistant('Failed to fetch ZM version for the assistant system prompt', LogLevel.WARN, { error: e });
      }

      const monitorsData = queryClient.getQueryData<MonitorsResponse>(queryKeys.monitors(profileId));
      const monitors = (monitorsData?.monitors ?? []).map((m) => ({
        id: m.Monitor.Id,
        name: m.Monitor.Name,
        func: m.Monitor.Function,
        enabled: m.Monitor.Enabled === '1',
      }));

      const system = buildSystemPrompt({
        now: new Date(),
        timezone: currentProfile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        locale: i18n.language,
        zmVersion,
        monitors,
      });

      const ctx: ToolContext = { profileId, queryClient, host };
      const history = useAssistantStore.getState().getThread(profileId);
      const result = await runAssistantTurn({ provider, host, ctx, history, system, signal: controller.signal });

      // Only the turn's new messages: `history` above is the full, untruncated
      // thread already in the store, so re-appending the whole returned array
      // would duplicate everything runAssistantTurn didn't drop.
      const newMessages = result.slice(history.length);
      newMessages.forEach((m) => append(profileId, m));
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        // User-initiated abort: not an error to surface.
      } else if (e instanceof Error && e.message === PROVIDER_NOT_AVAILABLE_MESSAGE) {
        setNotConfigured(true);
      } else {
        log.assistant('Assistant turn failed', LogLevel.ERROR, { error: e });
        setError(resolveQueryError(e, t, { fallbackKey: 'assistant.error_generic' }));
      }
    } finally {
      setRunning(false);
      abortControllerRef.current = null;
    }
  };

  return (
    <div className="flex h-full flex-col" data-testid="ask-panel">
      <div className="border-b px-3 py-2 text-sm font-medium">{t('assistant.title')}</div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {thread.map((msg, i) => {
          if (msg.role === 'tool') return null;
          return (
            <div
              key={i}
              data-testid={`assistant-message-${msg.role}`}
              className={cn(
                'max-w-[85%] rounded-lg px-3 py-2 text-sm',
                msg.role === 'user' ? 'ml-auto bg-primary text-primary-foreground' : 'bg-muted',
              )}
            >
              {msg.role === 'user' ? <p>{msg.text}</p> : renderAssistantText(msg.text, t)}
            </div>
          );
        })}

        {activities.length > 0 && (
          <div className="flex flex-wrap gap-1.5" data-testid="assistant-activities">
            {activities.map((a, i) => (
              <span
                key={`${a.toolName}-${i}`}
                title={getToolByName(a.toolName)?.description}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-xs',
                  a.status === 'error' ? 'border-destructive/40 text-destructive' : 'border-border text-muted-foreground',
                )}
              >
                {a.status === 'running' && t('assistant.activity.running', { tool: a.toolName })}
                {a.status === 'done' && t('assistant.activity.done', { tool: a.toolName })}
                {a.status === 'error' && t('assistant.activity.error', { tool: a.toolName })}
              </span>
            ))}
          </div>
        )}

        {running && !pendingConfirm && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('assistant.thinking')}
          </p>
        )}

        {notConfigured && <ErrorBanner message={t('assistant.not_configured_cta')} />}
        {error && !notConfigured && <ErrorBanner message={error} />}

        {pendingConfirm && (
          <AssistantConfirmCard
            request={pendingConfirm}
            onAccept={() => resolveConfirm(true)}
            onCancel={() => resolveConfirm(false)}
          />
        )}
      </div>

      <div className="flex items-center gap-2 border-t p-2">
        <input
          data-testid="assistant-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder={t('assistant.placeholder')}
          disabled={running || !profileId}
          className="flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
        {running ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleAbort}
            aria-label={t('assistant.abort')}
            data-testid="assistant-abort"
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            onClick={() => void handleSend()}
            disabled={!input.trim() || !profileId}
            aria-label={t('assistant.send')}
            data-testid="assistant-send"
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
