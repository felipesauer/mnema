import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pc } from '@mnema/core/utils/colors.js';
import type { Command } from 'commander';

// `@inquirer/prompts` is loaded lazily inside `resolveDecision` —
// `--yes` skips the cost, and unrelated CLI paths never touch it.

import { CONFIG_FILE_RELATIVE, ConfigLoader } from '@mnema/core/config/config-loader.js';
import { ErrorCode, ExitCode } from '@mnema/core/errors/error-codes.js';
import { printError } from '@mnema/core/errors/error-printer.js';
import { workflowsDir } from '@mnema/core/utils/asset-paths.js';
import { LAYOUT } from '@mnema/core/utils/layout.js';
import { resolveProjectRoot } from '../project-root.js';
import { isPromptAbort } from '../prompt-helpers.js';

interface DestroyOptions {
  readonly yes?: boolean;
  readonly keepMarkdown?: boolean;
  readonly keepAudit?: boolean;
}

/**
 * Registers `mnema destroy`, the uninstall command.
 *
 * The interactive flow asks the user to confirm twice — a yes/no
 * prompt and a key-typing prompt that must match the project key —
 * plus two narrower prompts that opt out of markdown / audit
 * preservation. `--yes` skips every prompt and uses the default
 * preservation set. By default, `mnema.config.json`, the SQLite state
 * dir, the bundled workflow JSON and the `AGENTS.md` managed block
 * are removed; markdown trees (`backlog/`, `sprints/`, `roadmap/`,
 * `memory/`) and the audit log (`.audit/`) are kept unless the user
 * explicitly opts in.
 */
