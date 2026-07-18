import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pc } from '@mnema/core/utils/colors.js';
import type { Command } from 'commander';

// `@inquirer/prompts` is loaded lazily inside `resolveOptions` —
// silent runs (`--yes` or all flags supplied) never pay the cost,
// and `mnema --version` / `mnema task ...` never touch it at all.

import { Err, Ok, type Result } from '@mnema/core/common/result.js';
import { CONFIG_FILE_RELATIVE } from '@mnema/core/config/config-loader.js';
import type { Config } from '@mnema/core/config/config-schema.js';
import { ConfigSchema } from '@mnema/core/config/config-schema.js';
import { ErrorCode } from '@mnema/core/errors/error-codes.js';
import { printError } from '@mnema/core/errors/error-printer.js';
import type { MnemaError } from '@mnema/core/errors/mnema-error.js';
import { AuditService } from '@mnema/core/services/integrity/audit-service.js';
import { IdentityService } from '@mnema/core/services/integrity/identity-service.js';
import { localTailDir } from '@mnema/core/services/integrity/machine-id.js';
import { ProjectSecretService } from '@mnema/core/services/integrity/project-secret.js';
import { AdoptionService } from '@mnema/core/services/knowledge/adoption-service.js';
import { SkillService } from '@mnema/core/services/knowledge/skill-service.js';
import { userKnowledgeDir } from '@mnema/core/services/knowledge/user-knowledge.js';
import { AuditWriter } from '@mnema/core/storage/audit/audit-writer.js';
import { MigrationRunner } from '@mnema/core/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@mnema/core/storage/sqlite/repositories/actor-repository.js';
import { AuditStateRepository } from '@mnema/core/storage/sqlite/repositories/audit-state-repository.js';
import { ProjectRepository } from '@mnema/core/storage/sqlite/repositories/project-repository.js';
import { SkillRepository } from '@mnema/core/storage/sqlite/repositories/skill-repository.js';
import { SqliteAdapter } from '@mnema/core/storage/sqlite/sqlite-adapter.js';
import { loadWorkflowFile } from '@mnema/core/storage/workflow-file.js';
import { migrationsDir, workflowsDir } from '@mnema/core/utils/asset-paths.js';
import { ensureGitattributes } from '@mnema/core/utils/gitattributes.js';
import { ensureGitignore } from '@mnema/core/utils/gitignore.js';
import { LAYOUT } from '@mnema/core/utils/layout.js';
import { VERSION } from '@mnema/core/utils/version.js';
import { isPromptAbort } from '../prompt-helpers.js';
import { writeAgentsMd } from '../templates/agents-md.js';
import { writeMnemaReadme } from '../templates/mnema-readme.js';

const SUPPORTED_PROFILES = ['full', 'audit-only'] as const;
type ProfileName = (typeof SUPPORTED_PROFILES)[number];

interface InitOptions {
  readonly name?: string;
  readonly key?: string;
  readonly description?: string;
  readonly profile?: string;
  readonly force?: boolean;
  readonly minimal?: boolean;
  readonly yes?: boolean;
  readonly cwd?: string;
}

/**
 * Resolved options after the wizard (or pure flag mode) — every field
 * required by {@link InitCommand.run} is populated.
 */
interface ResolvedInitOptions {
  readonly name: string;
  readonly key: string;
  readonly description?: string;
  /** Surface profile; defaults to `full` when omitted. */
  readonly profile?: ProfileName;
  readonly force: boolean;
  readonly minimal: boolean;
  readonly cwd?: string;
}

/**
 * Outcome of {@link InitCommand.run}.
 */
