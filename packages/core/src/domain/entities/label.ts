/**
 * A label is a transversal tag on tasks — the cross-cutting axis that
 * epics (one axis) and sprints (another) do not capture, e.g. `area:api`
 * or `tipo:bug`. The `name` is unique and case-sensitive as entered.
 */
export interface Label {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
}

/** A label together with how many (active) tasks carry it. */
export interface LabelCount {
  readonly name: string;
  readonly count: number;
}
