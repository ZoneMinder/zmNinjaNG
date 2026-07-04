import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  diffTouchesVersionLine,
  isChoreCommit,
  checkNativeVersionBump,
  checkCommits,
  NATIVE_VERSION_FILES,
} from '../check-native-version-bump.mjs';

const GRADLE_DIFF = `diff --git a/app/android/app/build.gradle b/app/android/app/build.gradle
index 1111111..2222222 100644
--- a/app/android/app/build.gradle
+++ b/app/android/app/build.gradle
@@ -23,7 +23,7 @@ android {
     defaultConfig {
         applicationId "com.example"
-        versionCode 101817
+        versionCode 101818
         versionName "1.3.0"
`;

const PBXPROJ_DIFF = `diff --git a/app/ios/App/App.xcodeproj/project.pbxproj b/app/ios/App/App.xcodeproj/project.pbxproj
index 1111111..2222222 100644
--- a/app/ios/App/App.xcodeproj/project.pbxproj
+++ b/app/ios/App/App.xcodeproj/project.pbxproj
@@ -414,7 +414,7 @@
-\t\t\t\tCURRENT_PROJECT_VERSION = 1817;
+\t\t\t\tCURRENT_PROJECT_VERSION = 1818;
`;

const UNRELATED_DIFF = `diff --git a/app/src/lib/version.ts b/app/src/lib/version.ts
index 1111111..2222222 100644
--- a/app/src/lib/version.ts
+++ b/app/src/lib/version.ts
@@ -1,3 +1,3 @@
-export const FOO = 1;
+export const FOO = 2;
`;

test('diffTouchesVersionLine detects an android versionCode bump', () => {
  assert.equal(diffTouchesVersionLine(GRADLE_DIFF), true);
});

test('diffTouchesVersionLine detects an iOS CURRENT_PROJECT_VERSION bump', () => {
  assert.equal(diffTouchesVersionLine(PBXPROJ_DIFF), true);
});

test('diffTouchesVersionLine is false for unrelated diffs', () => {
  assert.equal(diffTouchesVersionLine(UNRELATED_DIFF), false);
});

test('diffTouchesVersionLine is false for an empty diff', () => {
  assert.equal(diffTouchesVersionLine(''), false);
});

test('diffTouchesVersionLine ignores the diff header lines (+++/---)', () => {
  // Only the file header lines mention the path, no changed version line.
  const headerOnly = `diff --git a/app/android/app/build.gradle b/app/android/app/build.gradle\n--- a/app/android/app/build.gradle\n+++ b/app/android/app/build.gradle\n`;
  assert.equal(diffTouchesVersionLine(headerOnly), false);
});

test('isChoreCommit accepts plain chore: commits', () => {
  assert.equal(isChoreCommit('chore: bump version to 1.3.1'), true);
});

test('isChoreCommit accepts scoped chore(scope): commits', () => {
  assert.equal(isChoreCommit('chore(hooks): add pre-commit guard'), true);
});

test('isChoreCommit rejects feat/fix commits', () => {
  assert.equal(isChoreCommit('feat: add new widget'), false);
  assert.equal(isChoreCommit('fix: correct montage crash'), false);
});

test('isChoreCommit rejects "chore" without a colon', () => {
  assert.equal(isChoreCommit('chore bump version'), false);
});

test('isChoreCommit only looks at the first line of a multi-line message', () => {
  assert.equal(isChoreCommit('feat: add thing\n\nchore: unrelated body text'), false);
});

test('checkNativeVersionBump allows a non-chore commit that does not touch version lines', () => {
  const result = checkNativeVersionBump('feat: add widget', UNRELATED_DIFF);
  assert.equal(result.ok, true);
});

test('checkNativeVersionBump rejects a non-chore commit that bumps versionCode', () => {
  const result = checkNativeVersionBump('feat: add widget', GRADLE_DIFF);
  assert.equal(result.ok, false);
  assert.match(result.reason, /chore:/);
  for (const file of NATIVE_VERSION_FILES) {
    assert.match(result.reason, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('checkNativeVersionBump allows a chore commit that bumps CURRENT_PROJECT_VERSION', () => {
  const result = checkNativeVersionBump('chore: bump version to 1.3.1', PBXPROJ_DIFF);
  assert.equal(result.ok, true);
});

test('checkNativeVersionBump rejects a chore commit missing the colon', () => {
  const result = checkNativeVersionBump('chore bump version', GRADLE_DIFF);
  assert.equal(result.ok, false);
});

// checkCommits (refs #217 finding 1): the CI-mode helper that walks a list of
// commits already collected from git plumbing. Kept as a pure function of
// plain data so it's testable without a real git repo.

test('checkCommits returns no failures for an empty commit list', () => {
  assert.deepEqual(checkCommits([]), []);
});

test('checkCommits passes commits that do not touch version lines', () => {
  const failures = checkCommits([
    { sha: 'aaa1111', message: 'feat: add widget', diff: UNRELATED_DIFF },
    { sha: 'bbb2222', message: 'fix: correct bug', diff: '' },
  ]);
  assert.deepEqual(failures, []);
});

test('checkCommits passes a chore commit that bumps the native version', () => {
  const failures = checkCommits([
    { sha: 'ccc3333', message: 'chore: bump version to 1.3.1', diff: GRADLE_DIFF },
  ]);
  assert.deepEqual(failures, []);
});

test('checkCommits flags a non-chore commit that bumps versionCode', () => {
  const failures = checkCommits([
    { sha: 'ddd4444', message: 'feat: add widget', diff: GRADLE_DIFF },
  ]);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].sha, 'ddd4444');
  assert.match(failures[0].reason, /chore:/);
});

test('checkCommits flags only the offending commit among several', () => {
  const failures = checkCommits([
    { sha: 'aaa1111', message: 'feat: add widget', diff: UNRELATED_DIFF },
    { sha: 'eee5555', message: 'fix: bump native build', diff: PBXPROJ_DIFF },
    { sha: 'ccc3333', message: 'chore: bump version to 1.3.1', diff: GRADLE_DIFF },
  ]);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].sha, 'eee5555');
});
