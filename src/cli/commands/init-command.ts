import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';
import pc from 'picocolors';

import type { Config } from '../../config/config-schema.js';
import { ConfigSchema } from '../../config/config-schema.js';
import { WorkflowLoader } from '../../domain/state-machine/workflow-loader.js';
import { ErrorCode } from '../../errors/error-codes.js';
import { printError } from '../../errors/error-printer.js';
import type { MnemaError } from '../../errors/mnema-error.js';
import { Err, Ok, type Result } from '../../services/result.js';
import { MigrationRunner } from '../../storage/sqlite/migration-runner.js';
import { ProjectRepository } from '../../storage/sqlite/repositories/project-repository.js';
import { SqliteAdapter } from '../../storage/sqlite/sqlite-adapter.js';
import { migrationsDir, workflowsDir } from '../../utils/asset-paths.js';
import { VERSION } from '../../utils/version.js';
import { buildAgentsMd } from '../templates/agents-md.js';

const SUPPORTED_WORKFLOWS = ['default', 'lean', 'kanban', 'jira-classic'] as const;
type WorkflowName = (typeof SUPPORTED_WORKFLOWS)[number];

interface InitOptions {
  readonly name: string;
  readonly key: string;
  readonly description?: string;
  readonly workflow?: string;
  readonly force?: boolean;
  readonly minimal?: boolean;
  readonly cwd?: string;
}

/**
 * Outcome of {@link InitCommand.run}.
 */
export interface InitOutcome {
  readonly configPath: string;
  readonly mode: 'full' | 'minimal';
  readonly conflicts: readonly string[];
}

/**
 * Registers the `mnema init` command.
 *
 * Two flavours:
 * - `init` (default) creates the full layout: config, AGENTS.md, state
 *   db with migrations, audit dir, workflow file, backlog state folders,
 *   plus `sprints/`, `roadmap/`, `memory/`, `skills/`. Workflow-specific
 *   state directories are derived from the workflow JSON, not hardcoded.
 * - `init --minimal` creates only the essentials: `mnema.config.json`,
 *   `AGENTS.md`, `.app/state.db`, `workflows/<workflow>.json`,
 *   `.audit/current.jsonl` and `.gitignore`. Adoption commands fill the
 *   rest in later.
 *
 * `init` is non-destructive by default: when conflicting paths exist it
 * lists them and aborts with `INIT_CONFLICT`. Pass `--force` to ignore.
 */
export class InitCommand {
  /**
   * Attaches the `init` subcommand to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    program
      .command('init')
      .description('Initialise a new Mnema project in the current directory')
      .requiredOption('--name <name>', 'Human-readable project name')
      .requiredOption('--key <key>', 'Project key (uppercase, 2-10 chars)')
      .option('--description <text>', 'Optional project description')
      .option('--workflow <name>', 'Workflow preset', 'default')
      .option('--force', 'Overwrite existing files when paths conflict', false)
      .option('--minimal', 'Create only the essential files; use `mnema adopt` to grow', false)
      .option('--yes', 'Run silently without confirmations (default in MVP)', true)
      .action(async (options: InitOptions) => {
        const result = this.run(options);
        if (!result.ok) {
          process.exit(printError(result.error));
        }
        const outcome = result.value;
        process.stdout.write(`${pc.green('✓')} ${outcome.configPath}\n`);
        if (outcome.mode === 'minimal') {
          process.stdout.write(
            `${pc.dim('  minimal layout — run `mnema adopt all` to add skills/memory/roadmap')}\n`,
          );
        }
      });
  }

  /**
   * Runs the init flow, returning a structured result.
   *
   * Exposed for tests so they can call the same code path the CLI uses
   * without spawning a subprocess.
   *
   * @param options - Resolved init options
   * @returns Path of the created config file or a structured error
   */
  run(options: InitOptions): Result<InitOutcome, MnemaError> {
    const cwd = options.cwd ?? process.cwd();

    const validation = validateOptions(options);
    if (!validation.ok) return validation;

    const configPath = path.join(cwd, 'mnema.config.json');
    if (existsSync(configPath) && options.force !== true) {
      return Err({ kind: ErrorCode.AlreadyInitialized, configPath });
    }

    const config = buildConfig(options, validation.value);
    const minimal = options.minimal === true;

    const conflicts = detectConflicts(cwd, config, minimal);
    if (conflicts.length > 0 && options.force !== true) {
      return Err({ kind: ErrorCode.InitConflict, path: conflicts.join(', ') });
    }

    writeJson(configPath, config);
    writeAgentsMd(cwd, config);

    const stateDir = path.join(cwd, config.paths.state);
    const auditDir = path.join(cwd, config.paths.audit);
    const workflowsDest = path.join(cwd, config.paths.workflows);

    mkdirSync(stateDir, { recursive: true });
    mkdirSync(auditDir, { recursive: true });
    mkdirSync(workflowsDest, { recursive: true });

    if (!minimal) {
      mkdirSync(path.join(cwd, config.paths.backlog), { recursive: true });
      mkdirSync(path.join(cwd, config.paths.sprints), { recursive: true });
      mkdirSync(path.join(cwd, config.paths.roadmap), { recursive: true });
      mkdirSync(path.join(cwd, config.paths.memory), { recursive: true });
      mkdirSync(path.join(cwd, config.paths.skills), { recursive: true });
    }

    appendGitignore(cwd, config.paths.state);

    const workflowSrc = path.join(workflowsDir(), `${config.workflow}.json`);
    const workflowDestFile = path.join(workflowsDest, `${config.workflow}.json`);
    if (!existsSync(workflowDestFile)) {
      copyFileSync(workflowSrc, workflowDestFile);
    }

    if (!minimal) {
      createBacklogStateDirs(cwd, config, workflowDestFile);
    }

    const dbPath = path.join(stateDir, 'state.db');
    const adapter = new SqliteAdapter(dbPath);
    try {
      new MigrationRunner().run(adapter, migrationsDir());
      const projects = new ProjectRepository(adapter);
      if (projects.findByKey(config.project.key) === null) {
        projects.insert({
          key: config.project.key,
          name: config.project.name,
          description: config.project.description ?? null,
        });
      }
    } finally {
      adapter.close();
    }

    const auditFile = path.join(auditDir, 'current.jsonl');
    if (!existsSync(auditFile)) {
      writeFileSync(auditFile, '', 'utf-8');
    }

    return Ok({ configPath, mode: minimal ? 'minimal' : 'full', conflicts });
  }
}

