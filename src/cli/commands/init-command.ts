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
import { pc } from '../../utils/colors.js';

// `@inquirer/prompts` is loaded lazily inside `resolveOptions` —
// silent runs (`--yes` or all flags supplied) never pay the cost,
// and `mnema --version` / `mnema task ...` never touch it at all.

import { CONFIG_FILE_RELATIVE } from '../../config/config-loader.js';
import type { Config } from '../../config/config-schema.js';
import { ConfigSchema } from '../../config/config-schema.js';
import { WorkflowLoader } from '../../domain/state-machine/workflow-loader.js';
import { ErrorCode } from '../../errors/error-codes.js';
import { printError } from '../../errors/error-printer.js';
import type { MnemaError } from '../../errors/mnema-error.js';
import { AdoptionService } from '../../services/adoption-service.js';
import { AuditService } from '../../services/audit-service.js';
import { IdentityService } from '../../services/identity-service.js';
import { Err, Ok, type Result } from '../../services/result.js';
import { SkillService } from '../../services/skill-service.js';
import { AuditWriter } from '../../storage/audit/audit-writer.js';
import { MigrationRunner } from '../../storage/sqlite/migration-runner.js';
import { ActorRepository } from '../../storage/sqlite/repositories/actor-repository.js';
import { ProjectRepository } from '../../storage/sqlite/repositories/project-repository.js';
import { SkillRepository } from '../../storage/sqlite/repositories/skill-repository.js';
import { SqliteAdapter } from '../../storage/sqlite/sqlite-adapter.js';
import { migrationDirs, workflowsDir } from '../../utils/asset-paths.js';
import { ensureGitattributes } from '../../utils/gitattributes.js';
import { VERSION } from '../../utils/version.js';
import { isPromptAbort } from '../prompt-helpers.js';
import { writeAgentsMd } from '../templates/agents-md.js';

const SUPPORTED_WORKFLOWS = ['default', 'lean', 'kanban', 'jira-classic'] as const;
type WorkflowName = (typeof SUPPORTED_WORKFLOWS)[number];

/**
 * Reads the ordered `states` array from a bundled workflow's JSON. The
 * wizard shows these to the user, so they must be sourced from the same
 * file `init` actually copies — hard-coded label strings silently drift
 * from the JSON (they had, for every preset). Kept deliberately small:
 * the full {@link WorkflowLoader} pulls in Zod compilation we do not need
 * just to list state names.
 */
function workflowStates(name: WorkflowName): readonly string[] {
  const raw = readFileSync(path.join(workflowsDir(), `${name}.json`), 'utf-8');
  const states = (JSON.parse(raw) as { states?: unknown }).states;
  if (!Array.isArray(states) || !states.every((s): s is string => typeof s === 'string')) {
    throw new Error(`workflow ${name}.json has no string[] states array`);
  }
  return states;
}

/**
 * Builds the wizard's workflow-preset choices, deriving each state list
 * from its JSON via {@link workflowStates}. Iterating
 * {@link SUPPORTED_WORKFLOWS} means a future preset is covered the moment
 * its file ships — nothing to keep in sync by hand.
 */
function buildWorkflowChoices(): { name: string; value: WorkflowName }[] {
  return SUPPORTED_WORKFLOWS.map((name) => ({
    name: `${name} — ${workflowStates(name).join('/')}`,
    value: name,
  }));
}

const SUPPORTED_PROFILES = ['full', 'audit-only'] as const;
type ProfileName = (typeof SUPPORTED_PROFILES)[number];

interface InitOptions {
  readonly name?: string;
  readonly key?: string;
  readonly description?: string;
  readonly workflow?: string;
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
  readonly workflow: string;
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
      .option('--name <name>', 'Human-readable project name')
      .option('--key <key>', 'Project key (uppercase, 2-10 chars)')
      .option('--description <text>', 'Optional project description')
      .option('--workflow <name>', 'Workflow preset (default | lean | kanban | jira-classic)')
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

    const config = buildConfig(options, validation.value);
    const minimal = options.minimal === true;

