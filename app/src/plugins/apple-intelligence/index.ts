import { registerPlugin } from '@capacitor/core';
import type { AppleIntelligencePlugin } from './definitions';

const AppleIntelligence = registerPlugin<AppleIntelligencePlugin>('AppleIntelligence');

export * from './definitions';
export { AppleIntelligence };
