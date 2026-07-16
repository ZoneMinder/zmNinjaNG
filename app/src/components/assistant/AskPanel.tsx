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
 *
 * Test seam: in test mode (`isAssistantTestMode()`), before running a turn
 * this reads `window.__assistantMockScript` (seeded by e2e steps) and loads
 * it into `sharedMockProvider`. This is the only production-visible test
 * seam the assistant adds; `isAssistantTestMode()` is false in production
 * builds, so the branch never runs there.
 */
import { useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Send, Square } from 'lucide-react';
import { getVersion } from '../../api/auth';
import type { MonitorsResponse } from '../../api/types';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';
import { useFreshAccessToken } from '../../hooks/useFreshAccessToken';
import { resolveMinStreamingPort } from '../../lib/monitor/multiport';
import { runAssistantTurn } from '../../lib/assistant/agent';
import {
  getAssistantProvider,
  isAssistantTestMode,
  PROVIDER_NOT_AVAILABLE_MESSAGE,
} from '../../lib/assistant/providers/provider';
import { sharedMockProvider } from '../../lib/assistant/providers/mock';
import { buildSystemPrompt } from '../../lib/assistant/system-prompt';
import { getToolByName } from '../../lib/assistant/tools';
import type { AssistantMessage, AssistantTurn, ToolActivity, ToolContext } from '../../lib/assistant/types';
import { log, LogLevel } from '../../lib/logger';
import { Markdown } from '../../lib/markdown';
import { queryKeys } from '../../lib/query/query-keys';
import { resolveQueryError } from '../../lib/query/query-error';
import { cn } from '../../lib/utils';
import { ASSISTANT } from '../../lib/zmninja-ng-constants';
import { useAssistantStore } from '../../stores/assistant';
import { Button } from '../ui/button';
import { ErrorBanner } from '../ui/query-state';
import { AssistantConfirmCard } from './AssistantConfirmCard';
import { AssistantResultCards } from './AssistantResultCards';
import { useAssistantHost } from './useAssistantHost';

declare global {
  interface Window {
    /** e2e-only: a script for `sharedMockProvider`, read once per turn when
     *  `isAssistantTestMode()` is true. Never set outside tests/steps. */
    __assistantMockScript?: AssistantTurn[];
  }
}

/** The agent loop never renders text itself; it only ever emits this prefix
 *  (see agent.ts's ITERATION_CAP_KEY) to hand the localization job to us. */
const I18N_SENTINEL = '__i18n:';

/** Matches `providers/webllm.ts`'s `PARSE_ERROR_TEXT` sentinel key (with the
 *  `__i18n:` prefix already stripped): only this turn ever carries `raw`. */
const PARSE_ERROR_KEY = 'assistant.parse_error';

// Stable reference for the "no thread yet" case. Without it, the `thread`
// selector below would return a fresh `[]` literal every render whenever
// `threads[profileId]` is undefined (i.e. before the first message), which
// makes useSyncExternalStore see a new snapshot on every call and crashes
// the app with "Maximum update depth exceeded" the moment AskPanel mounts.
const EMPTY_THREAD: AssistantMessage[] = [];

/** Renders one assistant turn's text, resolving the `__i18n:` sentinel. When
 *  the turn is the parse-error fallback and carried the model's raw output
 *  (see providers/webllm.ts's `parseWebLlmTurn` and agent.ts's `raw` copy),
 *  a collapsed `<details>` offers it so the user (or the person debugging
 *  their report) can see why the turn failed instead of just the apology. */
function renderAssistantText(msg: AssistantMessage, t: TFunction) {
  const { text, raw } = msg;
  if (!text) return null;
  if (text.startsWith(I18N_SENTINEL)) {
    const key = text.slice(I18N_SENTINEL.length);
    return (
      <>
        <p className="text-sm">{t(key)}</p>
        {key === PARSE_ERROR_KEY && raw && (
          <details className="mt-1 text-xs text-muted-foreground" data-testid="assistant-raw-output">
            <summary className="cursor-pointer select-none">{t('assistant.show_raw_output')}</summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-background/50 p-2">
              {raw}
            </pre>
          </details>
        )}
      </>
    );
  }
  return <Markdown source={text} />;
}

/** Compact, truncated (rule 11) JSON preview of a tool call's input for the
 *  activity step list, e.g. `{"interval":"24 hour"}`. `undefined` for a tool
 *  called with no input, so the step shows just the tool name. */
function formatActivityInput(input: Record<string, unknown>): string | undefined {
  if (!input || Object.keys(input).length === 0) return undefined;
  const json = JSON.stringify(input);
  return json.length > ASSISTANT.activityInputPreviewChars
    ? `${json.slice(0, ASSISTANT.activityInputPreviewChars)}…`
    : json;
}

/** Renders one turn's tool-activity step trace ("Running count_events… /
 *  count_events done"). Shared by two call sites: a completed message's
 *  attached `steps` (rendered above that message's answer, refs #246) and the
 *  live `activities` array for the turn still in flight (rendered above the
 *  "thinking" indicator, where its answer will land once the turn resolves). */
