import { z } from 'zod';

import { screenRegexPattern } from './safe-regex.js';

/**
 * Supported string formats for workflow gate fields.
 * Keep aligned with the format branch in `field-spec-to-zod.ts`.
 */
export const StringFormatEnum = z.enum(['url', 'email', 'uuid', 'iso8601', 'task_key']);

/**
 * Whether a gate field updates the underlying task or just gates the
 * transition.
 *
 * - `mutating` (default): if the payload value is for a column that
 *   maps to the task table (`title`, `description`, `assignee_id`, …),
 *   it is persisted onto the task row at transition time.
 * - `validating`: payload value is recorded in `transitions.payload`
 *   for audit but never overwrites the task. Use for one-shot
 *   justifications like `reason`, `approval_note`, `pr_url`, `note` —
 *   they describe the transition itself, not a lasting attribute of
 *   the task.
 *
 * Authors who don't set the flag get the historical (mutating)
 *   behaviour. The validating mode is an opt-in.
 */
export type FieldKind = 'mutating' | 'validating';

/**
 * Common attributes available on every field spec.
 */
export interface FieldSpecCommon {
  readonly optional?: boolean;
  readonly default?: unknown;
  readonly description?: string;
  readonly field_kind?: FieldKind;
}

export interface StringFieldSpec extends FieldSpecCommon {
  readonly type: 'string';
  readonly min?: number;
  readonly max?: number;
  readonly format?: 'url' | 'email' | 'uuid' | 'iso8601' | 'task_key';
  readonly pattern?: string;
  readonly enum?: readonly string[];
}

export interface NumberFieldSpec extends FieldSpecCommon {
  readonly type: 'number';
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;
  readonly enum?: readonly number[];
}

export interface BooleanFieldSpec extends FieldSpecCommon {
  readonly type: 'boolean';
}

export interface ArrayFieldSpec extends FieldSpecCommon {
  readonly type: 'array';
  readonly items: FieldSpec;
  readonly min?: number;
  readonly max?: number;
  readonly unique?: boolean;
}

export interface ObjectFieldSpec extends FieldSpecCommon {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, FieldSpec>>;
}

/**
 * Discriminated union over all supported field types.
 */
export type FieldSpec =
  | StringFieldSpec
  | NumberFieldSpec
  | BooleanFieldSpec
  | ArrayFieldSpec
  | ObjectFieldSpec;

const FieldSpecBase = z.object({
  optional: z.boolean().optional(),
  default: z.unknown().optional(),
  description: z.string().optional(),
  field_kind: z.enum(['mutating', 'validating']).optional(),
});

const StringFieldSchema = FieldSpecBase.extend({
  type: z.literal('string'),
  min: z.number().int().nonnegative().optional(),
  max: z.number().int().positive().optional(),
  format: StringFormatEnum.optional(),
  // A `pattern` is compiled into a live RegExp and matched against
  // agent/user payloads, so it is screened here — at load — for ReDoS
  // safety. An unsafe pattern is rejected as a WorkflowInvalidError
  // before any payload can be matched against it.
  pattern: z
    .string()
    .optional()
    .superRefine((value, ctx) => {
      if (value === undefined) return;
      const rejection = screenRegexPattern(value);
      if (rejection !== null) {
        ctx.addIssue({ code: 'custom', message: rejection });
      }
    }),
  enum: z.array(z.string()).optional(),
});

const NumberFieldSchema = FieldSpecBase.extend({
  type: z.literal('number'),
  min: z.number().optional(),
  max: z.number().optional(),
  integer: z.boolean().optional(),
  enum: z.array(z.number()).optional(),
});

const BooleanFieldSchema = FieldSpecBase.extend({
  type: z.literal('boolean'),
});

/**
 * Zod schema for a single field specification.
 *
 * Declared via `z.lazy` so that array.items and object.properties can
 * reference {@link FieldSpecSchema} recursively. The explicit annotation
 * `z.ZodType<FieldSpec>` lets TypeScript infer the union without circular
 * type errors.
 */
