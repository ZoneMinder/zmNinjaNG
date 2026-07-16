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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && 'tool' in opts) return `${key}:${opts.tool}`;
      return key;
    },
    i18n: { language: 'en' },
  }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ getQueryData: () => undefined }),
}));
vi.mock('../../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => ({
    currentProfile: { id: 'p1', timezone: 'UTC' },
    settings: { assistantModelId: 'test-model' },
  }),
}));
vi.mock('../../../hooks/useFreshAccessToken', () => ({
  useFreshAccessToken: () => ({ token: null, isFresh: false }),
}));
const navigateMock = vi.fn();
vi.mock('../useAssistantHost', () => ({
  useAssistantHost: () => ({
    host: { confirm: vi.fn(), navigate: navigateMock, onActivity: vi.fn() },
    pendingConfirm: null,
    resolveConfirm: vi.fn(),
  }),
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
    expect(screen.getAllByTestId('assistant-example-prompt')).toHaveLength(3);
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

  it('renders one step per tool activity, with its compact input and status', () => {
    useAssistantStore.setState({
      activities: [
        { toolName: 'count_events', status: 'running', input: { interval: '24 hour' } },
        { toolName: 'count_events', status: 'done', input: { interval: '24 hour' } },
      ],
    });

    render(<AskPanel />);

    const steps = screen.getAllByTestId('assistant-activity-step');
    expect(steps).toHaveLength(2);
    expect(steps[0]).toHaveTextContent('assistant.activity.running:count_events');
    expect(steps[0]).toHaveTextContent('"interval":"24 hour"');
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
      role: 'tool',
      toolResults: [{ callId: 'c1', output: '[]' }],
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
      role: 'tool',
      toolResults: [{ callId: 'c1', output: '[]' }],
      display: [
        { kind: 'monitor', id: '1', title: 'Front Door', subtitle: 'Modect · Connected', navigatePath: '/monitors/1' },
      ],
    });

    render(<AskPanel />);

    expect(screen.queryByTestId('assistant-card-thumbnail-stub')).not.toBeInTheDocument();
    expect(screen.getByTestId('assistant-card-monitor')).toHaveTextContent('Front Door');
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
    expect(step).toHaveTextContent('assistant.activity.done:count_events');
    // DOCUMENT_POSITION_FOLLOWING: `answer` comes after `step` in DOM order,
    // i.e. the step chip renders above the answer, not below it.
    expect(step.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('does not render a result-card strip for a tool message with no display', () => {
    useAssistantStore.getState().append('p1', {
      role: 'tool',
      toolResults: [{ callId: 'c1', output: '{}' }],
    });

    render(<AskPanel />);

    expect(screen.queryByTestId('assistant-result-cards')).not.toBeInTheDocument();
  });
});
