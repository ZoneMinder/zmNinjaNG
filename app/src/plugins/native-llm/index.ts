import { registerPlugin } from '@capacitor/core';
import type { NativeLlmPlugin } from './definitions';

const NativeLlm = registerPlugin<NativeLlmPlugin>('NativeLlm');

export * from './definitions';
export { NativeLlm };
