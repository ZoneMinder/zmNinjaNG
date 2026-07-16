import { describe, it, expect } from 'vitest';
import { ASSISTANT } from '../../zmninja-ng-constants';
import { log } from '../../logger';
import type { AssistantMessage } from '../types';

describe('assistant constants and types', () => {
  it('exposes tuned defaults', () => {
    expect(ASSISTANT.maxToolIterations).toBe(6);
    expect(ASSISTANT.maxHistoryMessages).toBe(40);
    expect(ASSISTANT.maxListEventsLimit).toBe(25);
    expect(ASSISTANT.maxTokens).toBeGreaterThan(0);
    expect(ASSISTANT.webllmModels.length).toBeGreaterThan(0);
    expect(ASSISTANT.webllmModels.map((m) => m.id)).toContain(ASSISTANT.defaultModelId);
  });

  it('registers the assistant log helper', () => {
    expect(typeof log.assistant).toBe('function');
  });

  it('type surface is importable', () => {
    const msg: AssistantMessage = { role: 'user', text: 'hi' };
    expect(msg.role).toBe('user');
  });
});
