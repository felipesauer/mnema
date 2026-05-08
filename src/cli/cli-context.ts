import { ConfigLoader } from '../config/config-loader.js';
import type { Config } from '../config/config-schema.js';
import { ErrorCode } from '../errors/error-codes.js';
import { printError } from '../errors/error-printer.js';
import { createServiceContainer, type ServiceContainer } from '../services/service-container.js';
import { migrationsDir } from '../utils/asset-paths.js';
import { perfTrace } from '../utils/perf-trace.js';
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

  const config = loader.load();
  trace.mark('config parsed');

  const projectRoot = resolveProjectRoot(configFile);
  const container = createServiceContainer(config, projectRoot, {
    migrationsDir: migrationsDir(),
  });
  trace.mark('container built');
  trace.end();

  return { config, projectRoot, container };
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
  } finally {
    context.container.close();
  }
}
