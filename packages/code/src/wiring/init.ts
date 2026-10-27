/**
 * The `mnema init` wiring: what it declares, and what it prints.
 *
 * `mnema init`: establish a project in the current directory, or say that one is
 * already there. It is the only verb that can CREATE this machine's identity, so it
 * is also the only one with something to report about keys.
 *
 * It used to print two more lines, `registered in the project index` on a founding
 * and `index entry re-asserted` on a second run, about a machine-local index that
 * nothing in the product ever read. Reporting an effect nobody consumes is worse
 * than the dead write itself, because the person acts on what they are told; both
 * the write and the two lines are gone. `cli.writes.golden.txt` is what holds every
 * line this verb prints, so their absence is pinned there byte for byte.
 */

import type { Command } from 'commander';
import type { InitResult } from '../commands/init.js';
import type { InstructionsFile } from '../commands/instructions.js';
import type { PrettierIgnoreChange } from '../commands/the-record-page.js';
import { fact } from '../presentation/detail.js';
import type { Render } from '../presentation/render.js';
import { STARTS_OFF, SWITCH_ON_COMMAND } from '../record-framing.js';
import { here } from './context.js';
import type { CliIo } from './io.js';
import { onOneLine } from './on-one-line.js';
import { reportRefusal } from './report.js';
import { type Declared, mutatesTheRecord, type Wiring } from './verb.js';

/**
 * The name this verb is registered under, in one place.
 *
 * It is read rather than retyped for the reason `REPL_VERB` is (`wiring/repl.ts`): the bare
 * name offers this verb as the first thing to do in a directory with no project, and it
 * names it BY IDENTITY, so the door cannot end up pointing at a word this program no longer
 * routes.
 */
export const INIT_VERB = 'init';

/**
 * The code of the one refusal this verb has: the working directory can be no project's
 * root, the home directory, or one whose `.mnema/` is a machine's data directory
 * (`whyNoProjectRootAt`, `@mnema/core`). The sentence after it says which, and where to
 * run the verb instead.
 */
export const NOT_A_PROJECT_ROOT = 'NOT_A_PROJECT_ROOT';

/**
 * How this project's record reaches an agent: OFFERED to the person who just founded it,
 * and written into nothing.
 *
 * WHAT IT OFFERS IS THE RECORD'S CONTENT, AND THAT IS STILL PRINTED AND NOT WRITTEN. The
 * document `mnema brief` prints changes with every decision, and a committed copy of it cannot
 * go quiet when the switch that stops the plugin pushing it does, so the recipe and the line are
 * offered and the person decides. What a founding DOES write outside `.mnema/` is said above
 * this block, file by file: the `.prettierignore` line, and the block of standing instructions
 * (ADR-46), which carries nothing of the record, only this product's doors and when to use them.
 * So the first words say "no other file" whenever a founding wrote one (`init.test.ts` digests
 * every file this verb touches, and `cli.writes.golden.txt` pins every line it prints).
 *
 * IT REPEATS `mnema brief --help` ON PURPOSE, including the half that page was corrected
 * to carry: the `>` replaces the whole of the file it names. That clause is not decoration
 * beside a recipe: it is the reason the recipe names `MNEMA.md` and not `AGENTS.md`,
 * measured on a real repository whose `AGENTS.md` held 126 lines of its own method.
 * `the-recipe-says-what-it-overwrites.test.ts` holds every publisher of the recipe to that
 * clause, and this block is a THIRD publisher beside the help page and the generated
 * document. It is exported so that guard reads the text; a publisher it cannot read is a
 * publisher that drifts.
 *
 * ONLY ON THE FOUNDING RUN, which is {@link reportIdentity}'s rule in this same file and
 * not a new one: a sentence repeated on every `init` becomes noise a person learns to
 * scroll past. The other branch reports a run that founded nothing, and four lines of
 * advice under "nothing to found" is the product talking about itself at somebody who
 * asked it to do something and was told it already had.
 *
 * ITS FIRST LINE WAS "An agent host reads an `AGENTS.md` or a `CLAUDE.md` on its own",
 * and for the host this product ships a plugin for that is two claims and one of them is
 * false in the ordinary case: Claude Code reads an `AGENTS.md` only from 2.1.277, and by
 * default only where no `CLAUDE.md` exists (code.claude.com/docs/en/memory); 0 of 299
 * sessions on one machine loaded one, in two projects that keep both files. And it never
 * named the route that needs no file at all, which is the plugin: its `SessionStart`
 * handlers hand the document and the notes to every session. So the block now says the
 * plugin first, and the file only for a session the plugin does not reach.
 */
