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
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AskPanel } from '../AskPanel';
import { useAssistantStore } from '../../../stores/assistant';

const mockLanguage = { current: 'en' };
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && 'tool' in opts) return `${key}:${opts.tool}`;
      if (opts && 'tools' in opts) return `${key}:${opts.tools}`;
      return key;
    },
    i18n: { get language() { return mockLanguage.current; } },
  }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ getQueryData: () => undefined }),
}));
const mockBackend = { current: 'on-device' };
vi.mock('../../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => ({
    currentProfile: { id: 'p1', timezone: 'UTC' },
    settings: { assistantModelId: 'test-model', get assistantBackend() { return mockBackend.current; } },
  }),
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
// Rendering the real EventThumbnail would need <img> load/error events jsdom
// never fires; a stub keeps this test focused on the card, not the thumbnail
// component (which has its own tests in EventThumbnail.test.tsx).
vi.mock('../../events/EventThumbnail', () => ({
  EventThumbnail: ({ alt }: { alt?: string }) => <div data-testid="assistant-card-thumbnail-stub">{alt}</div>,
}));

describe('AskPanel', () => {
  beforeEach(() => {
    useAssistantStore.setState({ threads: {}, running: false, activities: [] });
  });

  it('renders Ninjii\'s self-introduction when the thread is empty (refs #246)', () => {
    render(<AskPanel />);

    const intro = screen.getByTestId('assistant-intro');
    expect(intro).toBeInTheDocument();
    expect(screen.getByAltText('assistant.title')).toHaveAttribute('src', '/ninjii.png');
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
  describe('on-device language notice', () => {
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

    // Ollama runs whatever model the user configured, so the limitation is not ours to claim.
    it('stays hidden on Ollama regardless of language', () => {
      mockLanguage.current = 'zh';
      mockBackend.current = 'ollama';
      render(<AskPanel />);
      expect(screen.queryByTestId('assistant-english-notice')).not.toBeInTheDocument();
    });
  });
});
