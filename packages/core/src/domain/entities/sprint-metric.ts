/**
 * A measurable target attached to a sprint — turns a free-text goal into
 * something you can check off objectively.
 *
 * `target` is required (a metric with no target is not measurable);
 * `baseline`, `unit` and `dueDate` are optional context.
 */
export interface SprintMetric {
  readonly id: string;
  readonly sprintId: string;
  readonly name: string;
  readonly baseline: number | null;
  readonly target: number;
  readonly unit: string | null;
  readonly dueDate: string | null;
  readonly createdAt: string;
}