export const REACHES_AN_AGENT = [
  'mnema writes no file of yours. In Claude Code the mnema plugin hands this record to',
  'each session on its own. Without it, `mnema brief > MNEMA.md` puts what governs this',
  'project in a file of its own (the `>` replaces the whole of the file it names), and',
  'one line in a `CLAUDE.md` brings that file in (an `AGENTS.md` is read there only',
  'where no `CLAUDE.md` exists):',
];

/**
 * The same block for a run that did write a file of the repository's (the `.prettierignore`, an
 * instructions file, and the output says so just above it): "no file of yours" would be false
 * there, so the first words say "no other file". Everything after them is the block above, word
 * for word.
 */
export const REACHES_AN_AGENT_AFTER_A_WRITE = [
  'mnema writes no other file of yours. In Claude Code the mnema plugin hands this record to',
  ...REACHES_AN_AGENT.slice(1),
];

/**
 * The line that goes in a file this product did not write, printed at the depth that means
 * VERBATIM.
 *
 * It names `MNEMA.md` because the recipe above does, and the two are one offer: a line
 * pointing at a file nobody made reaches a reader and tells it nothing. It is the shape
 * `mnema brief --help` publishes, the line `@MNEMA.md` in a `CLAUDE.md`, said as the
 * literal to paste rather than as a description of one, which is the difference between a
 * recommendation a person can act on and one they have to compose.
 *
 * IT WAS A SENTENCE, "What governs the work here is in `MNEMA.md`.", and a sentence is
 * the form the host reads only if the agent decides to open the file it names: a
 * `CLAUDE.md` "that tells Claude in words" to read another file is seen "only if it decides
 * to open the file" (code.claude.com/docs/en/memory). An `@` line is an import, expanded
 * into the session with the file that holds it. It is the one route here that reaches the
 * reader whether or not the reader goes looking, which is what this block offers at all.
 */
export const THE_LINE_IN_THEIRS = '@MNEMA.md';

/** Registers `mnema init` on the program. */
export function registerInit(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const init = program
    .command(INIT_VERB)
    .description('establish a mnema project in the current directory')
    .action(async () => {
      const { runInit } = await import('../commands/init.js');
      const result = runInit(here());
      if ('refused' in result) {
        // Worded where both surfaces word why a directory is no project's root. Loaded
        // here, with the adapter: it reads chains, and the floor must not.
        const { WHY_NO_PROJECT_ROOT } = await import('../not-a-project.js');
        reportRefusal(wiring, {
          reason: NOT_A_PROJECT_ROOT,
          message: onOneLine`no project can be founded at ${result.root}: ${WHY_NO_PROJECT_ROOT[result.refused]}. Run \`mnema init\` in the project’s own directory; a note that belongs to no project already goes to the machine-global tree, which needs none.`,
        });
        return;
      }
      // The ROOT is a directory this run discovered from the cwd, and a directory name
      // is the value this whole class was first measured on: a checkout, an archive or
      // a dependency can carry a newline in one and nobody typed it. The anchor beside
      // it cannot: `mnid:` and 64 hex (see {@link onOneLine}).
      if (result.created) {
        io.out(onOneLine`Initialized mnema project at ${result.root}`);
        io.out(render(fact(`identity: ${result.anchor}`)));
        reportIdentity(result.identity, io, render);
        reportIgnore(io, result.around?.prettierIgnore);
        const wroteInstructions = await reportInstructions(
          io,
          render,
          result.around?.instructions ?? [],
        );
        io.out('');
        const reaches =
          result.around?.prettierIgnore === undefined && !wroteInstructions
            ? REACHES_AN_AGENT
            : REACHES_AN_AGENT_AFTER_A_WRITE;
        for (const line of reaches) io.out(render(fact(line)));
        io.out(render(fact(THE_LINE_IN_THEIRS, 2)));
        for (const line of whatComesNext(result)) io.out(line === '' ? '' : render(fact(line)));
      } else {
        if (result.completed === undefined) {
          io.out(onOneLine`Already a mnema project at ${result.root}: nothing to found.`);
        } else {
          io.out(
            onOneLine`Already a mnema project at ${result.root}: nothing to found, and what it lacked beside the record is added.`,
          );
          if (result.completed.readme) io.out('Added .mnema/README.md.');
          if (result.completed.editorconfig) io.out('Added .mnema/.editorconfig.');
          if (result.completed.gitignore) io.out('Added the lines it lacked to .mnema/.gitignore.');
          reportIgnore(io, result.completed.prettierIgnore);
        }
        reportWhoWritesHere(result, io, render, (await import('../key-file.js')).keyFileLine);
      }
    });
  return mutatesTheRecord(init);
}