function ActivitySteps({ steps }: { steps: ToolActivity[] }) {
  const { t } = useTranslation();
  return (
    <ol className="flex flex-col gap-1" data-testid="assistant-activities">
      {steps.map((a, i) => {
        const compactInput = formatActivityInput(a.input);
        const statusText =
          a.status === 'running'
            ? t('assistant.activity.running', { tool: a.toolName })
            : a.status === 'done'
              ? t('assistant.activity.done', { tool: a.toolName })
              : t('assistant.activity.error', { tool: a.toolName });
        return (
          <li
            key={`${a.toolName}-${i}`}
            data-testid="assistant-activity-step"
            title={`${getToolByName(a.toolName)?.description ?? a.toolName}${a.input && Object.keys(a.input).length > 0 ? ` ${JSON.stringify(a.input)}` : ''}`}
            className={cn(
              'flex min-w-0 items-center gap-1.5 truncate rounded border px-2 py-1 text-xs',
              a.status === 'error' ? 'border-destructive/40 text-destructive' : 'border-border text-muted-foreground',
            )}
          >
            <span className="truncate">{statusText}</span>
            {compactInput && <span className="truncate opacity-70">{compactInput}</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function AskPanel() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { currentProfile, settings } = useCurrentProfile();
  const profileId = currentProfile?.id;
  const { token: accessToken, isFresh: accessTokenFresh } = useFreshAccessToken();

  const { host, pendingConfirm, resolveConfirm } = useAssistantHost();

  const thread = useAssistantStore((s) => (profileId ? (s.threads[profileId] ?? EMPTY_THREAD) : EMPTY_THREAD));
  const running = useAssistantStore((s) => s.running);
  const activities = useAssistantStore((s) => s.activities);
  const append = useAssistantStore((s) => s.append);
  const setRunning = useAssistantStore((s) => s.setRunning);
  const clearActivities = useAssistantStore((s) => s.clearActivities);

  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the message input on mount so a keyboard user who just entered Ask
  // mode (e.g. via the `?` key) can start typing immediately (refs #246). The
  // palette no longer renders its own search input in ask mode, so this is
  // the only input on screen; a plain `ref` + effect is used instead of the
  // `autoFocus` JSX attribute, which jsx-a11y/no-autofocus (rule 35) blocks.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
      const provider = getAssistantProvider(settings.assistantModelId);

      if (isAssistantTestMode() && window.__assistantMockScript) {
        sharedMockProvider.setScript(window.__assistantMockScript);
      }

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

      // Image-building inputs for event result cards (refs #246), mirroring
      // MonitorRecentEvents.tsx's buildRow: only actually used when a tool
      // returns event rows (list_events/get_event via lib/assistant/display.ts).
      const ctx: ToolContext = {
        profileId,
        queryClient,
        host,
        portalUrl: currentProfile?.portalUrl,
        accessToken: accessTokenFresh ? accessToken : null,
        minStreamingPort: resolveMinStreamingPort(currentProfile?.minStreamingPort, settings.forceDisableMultiPort),
        thumbnailFallbackChain: settings.thumbnailFallbackChain,
        dateTimeFormat: {
          dateFormat: settings.dateFormat,
          timeFormat: settings.timeFormat,
          customDateFormat: settings.customDateFormat,
          customTimeFormat: settings.customTimeFormat,
        },
      };
      const history = useAssistantStore.getState().getThread(profileId);
      const result = await runAssistantTurn({ provider, host, ctx, history, system, signal: controller.signal });

      // Only the turn's new messages: `history` above is the full, untruncated
      // thread already in the store, so re-appending the whole returned array
      // would duplicate everything runAssistantTurn didn't drop.
      const newMessages = result.slice(history.length);

      // Attach this turn's tool-activity steps to the assistant message
      // carrying the final answer (the last `role: 'assistant'` message: every
      // earlier one in a multi-iteration turn only carries `toolCalls`), so
      // the step trace renders above that answer and survives in history
      // (refs #246). `useAssistantStore`'s `activities` accumulated across the
      // whole turn (every iteration's `host.onActivity` call), not just the
      // last one, since `clearActivities` below only runs once the turn ends.
      const turnActivities = useAssistantStore.getState().activities;
      if (turnActivities.length > 0) {
        for (let i = newMessages.length - 1; i >= 0; i--) {
          if (newMessages[i].role === 'assistant') {
            newMessages[i] = { ...newMessages[i], steps: turnActivities };
            break;
          }
        }
      }

      newMessages.forEach((m) => append(profileId, m));
      // Clear the live activity trace now that it has been captured onto the
      // message above: without this, it would still render below the thread
      // (see the `activities.length > 0` block below) duplicating the steps
      // now attached to the message that just landed.
      clearActivities();
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
          if (msg.role === 'tool') {
            if (!msg.display || msg.display.length === 0) return null;
            return <AssistantResultCards key={i} entities={msg.display} host={host} />;
          }
          return (
            <div key={i} className="space-y-1">
              {/* This turn's tool steps, above its answer (refs #246): user
                  question -> "Running count_events…" / "count_events done" ->
                  answer, in that order both live and in history. */}
              {msg.role === 'assistant' && msg.steps && msg.steps.length > 0 && <ActivitySteps steps={msg.steps} />}
              <div
                data-testid={`assistant-message-${msg.role}`}
                className={cn(
                  'max-w-[85%] rounded-lg px-3 py-2 text-sm',
                  msg.role === 'user' ? 'ml-auto bg-primary text-primary-foreground' : 'bg-muted',
                )}
              >
                {msg.role === 'user' ? <p>{msg.text}</p> : renderAssistantText(msg, t)}
              </div>
            </div>
          );
        })}

        {/* Step trace for the turn still in flight: one row per
            `host.onActivity` call from agent.ts, so a multi-step answer
            ("which monitor was most active") shows what it's doing before the
            answer exists yet. Rendered above the "thinking" indicator, i.e.
            where the answer will land once the turn resolves; `handleSend`
            then moves this same list onto that answer's message (`steps`,
            above) and clears it, so it never lingers here to duplicate what
            now renders inside the thread. */}
        {activities.length > 0 && <ActivitySteps steps={activities} />}

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
          ref={inputRef}
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
