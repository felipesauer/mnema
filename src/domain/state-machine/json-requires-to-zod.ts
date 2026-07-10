import { z } from 'zod';

import type { FieldSpec } from './workflow-meta-schema.js';

/**
 * Defensive upper bound on the length of a pattern-validated string field
 * when the spec declares no explicit `max`. ReDoS needs a long input to
 * blow up; the pattern screen ({@link screenRegexPattern}) is the first
 * line of defence, and this cap is the second — enforced BEFORE the regex
 * runs (see {@link buildPatternString}), so a pattern that slips the
 * screen still cannot be handed an unbounded payload. 4096 is far above
 * any legitimate gate value (keys, handles, short identifiers).
 */
const PATTERN_FIELD_MAX_LENGTH = 4096;

/**
 * Translates a single field specification (JSON) into a Zod schema.
 *
 * Recursive for array and object fields. The runtime value type matches
 * the discriminator: callers should not invoke this directly with raw
 * input — it expects a spec already validated by `WorkflowMetaSchema`.
 *
 * @param spec - Field specification produced by the workflow meta-schema
 * @returns Zod schema enforcing the field's constraints
 */
export function fieldSpecToZod(spec: FieldSpec): z.ZodType {
  let schema: z.ZodType = buildBase(spec);

  if (spec.description !== undefined) schema = schema.describe(spec.description);
  if (spec.optional === true) schema = schema.optional();
  if (spec.default !== undefined) schema = schema.default(spec.default);
  return schema;
}

function buildBase(spec: FieldSpec): z.ZodType {
  switch (spec.type) {
    case 'string':
      return buildString(spec);
    case 'number':
      return buildNumber(spec);
    case 'boolean':
      return z.boolean();
    case 'array':
      return buildArray(spec);
    case 'object':
      return buildObject(spec);
  }
}

function buildString(spec: Extract<FieldSpec, { type: 'string' }>): z.ZodType {
  // A pattern field enforces its length bound inside an ordered check
  // (length before regex), so it must NOT also carry Zod's own `.min`/
  // `.max` — those run in the same pass and would neither gate the regex
  // nor avoid duplicate issues. Handle it before applying min/max.
  if (spec.pattern !== undefined) {
    return buildPatternString(spec);
  }
  let s: z.ZodString = z.string();
  if (spec.min !== undefined) s = s.min(spec.min);
  if (spec.max !== undefined) s = s.max(spec.max);
  if (spec.format === 'url') return s.pipe(z.url());
  if (spec.format === 'email') return s.pipe(z.email());
  if (spec.format === 'uuid') return s.pipe(z.uuid());
  if (spec.format === 'iso8601') return s.pipe(z.iso.datetime());
  if (spec.format === 'task_key') return s.regex(/^[A-Z][A-Z0-9]*-\d+$/);
  if (spec.enum !== undefined && spec.enum.length > 0) {
    const allowed = [...spec.enum];
    return s.refine((v) => allowed.includes(v), {
      message: `Must be one of ${allowed.join(', ')}`,
    });
  }
  return s;
}

/**
 * Builds the schema for a pattern-validated string, enforcing the length
 * bound BEFORE the regex runs.
 *
 * Zod does not short-circuit `.max(n).regex(re)`: it runs `re` even when
 * the value exceeds `n`, so chaining is not a defence against a ReDoS
 * pattern. Instead a single check does length first and returns early when
 * the value is out of bounds — an over-long payload never reaches the
 * regex engine, keeping its work bounded even if a pathological pattern
 * ever slips {@link screenRegexPattern}.
 */
function buildPatternString(spec: Extract<FieldSpec, { type: 'string' }>): z.ZodType {
  const max = spec.max ?? PATTERN_FIELD_MAX_LENGTH;
  const min = spec.min;
  const re = new RegExp(spec.pattern as string);
  return z.string().superRefine((value, ctx) => {
    if (min !== undefined && value.length < min) {
      ctx.addIssue({ code: 'too_small', minimum: min, origin: 'string', inclusive: true });
      return; // length out of bounds — do not run the regex
    }
    if (value.length > max) {
      ctx.addIssue({ code: 'too_big', maximum: max, origin: 'string', inclusive: true });
      return; // length out of bounds — do not run the regex
    }
    if (!re.test(value)) {
      ctx.addIssue({ code: 'invalid_format', format: 'regex', pattern: re.source });
    }
  });
}

function buildNumber(spec: Extract<FieldSpec, { type: 'number' }>): z.ZodType {
  let n: z.ZodNumber = z.number();
  if (spec.integer === true) n = n.int();
  if (spec.min !== undefined) n = n.min(spec.min);
  if (spec.max !== undefined) n = n.max(spec.max);
  if (spec.enum !== undefined && spec.enum.length > 0) {
    const allowed = [...spec.enum];
    return n.refine((v) => allowed.includes(v), {
      message: `Must be one of ${allowed.join(', ')}`,
    });
  }
  return n;
}

function buildArray(spec: Extract<FieldSpec, { type: 'array' }>): z.ZodType {
  let a: z.ZodArray<z.ZodType> = z.array(fieldSpecToZod(spec.items));
  if (spec.min !== undefined) a = a.min(spec.min);
  if (spec.max !== undefined) a = a.max(spec.max);
  if (spec.unique === true) {
    return a.refine((arr) => new Set(arr).size === arr.length, {
      message: 'Items must be unique',
    });
  }
  return a;
}

function buildObject(spec: Extract<FieldSpec, { type: 'object' }>): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  for (const [k, v] of Object.entries(spec.properties)) {
    shape[k] = fieldSpecToZod(v);
  }
  return z.object(shape);
}

/**
 * Translates a `requires` block (a record of named field specs) into a
 * Zod object schema usable to validate transition payloads.
 *
 * @param requires - Map of field name to field spec
 * @returns Zod object schema validating the full payload
 */
export function jsonRequiresToZod(requires: Readonly<Record<string, FieldSpec>>): z.ZodObject {
  const shape: Record<string, z.ZodType> = {};
  for (const [k, v] of Object.entries(requires)) {
    shape[k] = fieldSpecToZod(v);
  }
  return z.object(shape);
}
