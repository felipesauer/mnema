/**
 * The directions a reference walk may take, as the surface accepts them.
 *
 * One tuple, read by two things that must agree: the flag's HELP (`mnema refs
 * --direction`) and the adapter's GUARD, which turns anything else into an honest
 * refusal. They lived together in the adapter, and the help read it from there —
 * which meant declaring one flag loaded the walk, the projections and the whole
 * domain behind them, on every invocation of every verb, to print three words.
 *
 * So the tuple lives HERE, where nothing else does. This module imports one TYPE and
 * no value, which is what makes it free to load: the set stays single, and the floor
 * a person waits for stays the declaration (see `wiring/verb.ts`).
 */

import type { ReferenceDirection } from '@mnema/copilot';

/** The directions a walk may take, as the surface accepts them. */
export const REFERENCE_DIRECTIONS: readonly ReferenceDirection[] = ['both', 'out', 'in'];

/** Whether `value` names a direction — the surface's guard. */
export function isReferenceDirection(value: string): value is ReferenceDirection {
  return (REFERENCE_DIRECTIONS as readonly string[]).includes(value);
}
