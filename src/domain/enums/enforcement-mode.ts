/**
 * How strict the workflow gates are enforced.
 *
 * - `Advisory`: gate failures are reported but the transition is allowed.
 * - `Strict`: gate failures block the transition for agents but humans may override.
 * - `Blocking`: gate failures always block the transition.
 */
export enum EnforcementMode {
  Advisory = 'advisory',
  Strict = 'strict',
  Blocking = 'blocking',
}
