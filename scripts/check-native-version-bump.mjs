/**
 * commit-msg hook guard (rule 28, refs #217). `npm run build` bumps the
 * native build numbers in these two files as a side effect:
 *   - app/android/app/build.gradle (`versionCode`)
 *   - app/ios/App/App.xcodeproj/project.pbxproj (`CURRENT_PROJECT_VERSION`)
 * Those bumps are only meant to land in a dedicated `chore:` commit
 * (sync-version.js / the release flow), never bundled into a feature or fix
 * commit. A pre-commit hook can't see the commit message yet, so this runs
 * as commit-msg: if the staged diff touches a version line in either file
 * and the message isn't a `chore` commit, reject with instructions to revert
 * the bump or reword as `chore:`.
 *
 * Usage: check-native-version-bump.mjs <path-to-commit-msg-file>
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const NATIVE_VERSION_FILES = [
  'app/android/app/build.gradle',
  'app/ios/App/App.xcodeproj/project.pbxproj',
];

const VERSION_LINE_PATTERN = /versionCode|CURRENT_PROJECT_VERSION/;

/** True if `line` is an added/removed diff line (not a `+++`/`---` header). */
function isChangedLine(line) {
  if (line.startsWith('+++') || line.startsWith('---')) return false;
  return line.startsWith('+') || line.startsWith('-');
}

/** True if a unified diff has an added/removed line touching a version field. */
export function diffTouchesVersionLine(diffText) {
  return diffText
    .split('\n')
    .some((line) => isChangedLine(line) && VERSION_LINE_PATTERN.test(line));
}

/** Conventional-commit `chore:` or `chore(scope):` prefix, case-sensitive. */
export function isChoreCommit(message) {
  const firstLine = message.split('\n')[0].trim();
  return /^chore(\([^)]*\))?:/.test(firstLine);
}

function getStagedDiff(files) {
  try {
    return execFileSync('git', ['diff', '--cached', '--', ...files], { encoding: 'utf8' });
  } catch {
    return '';
  }
}

export function checkNativeVersionBump(commitMessage, diffText) {
  if (!diffTouchesVersionLine(diffText)) return { ok: true };
  if (isChoreCommit(commitMessage)) return { ok: true };
  return {
    ok: false,
    reason:
      'Commit touches native build-number lines (versionCode / CURRENT_PROJECT_VERSION) ' +
      'but the message is not a `chore:` commit (rule 28).\n' +
      'These are incidental bumps from `npm run build` and must only land in a dedicated ' +
      'chore commit.\n\n' +
      'Fix one of:\n' +
      `  1. Revert the bump: git checkout -- ${NATIVE_VERSION_FILES.join(' ')}\n` +
      '  2. Reword the commit message to start with `chore:` if the bump is intentional.',
  };
}

function main() {
  const commitMsgFile = process.argv[2];
  if (!commitMsgFile) {
    console.error('check-native-version-bump: missing commit-msg file argument');
    process.exit(1);
  }
  const commitMessage = readFileSync(commitMsgFile, 'utf8');
  const diffText = getStagedDiff(NATIVE_VERSION_FILES);
  const result = checkNativeVersionBump(commitMessage, diffText);
  if (!result.ok) {
    console.error(`\n${result.reason}\n`);
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
