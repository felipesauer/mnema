/**
 * Project entity — root of all other entities.
 */
export interface Project {
  readonly id: string;
  /** Uppercase prefix used in human keys, e.g. `"WEBAPP"` */
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly config: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly deletedAt: string | null;
}
