/**
 * Lifecycle state of a Sprint.
 */
export enum SprintState {
  Planned = 'PLANNED',
  Active = 'ACTIVE',
  Closed = 'CLOSED',
  /**
   * Retired without completing — a planned sprint that was superseded, or an
   * active one abandoned. Terminal, like {@link Closed}, but distinct so it
   * does not read as "finished". Reached via `sprint cancel`.
   */
  Canceled = 'CANCELED',
}
