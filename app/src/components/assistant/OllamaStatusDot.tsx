/**
 * Ollama connection dot for the assistant header (refs #246).
 *
 * Renders nothing unless the Ollama backend is selected. Green = reachable,
 * red = unreachable, amber (pulsing) = first probe in flight. Self-contained:
 * it owns the `useOllamaHealth` query, so both the desktop header and the mobile
 * sheet get the indicator by mounting this one element.
 */
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { useOllamaHealth } from '../../hooks/useOllamaHealth';

export function OllamaStatusDot({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { enabled, status } = useOllamaHealth();
  if (!enabled) return null;

  const label =
    status === 'connected'
      ? t('assistant.ollama_status_connected')
      : status === 'disconnected'
        ? t('assistant.ollama_status_disconnected')
        : t('assistant.ollama_status_checking');

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-testid="assistant-ollama-status"
      data-status={status}
      className={cn(
        'inline-block h-2 w-2 shrink-0 rounded-full',
        status === 'connected' && 'bg-green-500',
        status === 'disconnected' && 'bg-red-500',
        status === 'checking' && 'animate-pulse bg-amber-500',
        className,
      )}
    />
  );
}
