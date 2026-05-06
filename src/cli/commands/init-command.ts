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
import { ErrorCode, ExitCode } from '../../errors/error-codes.js';
import { printError } from '../../errors/error-printer.js';
import type { MnemaError } from '../../errors/mnema-error.js';
import { Err, Ok, type Result } from '../../services/result.js';
import { MigrationRunner } from '../../storage/sqlite/migration-runner.js';
import { ProjectRepository } from '../../storage/sqlite/repositories/project-repository.js';
import { SqliteAdapter } from '../../storage/sqlite/sqlite-adapter.js';
import { migrationsDir, workflowsDir } from '../../utils/asset-paths.js';
import { VERSION } from '../../utils/version.js';

const SUPPORTED_WORKFLOWS = ['default', 'lean', 'kanban', 'jira-classic'] as const;
type WorkflowName = (typeof SUPPORTED_WORKFLOWS)[number];

interface InitOptions {
  readonly name: string;
  readonly key: string;
  readonly description?: string;
  readonly workflow?: string;
  readonly force?: boolean;
  readonly cwd?: string;
}

/**
 * Registers the `mnema init` command on the given Commander program.
 *
 * The MVP implementation is silent-mode only: every required field is
 * passed via flags. The interactive wizard is scheduled for Phase 8.
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
      .option('--force', 'Overwrite an existing mnema.config.json', false)
      .option('--yes', 'Run silently without confirmations (default in MVP)', true)
      .action(async (options: InitOptions) => {
        const result = this.run(options);
        if (!result.ok) {
          process.exit(printError(result.error));
        }
        const { configPath } = result.value;
        process.stdout.write(`${pc.green('✓')} ${configPath}\n`);
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
  run(options: InitOptions): Result<{ configPath: string }, MnemaError> {
    const cwd = options.cwd ?? process.cwd();

    const validation = validateOptions(options);
    if (!validation.ok) return validation;

    const configPath = path.join(cwd, 'mnema.config.json');
    if (existsSync(configPath) && options.force !== true) {
      return Err({ kind: ErrorCode.AlreadyInitialized, configPath });
    }

    const config = buildConfig(options, validation.value);

    writeJson(configPath, config);
    writeAgentsMd(cwd, config);

    const stateDir = path.join(cwd, config.paths.state);
    const auditDir = path.join(cwd, config.paths.audit);
    const backlogDir = path.join(cwd, config.paths.backlog);
    const sprintsDir = path.join(cwd, config.paths.sprints);
    const roadmapDir = path.join(cwd, config.paths.roadmap);
    const memoryDir = path.join(cwd, config.paths.memory);
    const skillsDir = path.join(cwd, config.paths.skills);
    const workflowsDest = path.join(cwd, config.paths.workflows);

    for (const dir of [
      stateDir,
      auditDir,
      backlogDir,
      sprintsDir,
      roadmapDir,
      memoryDir,
      skillsDir,
      workflowsDest,
    ]) {
      mkdirSync(dir, { recursive: true });
    }
    for (const state of config.workflow === 'default'
      ? ['DRAFT', 'READY', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE', 'CANCELED']
      : []) {
      mkdirSync(path.join(backlogDir, state), { recursive: true });
    }

    appendGitignore(cwd, config.paths.state);

    const workflowSrc = path.join(workflowsDir(), `${config.workflow}.json`);
    const workflowDestFile = path.join(workflowsDest, `${config.workflow}.json`);
    if (!existsSync(workflowDestFile)) {
      copyFileSync(workflowSrc, workflowDestFile);
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

    return Ok({ configPath });
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

function writeJson(filePath: string, data: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

function writeAgentsMd(cwd: string, config: Config): void {
  const file = path.join(cwd, 'AGENTS.md');
  if (existsSync(file)) return;

  const body =
    `# AGENTS.md\n\n` +
    `Project: **${config.project.name}** (\`${config.project.key}\`)\n\n` +
    `This Mnema project is managed by the \`@saurim/mnema\` MCP server.\n\n` +
    `## Workflow\n\n` +
    `Active workflow: \`${config.workflow}\`. See \`workflows/${config.workflow}.json\` ` +
    `for the full state machine.\n\n` +
    `## Operating principles\n\n` +
    `1. Start a session with the \`context_bootstrap\` tool.\n` +
    `2. Wrap mutations in \`agent_run_start\` / \`agent_run_end\`.\n` +
    `3. Prefer transition tools (e.g. \`task_submit\`) over raw updates.\n`;

  writeFileSync(file, body, 'utf-8');
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

// Re-export for tests
export const _internal = { validateOptions, buildConfig };

// Avoid TS unused-export warning when the helper is only used in tests.
void ExitCode;
