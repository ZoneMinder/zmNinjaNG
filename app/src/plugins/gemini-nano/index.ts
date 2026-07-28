import { registerPlugin } from '@capacitor/core';
import type { GeminiNanoPlugin } from './definitions';

const GeminiNano = registerPlugin<GeminiNanoPlugin>('GeminiNano');

export * from './definitions';
export { GeminiNano };
