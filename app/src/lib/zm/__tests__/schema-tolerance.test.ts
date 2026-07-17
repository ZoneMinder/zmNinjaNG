/**
 * Drift-tolerance helpers (refs #247).
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { tolerantArray, withFieldCatch } from '../schema-tolerance';

describe('tolerantArray', () => {
  const Item = z.object({ Id: z.coerce.string(), Name: z.string() });

  it('keeps valid rows and drops malformed ones', () => {
    const schema = tolerantArray(Item, 'item');
    const result = schema.parse([
      { Id: 1, Name: 'a' },
      { Id: 2 }, // missing Name
      'garbage',
      { Id: 3, Name: 'c' },
    ]);
    expect(result.map((r) => r.Name)).toEqual(['a', 'c']);
  });

  it('returns an empty array, not a failure, when every row is bad', () => {
    const schema = tolerantArray(Item, 'item');
    expect(schema.parse([null, 'x', {}])).toEqual([]);
  });
});

describe('withFieldCatch fallback typing', () => {
  // The whole policy rests on fallbackFor deriving a type-correct value from
  // each field. If Zod's internal def shape changes, these break loudly rather
  // than silently defaulting everything to null.
  // Identity uses z.string() (non-coerce): z.coerce.string() would turn even
  // undefined into the literal "undefined" and never fail, which is a poor
  // identity guard. Booleans are non-coerce here for the same reason: a coerced
  // boolean never throws, so its fallback would never fire.
  const schema = z.object(
    withFieldCatch({
      Name: z.string(),
      required_string: z.string(),
      required_number: z.coerce.number(),
      required_boolean: z.boolean(),
      nullable_string: z.string().nullable(),
      optional_string: z.string().optional(),
      nullable_optional: z.string().nullable().optional(),
    }, ['Name']),
  );
  const base = { Name: 'n', required_string: 'a', required_number: 5, required_boolean: true, nullable_string: 'x', optional_string: 'y', nullable_optional: 'z' };

  it('falls a drifted required number to 0', () => {
    const r = schema.parse({ ...base, required_number: 'not a number' });
    expect(r.required_number).toBe(0);
  });

  it('falls a drifted required boolean to false', () => {
    const r = schema.parse({ ...base, required_boolean: { bad: true } });
    expect(r.required_boolean).toBe(false);
  });

  it('falls a drifted nullable field to null', () => {
    const r = schema.parse({ ...base, nullable_string: { bad: 1 } });
    expect(r.nullable_string).toBeNull();
  });

  it('leaves an identity field strict, so an absent Name still fails', () => {
    const withoutName = { ...base } as Record<string, unknown>;
    delete withoutName.Name;
    // Name absent: the object fails rather than inventing a name.
    expect(schema.safeParse(withoutName).success).toBe(false);
  });

  it('a good object round-trips unchanged', () => {
    const r = schema.parse(base);
    expect(r).toMatchObject({ Name: 'n', required_string: 'a', required_number: 5, required_boolean: true });
  });
});
