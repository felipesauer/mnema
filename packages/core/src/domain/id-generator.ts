import { v7 } from 'uuid';

/**
 * Parsed components of a task key.
 */
export interface ParsedTaskKey {
  readonly projectKey: string;
  readonly sequence: number;
}

/**
 * Generates a sortable UUID v7 (time-ordered).
 *
 * @returns A UUID v7 string in canonical form
 */
export function generateUuid(): string {
  return v7();
}

/**
 * Constructs a human-readable task key.
 *
 * @param projectKey - Uppercase project prefix (e.g., "WEBAPP")
 * @param sequence - Sequential number for the task
 * @returns Task key in the format "PROJECT-N"
 */
export function generateTaskKey(projectKey: string, sequence: number): string {
  return `${projectKey}-${sequence}`;
}

/**
 * Parses a task key into its components.
 *
 * @param key - Task key string (e.g., "WEBAPP-42")
 * @returns Parsed components, or null if the format is invalid
 */
export function parseTaskKey(key: string): ParsedTaskKey | null {
  const match = key.match(/^([A-Z][A-Z0-9]*)-(\d+)$/);
  if (match === null) return null;
  const projectKey = match[1];
  const sequenceStr = match[2];
  if (projectKey === undefined || sequenceStr === undefined) return null;
  return {
    projectKey,
    sequence: Number.parseInt(sequenceStr, 10),
  };
}
