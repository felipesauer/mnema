import { readFileSync } from 'node:fs';
import type { Workflow } from '../domain/state-machine/state-machine.js';
import { WorkflowLoader, WorkflowNotFoundError } from '../domain/state-machine/workflow-loader.js';

/**
 * Reads a workflow JSON file and compiles it. This is the disk-touching
 * seam kept OUT of the domain: {@link WorkflowLoader} is a pure unit that
 * takes already-read text, so the `node:fs` read lives here in storage/.
 *
 * @param path - Absolute or relative path to the workflow JSON file
 * @returns Fully-loaded workflow with compiled gate schemas
 * @throws WorkflowNotFoundError if the file cannot be read
 * @throws WorkflowInvalidError if the content violates the meta-schema
 */
export function loadWorkflowFile(path: string): Workflow {
  let contents: string;
  try {
    contents = readFileSync(path, 'utf-8');
  } catch {
    throw new WorkflowNotFoundError(path);
  }
  return new WorkflowLoader().load(contents, path);
}
