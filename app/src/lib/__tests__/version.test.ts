import { describe, it, expect } from 'vitest';
import { getAppVersion, getBuildNumber, getFullVersion } from '../version';

describe('version', () => {
  it('getAppVersion returns the package.json marketing version', () => {
    expect(getAppVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('getBuildNumber returns the build number injected at build time', () => {
    // vitest.config.ts defines __BUILD_NUMBER__ as 'test'
    expect(getBuildNumber()).toBe('test');
  });

  it('getFullVersion combines version and build number as "version (build)"', () => {
    expect(getFullVersion()).toBe(`${getAppVersion()} (${getBuildNumber()})`);
  });
});
