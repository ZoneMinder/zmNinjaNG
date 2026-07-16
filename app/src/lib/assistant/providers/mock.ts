import type { AssistantProvider, AssistantTurn, AssistantMessage, ToolDefinition } from '../types';

/** Deterministic provider for unit + e2e tests. Ignores message content and
 *  replays a preset script of turns. */
export class MockProvider implements AssistantProvider {
  private script: AssistantTurn[] = [];
  private cursor = 0;

  setScript(turns: AssistantTurn[]): void {
    this.script = turns;
    this.cursor = 0;
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