/** The lines under the instructions a founding wrote: what they are, and the door that takes them out. */
export const THE_INSTRUCTIONS_WERE_WRITTEN = [
  'Each holds the mnema instructions an agent host reads at the start of a session: when to',
  'call the mnema tools, and what never goes in the record. `mnema instructions --remove`',
  'takes them out.',
];

/**
 * Says what a founding did to the files a host reads standing instructions from, one line a file,
 * and the lines under them. A file left as it is, because somebody edited its block or it cannot
 * be read or written, is said too, with why and the command that tries again: the founding is
 * done by then, and no file here undoes it. Answers whether any file was written.
 */
async function reportInstructions(
  io: Wiring['io'],
  render: Render,
  files: readonly InstructionsFile[],
): Promise<boolean> {
  const said = files.filter((file) => file.did !== 'unchanged');
  if (said.length === 0) return false;
  const { changeLine } = await import('../commands/instructions.js');
  for (const file of said) io.out(render(fact(changeLine(file))));
  const wrote = said.some((file) => file.did !== 'refused' && file.did !== 'failed');
  if (wrote) for (const line of THE_INSTRUCTIONS_WERE_WRITTEN) io.out(render(fact(line)));
  return wrote;
}

/** Says what init did to the `.prettierignore`, when it did something. */
function reportIgnore(io: Wiring['io'], change: PrettierIgnoreChange | undefined): void {
  if (change === undefined) return;
  const what = change.did === 'created' ? 'Created' : 'Added `.mnema/` to';
  io.out(
    onOneLine`${what} ${change.path}${change.did === 'created' ? ', with the line `.mnema/`' : ''}: a formatter that rewrote the record would break its signatures.`,
  );
}

/**
 * Reports what establishing the identity did, on the one occasion it matters:
 * the run that created the tree.
 *
 * The line that earns its place is the backup key's: a key the person cannot
 * regenerate and cannot recover, because mnema has no central recovery. When
 * this run created it, the person is told WHERE the private half is and that it
 * has to leave the machine: a backup that stays on this disk is lost with the
 * disk, which is the exact loss it exists to survive. That warning is printed
 * only on the run that creates the key: repeated on every init it would become
 * noise a person learns to scroll past.
 *
 * A registered key this tree refused is always reported, never swallowed: a
 * person who believes they hold a usable backup and does not is worse off than
 * one who knows. For the same reason every OTHER key the tree enrolled is named
 * too: the backup is not the only key a roster can hold, and enrolling one
 * changes WHO may speak for the identity. That is not something to learn by
 * reading the chain later.
 */
/**
 * What a person who has just founded a project needs next, which `init` used to leave them to find:
 * that the record is a directory to commit, the first verb, the decision documents the record has
 * never read, and (when the project was founded somewhere other than the repository's root) that
 * the walk a session climbs from the workspace root will not find it.
 *
 * Each line is conditional on a fact the run READ, and none is about the record: they are advice
 * about the working tree, said once, at the moment they are useful.
 * `the-init-says-what-comes-next.test.ts` holds each.
 */
