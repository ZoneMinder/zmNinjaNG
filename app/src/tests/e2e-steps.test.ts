/**
 * Structural gates on the e2e step definitions (AGENTS.md rules 6 and 12).
 *
 * Two failures this catches, both of which shipped before it existed:
 *
 * 1. A `Then` with no `expect` cannot fail. A step that waits for a locator,
 *    swallows the timeout, and logs the result passes on every run, including
 *    runs where the feature is broken. Playwright's own waits do throw, but a
 *    step that states no expected value is not an assertion.
 * 2. A step definition no feature references is dead code. Step files drift
 *    when scenarios are rewritten and the old definitions stay behind.
 *
 * Features under `tests/features/.wip/` count as references: those scenarios
 * are staged, not deleted.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const STEP_DIR = join(__dirname, '../../tests/steps');
const FEATURE_DIR = join(__dirname, '../../tests/features');

interface StepDef {
  file: string;
  line: number;
  keyword: string;
  pattern: string;
  body: string;
}

const readFeatures = (dir: string): string => {
  let text = '';
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) text += readFeatures(join(dir, entry.name));
    else if (entry.name.endsWith('.feature')) text += `\n${readFileSync(join(dir, entry.name), 'utf8')}`;
  }
  return text;
};

/**
 * Cucumber expression to a line matcher. `{string}` matches a quoted value,
 * `{int}`/`{float}` match a literal number or a Scenario Outline `<placeholder>`.
 */
const patternToRegExp = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = escaped
    .replace(/\\\{string\\\}/g, '"[^"]*"')
    .replace(/\\\{(?:int|float)\\\}/g, '(?:[\\d.]+|<[^>]+>)');
  return new RegExp(`^\\s*(?:Given|When|Then|And|But)\\s+${body}\\s*$`, 'm');
};

const collectSteps = (): StepDef[] => {
  const steps: StepDef[] = [];
  for (const name of readdirSync(STEP_DIR).filter((n) => n.endsWith('.ts'))) {
    const source = ts.createSourceFile(
      name,
      readFileSync(join(STEP_DIR, name), 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        ['Given', 'When', 'Then'].includes(node.expression.text) &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        steps.push({
          file: name,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          keyword: node.expression.text,
          pattern: node.arguments[0].text,
          body: node.getText(source),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(steps.length, `no step definitions parsed out of ${name}`).toBeGreaterThan(0);
  }
  return steps;
};

const steps = collectSteps();
const featureText = readFeatures(FEATURE_DIR);

describe('e2e step definitions', () => {
  it('parses the step files and the feature files', () => {
    expect(steps.length).toBeGreaterThan(100);
    expect(featureText).toContain('Scenario:');
  });

  it('gives every Then step an assertion that can fail', () => {
    // Either the step asserts directly (`expect(...)`, `expect.poll(...)`) or it
    // delegates to an `assert*` helper that does.
    const asserts = (body: string) => /\bexpect\s*[.(]/.test(body) || /\bassert[A-Z]\w*\s*\(/.test(body);
    const unassertive = steps
      .filter((s) => s.keyword === 'Then' && !asserts(s.body))
      .map((s) => `${s.file}:${s.line}: Then ${s.pattern}`);
    expect(unassertive).toEqual([]);
  });

  it('has no step definition that no feature references', () => {
    const orphans = steps
      .filter((s) => !patternToRegExp(s.pattern).test(featureText))
      .map((s) => `${s.file}:${s.line}: ${s.keyword} ${s.pattern}`);
    expect(orphans).toEqual([]);
  });
});