export const FieldSpecSchema: z.ZodType<FieldSpec> = z.lazy(() =>
  z.discriminatedUnion('type', [
    StringFieldSchema,
    NumberFieldSchema,
    BooleanFieldSchema,
    FieldSpecBase.extend({
      type: z.literal('array'),
      items: FieldSpecSchema,
      min: z.number().int().nonnegative().optional(),
      max: z.number().int().positive().optional(),
      unique: z.boolean().optional(),
    }),
    FieldSpecBase.extend({
      type: z.literal('object'),
      properties: z.record(z.string(), FieldSpecSchema),
    }),
  ]),
);

const TransitionSchema = z.object({
  to: z.string(),
  description: z.string().min(10),
  use_when: z.string().min(10),
  requires: z.record(z.string(), FieldSpecSchema).default({}),
});

const FeaturesSchema = z
  .object({
    sprints: z.boolean().default(false),
    epics: z.boolean().default(false),
    review_workflow: z.boolean().default(false),
    blocked_state: z.boolean().default(false),
  })
  .prefault({});

/**
 * Validation schema for a workflow JSON definition.
 *
 * The two `.refine` calls enforce cross-field invariants that cannot be
 * expressed purely structurally: the initial state must be declared, and
 * every terminal state must also be declared.
 */
export const WorkflowMetaSchema = z
  .object({
    schema_version: z.literal('1.0'),
    name: z.string().min(1),
    description: z.string().optional(),
    states: z.array(z.string()).min(2),
    initial: z.string(),
    terminal: z.array(z.string()).default([]),
    features: FeaturesSchema,
    transitions: z.record(z.string(), z.record(z.string(), TransitionSchema)),
  })
  .refine((w) => w.states.includes(w.initial), {
    message: 'initial state must be in states[]',
    path: ['initial'],
  })
  .refine((w) => w.terminal.every((t) => w.states.includes(t)), {
    message: 'all terminal states must be in states[]',
    path: ['terminal'],
  })
  .superRefine((w, ctx) => {
    // Every transition's `to` must resolve to a declared state.
    // Without this, an author can move tasks into a phantom state
    // from which no further action is reachable.
    for (const [fromState, actions] of Object.entries(w.transitions)) {
      if (!w.states.includes(fromState)) {
        ctx.addIssue({
          code: 'custom',
          message: `transition from-state \`${fromState}\` is not in states[]`,
          path: ['transitions', fromState],
        });
      }
      for (const [action, transition] of Object.entries(actions)) {
        if (!w.states.includes(transition.to)) {
          ctx.addIssue({
            code: 'custom',
            message: `transition \`${fromState}.${action}\` points to unknown state \`${transition.to}\``,
            path: ['transitions', fromState, action, 'to'],
          });
        }
      }
    }
    // Walk every gate-field spec and check numeric bounds. Building an
    // invalid regex (min > max) silently passed before and crashed at
    // first `task move` with a raw Zod stack.
    for (const [fromState, actions] of Object.entries(w.transitions)) {
      for (const [action, transition] of Object.entries(actions)) {
        for (const [field, spec] of Object.entries(transition.requires)) {
          assertSpecBounds(spec, ctx, ['transitions', fromState, action, 'requires', field]);
        }
      }
    }
  });

function assertSpecBounds(
  spec: FieldSpec,
  ctx: z.RefinementCtx,
  prefix: readonly (string | number)[],
): void {
  if (spec.type === 'string' || spec.type === 'number' || spec.type === 'array') {
    if (spec.min !== undefined && spec.max !== undefined && spec.min > spec.max) {
      ctx.addIssue({
        code: 'custom',
        message: `${spec.type} field: min (${spec.min}) must be <= max (${spec.max})`,
        path: [...prefix, 'max'],
      });
    }
  }
  if (spec.type === 'array') {
    assertSpecBounds(spec.items, ctx, [...prefix, 'items']);
  }
  if (spec.type === 'object') {
    for (const [key, nested] of Object.entries(spec.properties)) {
      assertSpecBounds(nested, ctx, [...prefix, 'properties', key]);
    }
  }
}

/**
 * Type of a fully-validated workflow JSON document.
 */
export type WorkflowMeta = z.infer<typeof WorkflowMetaSchema>;

/**
 * Type of a single transition spec inside the meta-schema.
 */
export type TransitionMeta = z.infer<typeof TransitionSchema>;
