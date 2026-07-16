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
vi.mock('../useAssistantHost', () => ({
  useAssistantHost: () => ({
    host: { confirm: vi.fn(), navigate: vi.fn(), onActivity: vi.fn() },
    pendingConfirm: null,
    resolveConfirm: vi.fn(),
  }),
}));
vi.mock('../../../lib/assistant/tools', () => ({
  getToolByName: (name: string) => ({ name, description: `${name} description` }),
}));
vi.mock('../../../api/auth', () => ({ getVersion: vi.fn() }));

describe('AskPanel', () => {
  beforeEach(() => {
    useAssistantStore.setState({ threads: {}, running: false, activities: [] });
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
});
