import { readFileSync } from 'node:fs';
import type { z } from 'zod';

import { jsonRequiresToZod } from './json-requires-to-zod.js';
import type { Transition, Workflow, WorkflowFeatures } from './state-machine.js';
import { type WorkflowMeta, WorkflowMetaSchema } from './workflow-meta-schema.js';

/**
 * Thrown when a workflow JSON file cannot be located.
 */
export class WorkflowNotFoundError extends Error {
  constructor(public readonly path: string) {
    super(`workflow file not found: ${path}`);
    this.name = 'WorkflowNotFoundError';
  }
}

/**
 * Thrown when a workflow JSON exists but violates the meta-schema.
 *
 * The {@link issues} field carries the raw Zod issues; callers can
 * format them with {@link formatWorkflowIssues} for user-facing output.
 */
export class WorkflowInvalidError extends Error {
  constructor(
    public readonly path: string,
    public readonly issues: readonly z.core.$ZodIssue[],
  ) {
    super(`workflow file is invalid: ${path}`);
    this.name = 'WorkflowInvalidError';
  }
}

/**
 * Loads workflow JSON files from disk and produces ready-to-use
 * {@link Workflow} objects with compiled gate schemas.
 */
export class WorkflowLoader {
  /**
   * Loads a workflow JSON file, validates it against the meta-schema and
   * compiles each transition's `requires` block into a Zod object.
   *
   * @param path - Absolute or relative path to the workflow JSON file
   * @returns Fully-loaded workflow with compiled gate schemas
   * @throws WorkflowNotFoundError if the file cannot be read
   * @throws WorkflowInvalidError if the content violates the meta-schema
   */
  load(path: string): Workflow {
    let raw: string;
    try {
      raw = readFileSync(path, 'utf-8');
    } catch {
      throw new WorkflowNotFoundError(path);
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (error) {
      // Reuse the WorkflowInvalidError shape so a syntactically broken
      // workflow surfaces through the same error printer as a
      // schema-invalid one. The single fake issue points at <root> and
      // carries the parser's `line N column M` text.
      const message = error instanceof Error ? error.message : 'invalid JSON';
      throw new WorkflowInvalidError(path, [
        {
          code: 'custom',
          path: [],
          message: `JSON parse error: ${message}`,
          input: raw,
        } as z.core.$ZodIssue,
      ]);
    }
    const parsed = WorkflowMetaSchema.safeParse(json);
    if (!parsed.success) {
      throw new WorkflowInvalidError(path, parsed.error.issues);
    }

    return this.compile(parsed.data);
  }

  /**
   * Compiles a validated workflow meta document into the runtime
   * {@link Workflow} shape consumed by {@link StateMachine}.
   *
   * @param meta - Workflow document already validated by the meta-schema
   * @returns Compiled workflow with Zod gate schemas
   */
  compile(meta: WorkflowMeta): Workflow {
    const transitions: Record<string, Record<string, Transition>> = {};
    for (const [from, actions] of Object.entries(meta.transitions)) {
      const actionMap: Record<string, Transition> = {};
      for (const [action, def] of Object.entries(actions)) {
        actionMap[action] = {
          to: def.to,
          description: def.description,
          useWhen: def.use_when,
          requires: jsonRequiresToZod(def.requires),
          requiresSpec: def.requires,
        };
      }
      transitions[from] = actionMap;
    }

    const features: WorkflowFeatures = {
      sprints: meta.features.sprints,
      epics: meta.features.epics,
      reviewWorkflow: meta.features.review_workflow,
      blockedState: meta.features.blocked_state,
    };

    return {
      name: meta.name,
      description: meta.description ?? null,
      states: meta.states,
      initial: meta.initial,
      terminal: meta.terminal,
      features,
      transitions,
    };
  }
}

/**
 * Formats Zod issues from a workflow validation failure into a
 * human-readable multi-line message.
 *
 * @param path - Path that was being loaded (for the header)
 * @param issues - Issues collected from the failed validation
 * @returns Multi-line string suitable for terminal output
 */
export function formatWorkflowIssues(path: string, issues: readonly z.core.$ZodIssue[]): string {
  const lines = [`${path} is invalid:`];
  for (const issue of issues) {
    const where = issue.path.length > 0 ? issue.path.join('.') : '<root>';
    lines.push(`  ${where}: ${issue.message}`);
  }
  return lines.join('\n');
}