function validateOptions(options: InitOptions): Result<WorkflowName, MnemaError> {
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(options.key)) {
    return Err({
      kind: ErrorCode.ConfigInvalid,
      path: '<options>',
      issues: [
        {
          path: ['key'],
          message: 'must match /^[A-Z][A-Z0-9]{1,9}$/',
        },
      ],
    });
  }
  if (options.name.trim().length === 0) {
    return Err({
      kind: ErrorCode.ConfigInvalid,
      path: '<options>',
      issues: [{ path: ['name'], message: 'must not be empty' }],
    });
  }
  const wf = options.workflow ?? 'default';
  if (!SUPPORTED_WORKFLOWS.includes(wf as WorkflowName)) {
    return Err({
      kind: ErrorCode.ConfigInvalid,
      path: '<options>',
      issues: [
        {
          path: ['workflow'],
          message: `unknown workflow "${wf}"; choose one of ${SUPPORTED_WORKFLOWS.join(', ')}`,
        },
      ],
    });
  }
  return Ok(wf as WorkflowName);
}

function buildConfig(options: InitOptions, workflow: WorkflowName): Config {
  const raw = {
    version: '1.0' as const,
    mnema_version: `^${VERSION}`,
    project: {
      key: options.key,
      name: options.name,
      ...(options.description !== undefined ? { description: options.description } : {}),
    },
    workflow,
  };
  return ConfigSchema.parse(raw);
}

/**
 * Inspects the target directory and returns the relative paths that
 * already exist and would be touched by `init`.
 *
 * The minimal mode only checks paths that minimal mode actually uses;
 * full mode checks every path, including content folders such as
 * `backlog/`, `sprints/`, `memory/`, etc.
 *
 * @param cwd - Directory where the project will live
 * @param config - Resolved configuration
 * @param minimal - Whether the init is running in minimal mode
 * @returns Sorted list of relative paths that are already present
 */
function detectConflicts(cwd: string, config: Config, minimal: boolean): string[] {
  const paths = minimal
    ? [config.paths.state, config.paths.audit, config.paths.workflows, 'AGENTS.md']
    : [
        config.paths.state,
        config.paths.audit,
        config.paths.workflows,
        config.paths.backlog,
        config.paths.sprints,
        config.paths.roadmap,
        config.paths.memory,
        config.paths.skills,
        'AGENTS.md',
      ];
  return paths.filter((p) => existsSync(path.join(cwd, p))).sort();
}

function writeJson(filePath: string, data: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

function writeAgentsMd(cwd: string, config: Config): void {
  const file = path.join(cwd, 'AGENTS.md');
  if (existsSync(file)) return;
  writeFileSync(file, buildAgentsMd(config), 'utf-8');
}

function appendGitignore(cwd: string, statePath: string): void {
  const file = path.join(cwd, '.gitignore');
  const entry = `${statePath.replace(/\/$/, '')}/`;
  if (!existsSync(file)) {
    writeFileSync(file, `# mnema\n${entry}\n`, 'utf-8');
    return;
  }
  const current = readFileSync(file, 'utf-8');
  if (current.includes(entry)) return;
  appendFileSync(file, `\n# mnema\n${entry}\n`, 'utf-8');
}

/**
 * Creates one folder per workflow state under `backlog/`, derived from
 * the active workflow's `states` array. This keeps the backlog layout
 * in lockstep with the workflow JSON so users editing the workflow get
 * matching directories on next `mnema sync` (or manual init).
 */
function createBacklogStateDirs(cwd: string, config: Config, workflowFile: string): void {
  const workflow = new WorkflowLoader().load(workflowFile);
  const root = path.join(cwd, config.paths.backlog);
  for (const state of workflow.states) {
    mkdirSync(path.join(root, state), { recursive: true });
  }
}

// Re-export for tests
export const _internal = { validateOptions, buildConfig, detectConflicts };
