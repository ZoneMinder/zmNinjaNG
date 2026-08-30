/**
 * Mobile assistant bottom sheet (refs #246): height model, drag-to-resize,
 * flick-to-dismiss, and focus-to-expand. The keyboard/rotation behavior itself
 * needs a device (rule 27); this covers the logic that drives it.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { AssistantMobileSheet } from '../AssistantMobileSheet';
import { useAssistantPanelStore } from '../../../stores/assistantPanel';
import { ASSISTANT_PANEL } from '../../../lib/zmninja-ng-constants';
import { seedProfiles, resetProfileFixture } from '../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../tests/fake-store-gates';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
// The header dot owns a useQuery probe covered by useOllamaHealth's own test;
// stub it here (on-device backend, so the dot is hidden) to avoid needing a
// QueryClientProvider in this layout-focused test.
vi.mock('../../../hooks/useOllamaHealth', () => ({
  useOllamaHealth: () => ({ enabled: false, status: 'checking' }),
}));
// Stub AskPanel with a real input so focus-to-expand can be exercised.
vi.mock('../AskPanel', () => ({
  AskPanel: () => (
    <div data-testid="ask-panel-stub">
      <input data-testid="stub-input" />
    </div>
  ),
}));

const VH = 768; // jsdom window.innerHeight

describe('AssistantMobileSheet', () => {
  beforeEach(() => {
    useAssistantPanelStore.setState({ state: 'open', sheetHeightFraction: 0 });
    seedProfiles(['p1'], { settings: { p1: { assistantBackend: 'on-device', assistantModelId: 'x', assistantOllamaModel: '' } } });
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('renders the grip and the collapse/close/clear controls', () => {
    render(<AssistantMobileSheet />);
    expect(screen.getByTestId('assistant-mobile-sheet-grip')).toBeInTheDocument();
    expect(screen.getByTestId('assistant-mobile-minimize')).toBeInTheDocument();
    expect(screen.getByTestId('assistant-mobile-close')).toBeInTheDocument();
    expect(screen.getByTestId('assistant-mobile-clear')).toBeInTheDocument();
  });

  it('renders Ninjii in a visually distinct workspace', () => {
    render(<AssistantMobileSheet />);

    expect(screen.getByTestId('assistant-mobile-sheet')).toHaveClass(
      'border-primary/30',
      'shadow-primary/10',
    );
  });

  it('rests at the bar minimum height when the fraction is 0', () => {
    render(<AssistantMobileSheet />);
    const sheet = screen.getByTestId('assistant-mobile-sheet');
    expect(sheet).toHaveStyle({ height: `${ASSISTANT_PANEL.mobileSheetBarMinPx}px` });
  });

  it('grows the stored fraction when the grip is dragged up', () => {
    render(<AssistantMobileSheet />);
    const grip = screen.getByTestId('assistant-mobile-sheet-grip');

    // Start at bar (112px), drag up 200px → ~312px → fraction ~312/768.
    fireEvent.pointerDown(grip, { clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 300 });
    fireEvent.pointerUp(window, { clientY: 300 });

    const f = useAssistantPanelStore.getState().sheetHeightFraction;
    expect(f).toBeGreaterThan(0.35);
    expect(f).toBeLessThan(0.45);
  });

  it('collapses to the floating button when flicked below the bar', () => {
    render(<AssistantMobileSheet />);
    const grip = screen.getByTestId('assistant-mobile-sheet-grip');

    // Drag down well past the bar minimum → dismiss to minimized.
    fireEvent.pointerDown(grip, { clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 600 });
    fireEvent.pointerUp(window, { clientY: 600 });

    expect(useAssistantPanelStore.getState().state).toBe('minimized');
  });

  it('does not exceed the max fraction of the viewport when dragged far up', () => {
    render(<AssistantMobileSheet />);
    const grip = screen.getByTestId('assistant-mobile-sheet-grip');

    fireEvent.pointerDown(grip, { clientY: 700, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: -2000 }); // yank far past the top
    fireEvent.pointerUp(window, { clientY: -2000 });

    const px = useAssistantPanelStore.getState().sheetHeightFraction * VH;
    expect(px).toBeLessThanOrEqual(ASSISTANT_PANEL.mobileSheetMaxFraction * VH + 1);
  });

  it('expands to the focus fraction when the input is focused from the bar', () => {
    render(<AssistantMobileSheet />);
    fireEvent.focus(screen.getByTestId('stub-input'));
    expect(useAssistantPanelStore.getState().sheetHeightFraction).toBe(
      ASSISTANT_PANEL.mobileSheetFocusFraction,
    );
  });

  it('does not shrink a tall sheet when the input is focused', () => {
    useAssistantPanelStore.setState({ sheetHeightFraction: 0.8 });
    render(<AssistantMobileSheet />);
    fireEvent.focus(screen.getByTestId('stub-input'));
    // Already well above the bar, so focus leaves it as the user set it.
    expect(useAssistantPanelStore.getState().sheetHeightFraction).toBe(0.8);
  });
});