    // Note: there is no separate conflict-detection pass. Every write
    // below is idempotent — the AGENTS.md merge preserves whatever
    // content the user already had, the workflow JSON copy guards
    // `existsSync`, and the markdown directories are created with
    // `mkdirSync({ recursive: true })`. The single ownership claim is
    // `.mnema/mnema.config.json`, gated above with AlreadyInitialized.

    mkdirSync(path.dirname(configPath), { recursive: true });
    writeJson(configPath, config);
    writeAgentsMd(cwd, config);

    const stateDir = path.join(cwd, config.paths.state);
    const auditDir = path.join(cwd, config.paths.audit);
    const workflowsDest = path.join(cwd, config.paths.workflows);

    mkdirSync(stateDir, { recursive: true });
    mkdirSync(auditDir, { recursive: true });
    mkdirSync(workflowsDest, { recursive: true });
    // The backlog is essential in BOTH modes: `doctor` requires it
    // unconditionally, and the first `task create` would make it anyway — a
    // minimal init that immediately fails its own health check is a trap.
    mkdirSync(path.join(cwd, config.paths.backlog), { recursive: true });

    if (!minimal) {
      mkdirSync(path.join(cwd, config.paths.sprints), { recursive: true });
      mkdirSync(path.join(cwd, config.paths.roadmap), { recursive: true });
      mkdirSync(path.join(cwd, config.paths.memory), { recursive: true });
      mkdirSync(path.join(cwd, config.paths.observations), { recursive: true });
      mkdirSync(path.join(cwd, config.paths.skills), { recursive: true });
      mkdirSync(path.join(cwd, config.paths.commands), { recursive: true });
      mkdirSync(path.join(cwd, config.paths.templates), { recursive: true });
    }

    appendGitignore(cwd, config.paths.state, config.paths.audit);
    ensureGitattributes(cwd, config.paths.audit);

    const workflowSrc = path.join(workflowsDir(), `${config.workflow}.json`);
    const workflowDestFile = path.join(workflowsDest, `${config.workflow}.json`);
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
      createBacklogStateDirs(cwd, config, workflowDestFile);
      // Seed the example skills at init, not only via `mnema adopt skills`
      // (which agents skip — the report's "skills born empty, stay empty").
      // Reuses the exact adopt content, so there is a single source and the
      // write is idempotent. --minimal skips this and keeps skills/ empty.
      const adoption = new AdoptionService(cwd, config);
      adoption.adopt('skills');
      // Seed the slash commands too, so `.mnema/commands/` is not born empty
      // (the shortcut that makes the tool get used). Commands are pure files
      // with no SQLite row, so — unlike skills — they need no import step.
      adoption.adopt('commands');
      // Seed the task templates so `templates/<kind>.md` exist and are
      // overridable; task_create --template falls back to the built-ins when
      // a file is absent, so this is discoverability, not a hard dependency.
      adoption.adopt('templates');
    }

    const dbPath = path.join(stateDir, 'state.db');
    const adapter = new SqliteAdapter(dbPath);
    let identityConfigured = false;
    try {
      new MigrationRunner().run(adapter, migrationDirs(cwd));
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
        new SkillService(
          path.join(cwd, config.paths.skills),
          new Set(),
          new SkillRepository(adapter),
          identity,
          new AuditService(new AuditWriter(auditDir)),
        ).importSeeds('system');
      }
    } finally {
      adapter.close();
    }

    const auditFile = path.join(auditDir, 'current.jsonl');
    if (!existsSync(auditFile)) {
      writeFileSync(auditFile, '', 'utf-8');
    }

    return Ok({ configPath, mode: minimal ? 'minimal' : 'full', identityConfigured });
  }
}

