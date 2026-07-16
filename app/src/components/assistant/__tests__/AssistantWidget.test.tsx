/**
 * AssistantWidget tests (refs #246): the closed/open/minimized state
 * machine's render output, the FAB's reopen affordance, and the header
 * button wiring (Clear/Minimize/Close). AskPanel itself is stubbed: its
 * conversation internals are covered by AskPanel.test.tsx.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AssistantWidget } from '../AssistantWidget';
import { useAssistantPanelStore } from '../../../stores/assistantPanel';
import { useAssistantStore } from '../../../stores/assistant';
import { ASSISTANT_PANEL } from '../../../lib/zmninja-ng-constants';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => ({ currentProfile: { id: 'p1' }, settings: {} }),
}));
vi.mock('../AskPanel', () => ({
  AskPanel: () => <div data-testid="ask-panel-stub" />,
}));

describe('AssistantWidget', () => {
  beforeEach(() => {
    useAssistantPanelStore.setState({
      state: 'closed',
      size: { width: ASSISTANT_PANEL.defaultWidth, height: ASSISTANT_PANEL.defaultHeight },
    });
    useAssistantStore.setState({ threads: {}, running: false, activities: [] });
  });

  it('renders nothing when closed', () => {
    const { container } = render(<AssistantWidget />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders only the FAB when minimized, and opens the panel on click', async () => {
    useAssistantPanelStore.setState({ state: 'minimized' });
    render(<AssistantWidget />);

    const fab = screen.getByTestId('assistant-fab');
    expect(fab).toBeInTheDocument();
    expect(fab).toHaveAccessibleName('assistant.reopen');

    const user = userEvent.setup();
    await user.click(fab);
    expect(useAssistantPanelStore.getState().state).toBe('open');
  });

  it('renders the panel header and AskPanel body when open', () => {
    useAssistantPanelStore.setState({ state: 'open' });
    render(<AssistantWidget />);

    expect(screen.queryByTestId('assistant-fab')).not.toBeInTheDocument();
    expect(screen.getByTestId('assistant-panel')).toBeInTheDocument();
    expect(screen.getByTestId('ask-panel-stub')).toBeInTheDocument();
    expect(screen.getByTestId('assistant-clear')).toBeInTheDocument();
    expect(screen.getByTestId('assistant-minimize')).toBeInTheDocument();
    expect(screen.getByTestId('assistant-close')).toBeInTheDocument();
  });

  it('minimize button minimizes the panel without unmounting AskPanel', async () => {
    useAssistantPanelStore.setState({ state: 'open' });
    render(<AssistantWidget />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('assistant-minimize'));

    expect(useAssistantPanelStore.getState().state).toBe('minimized');
    // AskPanel stays mounted (hidden via CSS) so the conversation and any
    // in-flight turn survive the minimize (refs #246).
    expect(screen.getByTestId('ask-panel-stub')).toBeInTheDocument();
  });

  it('close button closes the panel', async () => {
    useAssistantPanelStore.setState({ state: 'open' });
    render(<AssistantWidget />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('assistant-close'));

    expect(useAssistantPanelStore.getState().state).toBe('closed');
  });

  it('Clear resets the current profile thread and clears activities', async () => {
    useAssistantPanelStore.setState({ state: 'open' });
    useAssistantStore.getState().append('p1', { role: 'user', text: 'is the front door armed?' });
    useAssistantStore.setState({ activities: [{ toolName: 'list_monitors', status: 'done', input: {} }] });

    render(<AssistantWidget />);

    const clearButton = screen.getByTestId('assistant-clear');
    expect(clearButton).toBeEnabled();

    const user = userEvent.setup();
    await user.click(clearButton);

    expect(useAssistantStore.getState().getThread('p1')).toEqual([]);
    expect(useAssistantStore.getState().activities).toEqual([]);
  });

  it('disables Clear when the current profile thread is empty', () => {
    useAssistantPanelStore.setState({ state: 'open' });
    render(<AssistantWidget />);

    expect(screen.getByTestId('assistant-clear')).toBeDisabled();
  });

  it('disables Clear while a turn is running, even with a non-empty thread', () => {
    useAssistantPanelStore.setState({ state: 'open' });
    useAssistantStore.getState().append('p1', { role: 'user', text: 'is the front door armed?' });
    useAssistantStore.setState({ running: true });

    render(<AssistantWidget />);

    expect(screen.getByTestId('assistant-clear')).toBeDisabled();
  });
});
