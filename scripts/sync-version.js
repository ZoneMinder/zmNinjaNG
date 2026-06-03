#!/usr/bin/env node

/**
 * Synchronizes version numbers from package.json (and git) to the iOS and
 * Android configuration files. Run before a mobile build so the store metadata
 * matches the app.
 *
 * Two numbers are written:
 * - Marketing version (package.json `version`): Android `versionName`,
 *   iOS `MARKETING_VERSION` (CFBundleShortVersionString). Bumped on a prod
 *   release. This is what users see in the store listing.
 * - Build number (git commit count): Android `versionCode`,
 *   iOS `CURRENT_PROJECT_VERSION` (CFBundleVersion). Increases on every commit.
 *   The stores require this to strictly increase per upload. Same source as the
 *   in-app sidebar build number, so the value shown in the app matches the
 *   Play Console / App Store Connect upload.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Monotonic build number from the git commit count. Stays in sync with the
 * in-app sidebar (app/src/lib/version.ts). Throws if git can't produce an
 * integer, so a release build fails loudly rather than shipping a bad
 * versionCode.
 */
function getBuildNumber() {
  const raw = execSync('git rev-list --count HEAD').toString().trim();
  const count = Number(raw);
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(`Could not derive build number from git: "${raw}"`);
  }
  return count;
}

/** Set Android versionName (marketing) and versionCode (build number). */
function applyGradleVersion(text, version, build) {
  return text
    .replace(/versionName ".*"/, `versionName "${version}"`)
    .replace(/versionCode \d+/, `versionCode ${build}`);
}

/** Set iOS MARKETING_VERSION (marketing) and CURRENT_PROJECT_VERSION (build). */
function applyXcodeVersion(text, version, build) {
  return text
    .replace(/MARKETING_VERSION = [\d.]+;/g, `MARKETING_VERSION = ${version};`)
    .replace(/CURRENT_PROJECT_VERSION = \d+;/g, `CURRENT_PROJECT_VERSION = ${build};`);
}

function main() {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../app/package.json'), 'utf8')
  );
  const version = packageJson.version;
  const build = getBuildNumber();

  console.log(`Syncing version ${version} (build ${build}) to all platform configs...`);

  const buildGradlePath = path.join(__dirname, '../app/android/app/build.gradle');
  if (fs.existsSync(buildGradlePath)) {
    const updated = applyGradleVersion(fs.readFileSync(buildGradlePath, 'utf8'), version, build);
    fs.writeFileSync(buildGradlePath, updated);
    console.log(`✓ Updated ${buildGradlePath} (versionName=${version}, versionCode=${build})`);
  }

  const xcodeProjectPath = path.join(__dirname, '../app/ios/App/App.xcodeproj/project.pbxproj');
  if (fs.existsSync(xcodeProjectPath)) {
    const updated = applyXcodeVersion(fs.readFileSync(xcodeProjectPath, 'utf8'), version, build);
    fs.writeFileSync(xcodeProjectPath, updated);
    console.log(`✓ Updated ${xcodeProjectPath} (MARKETING_VERSION=${version}, CURRENT_PROJECT_VERSION=${build})`);
  }

  // In GitHub Actions, expose the build number to later steps so the
  // electron-builder ${env.BUILD_NUMBER} macro and rename steps can use it.
  if (process.env.GITHUB_ENV) {
    fs.appendFileSync(process.env.GITHUB_ENV, `BUILD_NUMBER=${build}\n`);
    console.log(`✓ Exported BUILD_NUMBER=${build} to GITHUB_ENV`);
  }

  console.log(`✅ Synced version ${version}, build ${build}`);
}

if (require.main === module) {
  main();
}

module.exports = { getBuildNumber, applyGradleVersion, applyXcodeVersion };
