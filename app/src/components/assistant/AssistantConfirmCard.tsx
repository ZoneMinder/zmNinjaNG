/**
 * Destructive-action confirmation card (refs #246).
 *
 * Rendered by AskPanel whenever the agent loop's confirm gate
 * (lib/assistant/agent.ts) is waiting on a destructive tool call. The card
 * itself never decides anything: it only localizes `request.messageKey` /
 * `request.messageParams` and forwards the user's choice to the caller, which
 * resolves the Promise `useAssistantHost`'s `confirm()` handed back to the
 * agent loop.
 */
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import type { ConfirmRequest } from '../../lib/assistant/types';
import { Button } from '../ui/button';

export interface AssistantConfirmCardProps {
  request: ConfirmRequest;
  onAccept: () => void;
  onCancel: () => void;
}

export function AssistantConfirmCard({ request, onAccept, onCancel }: AssistantConfirmCardProps) {
  const { t } = useTranslation();
  // Cancel is the default-focused control for a destructive confirmation.
  // `autoFocus` is blocked by jsx-a11y/no-autofocus (rule 35), so focus is
  // set imperatively on mount instead.
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  return (
    <div
      data-testid="assistant-confirm"
      className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
    >
      <div className="flex items-start gap-2 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <p className="min-w-0">{t(request.messageKey, request.messageParams)}</p>
      </div>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">{t('assistant.confirm.details')}</summary>
        <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-[11px]">
          {JSON.stringify(request.params, null, 2)}
        </pre>
      </details>
      <div className="flex justify-end gap-2">
        <Button
          ref={cancelRef}
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          data-testid="assistant-confirm-cancel"
        >
          {t('assistant.confirm.cancel')}
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={onAccept}
          data-testid="assistant-confirm-accept"
        >
          {t('assistant.confirm.accept')}
        </Button>
      </div>
    </div>
  );
}
