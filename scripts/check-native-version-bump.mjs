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
 * Usage (commit-msg hook):
 *   check-native-version-bump.mjs <path-to-commit-msg-file>
 *
 * Usage (CI, refs #217 finding 1 - the commit-msg hook only runs if a
 * contributor ran `npm install` at the repo root and doesn't fire at all on
 * `git commit -n`, so it's advisory-only without a CI backstop):
 *   check-native-version-bump.mjs --ci <git-commit-range>
 * Walks every commit in the range (e.g. `origin/main..HEAD` or
 * `<base-sha>..<head-sha>`) and applies the same rule to each one.
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

/**
 * Pure helper (refs #217 finding 1): given a list of already-collected
 * `{ sha, message, diff }` commits, returns the subset that violate rule 28.
 * Kept separate from the git plumbing in `runCi` so it's testable without a
 * real repo.
 */
export function checkCommits(commits) {
  const failures = [];
  for (const commit of commits) {
    const result = checkNativeVersionBump(commit.message, commit.diff);
    if (!result.ok) {
      failures.push({ sha: commit.sha, message: commit.message, reason: result.reason });
    }
  }
  return failures;
}

/** True if `sha` is a real commit hash (guards against a git "zero SHA" on a push event). */
function isRealSha(sha) {
  return /^[0-9a-f]{7,40}$/i.test(sha) && !/^0+$/.test(sha);
}

/**
 * CLI entry point for CI (refs #217 finding 1). Lists every commit in
 * `range`, loads its message and its diff restricted to the native-version
 * files, and runs `checkCommits` over the result. Returns a process exit
 * code (0 = pass).
 */
export function runCi(range) {
  const [fromRef, toRef] = range.includes('...') ? range.split('...') : range.split('..');
  if (!fromRef || !toRef || !isRealSha(fromRef) || !isRealSha(toRef)) {
    console.log(
      `check-native-version-bump: skipping CI check, no valid commit range ("${range}"). ` +
        'This is expected on the first push of a new branch.'
    );
    return 0;
  }

  let shas;
  try {
    shas = execFileSync('git', ['rev-list', range], { encoding: 'utf8' })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (err) {
    console.error(`check-native-version-bump: failed to list commits for range "${range}": ${err.message}`);
    return 1;
  }

  if (shas.length === 0) {
    console.log('check-native-version-bump: no commits in range, nothing to check');
    return 0;
  }

  const commits = shas.map((sha) => {
    const message = execFileSync('git', ['log', '-1', '--format=%B', sha], { encoding: 'utf8' });
    let diff = '';
    try {
      diff = execFileSync('git', ['show', sha, '--', ...NATIVE_VERSION_FILES], { encoding: 'utf8' });
    } catch {
      diff = '';
    }
    return { sha, message, diff };
  });

  const failures = checkCommits(commits);
  if (failures.length === 0) {
    console.log(`check-native-version-bump: ${commits.length} commit(s) checked, no rule-28 violations`);
    return 0;
  }

  for (const failure of failures) {
    console.error(`\ncommit ${failure.sha.slice(0, 12)} "${failure.message.split('\n')[0]}"`);
    console.error(failure.reason);
  }
  return 1;
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
  if (process.argv[2] === '--ci') {
    const range = process.argv[3];
    if (!range) {
      console.error('check-native-version-bump: --ci requires a commit range argument');
      process.exit(1);
    }
    process.exit(runCi(range));
  }

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
