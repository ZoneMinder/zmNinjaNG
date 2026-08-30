#!/usr/bin/env node
// Mutation-smoke: for each target, apply one real-code mutation, run its
// tests, confirm they go red, then always restore the original file.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const targets = [
  {
    desc: 'auth.ts: getFreshAccessToken freshness check, > flipped to <',
    file: 'src/stores/auth.ts',
    from: 'state.accessTokenExpires - now > ZM_INTEGRATION.accessTokenLeewayMs;',
    to: 'state.accessTokenExpires - now < ZM_INTEGRATION.accessTokenLeewayMs;',
    testGlobs: ['src/stores/__tests__/auth.test.ts'],
  },
  {
    desc: 'sessions.ts: getSession cache-hit path disabled (if (cached) -> if (false))',
    file: 'src/services/sessions.ts',
    from: 'if (cached) return cached;',
    to: 'if (false) return cached;',
    testGlobs: [
      'src/services/__tests__/sessions.test.ts',
      'src/stores/__tests__/auth-session-wiring.test.ts',
    ],
  },
  {
    desc: 'url-builder.ts: buildQueryString drops the token param (if (token) -> if (false))',
    file: 'src/lib/zm/url-builder.ts',
    from: '  if (token) {\n    finalParams.token = token;\n  }',
    to: '  if (false) {\n    finalParams.token = token;\n  }',
    testGlobs: ['src/lib/zm/__tests__/url-builder.test.ts'],
  },
  {
    desc: 'schema-tolerance.ts: withFieldCatch no-ops (drops .catch fallback)',
    file: 'src/lib/zm/schema-tolerance.ts',
    from: 'out[key] = identity.includes(key as keyof Shape) ? field : field.catch(fallbackFor(field) as never);',
    to: 'out[key] = field;',
    testGlobs: ['src/api/__tests__/types.test.ts'],
  },
];

function runVitest(globs) {
  const result = spawnSync('npx', ['vitest', 'run', ...globs, '--reporter=dot'], {
    cwd: root,
    timeout: 120_000,
    killSignal: 'SIGKILL',
    stdio: 'inherit',
  });
  if (result.error?.code === 'ETIMEDOUT' || result.signal) {
    console.error(`vitest run timed out or was killed (signal: ${result.signal})`);
    return 1; // treat as failure (non-zero), same as a broken run
  }
  return result.status ?? 1;
}

let anySurvived = false;

for (const t of targets) {
  const filePath = path.join(root, t.file);
  const original = readFileSync(filePath, 'utf8');
  if (!original.includes(t.from)) {
    throw new Error(`Mutation target not found in ${t.file}: ${JSON.stringify(t.from)}`);
  }
  const mutated = original.replace(t.from, t.to);
  try {
    writeFileSync(filePath, mutated);
    console.log(`\n--- Running: ${t.desc} ---`);
    const status = runVitest(t.testGlobs);
    if (status !== 0) {
      console.log(`PASS: ${t.desc}`);
    } else {
      console.log(`FAIL (mutation survived): ${t.desc}`);
      anySurvived = true;
    }
  } finally {
    writeFileSync(filePath, original);
  }
}

console.log('\n=== mutation-smoke summary ===');
console.log(anySurvived ? 'At least one mutation survived.' : 'All mutations were caught.');
process.exit(anySurvived ? 1 : 0);
