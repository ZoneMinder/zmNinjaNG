/**
 * Schema drift tolerance helpers (refs #247, rule 43).
 *
 * ZoneMinder changes what it sends between releases. A field we declared, whose
 * type drifts or which stops being sent, must never fail the whole response,
 * and these two helpers are how every schema in `api/` honors that instead of
 * each one reinventing it.
 *
 * `tolerantArray` keeps the good rows when one is malformed, so a single
 * unusable camera or event cannot blank an entire list. `withFieldCatch` puts a
 * type-matching fallback on every field of an object so a drifted field falls
 * back and the rest of the row survives, without hand-writing `.catch(...)` on
 * hundreds of fields and getting the fallback type wrong on some of them.
 */
import { z } from 'zod';
import { log, LogLevel } from '../logger';

/**
 * An array that drops entries failing `itemSchema` instead of failing as a
 * unit. `z.array(itemSchema)` rejects the whole array on one bad element, which
 * is the exact "one monitor blanks every monitor" failure this prevents.
 *
 * `label` names the collection in the dropped-rows log so a real data problem
 * is still visible rather than silently swallowed (an empty screen with no log
 * is worse than a loud one).
 */
export function tolerantArray<T extends z.ZodTypeAny>(itemSchema: T, label: string) {
  return z.array(z.unknown()).transform((rows) => {
    const kept: z.infer<T>[] = [];
    let dropped = 0;
    for (const row of rows) {
      const parsed = itemSchema.safeParse(row);
      if (parsed.success) kept.push(parsed.data);
      else dropped += 1;
    }
    if (dropped > 0) {
      log.api(`Dropped ${dropped} malformed ${label} entr${dropped === 1 ? 'y' : 'ies'}`, LogLevel.WARN, {
        label,
        dropped,
        total: rows.length,
      });
    }
    return kept;
  });
}

/**
 * The fallback a drifted field takes, derived from its own schema so it always
 * matches the declared type: a nullable field falls to null, an optional one to
 * undefined, and a required scalar to the empty value of its type.
 *
 * Read straight off `_zod.def` (Zod v4's internal shape) rather than by parsing:
 * `safeParse(undefined)` would not distinguish "optional" from "has a default",
 * and the def is what actually drives the type.
 */
function fallbackFor(schema: z.ZodTypeAny): unknown {
  // Zod's internal def shape (`_zod.def`) is not part of the public typings, so
  // this introspection is deliberately `any`. It is covered by tests in
  // `__tests__/schema-tolerance.test.ts` that break loudly if the shape changes
  // (rule 41: verified by running, not by trusting an internal API).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = schema;
  let nullable = false;
  let optional = false;
  // Bounded: the wrapper chain on these schemas is a handful deep, and the
  // guard stops a malformed schema from looping forever.
  for (let i = 0; i < 20; i++) {
    const typeName = current?._zod?.def?.type;
    if (typeName === 'optional' || typeName === 'default' || typeName === 'catch') {
      optional = optional || typeName === 'optional';
      current = current._zod.def.innerType;
    } else if (typeName === 'nullable') {
      nullable = true;
      current = current._zod.def.innerType;
    } else {
      break;
    }
  }

  if (nullable) return null;
  if (optional) return undefined;

  switch (current?._zod?.def?.type) {
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'string':
      return '';
    default:
      // Union, object, record, enum, unknown: no single safe empty value, so
      // fall to null. A consumer already handles null on these because the app
      // never assumed every field was present.
      return null;
  }
}

/**
 * Wraps every field of a raw object shape in `.catch(fallbackFor(field))`, so
 * no single field can fail the object.
 *
 * `identity` names the fields that MUST parse (an id, a name): a fallback there
 * would invent a phantom entity, so they are left strict and the row is dropped
 * at the array level (`tolerantArray`) instead. Everything else tolerates drift
 * in place.
 */
export function withFieldCatch<Shape extends z.ZodRawShape>(
  shape: Shape,
  identity: ReadonlyArray<keyof Shape> = [],
): Shape {
  // Internal `any`: `.catch()` narrows the field's runtime type but the output
  // stays assignable to the original field (a caught optional still yields
  // `T | undefined`), so casting the whole result back to `Shape` keeps
  // `z.infer` unchanged. The identity fields are returned untouched.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Record<string, any> = {};
  for (const [key, schema] of Object.entries(shape)) {
    const field = schema as z.ZodTypeAny;
    out[key] = identity.includes(key as keyof Shape) ? field : field.catch(fallbackFor(field) as never);
  }
  return out as unknown as Shape;
}
