import path from 'node:path';

import type { Command } from 'commander';
import pc from 'picocolors';

import { printError } from '../../errors/error-printer.js';
import { GithubIssuesImporter } from '../../services/importers/github-issues-importer.js';
import { MarkdownImporter } from '../../services/importers/markdown-importer.js';
import { withMutatingCliContext } from '../cli-context.js';

interface MarkdownOptions {
  readonly from: string;
  readonly recursive?: boolean;
  readonly skipExisting?: boolean;
}

interface GithubOptions {
  readonly repo: string;
  readonly token?: string;
  readonly state?: 'open' | 'closed' | 'all';
}

/**
 * Registers `mnema import`, the one-shot ingestion entry point.
 *
 * Two sources today:
 * - `import markdown --from <path>`        → walks files for `## STATE Title` headings
 * - `import github-issues --repo owner/r`  → fetches issues via the REST API
 *
 * Both create tasks in the workflow's initial state — agents (or
 * humans) can then transition them through the regular gates.
 */
export class ImportCommand {
  /**
   * Attaches the `import` command group to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    const group = program.command('import').description('One-shot import from external sources');

    group
      .command('markdown')
      .description(
        'Parse Markdown headings into tasks (one-shot). The importer is ' +
          'state-blind: a heading like `## DRAFT Fix login` becomes a task ' +
          'whose title is the literal `DRAFT Fix login`, since honouring ' +
          'a state hint would require running the workflow gate against ' +
          'payload the markdown does not carry. Re-running creates ' +
          'duplicates unless you pass `--skip-existing`.',
      )
      .requiredOption('--from <path>', 'File or directory to parse')
      .option('--recursive', 'Walk directories recursively', false)
      .option('--skip-existing', 'Skip headings whose exact title is already an active task', false)
      .action(async (options: MarkdownOptions) => {
        await withMutatingCliContext(({ container, config, projectRoot }) => {
          const sourcePath = path.isAbsolute(options.from)
            ? options.from
            : path.resolve(projectRoot, options.from);

          const importer = new MarkdownImporter(
            container.task,
            config.project.key,
            container.identity.getDefaultActor(),
          );
          const result = importer.import(sourcePath, {
            recursive: options.recursive === true,
            skipExisting: options.skipExisting === true,
          });
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          const summary = result.value;
          process.stdout.write(
            `${pc.green('✓')} markdown import complete  files=${summary.filesScanned}  tasks_created=${summary.tasksCreated}  skipped_existing=${summary.tasksSkippedExisting}\n`,
          );
          for (const skipped of summary.skipped) {
            process.stderr.write(
              `${pc.yellow('!')} skipped ${skipped.source}: ${skipped.reason}\n`,
            );
          }
        });
      });

    group
      .command('github-issues')
      .description('Fetch GitHub issues into tasks (one-shot)')
      .requiredOption('--repo <slug>', 'GitHub repository in `owner/name` form')
      .option('--token <token>', 'Personal access token (also taken from $GITHUB_TOKEN)')
      .option('--state <state>', 'Issue state filter — open, closed or all (default all)')
      .action(async (options: GithubOptions) => {
        const token = options.token ?? process.env.GITHUB_TOKEN;
        await withMutatingCliContext(async ({ container, config }) => {
          const importer = new GithubIssuesImporter(
            container.task,
            config.project.key,
            container.identity.getDefaultActor(),
          );
          try {
            const summary = await importer.import(options.repo, { state: options.state, token });
            process.stdout.write(
              `${pc.green('✓')} github-issues import complete  scanned=${summary.issuesScanned}  tasks_created=${summary.tasksCreated}\n`,
            );
            for (const skipped of summary.skipped) {
              process.stderr.write(
                `${pc.yellow('!')} skipped #${skipped.number}: ${skipped.reason}\n`,
              );
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write(`${pc.red('error:')} ${message}\n`);
            process.exit(1);
          }
        });
      });
  }
}