export function whatComesNext(result: InitResult): string[] {
  const lines: string[] = [];
  const around = result.around;
  if (around === undefined) return lines;
  lines.push('');
  if (around.gitRoot !== undefined) {
    lines.push(
      'Commit `.mnema/` with the repository: the record travels with it, and every clone reads it.',
    );
    if (around.foundedBelowTheRoot) {
      lines.push(
        onOneLine`This is not the root of the git repository (${around.gitRoot}). A session opened at that root climbs from there and will not find a project founded below it: run \`mnema init\` there instead, unless the project is meant to live here.`,
      );
    }
  }
  lines.push(
    `Off until switched on: ${STARTS_OFF.join(', ')}.`,
    `Turn one on with \`${SWITCH_ON_COMMAND}\`; \`mnema switch\` lists every channel.`,
  );
  lines.push(
    'Next: `mnema decision record <title> <rationale>`; `mnema status` shows where things stand.',
  );
  for (const base of around.neverImported) {
    lines.push(
      onOneLine`${base.directory} holds ${String(base.documents)} decision document(s) this record has never read: \`mnema decision import ${base.directory}\``,
    );
  }
  return lines;
}

function reportIdentity(identity: InitResult['identity'], io: CliIo, render: Render): void {
  if (identity === undefined) return;
  const backup = identity.backup;
  if (backup?.created === true) {
    io.out(
      render(
        fact(onOneLine`backup key: created and enrolled, private half at ${backup.privateKeyPath}`),
      ),
    );
    io.out(
      render(fact('Move that file off this machine: a backup left on this disk is lost with it.')),
    );
  } else if (backup !== null && identity.enrolled.includes(backup.fingerprint)) {
    io.out(render(fact('backup key: enrolled in this project')));
  }
  for (const fingerprint of identity.enrolled) {
    if (fingerprint === backup?.fingerprint) continue;
    io.out(render(fact(`key ${fingerprint} enrolled in this project`)));
  }
  for (const declined of identity.declined) {
    io.out(render(fact(`key ${declined.fingerprint} was NOT enrolled: ${declined.reason}`)));
  }
}

/**
 * The line under "nothing to found": the identity this machine writes as here, or, where the
 * identity this checkout recorded no longer counts its key, that a write to the public tree is
 * refused.
 *
 * IT WAS THE IDENTITY ALONE, and in a checkout the key had left that was the identity the next
 * write was refused as: measured on the binary, `identity: <the recorded identity>` with exit 0,
 * then `Refused (STALE_ANCHOR)` on the write after it. There the line says the refusal now, in
 * the words the refused write prints: its code, its message, and the file its restore takes, on
 * the line `reportIdentityRefusal` puts it on (`wiring/report.ts`), so a person who runs `init`
 * to see who they are here is told what the write would have told them.
 *
 * THE PUBLIC TREE, because that is the tree this verb answers for and the one a retirement
 * reaches: `key revoke` writes it alone, and a `--scope private` write in the same checkout lands
 * (measured). THE EXIT STAYS 0: `init` did what it was asked, and the line is what changed.
 * `the-init-says-a-write-is-refused.test.ts` runs both checkouts on the binary.
 */
function reportWhoWritesHere(
  result: InitResult,
  io: CliIo,
  render: Render,
  keyFileLine: typeof import('../key-file.js').keyFileLine,
): void {
  const refused = result.writeRefused;
  if (refused === undefined) {
    io.out(render(fact(`identity: ${result.anchor}`)));
    return;
  }
  io.out(
    render(
      fact(
        onOneLine`a write to the public tree here is refused (${refused.code}): ${refused.message}`,
      ),
    ),
  );
  if (refused.keyFile !== undefined) {
    io.out(render(fact(keyFileLine(refused.keyFile, here().env.mnemaHome))));
  }
}
