import type { AssistantProvider, AssistantTurn, AssistantMessage, CompletionResult, ToolDefinition } from '../types';

/** Deterministic provider for unit + e2e tests. Ignores message content and
 *  replays a preset script of turns. */
export class MockProvider implements AssistantProvider {
  private script: AssistantTurn[] = [];
  private cursor = 0;
  /** Mutable, unlike the real providers' readonly field: a test needs to stand
   *  in for both an on-device model (a known window) and Ollama (undefined)
   *  without constructing a different provider. */
  contextWindow?: number;

  setScript(turns: AssistantTurn[]): void {
    this.script = turns;
    this.cursor = 0;
  }

  /** Never exercised: AskPanel skips triage and verification in test mode so a
   *  scripted turn is not consumed by them (see `isAssistantTestMode`). */
  async complete(): Promise<CompletionResult> {
    return { text: '' };
  }

  async chat(
    _messages: AssistantMessage[],
    _tools: ToolDefinition[],
    _system: string,
    signal: AbortSignal,
  ): Promise<AssistantTurn> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const turn = this.script[this.cursor] ?? { text: '', toolCalls: [] };
    this.cursor += 1;
    return turn;
  }
}

/** Singleton the e2e test-mode host seeds via window for determinism. */
export const sharedMockProvider = new MockProvider();