export class DestroyCommand {
  /**
   * Attaches the `destroy` subcommand to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    program
      .command('destroy')
      .description(
        'Remove the local Mnema project. Interactive flow asks for ' +
          'yes/no, two preservation prompts (markdown, audit), and a ' +
          'key-typing match. `--yes` skips all prompts.',
      )
      .option('--yes', 'Skip every prompt and use the default preservation set', false)
      .option('--keep-markdown', 'Force-keep backlog/sprints/roadmap/memory', false)
      .option('--keep-audit', 'Force-keep .audit/', false)
      .action(async (options: DestroyOptions) => {
        const loader = new ConfigLoader();
        const configFile = loader.findConfigFile();
        if (configFile === null) {
          process.exit(printError({ kind: ErrorCode.ConfigNotFound, currentDir: process.cwd() }));
        }
        const config = loader.load();
        const projectRoot = resolveProjectRoot(configFile);

        let decision: DestroyDecision | null;
        try {
          decision = await resolveDecision(options, config.project.key);
        } catch (error) {
          if (isPromptAbort(error)) {
            process.stdout.write(`${pc.dim('aborted')}\n`);
            return;
          }
          throw error;
        }
        if (decision === null) {
          process.stdout.write(`${pc.dim('aborted')}\n`);
          return;
        }

        const removed = removeArtifacts(projectRoot, { ...LAYOUT, workflow: 'default' }, decision);
        for (const target of removed) {
          process.stdout.write(`${pc.dim('removed')} ${target}\n`);
        }
        process.stdout.write(`${pc.green('✓')} project ${pc.bold(config.project.key)} destroyed\n`);
        if (decision.keepMarkdown) {
          process.stdout.write(
            `${pc.dim('  kept markdown trees (backlog/sprints/roadmap/memory)')}\n`,
          );
        }
        if (decision.keepAudit) {
          process.stdout.write(`${pc.dim('  kept .audit/')}\n`);
        }
      });
  }
}

/**
 * Outcome of the destroy confirmation flow.
 */
export interface DestroyDecision {
  readonly keepMarkdown: boolean;
  readonly keepAudit: boolean;
}

async function resolveDecision(
  options: DestroyOptions,
  projectKey: string,
): Promise<DestroyDecision | null> {
  if (options.yes === true) {
    return {
      keepMarkdown: options.keepMarkdown === true,
      keepAudit: options.keepAudit === true,
    };
  }

  // Lazy: --yes path above never touches @inquirer/prompts.
  const { confirm, input } = await import('@inquirer/prompts');

  const proceed = await confirm({
    message: 'This will delete the SQLite database and project config. Continue?',
    default: false,
  });
  if (!proceed) return null;

  const keepMarkdown =
    options.keepMarkdown === true
      ? true
      : await confirm({
          message: 'Keep markdown trees (backlog/, sprints/, roadmap/, memory/, observations/)?',
          default: true,
        });

  const keepAudit =
    options.keepAudit === true
      ? true
      : await confirm({
          message: 'Keep the audit log (.audit/)?',
          default: true,
        });

  const typed = await input({
    message: `Type the project key (${projectKey}) to confirm:`,
  });
  if (typed.trim() !== projectKey) {
    process.stderr.write(`${pc.red('error:')} key did not match — destroy cancelled\n`);
    process.exit(ExitCode.Usage);
  }

  return { keepMarkdown, keepAudit };
}

/**
 * Paths affected by destroy. Mirrors the relevant subset of
 * {@link import('@mnema/core/config/config-schema.js').Config.paths} plus
 * the active workflow name so destroy can target only the JSON file
 * `init` actually wrote (rather than the whole `workflows/`
 * directory, which the user might own for unrelated reasons —
 * notably the Mnema repo dogfooding itself, where `workflows/`
 * carries the bundled presets).
 */
export interface DestroyPaths {
  readonly state: string;
  readonly audit: string;
  readonly workflows: string;
  readonly backlog: string;
  readonly sprints: string;
  readonly roadmap: string;
  readonly memory: string;
  readonly observations: string;
  readonly skills: string;
  readonly commands: string;
  readonly workflow: string;
}

/**
 * Removes the project artifacts and returns the list of relative paths
 * actually deleted (those that did not exist are silently skipped).
 *
 * Exported for tests; the CLI command wraps it after collecting the
 * confirmation flow.
 *
 * The default layout puts every Mnema-managed artefact under
 * `.mnema/`, so the common case is: drop the directory, then strip
 * the Mnema-managed section from `AGENTS.md`. Custom layouts where
 * `paths.*` point outside `.mnema/` are still honoured: each
 * configured path is removed individually, gated by the keep flags.
 *
 * @param projectRoot - Absolute path containing `.mnema/mnema.config.json`
 * @param paths - Configured project paths plus the active workflow name
 * @param decision - Whether to keep markdown trees and the audit log
 * @returns The relative paths that were removed, in execution order
 */
export function removeArtifacts(
  projectRoot: string,
  paths: DestroyPaths,
  decision: DestroyDecision,
): string[] {
  const removed: string[] = [];

  // Always remove: the config file, the SQLite state dir, and the
  // skills dir if it still has only the bundled scaffolding (init
  // creates it empty; `mnema adopt` adds files only on demand).
  if (removeIfExists(projectRoot, CONFIG_FILE_RELATIVE)) removed.push(CONFIG_FILE_RELATIVE);
  if (removeIfExists(projectRoot, paths.state)) removed.push(paths.state);
  if (removeIfEmptyDir(projectRoot, paths.skills)) removed.push(paths.skills);

  // The bundled workflow JSON: only remove the file `init` actually
  // wrote, not the whole directory. Byte-match against the package's
  // bundled template; if the user customised the workflow it stays.
  // Directory remains so other custom workflows survive untouched.
  const removedWorkflow = removeBundledWorkflow(projectRoot, paths.workflows, paths.workflow);
  if (removedWorkflow !== null) removed.push(removedWorkflow);

  if (!decision.keepAudit) {
    if (removeIfExists(projectRoot, paths.audit)) removed.push(paths.audit);
  }

  if (!decision.keepMarkdown) {
    for (const rel of [
      paths.backlog,
      paths.sprints,
      paths.roadmap,
      paths.memory,
      paths.observations,
    ]) {
      if (removeIfExists(projectRoot, rel)) removed.push(rel);
    }
  }

  // The commands dir (MNEMA-69) is versioned markdown like the trees
  // above, but `init` scaffolds it empty. Under keepMarkdown it is only
  // folded when empty (the scaffold), so user-authored commands survive;
  // otherwise it is removed outright.
  if (!decision.keepMarkdown) {
    if (removeIfExists(projectRoot, paths.commands)) removed.push(paths.commands);
  } else if (removeIfEmptyDir(projectRoot, paths.commands)) {
    removed.push(paths.commands);
  }

  // Fold the bundled workflow directory if `removeBundledWorkflow`
  // emptied it. Custom workflow files (not byte-matching the bundled
  // template) survive and the directory stays.
  if (removeIfEmptyDir(projectRoot, paths.workflows)) removed.push(paths.workflows);

  // Then fold the `.mnema/` shell when nothing inside it remains. The
  // dir stays only when the user opted to keep something (audit /
  // markdown) or has files Mnema didn't manage.
  if (removeIfEmptyDir(projectRoot, '.mnema')) removed.push('.mnema');

  // Strip the AGENTS.md managed block. Whatever the user wrote outside
  // the markers stays; if the file becomes empty after the strip, drop
  // it entirely so a clean re-init starts from scratch.
  const agentsRel = stripManagedAgentsBlock(projectRoot);
  if (agentsRel !== null) removed.push(agentsRel);

  // Strip the Mnema-managed `.gitignore` block. Init writes a commented
  // block that ignores the state dir, `config.local.json` and the audit
  // write-lock; we remove only those Mnema-owned lines, so any rule the
  // user added on their own stays intact.
  const gitignoreRel = stripGitignoreEntry(projectRoot, paths.state, paths.audit);
  if (gitignoreRel !== null) removed.push(gitignoreRel);

  // Strip the Mnema-managed `.gitattributes` block (the audit-log
  // `merge=union` line and its comment). Same conservatism: only the
  // exact lines init wrote are removed.
  const gitattributesRel = stripGitattributesEntry(projectRoot, paths.audit);
  if (gitattributesRel !== null) removed.push(gitattributesRel);

  return removed;
}

function removeIfExists(projectRoot: string, relative: string): boolean {
  const target = path.join(projectRoot, relative);
  if (!existsSync(target)) return false;
  rmSync(target, { recursive: true, force: true });
  return true;
}

function removeIfEmptyDir(projectRoot: string, relative: string): boolean {
  const target = path.join(projectRoot, relative);
  if (!existsSync(target)) return false;
  const stat = statSync(target);
  if (!stat.isDirectory()) return false;
  if (readdirSync(target).length > 0) return false;
  rmSync(target, { recursive: true, force: true });
  return true;
}

/**
 * Removes the workflow JSON only when it byte-matches the bundled
 * template — i.e. the user has not customised it since `init`. Returns
 * the relative path that was removed, or `null` when nothing was.
 *
 * Refuses to delete the file when its absolute path is the same as
 * the bundled template's; that case happens when Mnema dogfoods on
 * itself (the project root and the package root coincide), and the
 * file in question IS the source-of-truth for every other consumer.
 */
function removeBundledWorkflow(
  projectRoot: string,
  workflowsRel: string,
  workflowName: string,
): string | null {
  const filename = `${workflowName}.json`;
  const target = path.join(projectRoot, workflowsRel, filename);
  if (!existsSync(target)) return null;

  const bundled = path.join(workflowsDir(), filename);
  if (!existsSync(bundled)) return null;

  if (path.resolve(target) === path.resolve(bundled)) return null;

  const targetBytes = readFileSync(target);
  const bundledBytes = readFileSync(bundled);
  if (!targetBytes.equals(bundledBytes)) return null;

  unlinkSync(target);
  return path.join(workflowsRel, filename);
}

const AGENTS_MD_BEGIN = '<!-- MNEMA:START -->';
const AGENTS_MD_END = '<!-- MNEMA:END -->';

/**
 * Removes the Mnema-managed block from `AGENTS.md`. Returns
 * `'AGENTS.md'` when the file was modified or deleted, `null`
 * otherwise.
 *
 * - File missing → no-op.
 * - File without the managed markers → left alone (the user owns it).
 * - File with the markers → strip the block. If what remains is empty
 *   or only whitespace, delete the file entirely; otherwise rewrite
 *   it without the block.
 */
function stripManagedAgentsBlock(projectRoot: string): string | null {
  const file = path.join(projectRoot, 'AGENTS.md');
  if (!existsSync(file)) return null;
  const previous = readFileSync(file, 'utf-8');
  const start = previous.indexOf(AGENTS_MD_BEGIN);
  const end = previous.indexOf(AGENTS_MD_END);
  if (start === -1 || end === -1 || end < start) return null;

  const before = previous.slice(0, start);
  const after = previous.slice(end + AGENTS_MD_END.length);
  const remaining = `${before}${after}`.trim();

  if (remaining.length === 0) {
    rmSync(file);
  } else {
    writeFileSync(file, `${remaining}\n`, 'utf-8');
  }
  return 'AGENTS.md';
}

/**
 * The exact `.gitignore` block `init` writes today. Kept in lock-step with
 * init-command's `gitignoreBlock` so destroy strips precisely what init
 * produced — a `# mnema:`-commented header plus three ignore lines (the state
 * dir, `.mnema/config.local.json`, and the audit write-lock). An older init
 * wrote a leaner `# mnema\n<state>/` tuple, which is also stripped as a
 * fallback so a project created by a prior version still cleans up.
 */
function gitignoreBlocks(statePath: string, auditPath: string): string[] {
  const stateEntry = `${statePath.replace(/\/$/, '')}/`;
  const lockEntry = `${auditPath.replace(/\/$/, '')}/.audit.lock*`;
  const current = [
    '# mnema: ignore only the local cache (SQLite db, sync buffer,',
    '# attachments) and the personal config.local.json override. The',
    '# backlog/roadmap/sprint/memory/skill markdown and the audit log',
    '# under .mnema/ are the source of truth — commit them. The cache is',
    '# rebuildable from that markdown via `mnema sync`.',
    stateEntry,
    '.mnema/config.local.json',
    lockEntry,
  ].join('\n');
  // Fallback: the legacy two-line tuple a prior init version wrote.
  const legacy = `# mnema\n${stateEntry}`;
  return [current, legacy];
}

/**
 * The exact `.gitattributes` block `init` writes today (see init-command's
 * `gitattributesLines`) — the audit-log `merge=union` line and its comment.
 */
function gitattributesBlock(auditPath: string): string {
  const dir = auditPath.replace(/\/$/, '');
  return [
    '# mnema: the audit log is append-only; merge with union so parallel',
    '# branches keep both sides instead of conflicting on the tail.',
    `${dir}/*.jsonl merge=union`,
  ].join('\n');
}

/**
 * Removes a Mnema-managed block from a git dotfile. Conservative: it removes
 * only a block byte-for-byte identical to one `init` writes (with an optional
 * leading blank-line separator, which init prepends when extending an existing
 * file), so any rule the user added on their own stays intact. Deletes the file
 * when nothing but the managed block remained. Returns the relative filename
 * when the file was modified or deleted, `null` when it held nothing Mnema
 * wrote.
 */
function stripManagedGitFileBlock(
  projectRoot: string,
  relativeFile: string,
  blocks: readonly string[],
): string | null {
  const file = path.join(projectRoot, relativeFile);
  if (!existsSync(file)) return null;
  let content = readFileSync(file, 'utf-8');

  let removedAny = false;
  for (const block of blocks) {
    if (!content.includes(block)) continue;
    // Drop the block plus an optional leading blank-line separator.
    content = content.replace(`\n${block}`, '').replace(block, '');
    removedAny = true;
  }
  if (!removedAny) return null;

  const trimmed = content.trim();
  if (trimmed.length === 0) {
    rmSync(file);
  } else {
    writeFileSync(file, `${trimmed}\n`, 'utf-8');
  }
  return relativeFile;
}

/**
 * Removes the Mnema-managed block(s) `init` writes into `.gitignore`.
 * Returns `.gitignore` when the file was modified or deleted, `null` when
 * it held nothing Mnema wrote.
 */
function stripGitignoreEntry(
  projectRoot: string,
  statePath: string,
  auditPath: string,
): string | null {
  return stripManagedGitFileBlock(projectRoot, '.gitignore', gitignoreBlocks(statePath, auditPath));
}

/**
 * Removes the Mnema-managed block `init` writes into `.gitattributes` (the
 * audit-log `merge=union` line and its comment). Returns `.gitattributes`
 * when the file was modified or deleted, `null` when it held nothing Mnema
 * wrote.
 */
function stripGitattributesEntry(projectRoot: string, auditPath: string): string | null {
  return stripManagedGitFileBlock(projectRoot, '.gitattributes', [gitattributesBlock(auditPath)]);
}