export interface InitOutcome {
  readonly configPath: string;
  readonly mode: 'full' | 'minimal';
  /**
   * Whether a default human identity is already resolvable (via
   * `MNEMA_ACTOR` or `~/.config/mnema/identity.json`). When false, init
   * points the user at `mnema identity set`, since every mutation needs
   * an actor and its absence is the most common first-run failure.
   */
  readonly identityConfigured: boolean;
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
 *   `AGENTS.md`, `.app/state.db`, `workflows/<workflow>.json`, this machine's
 *   audit tail (`audit/m-<id>/current.jsonl`) and `.gitignore`. Adoption
 *   commands fill the rest in later.
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
      .option('--name <name>', 'Human-readable project name')
      .option('--key <key>', 'Project key (uppercase, 2-10 chars)')
      .option('--description <text>', 'Optional project description')
      .option(
        '--profile <name>',
        'Surface profile: full (default) | audit-only (core audit + tasks; no epics/sprints/knowledge)',
      )
      .option('--force', 'Overwrite existing files when paths conflict', false)
      .option('--minimal', 'Create only the essential files; use `mnema adopt` to grow', false)
      .option('--yes', 'Skip the wizard; requires --name and --key', false)
      .action(async (options: InitOptions) => {
        let resolved: ResolvedInitOptions | null;
        try {
          resolved = await resolveOptions(options);
        } catch (error) {
          if (isPromptAbort(error)) {
            process.stdout.write(`${pc.dim('aborted')}\n`);
            return;
          }
          throw error;
        }
        if (resolved === null) {
          process.stdout.write(`${pc.dim('aborted')}\n`);
          return;
        }
        const result = this.run(resolved);
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
        // Every mutation needs a human actor; a fresh machine has none, and
        // the failure is otherwise only discovered on the first write. Point
        // the user at it now as an explicit next step.
        if (!outcome.identityConfigured) {
          process.stdout.write(
            `${pc.dim('  next: set your identity — `mnema identity set <handle>` (or export MNEMA_ACTOR) before your first change')}\n`,
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
   * @param options - Resolved init options (every required field set)
   * @returns Path of the created config file or a structured error
   */
  run(options: ResolvedInitOptions): Result<InitOutcome, MnemaError> {
    const cwd = options.cwd ?? process.cwd();

    const validation = validateOptions(options);
    if (!validation.ok) return validation;

    const configPath = path.join(cwd, CONFIG_FILE_RELATIVE);
    if (existsSync(configPath) && options.force !== true) {
      return Err({ kind: ErrorCode.AlreadyInitialized, configPath });
    }

    const config = buildConfig(options);
    const minimal = options.minimal === true;

    // Note: there is no separate conflict-detection pass. Every write
    // below is idempotent — the AGENTS.md merge preserves whatever
    // content the user already had, the workflow JSON copy guards
    // `existsSync`, and the markdown directories are created with
    // `mkdirSync({ recursive: true })`. The single ownership claim is
    // `.mnema/mnema.config.json`, gated above with AlreadyInitialized.

    mkdirSync(path.dirname(configPath), { recursive: true });
    writeJson(configPath, config);

    const stateDir = path.join(cwd, LAYOUT.state);
    const auditDir = path.join(cwd, LAYOUT.audit);
    const tailDir = localTailDir(auditDir, userKnowledgeDir());
    const workflowsDest = path.join(cwd, LAYOUT.workflows);

    mkdirSync(stateDir, { recursive: true });
    mkdirSync(auditDir, { recursive: true });
    mkdirSync(workflowsDest, { recursive: true });
    // The backlog is essential in BOTH modes: `doctor` requires it
    // unconditionally, and the first `task create` would make it anyway — a
    // minimal init that immediately fails its own health check is a trap.
    mkdirSync(path.join(cwd, LAYOUT.backlog), { recursive: true });

    if (!minimal) {
      mkdirSync(path.join(cwd, LAYOUT.sprints), { recursive: true });
      mkdirSync(path.join(cwd, LAYOUT.roadmap), { recursive: true });
      mkdirSync(path.join(cwd, LAYOUT.memory), { recursive: true });
      mkdirSync(path.join(cwd, LAYOUT.observations), { recursive: true });
      mkdirSync(path.join(cwd, LAYOUT.skills), { recursive: true });
      mkdirSync(path.join(cwd, LAYOUT.commands), { recursive: true });
      mkdirSync(path.join(cwd, LAYOUT.templates), { recursive: true });
    }

    ensureGitignore(cwd, LAYOUT.state, LAYOUT.audit);
    ensureGitattributes(cwd, LAYOUT.audit);

    const workflowSrc = path.join(workflowsDir(), 'default.json');
    const workflowDestFile = path.join(workflowsDest, 'default.json');
    // Only copy when src and dest differ. The dogfood-on-self setup
    // resolves workflowsDir() and paths.workflows to the same on-disk
    // path; in that case the file is already in place (or genuinely
    // missing) and `copyFileSync` would either no-op or fail with
    // ENOENT against itself.
    if (path.resolve(workflowSrc) !== path.resolve(workflowDestFile)) {
      if (!existsSync(workflowDestFile)) {
        copyFileSync(workflowSrc, workflowDestFile);
      }
    }

    if (!minimal) {
      createBacklogStateDirs(cwd, workflowDestFile);
      // Seed the example skills at init, not only via `mnema adopt skills`
      // (which agents skip — the report's "skills born empty, stay empty").
      // Reuses the exact adopt content, so there is a single source and the
      // write is idempotent. --minimal skips this and keeps skills/ empty.
      const adoption = new AdoptionService(cwd);
      adoption.adopt('skills');
      // Seed the slash commands too, so `.mnema/commands/` is not born empty
      // (the shortcut that makes the tool get used). Commands are pure files
      // with no SQLite row, so — unlike skills — they need no import step.
      adoption.adopt('commands');
      // Seed the task templates so `templates/<kind>.md` exist and are
      // overridable; task_create --template falls back to the built-ins when
      // a file is absent, so this is discoverability, not a hard dependency.
      adoption.adopt('templates');
      // Seed memory/ (INDEX.md, context.md) so AGENTS.md can embed the memory
      // index on this first write instead of rendering a "skipped — file not
      // found" note that a later `agents sync` would silently fix.
      adoption.adopt('memory');
    }

    // AGENTS.md is written AFTER the adopts so its `@memory/INDEX.md` import
    // resolves in one pass. In --minimal there are no adopts and no memory
    // dir, so the import correctly degrades to "skipped" until `mnema adopt`.
    writeAgentsMd(cwd, config);

    // A committed source-of-truth map inside `.mnema/` — it travels with a
    // clone (the top-level README does not), so a teammate who opens the dir
    // can tell record from cache from public-key material. Non-destructive.
    writeMnemaReadme(cwd);

    const dbPath = path.join(stateDir, 'state.db');
    const adapter = new SqliteAdapter(dbPath);
    let identityConfigured = false;
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
      // resolveDefaultActor never throws and reads only env + the user
      // identity file, so it is safe to probe here purely to decide
      // whether init should nudge the user to set their identity.
      const identity = new IdentityService(new ActorRepository(adapter));
      identityConfigured = identity.resolveDefaultActor().actor !== null;

      // Record the seed skills as SQLite rows (the files were written above).
      // Without rows they read as orphan mirrors and `mnema upgrade` would
      // prune them — so seeding must reach the DB, not just the filesystem.
      // Attributed to a fixed `system` actor, never the human's identity:
      // these skills are shipped by the tool, not authored by the user, so
      // the trail should say so (and init must not create a user actor row
      // as a side effect).
      if (!minimal) {
        // Seed events enter the REAL chain, HMAC-keyed: mint the project
        // secret and write through the chained+mirrored writer, so a fresh
        // `init` produces a keyed chain from its very first line. Writes land
        // in this machine's tail (`audit/m-<id>/`), the same directory every
        // later write and the aggregating readers use.
        const secret = new ProjectSecretService(cwd, options.key);
        new SkillService(
          path.join(cwd, LAYOUT.skills),
          new Set(),
          new SkillRepository(adapter),
          identity,
          new AuditService(
            new AuditWriter(tailDir, new AuditStateRepository(adapter), () => secret.getOrCreate()),
          ),
        ).importSeeds('system');
      }
    } finally {
      adapter.close();
    }

    const auditFile = path.join(tailDir, 'current.jsonl');
    if (!existsSync(auditFile)) {
      mkdirSync(tailDir, { recursive: true });
      writeFileSync(auditFile, '', 'utf-8');
    }

    return Ok({ configPath, mode: minimal ? 'minimal' : 'full', identityConfigured });
  }
}

function validateOptions(options: ResolvedInitOptions): Result<undefined, MnemaError> {
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
  return Ok(undefined);
}

function buildConfig(options: ResolvedInitOptions): Config {
  const raw = {
    version: '1.0' as const,
    mnema_version: `^${VERSION}`,
    project: {
      key: options.key,
      name: options.name,
      ...(options.description !== undefined ? { description: options.description } : {}),
    },
    // audit-only trims the advertised surface to the core: the knowledge
    // group (decisions/skills/memories/observations) is turned off here.
    // Re-enable later by flipping the flag.
    ...(options.profile === 'audit-only' ? { features: { knowledge: false } } : {}),
  };
  return ConfigSchema.parse(raw);
}

function writeJson(filePath: string, data: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

/**
 * Creates one folder per workflow state under `backlog/`, derived from
 * the active workflow's `states` array. This keeps the backlog layout
 * in lockstep with the workflow JSON so users editing the workflow get
 * matching directories on next `mnema sync` (or manual init).
 */
function createBacklogStateDirs(cwd: string, workflowFile: string): void {
  const workflow = loadWorkflowFile(workflowFile);
  const root = path.join(cwd, LAYOUT.backlog);
  for (const state of workflow.states) {
    mkdirSync(path.join(root, state), { recursive: true });
  }
}

/**
 * Resolves init options into a fully populated set, falling back to a
 * Q&A wizard when required fields are missing.
 *
 * Behaviour:
 * - When `--yes` is set, skips the wizard. Caller must supply name and
 *   key via flags; otherwise returns `null` (the action prints "aborted"
 *   and exits cleanly).
 * - When `--name` and `--key` are both present, runs in silent mode
 *   (matches the pre-wizard behaviour for scripts and CI).
 * - Otherwise prompts for the missing pieces. Re-uses any flag the user
 *   already passed as the prompt default.
 *
 * @param options - Raw flag input from Commander
 * @returns Resolved options or `null` when the wizard is aborted
 */
/**
 * Normalises the `--profile` flag, exiting with a usage error on an
 * unknown value. Defaults to `full`.
 */
function resolveProfile(raw: string | undefined): ProfileName {
  if (raw === undefined) return 'full';
  if (!SUPPORTED_PROFILES.includes(raw as ProfileName)) {
    process.stderr.write(
      `${pc.red('error:')} unknown profile "${raw}"; choose one of ${SUPPORTED_PROFILES.join(', ')}\n`,
    );
    process.exit(2);
  }
  return raw as ProfileName;
}

async function resolveOptions(options: InitOptions): Promise<ResolvedInitOptions | null> {
  const profile = resolveProfile(options.profile);

  if (options.yes === true) {
    if (options.name === undefined || options.key === undefined) {
      process.stderr.write(`${pc.red('error:')} --yes requires --name and --key\n`);
      process.exit(2);
    }
    return {
      name: options.name,
      key: options.key,
      description: options.description,
      profile,
      force: options.force === true,
      minimal: options.minimal === true,
      cwd: options.cwd,
    };
  }

  // Silent path when both required flags are provided.
  if (options.name !== undefined && options.key !== undefined) {
    return {
      name: options.name,
      key: options.key,
      description: options.description,
      profile,
      force: options.force === true,
      minimal: options.minimal === true,
      cwd: options.cwd,
    };
  }

  process.stdout.write(`${pc.bold('Mnema init')} — answer a few questions to bootstrap.\n\n`);

  // Lazy: silent paths above never touch @inquirer/prompts.
  const { confirm, input } = await import('@inquirer/prompts');

  const name = await input({
    message: 'Project name',
    default: options.name,
    validate: (value) => (value.trim().length === 0 ? 'must not be empty' : true),
  });

  const key = await input({
    message: 'Project key (uppercase letters and digits, 2-10 chars)',
    default: options.key ?? deriveKey(name),
    validate: (value) =>
      /^[A-Z][A-Z0-9]{1,9}$/.test(value)
        ? true
        : 'must match /^[A-Z][A-Z0-9]{1,9}$/ (e.g. WEBAPP, MYAPP1)',
  });

  const description =
    options.description ??
    (await input({
      message: 'Description (optional, press enter to skip)',
      default: '',
    }));

  const minimal =
    options.minimal === true
      ? true
      : await confirm({
          message: 'Minimal layout? (skills/memory/roadmap added later via `mnema adopt`)',
          default: false,
        });

  return {
    name,
    key,
    description: description.trim().length > 0 ? description : undefined,
    profile,
    force: options.force === true,
    minimal,
    cwd: options.cwd,
  };
}

/**
 * Derives a candidate project key from a free-text name. Picks the
 * first 6 alphanumeric chars, uppercased; returns `undefined` when no
 * valid prefix can be extracted (the wizard will then ask without a
 * default).
 */
function deriveKey(name: string): string | undefined {
  const cleaned = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(cleaned)) return undefined;
  return cleaned;
}

// Re-export for tests
export const _internal = {
  validateOptions,
  buildConfig,
  deriveKey,
};
