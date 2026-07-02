import type { Command } from 'commander';

import { ConfigLoader } from '../../config/config-loader.js';
import { ErrorCode } from '../../errors/error-codes.js';
import { printError } from '../../errors/error-printer.js';
import {
  GitCommitFailedError,
  GitCommitNotARepoError,
  GitCommitService,
} from '../../services/git-commit-service.js';
import { pc } from '../../utils/colors.js';
import { resolveProjectRoot } from '../project-root.js';

interface CommitOptions {
  readonly message?: string;
  readonly trailMessage?: string;
  readonly trailOnly?: boolean;
}

/**
 * Registers `mnema commit`, a thin git helper that commits the versioned
 * `.mnema/` trail SEPARATELY from code so the mirror churn an agent makes
 * on every transition does not mix into a code diff.
 *
 * It makes up to two commits — the trail first (default message), then the
 * code (your `-m`). The trail is auto-staged; CODE is whatever you already
 * staged with `git add` / `git add -p`, committed from the index verbatim,
 * so unstaged edits are preserved. It never `git add`s code, never amends,
 * and never pushes; an empty bucket is skipped, not committed.
 */
export class CommitCommand {
  register(program: Command): void {
    program
      .command('commit')
      .description('Commit the .mnema/ trail separately from code (trail first, then code)')
      .option('-m, --message <message>', 'Commit message for the code changes')
      .option(
        '--trail-message <message>',
        'Commit message for the .mnema/ trail (default: "chore(mnema): update trail")',
      )
      .option('--trail-only', 'Only commit the .mnema/ trail; leave code changes staged/untouched')
      .action((options: CommitOptions) => {
        // A pure git helper: resolve the project root WITHOUT opening the
        // SQLite container, so it works even when the DB is drifted /
        // un-migrated (it never touches the database).
        const configFile = new ConfigLoader().findConfigFile();
        if (configFile === null) {
          process.exit(printError({ kind: ErrorCode.ConfigNotFound, currentDir: process.cwd() }));
        }
        const projectRoot = resolveProjectRoot(configFile);
        const service = new GitCommitService(projectRoot);
        try {
          const result = service.commit({
            message: options.message,
            trailMessage: options.trailMessage,
            trailOnly: options.trailOnly === true,
          });
          if (result.nothing !== undefined) {
            process.stdout.write(`${pc.dim(result.nothing)}\n`);
            return;
          }
          for (const step of result.committed) {
            const label = step.kind === 'trail' ? 'trail' : 'code';
            process.stdout.write(
              `${pc.green('✓')} committed ${pc.bold(label)}  ` +
                `${step.paths.length} path(s)  ${pc.dim(step.message)}\n`,
            );
          }
        } catch (error) {
          // A trail commit may have landed before a code commit failed; the
          // error message names which bucket so the user can finish by hand.
          if (error instanceof GitCommitNotARepoError || error instanceof GitCommitFailedError) {
            process.stderr.write(`${pc.red('error:')} ${error.message}\n`);
            process.exitCode = 1;
            return;
          }
          throw error;
        }
      });
  }
}
