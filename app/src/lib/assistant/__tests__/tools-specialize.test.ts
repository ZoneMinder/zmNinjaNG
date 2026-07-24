import { describe, it, expect } from 'vitest';
import { TOOLS, specializeToolSchemas } from '../tools';
import type { ToolDefinition } from '../types';

const LABELS = ['car', 'person', 'truck'];

function objectTypeSpec(tools: ToolDefinition[]): Record<string, unknown> {
  const listEvents = tools.find((t) => t.name === 'list_events');
  const properties = listEvents?.schema.properties as Record<string, Record<string, unknown>>;
  return properties.objectType;
}

describe('specializeToolSchemas', () => {
  it('constrains the string form of objectType to the install labels', () => {
    const spec = objectTypeSpec(specializeToolSchemas(TOOLS, LABELS));
    const branches = spec.anyOf as Array<Record<string, unknown>>;
    expect(branches).toContainEqual({ type: 'string', enum: LABELS });
  });

  it('constrains the array form through its items', () => {
    const spec = objectTypeSpec(specializeToolSchemas(TOOLS, LABELS));
    const branches = spec.anyOf as Array<Record<string, unknown>>;
    expect(branches).toContainEqual({ type: 'array', items: { type: 'string', enum: LABELS } });
  });

  it('keeps the declared type and description so the validator and prompt line are unchanged', () => {
    const before = objectTypeSpec([...TOOLS]);
    const after = objectTypeSpec(specializeToolSchemas(TOOLS, LABELS));
    expect(after.type).toEqual(before.type);
    expect(after.description).toBe(before.description);
  });

  it('returns the tools unchanged when no labels are known', () => {
    expect(specializeToolSchemas(TOOLS, [])).toBe(TOOLS);
    expect(specializeToolSchemas(TOOLS, undefined)).toBe(TOOLS);
    expect(specializeToolSchemas(TOOLS, ['', '  '])).toBe(TOOLS);
  });

  it('leaves tools without an objectType property untouched', () => {
    const specialized = specializeToolSchemas(TOOLS, LABELS);
    for (const tool of TOOLS) {
      const properties = (tool.schema.properties ?? {}) as Record<string, unknown>;
      if (properties.objectType) continue;
      expect(specialized.find((t) => t.name === tool.name)).toBe(tool);
    }
  });

  it('does not mutate the registry it was given', () => {
    const listEvents = TOOLS.find((t) => t.name === 'list_events');
    const properties = listEvents?.schema.properties as Record<string, Record<string, unknown>>;
    const snapshot = JSON.stringify(properties.objectType);
    specializeToolSchemas(TOOLS, LABELS);
    expect(JSON.stringify(properties.objectType)).toBe(snapshot);
    expect(properties.objectType.anyOf).toBeUndefined();
  });

  it('only constrains the branches the original schema allows', () => {
    const stringOnly: ToolDefinition[] = [
      {
        name: 'fake_tool',
        description: 'test only',
        schema: { type: 'object', properties: { objectType: { type: 'string' } } },
        execute: async () => ({ output: '' }),
      },
    ];
    const spec = specializeToolSchemas(stringOnly, LABELS)[0].schema.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(spec.objectType.anyOf).toEqual([{ type: 'string', enum: LABELS }]);
  });
});