function validateOptions(options: ResolvedInitOptions): Result<WorkflowName, MnemaError> {
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

function buildConfig(options: ResolvedInitOptions, workflow: WorkflowName): Config {
  const raw = {
    version: '1.0' as const,
    mnema_version: `^${VERSION}`,
    project: {
      key: options.key,
      name: options.name,
      ...(options.description !== undefined ? { description: options.description } : {}),
    },
    workflow,
    // audit-only trims the advertised surface to the core: the knowledge
    // group (decisions/skills/memories/observations) is turned off here,
    // and the lean-by-default workflow keeps epics/sprints off. Everything
    // can be re-enabled later by flipping the flag / switching workflow.
    ...(options.profile === 'audit-only' ? { features: { knowledge: false } } : {}),
  };
  return ConfigSchema.parse(raw);
}

function writeJson(filePath: string, data: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

/**
 * The `.gitignore` block Mnema writes. Only the **state** directory and
 * the personal `config.local.json` override are ignored — the state dir
 * holds the SQLite cache, the sync buffer and attachment blobs, all of
 * which are derived and rebuildable from the markdown via `mnema sync`;
 * `config.local.json` is a per-user override that must not reach the
 * team's repo. Everything else under `.mnema/` (the backlog / roadmap /
 * sprint / memory / skill markdown and the `audit/` log) is the
 * version-controlled record of the work and is meant to be committed:
 * it is the source of truth and what survives a fresh clone. The
 * comment lines double as the in-repo documentation of that split.
 */
function gitignoreBlock(statePath: string, auditPath: string): string {
  const entry = `${statePath.replace(/\/$/, '')}/`;
  return [
    '# mnema: ignore only the local cache (SQLite db, sync buffer,',
    '# attachments) and the personal config.local.json override. The',
    '# backlog/roadmap/sprint/memory/skill markdown and the audit log',
    '# under .mnema/ are the source of truth — commit them. The cache is',
    '# rebuildable from that markdown via `mnema sync`.',
    entry,
    '.mnema/config.local.json',
    // The audit dir is committed, but the cross-process write lock in it
    // is transient local state — never version it.
    `${auditPath.replace(/\/$/, '')}/.audit.lock*`,
  ].join('\n');
}

function appendGitignore(cwd: string, statePath: string, auditPath: string): void {
  const file = path.join(cwd, '.gitignore');
  const entry = `${statePath.replace(/\/$/, '')}/`;
  const block = gitignoreBlock(statePath, auditPath);
  if (!existsSync(file)) {
    writeFileSync(file, `${block}\n`, 'utf-8');
    return;
  }
  const current = readFileSync(file, 'utf-8');
  if (current.includes(entry)) return;
  // If a broader ancestor (e.g. `.mnema/` for the new default
  // layout `.mnema/state`) is already ignored, the more specific
  // entry would be redundant — skip it.
  if (covers(current, entry)) return;
  appendFileSync(file, `\n${block}\n`, 'utf-8');
}

/**
 * Returns true when `gitignore` already contains a line that ignores
 * an ancestor of `entry`. The check is intentionally simple: it walks
 * up the path one segment at a time and looks for a literal match —
 * good enough for the defaults Mnema writes; users with custom
 * negation rules can edit the file themselves.
 */
function covers(gitignoreBody: string, entry: string): boolean {
  const segments = entry
    .replace(/\/$/, '')
    .split('/')
    .filter((s) => s.length > 0);
  for (let i = 1; i < segments.length; i += 1) {
    const ancestor = `${segments.slice(0, i).join('/')}/`;
    if (gitignoreBody.includes(ancestor)) return true;
  }
  return false;
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

/**
 * The default workflow for a profile when `--workflow` was not given.
 * audit-only pairs with the lean workflow (no sprints/epics/review) so the
 * whole surface is small; full keeps the default workflow.
 */
function defaultWorkflowFor(profile: ProfileName): WorkflowName {
  return profile === 'audit-only' ? 'lean' : 'default';
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
      workflow: options.workflow ?? defaultWorkflowFor(profile),
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
      workflow: options.workflow ?? defaultWorkflowFor(profile),
      profile,
      force: options.force === true,
      minimal: options.minimal === true,
      cwd: options.cwd,
    };
  }

  process.stdout.write(`${pc.bold('Mnema init')} — answer a few questions to bootstrap.\n\n`);

  // Lazy: silent paths above never touch @inquirer/prompts.
  const { confirm, input, select } = await import('@inquirer/prompts');

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

  const workflow = await select<WorkflowName>({
    message: 'Workflow preset',
    default: (options.workflow as WorkflowName | undefined) ?? 'default',
    choices: buildWorkflowChoices(),
  });

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
    workflow,
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
  workflowStates,
  buildWorkflowChoices,
};
