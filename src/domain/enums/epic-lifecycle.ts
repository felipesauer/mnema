/**
 * Derived lifecycle of an epic — NOT a stored state.
 *
 * Computed from the epic's `state` (OPEN/CLOSED) plus the progress of
 * its tasks, so it always reflects reality without a column that could
 * drift. See MNEMA-ADR-24.
 *
 * - `closed`      — the epic's state is CLOSED.
 * - `empty`       — OPEN, with no tasks attached.
 * - `in-progress` — OPEN, has tasks, not all in a terminal state.
 * - `developed`   — OPEN, every task in a terminal state (ready to close).
 */
export type EpicLifecycle = 'closed' | 'empty' | 'in-progress' | 'developed';
