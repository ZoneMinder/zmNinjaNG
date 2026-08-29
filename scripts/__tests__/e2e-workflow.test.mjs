/**
 * The browser e2e job ends green when it has nothing to run, so that a fork
 * PR or a clone with no ZoneMinder is not blocked. That makes its green tick
 * ambiguous, and the only thing telling the two apart is the warning and the
 * step summary it writes on the skip path (M2).
 *
 * ci.yml had that report; test.yml ran the same suite without it, so one of
 * the two workflows was silently green on skip for months. This keeps them in
 * step: a workflow that runs the e2e suite has to say when it did not.
 *
 * The check is textual rather than per-job. It catches the regression that
 * actually happened (a workflow running e2e with no skip report at all) and
 * costs no yaml parser.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const workflowDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../.github/workflows',
);

test('every workflow that runs the e2e suite reports when it skipped', () => {
  const offenders = readdirSync(workflowDir)
    .filter((f) => /\.ya?ml$/.test(f))
    .filter((f) => {
      const text = readFileSync(path.join(workflowDir, f), 'utf8');
      return text.includes('test:e2e') && !text.includes('E2E skipped');
    });

  assert.deepEqual(
    offenders,
    [],
    `these workflows run the e2e suite but never say when it did not run: ${offenders.join(', ')}`,
  );
});
