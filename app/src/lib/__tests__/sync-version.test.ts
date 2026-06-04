import { describe, it, expect } from 'vitest';
// scripts/sync-version.js is a repo-root CommonJS build script. It exports pure
// string transforms that this suite exercises; the file-writing main() only
// runs when the script is invoked directly (require.main === module).
import syncVersion from '../../../../scripts/sync-version.js';

const { androidVersionCode, applyGradleVersion, applyXcodeVersion } = syncVersion;

describe('sync-version build number injection', () => {
  it('offsets the Android versionCode above the legacy major*10000+minor*100+patch scheme', () => {
    // The live Play release used the legacy scheme (v1.1.14 -> 10114). A raw
    // commit-count code (~1533) would be a downgrade and Play rejects it. The
    // offset must clear any legacy code (<= 99999 for versions below 10.0.0).
    expect(androidVersionCode(1533)).toBe(101533);
    expect(androidVersionCode(1533)).toBeGreaterThan(10114);
    // Monotonic: a later commit yields a higher code.
    expect(androidVersionCode(1534)).toBeGreaterThan(androidVersionCode(1533));
  });

  it('sets Android versionName to the marketing version and versionCode to the build number', () => {
    const gradle = `    defaultConfig {
        applicationId "com.zoneminder.zmNinjaNG"
        versionCode 10114
        versionName "1.1.14"
    }`;

    const out = applyGradleVersion(gradle, '2.1.1', 1600);

    expect(out).toContain('versionName "2.1.1"');
    expect(out).toContain('versionCode 1600');
    // The derived formula must be gone, not left alongside the new value.
    expect(out).not.toContain('10114');
  });

  it('sets iOS MARKETING_VERSION and CURRENT_PROJECT_VERSION across every build config', () => {
    const pbxproj = `
				CURRENT_PROJECT_VERSION = 1;
				MARKETING_VERSION = 1.1.14;
				CURRENT_PROJECT_VERSION = 1;
				MARKETING_VERSION = 1.1.14;`;

    const out = applyXcodeVersion(pbxproj, '2.1.1', 1600);

    expect(out).not.toContain('CURRENT_PROJECT_VERSION = 1;');
    expect(out.match(/CURRENT_PROJECT_VERSION = 1600;/g)).toHaveLength(2);
    expect(out.match(/MARKETING_VERSION = 2\.1\.1;/g)).toHaveLength(2);
  });
});
