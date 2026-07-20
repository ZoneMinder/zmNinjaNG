/**
 * Captures the verbatim request/response pair for one model round trip
 * (refs #246).
 *
 * Every backend calls `captureExchange`, so the transcript the panel shows is
 * bounded the same way regardless of which one answered, and a reader can
 * compare a WebLLM turn against an Ollama turn without allowing for different
 * truncation rules.
 */
import { ASSISTANT } from '../zmninja-ng-constants';
import type { ModelExchange } from './types';

/** `value` as a readable string, bounded by `maxExchangeCharacters`.
 *
 *  The marker names the characters dropped rather than trailing off silently:
 *  a transcript that ends mid-JSON looks like the request itself was
 *  malformed, which is exactly the kind of false lead this feature exists to
 *  remove. */
export function boundExchangeText(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? String(value);
  if (text.length <= ASSISTANT.maxExchangeCharacters) return text;
  const dropped = text.length - ASSISTANT.maxExchangeCharacters;
  return `${text.slice(0, ASSISTANT.maxExchangeCharacters)}\n… [${dropped} more characters not shown]`;
}

export function captureExchange(params: {
  backend: string;
  model: string;
  sent: unknown;
  received: unknown;
  startedAt: number;
}): ModelExchange {
  return {
    backend: params.backend,
    model: params.model,
    sent: boundExchangeText(params.sent),
    received: boundExchangeText(params.received),
    ms: Date.now() - params.startedAt,
  };
}
