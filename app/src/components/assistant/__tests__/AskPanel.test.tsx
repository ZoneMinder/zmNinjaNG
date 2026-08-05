/**
 * AskPanel component tests (refs #246).
 *
 * Only exercises the static-render paths (message list, raw-output details,
 * activity step list): `handleSend` and its provider/host wiring are already
 * covered by lib/assistant/agent.test.ts and providers/__tests__/webllm.test.ts,
 * and mocking that entire chain here would just duplicate it. Heavy
 * dependencies (react-router-dom, react-query, tools.ts's api/* imports) are
 * mocked following the pattern in components/__tests__/CommandPalette.test.tsx
 * to avoid transitively loading stores/profile via log-sanitizer -> client.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AskPanel } from '../AskPanel';
import { useAssistantStore } from '../../../stores/assistant';
import { NINJII_LOGO_URL } from '../../../lib/assistant/ninjii-logo';

const mockLanguage = { current: 'en' };
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && 'tool' in opts) return `${key}:${opts.tool}`;
      if (opts && 'tools' in opts) return `${key}:${opts.tools}`;
      if (opts && 'chunk' in opts) return `${key}:${opts.chunk}/${opts.chunks}:${opts.percent}`;
      if (opts && 'target' in opts) return `${key}:${opts.target}`;
      return key;
    },
    i18n: { get language() { return mockLanguage.current; } },
  }),
}));
// The system-model note points at a different backend per platform, so the
// platform has to be steerable here.
const mockIsIOS = { current: false };
vi.mock('../../../lib/platform', () => ({
  Platform: {
    get isIOS() {
      return mockIsIOS.current;
    },
    get isNative() {
      return mockIsIOS.current;
    },
    get isAndroid() {
      return !mockIsIOS.current;
    },
  },
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ getQueryData: () => undefined }),
}));
const mockBackend = { current: 'on-device' };
const mockOllamaModel = { current: '' };
vi.mock('../../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => ({
    currentProfile: { id: 'p1', timezone: 'UTC' },
    settings: {
      assistantModelId: 'test-model',
      get assistantBackend() { return mockBackend.current; },
      get assistantOllamaModel() { return mockOllamaModel.current; },
      assistantOllamaBaseUrl: 'http://zm:11434/v1',
      // Event result cards read this surface toggle (refs #270); previews off
      // keeps these tests about the cards themselves.
      hoverPreview: { assistant: false },
    },
  }),
  // Only read in All mode (refs #337); single mode's isAllMode is false so
  // this is never actually consulted, but it's called unconditionally.
  useProfileById: () => ({ profile: null, settings: {} }),
}));
// null: useProfileScope's real return for single mode (see its own doc
// comment) - AskPanel's isAllMode check must see it that way, not the real
// hook, which would otherwise pull in stores/profile.ts's whole dependency
// chain into this unit test (refs #337, same rationale as the mocks above).
vi.mock('../../../hooks/useProfileScope', () => ({
  useProfileScope: () => null,
}));
// The warmup effect (refs #261) resolves the stored API key and fires
// warmOllamaModel on mount for the Ollama backend; both are stubbed so the
// test controls when the warmup settles and no request leaves jsdom.
vi.mock('../../../lib/security/secureStorage', () => ({ getSecureValue: vi.fn().mockResolvedValue(null) }));
const warmResolvers: Array<(v: boolean) => void> = [];
vi.mock('../../../lib/assistant/providers/openai', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  warmOllamaModel: vi.fn(() => new Promise<boolean>((resolve) => warmResolvers.push(resolve))),
}));
vi.mock('../../../hooks/useFreshAccessToken', () => ({
  useFreshAccessToken: () => ({ token: null, isFresh: false }),
}));
const navigateMock = vi.fn();
vi.mock('../useAssistantHost', () => ({
  useAssistantHost: () => ({ host: { navigate: navigateMock, onActivity: vi.fn() } }),
}));
vi.mock('../../../lib/assistant/tools', () => ({
  getToolByName: (name: string) => ({ name, description: `${name} description` }),
}));
vi.mock('../../../api/auth', () => ({ getVersion: vi.fn() }));
// Monitor result cards resolve their live preview through the shared monitors
// query; neither the query nor a real stream belongs in this test (refs #264).
vi.mock('../../../hooks/useMonitors', () => ({ useMonitors: () => ({ monitors: [] }) }));
vi.mock('../../monitors/LiveMonitorPlayer', () => ({
  LiveMonitorPlayer: () => <div data-testid="assistant-live-player-stub" />,
}));
// Rendering the real EventThumbnail would need <img> load/error events jsdom
// never fires; a stub keeps this test focused on the card, not the thumbnail
// component (which has its own tests in EventThumbnail.test.tsx).
vi.mock('../../events/EventThumbnail', () => ({
  EventThumbnail: ({ alt }: { alt?: string }) => <div data-testid="assistant-card-thumbnail-stub">{alt}</div>,
}));

describe('AskPanel', () => {
  beforeEach(() => {
    useAssistantStore.setState({ threads: {}, running: false, activities: [] });
    mockBackend.current = 'on-device';
    mockOllamaModel.current = '';
    warmResolvers.length = 0;
  });

  // Single mode: no pinned-profile banner or picker at all (refs #337).
  it('renders no pinned-profile banner or picker in single mode', () => {
    render(<AskPanel />);

    expect(screen.queryByTestId('assistant-pinned-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('page-profile-picker')).not.toBeInTheDocument();
  });

  it('renders Ninjii\'s self-introduction when the thread is empty (refs #246)', () => {
    render(<AskPanel />);

    const intro = screen.getByTestId('assistant-intro');
    expect(intro).toBeInTheDocument();
    expect(screen.getByAltText('assistant.title')).toHaveAttribute('src', NINJII_LOGO_URL);
    expect(intro).toHaveTextContent('assistant.intro_greeting');
    expect(intro).toHaveTextContent('assistant.intro_help');
    expect(screen.getAllByTestId('assistant-example-prompt')).toHaveLength(4);
  });

  it('fills the input (does not send) when an example prompt chip is clicked', async () => {
    render(<AskPanel />);

    const user = userEvent.setup();
    await user.click(screen.getAllByTestId('assistant-example-prompt')[0]);

    const input = screen.getByTestId('assistant-input') as HTMLInputElement;
    expect(input.value).toBe('assistant.intro_example_1');
    // No turn was sent: the thread is still empty and the intro still shows.
    expect(screen.getByTestId('assistant-intro')).toBeInTheDocument();
  });

  // The warmup starts when the panel opens with the Ollama backend, and the
  // chat says so while it runs (refs #261): without the line, a cold server's
  // ~36s load looked like a hang or hid behind a misleading "Thinking".
  it('shows the model-loading line while the Ollama warmup runs, then hides it', async () => {
    mockBackend.current = 'ollama';
    mockOllamaModel.current = 'qwen3:8b';

    render(<AskPanel />);

    expect(await screen.findByTestId('assistant-model-loading')).toHaveTextContent('assistant.loading_model');
    warmResolvers.pop()?.(true);
    await waitFor(() => expect(screen.queryByTestId('assistant-model-loading')).not.toBeInTheDocument());
  });

  it('starts no warmup on the on-device backend', () => {
    render(<AskPanel />);
    expect(screen.queryByTestId('assistant-model-loading')).not.toBeInTheDocument();
    expect(warmResolvers).toHaveLength(0);
  });

  it('does not render the self-introduction once the thread has messages', () => {
    useAssistantStore.getState().append('p1', { role: 'user', text: 'is the front door armed?' });

    render(<AskPanel />);

    expect(screen.queryByTestId('assistant-intro')).not.toBeInTheDocument();
  });

  it('offers a collapsible raw-output section for a parse-error turn that carried raw text', () => {
    useAssistantStore.getState().append('p1', { role: 'user', text: 'which monitor was most active?' });
    useAssistantStore.getState().append('p1', {
      role: 'assistant',
      text: '__i18n:assistant.parse_error',
      toolCalls: [],
      raw: '<think>still reasoning</think>',
    });

    render(<AskPanel />);

    const details = screen.getByTestId('assistant-raw-output');
    expect(details).toBeInTheDocument();
    expect(details).toHaveTextContent('<think>still reasoning</think>');
  });

  it('does not render the raw-output section when the parse-error turn has no raw text', () => {
    useAssistantStore.getState().append('p1', {
      role: 'assistant',
      text: '__i18n:assistant.parse_error',
      toolCalls: [],
    });

    render(<AskPanel />);

    expect(screen.queryByTestId('assistant-raw-output')).not.toBeInTheDocument();
  });

  it('does not render the raw-output section for a normal answer, even if raw were somehow set', () => {
    useAssistantStore.getState().append('p1', {
      role: 'assistant',
      text: 'The front door camera is armed.',
      toolCalls: [],
      raw: 'irrelevant',
    });

    render(<AskPanel />);

    expect(screen.queryByTestId('assistant-raw-output')).not.toBeInTheDocument();
  });

  // One line that each step replaces, not a row per step: a turn can make
  // several round trips, and stacking them pushed the answer off screen.
  it('shows only the latest activity, replacing the previous one', () => {
    useAssistantStore.setState({
      activities: [
        { toolName: 'count_events', status: 'running', input: { interval: '24 hour' } },
        { toolName: 'count_events', status: 'done', input: { interval: '24 hour' } },
      ],
    });

    render(<AskPanel />);

    const steps = screen.getAllByTestId('assistant-activity-step');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toHaveTextContent('assistant.activity.done:count_events');
  });

  // The model's own turns were invisible in the app while the logs were full
  // of them; the panel could only say "Thinking". They get their own line
  // because sharing one with the tool step meant the tool call overwrote the
  // reasoning that chose it, milliseconds later.
  it('shows the model\'s reasoning alongside the tool step, on its own line', () => {
    useAssistantStore.setState({
      activities: [
        { toolName: 'count_events', status: 'done', input: {} },
        { kind: 'model', detail: 'Counts alone cannot answer this,\nI need list_events.', toolName: 'list_events', status: 'running', input: {} },
      ],
    });

    render(<AskPanel />);

    const steps = screen.getAllByTestId('assistant-activity-step');
    expect(steps).toHaveLength(2);
    // Newlines flattened so a long chain of thought cannot reflow the panel.
    expect(steps[0]).toHaveTextContent('Counts alone cannot answer this, I need list_events.');
    // The tool step survives on its own line rather than replacing the thought.
    expect(steps[1]).toHaveTextContent('assistant.activity.done:count_events');
  });

  it('omits the compact input for a tool called with no input', () => {
    useAssistantStore.setState({
      activities: [{ toolName: 'list_monitors', status: 'done', input: {} }],
    });

    render(<AskPanel />);

    const step = screen.getByTestId('assistant-activity-step');
    expect(step).toHaveTextContent('assistant.activity.done:list_monitors');
    expect(step).not.toHaveTextContent('{}');
  });

  it('renders an event result card with a thumbnail and navigates on Open (refs #246)', async () => {
    useAssistantStore.getState().append('p1', { role: 'user', text: 'find front door events' });
    useAssistantStore.getState().append('p1', {
      role: 'assistant',
      text: 'Here is what I found at Front Door.',
      toolCalls: [],
      display: [
        {
          kind: 'event',
          id: '42',
          title: 'Front Door · Jan 1, 2026',
          subtitle: 'person, car',
          navigatePath: '/events/42',
          imageUrls: ['https://zm.example.com/index.php?view=image&eid=42&fid=alarm'],
          cacheKey: '42',
        },
      ],
    });

    render(<AskPanel />);

    expect(screen.getByTestId('assistant-card-thumbnail-stub')).toBeInTheDocument();
    const card = screen.getByTestId('assistant-card-event');
    expect(card).toHaveTextContent('Front Door · Jan 1, 2026');
    expect(card).toHaveTextContent('person, car');

    const user = userEvent.setup();
    await user.click(screen.getByTestId('assistant-card-open'));
    expect(navigateMock).toHaveBeenCalledWith('/events/42');
  });

  it('renders a monitor result card with no thumbnail', () => {
    useAssistantStore.getState().append('p1', {
      role: 'assistant',
      text: 'Front Door is enabled.',
      toolCalls: [],
      display: [
        { kind: 'monitor', id: '1', title: 'Front Door', subtitle: 'Modect · Connected', navigatePath: '/monitors/1' },
      ],
    });

    render(<AskPanel />);

    expect(screen.queryByTestId('assistant-card-thumbnail-stub')).not.toBeInTheDocument();
    expect(screen.getByTestId('assistant-card-monitor')).toHaveTextContent('Front Door');
  });

  it('renders a message\'s cards below its answer text, not above it (refs #246)', () => {
    useAssistantStore.getState().append('p1', { role: 'user', text: 'how many people came today?' });
    useAssistantStore.getState().append('p1', {
      role: 'assistant',
      text: 'Three people were detected today.',
      toolCalls: [],
      steps: [{ toolName: 'list_events', status: 'done', input: { range: 'today', objectType: 'person' } }],
      display: [
        { kind: 'event', id: '42', title: 'Front Door · today', navigatePath: '/events/42' },
      ],
    });

    render(<AskPanel />);

    const step = screen.getByTestId('assistant-activity-step');
    const answer = screen.getByTestId('assistant-message-assistant');
    const card = screen.getByTestId('assistant-card-event');
    // Net DOM order: steps -> answer text -> cards.
    expect(step.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(answer.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders a turn\'s step trace above its answer, in chronological order (refs #246)', () => {
    useAssistantStore.getState().append('p1', { role: 'user', text: 'which monitor was busiest?' });
    useAssistantStore.getState().append('p1', {
      role: 'assistant',
      text: 'The front door camera was busiest.',
      toolCalls: [],
      steps: [{ toolName: 'count_events', status: 'done', input: { interval: '24 hour' } }],
    });

    render(<AskPanel />);

    const step = screen.getByTestId('assistant-activity-step');
    const answer = screen.getByTestId('assistant-message-assistant');
    // Finished turns name the tools used rather than the last step alone.
    expect(step).toHaveTextContent('assistant.activity.used:count_events');
    // DOCUMENT_POSITION_FOLLOWING: `answer` comes after `step` in DOM order,
    // i.e. the step chip renders above the answer, not below it.
    expect(step.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('does not render a result-card strip for a tool message (cards never attach there)', () => {
    useAssistantStore.getState().append('p1', {
      role: 'tool',
      toolResults: [{ callId: 'c1', output: '{}' }],
    });

    render(<AskPanel />);

    expect(screen.queryByTestId('assistant-result-cards')).not.toBeInTheDocument();
  });

  it('does not render a result-card strip for an assistant message with no display', () => {
    useAssistantStore.getState().append('p1', {
      role: 'assistant', text: 'All good.', toolCalls: [],
    });

    render(<AskPanel />);

    expect(screen.queryByTestId('assistant-result-cards')).not.toBeInTheDocument();
  });

  // The on-device model is small and English-first; the app says so rather
  // than letting a non-English user discover it through worse answers.
  describe('language notice', () => {
    it('warns when the app language is not English and the model runs on-device', () => {
      mockLanguage.current = 'de';
      mockBackend.current = 'on-device';
      render(<AskPanel />);
      expect(screen.getByTestId('assistant-english-notice')).toBeInTheDocument();
    });

    it('stays hidden in English', () => {
      mockLanguage.current = 'en-GB';
      mockBackend.current = 'on-device';
      render(<AskPanel />);
      expect(screen.queryByTestId('assistant-english-notice')).not.toBeInTheDocument();
    });

    // Shown on Ollama too. This used to be treated as an on-device model
    // quality issue, which is the smaller half of it: requiredReadTool matches
    // English words to decide when live data is mandatory, the triage prompt is
    // English, and resolveWhen parses English time phrases. Those guards fail
    // silently in another language whatever model is answering.
    it('warns on Ollama too, since the English-only machinery is not the model', () => {
      mockLanguage.current = 'zh';
      mockBackend.current = 'ollama';
      render(<AskPanel />);
      expect(screen.getByTestId('assistant-english-notice')).toBeInTheDocument();
    });

    it('stays hidden in English on Ollama', () => {
      mockLanguage.current = 'en';
      mockBackend.current = 'ollama';
      render(<AskPanel />);
      expect(screen.queryByTestId('assistant-english-notice')).not.toBeInTheDocument();
    });
  });

  // A system/OS-hosted backend (Apple Intelligence today) is the least
  // accurate option; the panel persistently nudges toward the llama.cpp
  // on-device backend, naming the active backend via assistantBackendLabel.
  describe('system-model note', () => {
    it('shows the note when the active backend is a system model (apple)', () => {
      mockBackend.current = 'apple';
      render(<AskPanel />);
      expect(screen.getByTestId('assistant-system-model-note')).toHaveTextContent('assistant.system_model_note');
    });

    // The note used to hardcode llama.cpp. Android's build no longer has it
    // (issue #270), so sending an Android user there is advice they cannot take.
    it('points an Android system-model user at Ollama, never llama.cpp', () => {
      mockIsIOS.current = false;
      mockBackend.current = 'gemini-nano';
      render(<AskPanel />);
      expect(screen.getByTestId('assistant-system-model-note')).toHaveTextContent(
        'assistant.system_model_note:settings.assistant.backend_ollama',
      );
    });

    it('still points an iOS system-model user at the on-device llama.cpp backend', () => {
      mockIsIOS.current = true;
      mockBackend.current = 'apple';
      render(<AskPanel />);
      expect(screen.getByTestId('assistant-system-model-note')).toHaveTextContent(
        'assistant.system_model_note:settings.assistant.backend_download_model',
      );
    });

    it('stays hidden on the Ollama backend', () => {
      mockBackend.current = 'ollama';
      render(<AskPanel />);
      expect(screen.queryByTestId('assistant-system-model-note')).not.toBeInTheDocument();
    });

    it('stays hidden on the on-device (llama.cpp/WebGPU) backend', () => {
      mockBackend.current = 'on-device';
      render(<AskPanel />);
      expect(screen.queryByTestId('assistant-system-model-note')).not.toBeInTheDocument();
    });
  });

  describe('slow-phase status line', () => {
    it('shows the model-load status while the load phase runs', () => {
      useAssistantStore.setState({ running: true, phase: { phase: 'loading_model', progress: 0.43 } });
      render(<AskPanel />);
      expect(screen.getByTestId('assistant-status')).toHaveTextContent('assistant.status.loading_model');
    });

    it('hides the prefill note under the token threshold, falling back to Thinking', () => {
      useAssistantStore.setState({ running: true, phase: { phase: 'prefill', progress: 0.5, tokens: 100 } });
      render(<AskPanel />);
      expect(screen.getByTestId('assistant-status')).toHaveTextContent('assistant.thinking');
    });

    it('triage prefill (slot 1) reads "understanding", with batch progress', () => {
      useAssistantStore.setState({ running: true, phase: { phase: 'prefill', progress: 0.55, tokens: 1000, chunk: 3, chunks: 6, slot: 1 } });
      render(<AskPanel />);
      // mock t echoes key:chunk/chunks:percent
      expect(screen.getByTestId('assistant-status')).toHaveTextContent('assistant.status.understanding:3/6:55');
    });

    it('first-turn chat prefill (slot 0, no prior assistant reply) reads "preparing"', () => {
      useAssistantStore.setState({ threads: { p1: [{ role: 'user', text: 'hello' }] }, running: true, phase: { phase: 'prefill', progress: 0.5, tokens: 1000, chunk: 1, chunks: 2, slot: 0 } });
      render(<AskPanel />);
      expect(screen.getByTestId('assistant-status')).toHaveTextContent('assistant.status.preparing:1/2:50');
    });

    it('chat prefill with history (slot 0, prior assistant reply) reads "reading conversation"', () => {
      useAssistantStore.setState({ threads: { p1: [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'a' }] }, running: true, phase: { phase: 'prefill', progress: 0.5, tokens: 1000, chunk: 2, chunks: 4, slot: 0 } });
      render(<AskPanel />);
      expect(screen.getByTestId('assistant-status')).toHaveTextContent('assistant.status.prefill:2/4:50');
    });

    it('clears the prefill note at 100% (decode window), keeping the running indicator', () => {
      useAssistantStore.setState({ running: true, phase: { phase: 'prefill', progress: 1, tokens: 1000 } });
      render(<AskPanel />);
      const status = screen.getByTestId('assistant-status'); // running indicator still present
      expect(status).toHaveTextContent('assistant.thinking');
      expect(status).not.toHaveTextContent('assistant.status.prefill');
    });

    it('shows the server-slow note and clears its interval on unmount (no timer leak)', () => {
      const clearSpy = vi.spyOn(global, 'clearInterval');
      useAssistantStore.setState({ running: true, phase: { phase: 'server_slow' } });
      const { unmount } = render(<AskPanel />);
      expect(screen.getByTestId('assistant-status')).toHaveTextContent('assistant.status.server_slow');
      unmount();
      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });
  });
});
