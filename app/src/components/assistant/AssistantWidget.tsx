/**
 * Floating assistant entry point (refs #246).
 *
 * A thin state switch over `useAssistantPanelStore`: nothing when closed, the
 * floating button when minimized, and the conversation shell when open. The
 * shell is one of two, chosen at runtime by viewport (`useIsMobile`): the
 * resizable desktop card (`AssistantDesktopPanel`) or the bottom sheet
 * (`AssistantMobileSheet`). Both embed the same `AskPanel`.
 *
 * The shell stays mounted (hidden) while minimized rather than unmounting, so
 * the conversation and any in-flight turn survive collapsing to the button.
 */
import { useTranslation } from 'react-i18next';
import { useAssistantPanelStore } from '../../stores/assistantPanel';
import { useIsMobile } from '../../hooks/useIsMobile';
import { NINJII_LOGO_URL } from '../../lib/assistant/ninjii-logo';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { AssistantDesktopPanel } from './AssistantDesktopPanel';
import { AssistantMobileSheet } from './AssistantMobileSheet';

export function AssistantWidget() {
  const { t } = useTranslation();
  const panelState = useAssistantPanelStore((s) => s.state);
  const open = useAssistantPanelStore((s) => s.open);
  const isMobile = useIsMobile();

  if (panelState === 'closed') return null;

  return (
    <>
      {panelState === 'minimized' && (
        <Button
          type="button"
          onClick={open}
          aria-label={t('assistant.reopen')}
          data-testid="assistant-fab"
          // bottom-20 (not bottom-4) offsets this above BackgroundTaskDrawer's
          // own bottom-4 right-4 badge so the two floating triggers never overlap.
          className="fixed bottom-20 right-4 z-50 h-12 w-12 rounded-full shadow-lg"
        >
          {/* decorative: the button's own aria-label already names Ninjii */}
          <img src={NINJII_LOGO_URL} alt="" className="h-7 w-7 rounded-full object-contain" />
        </Button>
      )}

      {/* Hidden, not unmounted, while minimized: keeps AskPanel and any running
          turn alive under the button. */}
      <div className={cn(panelState !== 'open' && 'hidden')}>
        {isMobile ? <AssistantMobileSheet /> : <AssistantDesktopPanel />}
      </div>
    </>
  );
}
