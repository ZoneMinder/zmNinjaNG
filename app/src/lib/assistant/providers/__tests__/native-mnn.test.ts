import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeMnnProvider } from '../native-mnn';
import { NATIVE_MNN_MODELS } from '../../native-mnn';
import { ASSISTANT } from '../../../zmninja-ng-constants';

const MODEL_ID = 'Qwen3.5-2B-Claude-4.6-Opus-Reasoning-Distilled-MNN';

const nativeMnnChatMock = vi.fn();
vi.mock('../../native-mnn', async () => {
  const actual = await vi.importActual<typeof import('../../native-mnn')>('../../native-mnn');
  return {
    NATIVE_MNN_MODELS: actual.NATIVE_MNN_MODELS,
    supportsNativeMnnModel: (modelId: string) => modelId === 'Qwen3.5-2B-Claude-4.6-Opus-Reasoning-Distilled-MNN',
    nativeMnnChat: (...args: unknown[]) => nativeMnnChatMock(...args),
  };
});

/** The native bridge returns MNN's own token counts with the text. */
const reply = (content: string, promptTokens = 1200, completionTokens = 40) => ({
  content, promptTokens, completionTokens,
});

type SentMessage = { role: string; content: string };
const sentMessages = (callIndex = 0): SentMessage[] => nativeMnnChatMock.mock.calls[callIndex][1] as SentMessage[];

describe('NativeMnnProvider', () => {
  beforeEach(() => nativeMnnChatMock.mockReset());

  it('uses shared JSON contract and parses its answer', async () => {
    nativeMnnChatMock.mockResolvedValue(reply('{"answer":"Three events."}'));
    const provider = new NativeMnnProvider(MODEL_ID);

    await expect(provider.chat([{ role: 'user', text: 'How many events?' }], [], 'system', new AbortController().signal))
      .resolves.toMatchObject({ text: 'Three events.', toolCalls: [] });
    expect(nativeMnnChatMock).toHaveBeenCalledWith(MODEL_ID, expect.any(Array), ASSISTANT.nativeMnnMaxTokens);
  });

  // Without this the auto-clear check in AskPanel silently never fired on
  // mobile, because usage was undefined on every native turn.
  it('reports MNN\'s own token counts so the context-full check can run', async () => {
    nativeMnnChatMock.mockResolvedValue(reply('{"answer":"ok"}', 3100, 25));
    const provider = new NativeMnnProvider(MODEL_ID);

    const turn = await provider.chat([{ role: 'user', text: 'hi' }], [], 'system', new AbortController().signal);

    expect(turn.usage).toEqual({ promptTokens: 3100, completionTokens: 25, totalTokens: 3125 });
  });

  // The whole point of the ChatMessages bridge: the conversation must reach
  // native code as discrete role-tagged turns, never flattened into one
  // string, or MNN wraps the entire blob as a single user turn.
  it('sends role-tagged turns, opening with a system message', async () => {
    nativeMnnChatMock.mockResolvedValue(reply('{"answer":"ok"}'));
    const provider = new NativeMnnProvider(MODEL_ID);

    await provider.chat([{ role: 'user', text: 'How many events?' }], [], 'system text', new AbortController().signal);

    const messages = sentMessages();
    expect(messages[0]).toMatchObject({ role: 'system' });
    expect(messages[0].content).toContain('system text');
    expect(messages.at(-1)).toMatchObject({ role: 'user' });
    expect(messages.at(-1)?.content).toContain('How many events?');
    for (const message of messages) {
      expect(['system', 'user', 'assistant']).toContain(message.role);
      expect(message.content.startsWith('user:')).toBe(false);
    }
  });

  // Thinking stays enabled for this reasoning-distilled model, and the
  // few-shot block is back now that role markers make it read as examples.
  it('keeps thinking enabled and includes the few-shot examples', async () => {
    nativeMnnChatMock.mockResolvedValue(reply('{"answer":"ok"}'));
    const provider = new NativeMnnProvider(MODEL_ID);

    await provider.chat([{ role: 'user', text: 'hi' }], [], 'system', new AbortController().signal);

    const messages = sentMessages();
    expect(messages.some((m) => m.content.includes('/no_think'))).toBe(false);
    expect(messages.some((m) => m.content.includes('There were 15 events today'))).toBe(true);
  });

  it('retries a degenerate reply instead of surfacing the parse error', async () => {
    nativeMnnChatMock
      .mockResolvedValueOnce(reply('```'))
      .mockResolvedValueOnce(reply('{"answer":"Two people came."}'));
    const provider = new NativeMnnProvider(MODEL_ID);

    const turn = await provider.chat([{ role: 'user', text: 'hi' }], [], 'system', new AbortController().signal);

    expect(turn.text).toBe('Two people came.');
    expect(nativeMnnChatMock).toHaveBeenCalledTimes(2);
  });

  it('gives up with the parse-error apology after every attempt degenerates', async () => {
    nativeMnnChatMock.mockResolvedValue(reply('```'));
    const provider = new NativeMnnProvider(MODEL_ID);

    const turn = await provider.chat([{ role: 'user', text: 'hi' }], [], 'system', new AbortController().signal);

    expect(turn.text).toBe('__i18n:assistant.parse_error');
    expect(nativeMnnChatMock).toHaveBeenCalledTimes(ASSISTANT.webllmMaxAttempts);
  });

  it('reports the model registry context window rather than a hardcoded guess', () => {
    expect(new NativeMnnProvider(MODEL_ID).contextWindow).toBe(
      NATIVE_MNN_MODELS.find((m) => m.id === MODEL_ID)?.contextWindowSize,
    );
  });

  it('rejects a desktop-only model before calling native code', async () => {
    const provider = new NativeMnnProvider('Llama-3.2-1B-Instruct-q4f16_1-MLC');

    await expect(provider.chat([], [], 'system', new AbortController().signal)).rejects.toThrow('__i18n:assistant.model_unavailable_native');
    expect(nativeMnnChatMock).not.toHaveBeenCalled();
  });

  // Regression, from a real on-device session: "Hello" produced a correct
  // plain-language greeting, the parser rejected it for lacking the JSON
  // envelope, and the retry "complied" by calling list_monitors, so a greeting
  // fetched every camera and filled the panel with thumbnails.
  it('accepts a plain-language greeting on the first attempt, with no retry', async () => {
    nativeMnnChatMock.mockResolvedValue(
      reply('The user greeted me, no tool needed.\n</think>\n\nHello! How can I help you today?\n'),
    );
    const provider = new NativeMnnProvider(MODEL_ID);

    const turn = await provider.chat([{ role: 'user', text: 'Hello' }], [], 'system', new AbortController().signal);

    expect(turn.text).toBe('Hello! How can I help you today?');
    expect(turn.toolCalls).toEqual([]);
    // One call: no re-roll, so nothing pressures the model into a tool call.
    expect(nativeMnnChatMock).toHaveBeenCalledTimes(1);
  });
});
