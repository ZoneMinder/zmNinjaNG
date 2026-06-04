// Type declarations for the CommonJS build script sync-version.js so it can be
// imported from the app's vitest suite.

export function getBuildNumber(): number;
export function androidVersionCode(build: number): number;
export function applyGradleVersion(text: string, version: string, build: number): string;
export function applyXcodeVersion(text: string, version: string, build: number): string;

declare const _default: {
  getBuildNumber: typeof getBuildNumber;
  androidVersionCode: typeof androidVersionCode;
  applyGradleVersion: typeof applyGradleVersion;
  applyXcodeVersion: typeof applyXcodeVersion;
};
export default _default;
