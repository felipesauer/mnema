/**
 * The `mnema stack` wiring: installing a stack and removing one.
 *
 * `stack add <source>` shows the plan whole — the stack, its digest and who signed it, its
 * source, every file and the hosts that read it, the hosts that receive nothing, and the hooks it
 * declares, apart and off — and writes it only when `--expect` names the digest the plan showed, so what is written
 * is what was read even when the source is fetched again. `--dry-run` shows the plan and stops.
 * `stack remove <name>` deletes what is still as it was written and names what is not.
 * `list`, `show`, `diff` and `check` look at what is installed against its receipt and the record;
 * `export` copies the skills and agents back out; `enable` and `disable` (a hook) are the one act a stack
 * cannot do for itself — a hook is never on until a person, at a terminal, has read it.
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
import { type Declared, groupOf, mutatesTheRecord, readsTheRecord, type Wiring } from './verb.js';

/** Where the files go: one of the trees, or a folder of the person's with `--to`. */
interface TargetOptions {
  readonly scope?: string;
  readonly to?: string;
}

/**
 * What `stack remove` says of who may remove. A `stack.removed` fact is signed by whoever wrote it
 * and is read for what it says; nothing ties it to the key that adopted the stack, so the verb says
 * so where a person decides and where it is done, and the package page says it beside what the
 * digest and the signature prove.
 */
const WHO_MAY_REMOVE =
  'The record does not check who removes a stack: a removal signed by any key that writes to this tree stands, whoever adopted it.';

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

/**
 * The target a READING verb names: `undefined` when it names none (then every tree is looked in),
 * `null` after reporting that it named two.
 */
function readTargetOf(
  wiring: Wiring,
  scope: string | undefined,
  to: string | undefined,
): { scope: 'public' | 'private' | 'global' } | { to: string } | undefined | null {
  if (scope !== undefined && to !== undefined) {
    reportUsage(wiring, '--scope and --to name two places; give one.');
    return null;
  }
  if (to !== undefined) return { to };
  return scope === undefined ? undefined : { scope: scope as 'public' | 'private' | 'global' };
}

const LOOK_SCOPE_HELP = `look in this tree only: ${scopeChoices(SCOPES)}. Without it, in all three.`;

