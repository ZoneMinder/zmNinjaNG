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
import { ASSISTANT, ASSISTANT_PANEL } from '../../../lib/zmninja-ng-constants';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
// Mutable so a test can switch backends: the header reads the assistant
// settings to say which model is answering and where it runs.
let mockSettings: Record<string, unknown> = {};
vi.mock('../../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => ({ currentProfile: { id: 'p1' }, settings: mockSettings }),
}));
vi.mock('../AskPanel', () => ({
  AskPanel: () => <div data-testid="ask-panel-stub" />,
}));
// The header dot owns a useQuery probe covered by useOllamaHealth's own test;
// stub it here so these chrome tests need no QueryClientProvider. Reflect the
// selected backend so the dot still renders (or hides) as it would live.
vi.mock('../../../hooks/useOllamaHealth', () => ({
  useOllamaHealth: () => ({ enabled: mockSettings.assistantBackend === 'ollama', status: 'connected' }),
}));
// Mutable so a test can pick which shell the widget renders. jsdom has no
// matchMedia, so the real hook returns false (desktop) anyway; this makes the
// choice explicit and lets one test assert the mobile branch.
let mockIsMobile = false;
vi.mock('../../../hooks/useIsMobile', () => ({
  useIsMobile: () => mockIsMobile,
}));

describe('AssistantWidget', () => {
  beforeEach(() => {
    useAssistantPanelStore.setState({
      state: 'closed',
      size: { width: ASSISTANT_PANEL.defaultWidth, height: ASSISTANT_PANEL.defaultHeight },
    });
    useAssistantStore.setState({ threads: {}, running: false, activities: [] });
    mockSettings = {};
    mockIsMobile = false;
  });

  describe('mobile vs desktop shell', () => {
    it('renders the desktop card, not the mobile sheet, when not mobile', () => {
      mockIsMobile = false;
      useAssistantPanelStore.setState({ state: 'open' });
      render(<AssistantWidget />);
      expect(screen.getByTestId('assistant-panel')).toBeInTheDocument();
      expect(screen.queryByTestId('assistant-mobile-sheet')).not.toBeInTheDocument();
    });

    it('renders the mobile sheet, not the desktop card, when mobile', () => {
      mockIsMobile = true;
      useAssistantPanelStore.setState({ state: 'open' });
      render(<AssistantWidget />);
      expect(screen.getByTestId('assistant-mobile-sheet')).toBeInTheDocument();
      expect(screen.queryByTestId('assistant-panel')).not.toBeInTheDocument();
    });
  });

  // The header answers "who am I talking to, and is it running on my device or
  // on a server": the same question the parse-error and OOM notes leave the
  // user asking, and the answer lives two screens away in Settings.
  describe('backend label', () => {
    it('shows the on-device model by its picker label, not its registry id', () => {
      mockSettings = {
        assistantBackend: 'on-device',
        assistantModelId: ASSISTANT.webllmModels[0].id,
      };
      useAssistantPanelStore.setState({ state: 'open' });
      render(<AssistantWidget />);

      const label = screen.getByTestId('assistant-backend-label');
      expect(label).toHaveTextContent(ASSISTANT.webllmModels[0].label);
      expect(label).toHaveTextContent('assistant.backend_on_device');
      // The raw id is what settings persist; it is not what a human reads.
      expect(label).not.toHaveTextContent(ASSISTANT.webllmModels[0].id);
    });

    it('shows the Ollama model name and mode when the backend is remote', () => {
      mockSettings = {
        assistantBackend: 'ollama',
        assistantOllamaModel: 'qwen2.5:3b',
        assistantModelId: ASSISTANT.webllmModels[0].id,
      };
      useAssistantPanelStore.setState({ state: 'open' });
      render(<AssistantWidget />);

      const label = screen.getByTestId('assistant-backend-label');
      expect(label).toHaveTextContent('qwen2.5:3b');
      expect(label).toHaveTextContent('assistant.backend_ollama');
      // The on-device model stays in settings while Ollama is selected; showing
      // it here would name a model that is not answering.
      expect(label).not.toHaveTextContent(ASSISTANT.webllmModels[0].label);
    });

    it('falls back to a saved id with no matching picker entry', () => {
      mockSettings = { assistantBackend: 'on-device', assistantModelId: 'some-unlisted-model' };
      useAssistantPanelStore.setState({ state: 'open' });
      render(<AssistantWidget />);

      expect(screen.getByTestId('assistant-backend-label')).toHaveTextContent('some-unlisted-model');
    });

    it('shows the mode alone when no model is configured yet', () => {
      mockSettings = { assistantBackend: 'ollama', assistantOllamaModel: '' };
      useAssistantPanelStore.setState({ state: 'open' });
      render(<AssistantWidget />);

      expect(screen.getByTestId('assistant-backend-label')).toHaveTextContent(
        'assistant.backend_ollama',
      );
    });
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
    // Ninjii's logo replaces the lucide icon in the FAB (refs #246); it's
    // decorative since the button's own aria-label already names Ninjii.
    expect(fab.querySelector('img')).toHaveAttribute('src', '/ninjii.png');

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
    // Ninjii's logo in the header, to the left of the title (refs #246).
    expect(screen.getByAltText('assistant.title')).toHaveAttribute('src', '/ninjii.png');
  });

  it('puts the resize handle at the top-left, the corner away from the bottom-right anchor', () => {
    useAssistantPanelStore.setState({ state: 'open' });
    render(<AssistantWidget />);

    const handle = screen.getByTestId('assistant-panel-resize');
    // Top-left, not bottom-right: the panel is pinned bottom-right, so this is
    // the free corner (refs #246). A regression that moved it back to the
    // anchored corner would drop `left-0 top-0`.
    expect(handle.className).toContain('left-0');
    expect(handle.className).toContain('top-0');
    expect(handle.className).toContain('cursor-nwse-resize');
    expect(handle).toHaveAttribute('aria-label', 'assistant.resize');
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
