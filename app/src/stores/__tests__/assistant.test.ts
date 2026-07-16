import { describe, it, expect, beforeEach } from 'vitest';
import { useAssistantStore } from '../assistant';

describe('assistant store', () => {
  beforeEach(() => useAssistantStore.getState().reset('p1'));
  it('keeps history per profile', () => {
    useAssistantStore.getState().append('p1', { role: 'user', text: 'hi' });
    expect(useAssistantStore.getState().getThread('p1')).toHaveLength(1);
    expect(useAssistantStore.getState().getThread('p2')).toHaveLength(0);
  });
  it('reset clears one profile only', () => {
    useAssistantStore.getState().append('p1', { role: 'user', text: 'hi' });
    useAssistantStore.getState().reset('p1');
    expect(useAssistantStore.getState().getThread('p1')).toHaveLength(0);
  });
});
