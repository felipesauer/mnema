import {
  CONFIG_FILE_RELATIVE,
  ConfigInvalidError,
  ConfigLoader,
} from '@mnema/core/config/config-loader.js';
import type { Config } from '@mnema/core/config/config-schema.js';
import {
  WorkflowInvalidError,
  WorkflowNotFoundError,
} from '@mnema/core/domain/state-machine/workflow-loader.js';
import { ErrorCode } from '@mnema/core/errors/error-codes.js';
import { printError } from '@mnema/core/errors/error-printer.js';
import { type ErrorIssue, fromZodIssues } from '@mnema/core/errors/mnema-error.js';
import { IdentityNotConfiguredError } from '@mnema/core/services/integrity/identity-service.js';
import {
  createServiceContainer,
  type ServiceContainer,
} from '@mnema/core/services/service-container.js';
import { migrationsDir } from '@mnema/core/utils/asset-paths.js';
import { perfTrace } from '@mnema/core/utils/perf-trace.js';
import type { z } from 'zod';
import { listAvailableToolNames } from '../mcp/tool-registry.js';
import { resolveProjectRoot } from './project-root.js';

/**
 * Composite return value of {@link openCliContext}: the loaded config,
 * the resolved project root, and a fully-wired service container.
 */
export interface CliContext {
  readonly config: Config;
  readonly projectRoot: string;
  readonly container: ServiceContainer;
}

/**
 * Locates the nearest `mnema.config.json`, loads it, and builds a
 * service container rooted in its directory.
 *
 * Exits the process with a structured `CONFIG_NOT_FOUND` error when no
 * config can be reached from the cwd.
 *
 * @returns The opened CLI context — caller is responsible for calling
 *   `context.container.close()` when done
 */
export function openCliContext(): CliContext {
  const trace = perfTrace('openCliContext');
  const loader = new ConfigLoader();
  const configFile = loader.findConfigFile();
  if (configFile === null) {
    process.exit(printError({ kind: ErrorCode.ConfigNotFound, currentDir: process.cwd() }));
  }
  trace.mark('config file located');

  let config: Config;
  try {
    config = loader.load();
  } catch (error) {
    // An invalid config is an EXPECTED rejection, not an internal crash.
    // Left to escape, the global handler printed only "<path> is invalid /
    // hint: unexpected internal error…", hiding the precise Zod issues the
    // error already carries — route it through the structured printer, which
    // renders each issue (path + message).
    if (error instanceof ConfigInvalidError) {
      process.exit(
        printError({
          kind: ErrorCode.ConfigInvalid,
          path: CONFIG_FILE_RELATIVE,
          issues: toConfigIssues(error.issues),
        }),
      );
    }
    throw error;
  }
  trace.mark('config parsed');

  const projectRoot = resolveProjectRoot(configFile);
  let container: ServiceContainer;
  try {
    container = createServiceContainer(config, projectRoot, {
      migrationsDir: migrationsDir(),
      // Skill lint checks that a referenced tool *exists*, not that it is
      // advertised under the current profile, so validate against the full
      // catalogue (all groups enabled) plus this workflow's transition tools.
      resolveKnownTools: (workflow) =>
        listAvailableToolNames(workflow, { epics: true, sprints: true, knowledge: true }),
    });
  } catch (error) {
    // The workflow loader is the most common throw site during boot —
    // route its structured errors through the standard printer instead
    // of letting them surface as a raw Node stack trace.
    if (error instanceof WorkflowInvalidError) {
      process.exit(
        printError({
          kind: ErrorCode.WorkflowInvalid,
          path: error.path,
          issues: fromZodIssues(error.issues),
        }),
      );
    }
    if (error instanceof WorkflowNotFoundError) {
      process.exit(printError({ kind: ErrorCode.WorkflowNotFound, path: error.path }));
    }
    throw error;
  }
  trace.mark('container built');
  trace.end();

  return { config, projectRoot, container };
}

/**
 * Adapts {@link ConfigInvalidError.issues} (typed `unknown`) to the
 * {@link ErrorIssue} list the structured printer renders. Two shapes exist:
 * a Zod issue array from a failed schema parse, or the `SyntaxError` cause
 * wrapped by the loader when the file is not even valid JSON — the latter
 * becomes a single root-level issue carrying the parser's message.
 */
function toConfigIssues(issues: unknown): ErrorIssue[] {
  if (Array.isArray(issues)) return fromZodIssues(issues as z.core.$ZodIssue[]);
  const message = issues instanceof Error ? issues.message : String(issues);
  return [{ path: [], message, code: 'custom' }];
}

/**
 * Helper that opens a context, runs the handler, and guarantees the
 * SQLite handle is released even if the handler throws.
 *
 * @param handler - Async callback receiving the open CLI context
 */
export async function withCliContext(
  handler: (context: CliContext) => Promise<void> | void,
): Promise<void> {
  const context = openCliContext();
  try {
    await handler(context);
  } catch (error) {
    // A missing identity is a common first-run failure; route it through
    // the structured printer (friendly hint + Usage exit) rather than
    // letting a bare Error reach the global handler as a generic Internal.
    if (error instanceof IdentityNotConfiguredError) {
      process.exit(printError({ kind: ErrorCode.IdentityNotConfigured }));
    }
    throw error;
  } finally {
    context.container.close();
  }
}

/**
 * Variant of {@link withCliContext} that refuses to run when the
 * database has pending migrations. Used by mutating commands so a
 * developer who pulled a schema bump but forgot to run `mnema migrate`
 * cannot silently corrupt the audit trail by writing under the old
 * shape. Read-only commands keep using {@link withCliContext} — they
 * are safe even when drift exists, and reading is how the user is
 * expected to discover what is going on.
 *
 * @param handler - Async callback receiving the open CLI context
 */
export async function withMutatingCliContext(
  handler: (context: CliContext) => Promise<void> | void,
): Promise<void> {
  const context = openCliContext();
  try {
    if (context.container.pendingMigrations.length > 0) {
      const code = printError({
        kind: ErrorCode.SchemaOutOfDate,
        pending: context.container.pendingMigrations.map((m) => m.file),
      });
      context.container.close();
      process.exit(code);
    }
    await handler(context);
  } catch (error) {
    if (error instanceof IdentityNotConfiguredError) {
      process.exit(printError({ kind: ErrorCode.IdentityNotConfigured }));
    }
    throw error;
  } finally {
    context.container.close();
  }
}
