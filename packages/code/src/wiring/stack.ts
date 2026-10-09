/**
 * The `mnema stack` wiring: installing a stack and removing one.
 *
 * `stack add <source>` shows the plan whole — the stack, its digest, its source, every file and
 * the hosts that read it, the hosts that receive nothing, and the hooks it declares, apart and
 * off — and writes it only when `--expect` names the digest the plan showed, so what is written
 * is what was read even when the source is fetched again. `--dry-run` shows the plan and stops.
 * `stack remove <name>` deletes what is still as it was written and names what is not.
 *
 * IT IS ON THIS SURFACE AND NOT ON THE AGENT'S. Installing writes into the folders a host reads
 * as instruction, which is an act of the person who administers the project; there is no MCP
 * tool for it, as there is none for `skill export`.
 */

import type { Command } from 'commander';
import { SCOPES, scopeChoices } from '../vocabulary.js';
import { here } from './context.js';
import { enumeratedOption } from './enumerated.js';
import { onOneLine } from './on-one-line.js';
import { reportRefusal, reportUsage } from './report.js';
import { type Declared, mutatesTheRecord, type Wiring } from './verb.js';

/** Where the files go: one of the trees, or a folder of the person's with `--to`. */
interface TargetOptions {
  readonly scope?: string;
  readonly to?: string;
}

const SCOPE_HELP =
  `the tree that records the adoption, and so where the files go: ${scopeChoices(SCOPES)}. ` +
  'Defaults to public: the files go into the project to be committed with it; private keeps ' +
  'them out of git, and global puts them in the home.';

const TO_HELP = 'write the files into this folder instead, and record nothing';

/** The target the two flags name, or `undefined` after reporting a misuse. */
function targetOf(
  wiring: Wiring,
  scope: string | undefined,
  to: string | undefined,
): { scope: 'public' | 'private' | 'global' } | { to: string } | undefined {
  if (scope !== undefined && to !== undefined) {
    reportUsage(wiring, '--scope and --to name two places; give one.');
    return undefined;
  }
  if (to !== undefined) return { to };
  return { scope: (scope ?? 'public') as 'public' | 'private' | 'global' };
}

/**
 * A refusal as the report takes it: no project is the product's one sentence for it, and any
 * other carries what stands in the way folded into its one line.
 */
function said(refused: { code: string; message: string; lines?: readonly string[] }): {
  reason: string;
  code: string;
  message: string;
} {
  const lines = refused.lines ?? [];
  return {
    reason: refused.code === 'NO_PROJECT' ? 'NO_PROJECT' : 'REFUSED',
    code: refused.code,
    message:
      lines.length === 0 ? refused.message : `${refused.message} In the way: ${lines.join('; ')}.`,
  };
}

/** Registers `mnema stack` on the program. */
export function registerStack(program: Command, wiring: Wiring): Declared {
  const { io } = wiring;
  const stack = program
    .command('stack')
    .description('install a stack of skills and agents into the folders each host reads');

  stack
    .command('add')
    .description('show the plan of a stack, and write it when --expect names its digest')
    .argument('<source>', 'a folder, a tar archive, or an https:// git address')
    .addOption(enumeratedOption('--scope <scope>', SCOPE_HELP, SCOPES))
    .option('--to <folder>', TO_HELP)
    .option('--as <name>', 'install it under this name, when its own is taken')
    .option('--expect <digest>', 'write it, if its digest is this one — the one the plan showed')
    .option('--dry-run', 'show the plan and write nothing')
    .action(
      async (
        source: string,
        opts: TargetOptions & { as?: string; expect?: string; dryRun?: boolean },
      ) => {
        const target = targetOf(wiring, opts.scope, opts.to);
        if (target === undefined) return;
        const { readStackSource } = await import('../commands/stack-source.js');
        const { applyStackInstall, planLines, planStackInstall, targetRefusal } = await import(
          '../commands/stack-install.js'
        );
        const ctx = here();
        const nowhere = targetRefusal(ctx, target);
        if (nowhere !== undefined) {
          reportRefusal(wiring, said(nowhere));
          return;
        }
        const read = await readStackSource(source, ctx.cwd);
        if (!read.ok) {
          reportRefusal(wiring, { reason: 'REFUSED', code: read.code, message: read.message });
          return;
        }
        const plan = planStackInstall(ctx, read, {
          target,
          ...(opts.as !== undefined ? { as: opts.as } : {}),
        });
        if (!plan.ok) {
          reportRefusal(wiring, said(plan));
          return;
        }
        for (const line of planLines(plan)) io.out(line);
        if (opts.dryRun === true) {
          io.out('Dry run: nothing was written.');
          return;
        }
        if (opts.expect === undefined) {
          reportRefusal(wiring, {
            reason: 'REFUSED',
            code: 'STACK_UNCONFIRMED',
            message: `the plan above was not written. To write exactly these bytes, run it again with --expect ${plan.digest}.`,
          });
          return;
        }
        const installed = applyStackInstall(ctx, plan, opts.expect);
        if (!installed.ok) {
          reportRefusal(wiring, said(installed));
          return;
        }
        // The name and the version are the stack's own words, so the line goes through the tag.
        io.out(
          onOneLine`Installed ${plan.installedAs} ${plan.version}: ${plan.files.length} files written.`,
        );
        io.out(
          'scope' in target
            ? `The adoption is recorded in the ${target.scope} tree.`
            : 'Nothing is recorded: a folder of your own governs nothing.',
        );
      },
    );

  stack
    .command('remove')
    .description('remove an installed stack, keeping every file changed since it was written')
    .argument('<name>', 'the name the stack is installed under')
    .addOption(enumeratedOption('--scope <scope>', SCOPE_HELP, SCOPES))
    .option('--to <folder>', 'the folder it was written into with --to')
    .option('--dry-run', 'say what would be removed and remove nothing')
    .action(async (name: string, opts: TargetOptions & { dryRun?: boolean }) => {
      const target = targetOf(wiring, opts.scope, opts.to);
      if (target === undefined) return;
      const { removeInstalledStack } = await import('../commands/stack-install.js');
      const removed = removeInstalledStack(here(), {
        name,
        target,
        ...(opts.dryRun === true ? { dryRun: true } : {}),
      });
      if (!removed.ok) {
        reportRefusal(wiring, said(removed));
        return;
      }
      const verb = opts.dryRun === true ? 'Would remove' : 'Removed';
      io.out(
        onOneLine`${verb} ${removed.name} ${removed.version}: ${removed.removed.length} files.`,
      );
      for (const path of removed.kept)
        io.out(onOneLine`  kept, changed since it was written: ${path}`);
      for (const path of removed.missing) io.out(onOneLine`  already gone: ${path}`);
      if (removed.recorded) io.out('The removal is recorded.');
      if (opts.dryRun === true) io.out('Dry run: nothing was removed.');
    });

  // Both members write, so the group answers as one: there is no reading member to run apart.
  return mutatesTheRecord(stack);
}