/** Registers `mnema stack` on the program. */
export function registerStack(program: Command, wiring: Wiring): Declared {
  const { io } = wiring;
  const stack = program
    .command('stack')
    .description('install a stack of skills and agents into the folders each host reads');

  const add = stack
    .command('add')
    .description('show the plan of a stack, and write it when --expect names its digest')
    .argument('<source>', 'a folder, a tar archive, or an https:// git address')
    .addOption(enumeratedOption('--scope <scope>', SCOPE_HELP, SCOPES))
    .option('--to <folder>', TO_HELP)
    .option('--as <name>', 'install it under this name, when its own is taken')
    .option('--expect <digest>', 'write it, if its digest is this one — the one the plan showed')
    .option('--dry-run', 'show the plan and write nothing')
    .addHelpText(
      'after',
      [
        '',
        'A stack may carry stack.sigstore.json, a Sigstore signature over its digest, checked',
        'offline against the root this binary carries. The plan names who signed, beside the',
        'digest. A signature proves WHO signed these bytes, not that they are SAFE to run: read',
        'the plan either way. A stack with no signature installs on its digest alone, and the plan',
        'says so; a signature that does not hold is refused. --expect is still the confirmation.',
      ].join('\n'),
    )
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
        const plan = await planStackInstall(ctx, read, {
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

  const remove = stack
    .command('remove')
    .description('remove an installed stack, keeping every file changed since it was written')
    .argument('<name>', 'the name the stack is installed under')
    .addOption(enumeratedOption('--scope <scope>', SCOPE_HELP, SCOPES))
    .option('--to <folder>', 'the folder it was written into with --to')
    .option('--dry-run', 'say what would be removed and remove nothing')
    .addHelpText('after', ['', WHO_MAY_REMOVE].join('\n'))
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
      // Said where a person decides (the dry run) and where it is done, and only for a tree: a
      // folder of one's own records nothing.
      if ('scope' in target) io.out(WHO_MAY_REMOVE);
    });

  const lookOptions = (command: Command): Command =>
    command
      .addOption(enumeratedOption('--scope <scope>', LOOK_SCOPE_HELP, SCOPES))
      .option('--to <folder>', 'look in the folder it was written into with --to');

  const list = lookOptions(
    stack
      .command('list')
      .description('list the installed stacks, and whether each is still as written'),
  )
    .option('--json', 'emit the same reading as JSON, for a program to take')
    .action(async (opts: TargetOptions & { json?: boolean }) => {
      const target = readTargetOf(wiring, opts.scope, opts.to);
      if (target === null) return;
      const { listJson, listLines } = await import('../commands/stack-inspect.js');
      if (opts.json === true) {
        io.out(listJson(here(), target));
        return;
      }
      for (const line of listLines(here(), target)) io.out(line);
    });

  const index = stack
    .command('index')
    .description('list the stacks an index names, with the digest each must have')
    .argument('[folder]', 'the folder holding index.json', 'stack-index')
    .option('--json', 'emit the entries as JSON, for a program to take')
    .addHelpText(
      'after',
      [
        '',
        'The index holds no stack: each entry is a name, a link and a digest, and one kept in the',
        'same checkout names its folder. Being listed does not make a stack safe. Add one with',
        '`mnema stack add <source> --dry-run`, and it is the stack listed only if the digest the',
        'plan shows is the one the index gives.',
      ].join('\n'),
    )
    .action(async (folder: string, opts: { json?: boolean }) => {
      const { indexJson, indexLines, readStackIndex } = await import('../commands/stack-index.js');
      const read = readStackIndex(here().cwd, folder);
      if (!read.ok) {
        reportRefusal(wiring, said(read));
        return;
      }
      if (opts.json === true) io.out(indexJson(read));
      else for (const line of indexLines(read)) io.out(line);
    });

  const show = lookOptions(
    stack
      .command('show')
      .description('show one installed stack: its files, its hooks, and the record'),
  )
    .argument('<name>', 'the name the stack is installed under')
    .action(async (name: string, opts: TargetOptions) => {
      const target = readTargetOf(wiring, opts.scope, opts.to);
      if (target === null) return;
      const { findEntry, inspect, showLines } = await import('../commands/stack-inspect.js');
      const found = findEntry(here(), name, target);
      if ('ok' in found) {
        reportRefusal(wiring, said(found));
        return;
      }
      for (const line of showLines(inspect(found))) io.out(line);
    });

  const diff = lookOptions(
    stack
      .command('diff')
      .description(
        'compare the installed files with their receipt, and the receipt with the record',
      ),
  )
    .argument('<name>', 'the name the stack is installed under')
    .action(async (name: string, opts: TargetOptions) => {
      const target = readTargetOf(wiring, opts.scope, opts.to);
      if (target === null) return;
      const { diffLines, findEntry, inspect, isSound } = await import(
        '../commands/stack-inspect.js'
      );
      const found = findEntry(here(), name, target);
      if ('ok' in found) {
        reportRefusal(wiring, said(found));
        return;
      }
      const looked = inspect(found);
      for (const line of diffLines(looked)) io.out(line);
      if (!isSound(looked)) io.fail();
    });

  const check = lookOptions(
    stack
      .command('check')
      .description(
        'check every installed stack, or one, against its receipt and the record; fails if any departs',
      ),
  )
    .argument('[name]', 'one stack, by the name it is installed under')
    .action(async (name: string | undefined, opts: TargetOptions) => {
      const target = readTargetOf(wiring, opts.scope, opts.to);
      if (target === null) return;
      const { allEntries, findEntry, inspect, problemsOf, unreceipted } = await import(
        '../commands/stack-inspect.js'
      );
      const ctx = here();
      let entries = allEntries(ctx, target);
      if (name !== undefined) {
        const found = findEntry(ctx, name, target);
        if ('ok' in found) {
          reportRefusal(wiring, said(found));
          return;
        }
        entries = [found];
      }
      const problems = [
        ...entries.flatMap((e) => problemsOf(inspect(e))),
        ...(name === undefined ? unreceipted(ctx, target) : []),
      ];
      for (const line of problems) io.out(line);
      io.out(
        problems.length === 0
          ? `${entries.length} stacks checked: every file the receipts name is as written and the record agrees; files they do not name are not looked at.`
          : `${entries.length} stacks checked: ${problems.length} departures.`,
      );
      if (problems.length > 0) io.fail();
    });

  const exported = lookOptions(
    stack
      .command('export')
      .description(
        "copy an installed stack's skills and agents into a new folder, in a stack's layout",
      ),
  )
    .argument('<name>', 'the name the stack is installed under')
    .argument('<folder>', 'a folder that does not exist yet, or is empty')
    .action(async (name: string, folder: string, opts: TargetOptions) => {
      const target = readTargetOf(wiring, opts.scope, opts.to);
      if (target === null) return;
      const { exportInstalled, findEntry, inspect } = await import('../commands/stack-inspect.js');
      const ctx = here();
      const found = findEntry(ctx, name, target);
      if ('ok' in found) {
        reportRefusal(wiring, said(found));
        return;
      }
      const done = exportInstalled(ctx, inspect(found), folder);
      if (!done.ok) {
        reportRefusal(wiring, said(done));
        return;
      }
      io.out(onOneLine`Exported ${found.name}: ${done.written.length} files into ${folder}.`);
      for (const path of done.skipped)
        io.out(onOneLine`  skipped, changed since it was written: ${path}`);
      io.out(
        "This is the skills and agents only: stack.json, LICENSE and the hooks are not part of an installation, so this folder is not the stack and its digest is not the stack's.",
      );
    });

  const enable = lookOptions(
    stack
      .command('enable')
      .description(
        'turn on a hook an installed stack declares: shows its script and asks its name, at a terminal',
      )
      .argument('<stack>', 'the name the stack is installed under')
      .argument('<hook>', 'the name of a hook the stack declares')
      .requiredOption(
        '--from <source>',
        'the stack as it was installed: a folder, a tar archive, or an https:// git address',
      ),
  ).action(async (name: string, hookName: string, opts: TargetOptions & { from: string }) => {
    const target = readTargetOf(wiring, opts.scope, opts.to);
    if (target === null) return;
    // Asked before anything is read: without a person at a terminal the verb has nothing to do.
    if (io.aPersonIsHere !== true || io.ask === undefined) {
      reportRefusal(wiring, {
        reason: 'REFUSED',
        code: 'STACK_HOOK_NEEDS_A_PERSON',
        message:
          'a hook is turned on by a person at a terminal, one hook at a time, and this is not a terminal. No hook was turned on.',
      });
      return;
    }
    const { findEntry } = await import('../commands/stack-inspect.js');
    const { offerHook, offerLines, turnHookOn } = await import('../commands/stack-hooks.js');
    const { readStackSource } = await import('../commands/stack-source.js');
    const ctx = here();
    const found = findEntry(ctx, name, target);
    if ('ok' in found) {
      reportRefusal(wiring, said(found));
      return;
    }
    const read = await readStackSource(opts.from, ctx.cwd);
    if (!read.ok) {
      reportRefusal(wiring, { reason: 'REFUSED', code: read.code, message: read.message });
      return;
    }
    const offer = offerHook(found, hookName, read);
    if (!offer.ok) {
      reportRefusal(wiring, said(offer));
      return;
    }
    for (const line of offerLines(found, offer)) io.out(line);
    const answer = await io.ask(`Type the hook's name, ${offer.hook.name}, to turn it on: `);
    if (answer.replace(/[\r\n]+$/, '') !== offer.hook.name) {
      reportRefusal(wiring, {
        reason: 'REFUSED',
        code: 'STACK_HOOK_NOT_APPROVED',
        message: "the name typed is not the hook's. No hook was turned on.",
      });
      return;
    }
    const on = turnHookOn(found, offer);
    if (!on.ok) {
      reportRefusal(wiring, said(on));
      return;
    }
    io.out(
      onOneLine`Approved ${found.name} hook ${offer.hook.name}; its script is kept at ${on.script}.`,
    );
    io.out(
      "mnema registers it with no host and runs nothing: to have a host run it, point that host's hook configuration at the script yourself.",
    );
  });

  const disable = lookOptions(
    stack
      .command('disable')
      .description('turn a hook off again: takes back the approval and the script kept with it')
      .argument('<stack>', 'the name the stack is installed under')
      .argument('<hook>', 'the name of a hook the stack declares'),
  ).action(async (name: string, hookName: string, opts: TargetOptions) => {
    const target = readTargetOf(wiring, opts.scope, opts.to);
    if (target === null) return;
    const { findEntry } = await import('../commands/stack-inspect.js');
    const { turnHookOff } = await import('../commands/stack-hooks.js');
    const found = findEntry(here(), name, target);
    if ('ok' in found) {
      reportRefusal(wiring, said(found));
      return;
    }
    const off = turnHookOff(found, hookName);
    if (!off.ok) {
      reportRefusal(wiring, said(off));
      return;
    }
    io.out(
      off.was === 'on'
        ? onOneLine`Took back the approval of ${found.name} hook ${hookName}.`
        : onOneLine`${found.name} hook ${hookName} was not approved. Nothing changed.`,
    );
  });

  // `list`, `show`, `diff` and `check` read; `export`, `enable` and `disable` write files and not the
  // record, and are still writes to the console, as `skill export` is.
  return groupOf(stack, [
    mutatesTheRecord(add),
    mutatesTheRecord(remove),
    readsTheRecord(list),
    readsTheRecord(index),
    readsTheRecord(show),
    readsTheRecord(diff),
    readsTheRecord(check),
    mutatesTheRecord(exported),
    mutatesTheRecord(enable),
    mutatesTheRecord(disable),
  ]);
}
