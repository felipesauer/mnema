import { v7 } from 'uuid';

/**
 * Generates a sortable UUID v7 (time-ordered). This is the sole identity a
 * task, epic, and sprint carries — there is no human key to construct.
 *
 * @returns A UUID v7 string in canonical form
 */
export function generateUuid(): string {
  return v7();
}
