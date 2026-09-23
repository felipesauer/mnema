/**
 * The `mnema init` wiring: what it declares, and what it prints.
 *
 * `mnema init` — establish a project in the current directory, or say that one is
 * already there. It is the only verb that can CREATE this machine's identity, so it
 * is also the only one with something to report about keys.
 *
 * It used to print two more lines — `registered in the project index` on a founding
 * and `index entry re-asserted` on a second run — about a machine-local index that
 * nothing in the product ever read. Reporting an effect nobody consumes is worse
 * than the dead write itself, because the person acts on what they are told; both
 * the write and the two lines are gone. `cli.writes.golden.txt` is what holds every
 * line this verb prints, so their absence is pinned there byte for byte.
 */

import type { Command } from 'commander';
import type { InitResult } from '../commands/init.js';
import { fact } from '../presentation/detail.js';
import type { Render } from '../presentation/render.js';
import { here } from './context.js';
import type { CliIo } from './io.js';
import { onOneLine } from './on-one-line.js';
import { type Declared, mutatesTheRecord, type Wiring } from './verb.js';

/**
 * The name this verb is registered under, in one place.
 *
 * It is read rather than retyped for the reason `REPL_VERB` is (`wiring/repl.ts`): the bare
 * name offers this verb as the first thing to do in a directory with no project, and it
 * names it BY IDENTITY — so the door cannot end up pointing at a word this program no longer
 * routes.
 */
export const INIT_VERB = 'init';

/**
 * How this project's record reaches an agent — OFFERED to the person who just founded it,
 * and written into nothing.
 *
 * WHY IT IS PRINTED AND NOT WRITTEN, which is the decision this block stands on rather
 * than a shortcut it took. A block spliced into somebody's `AGENTS.md` or `CLAUDE.md`
 * would be text this product pushes at a model unasked, which is a CHANNEL by its own
 * criterion (`record-framing.ts`) — and every channel it pushes can be switched off with
 * the switching recorded. Bytes already written to somebody's disk cannot go quiet when a
 * switch does. So the recipe and the line are offered and the person decides: `git status`
 * after `mnema init` holds one new item and it is `.mnema/`, which is this product's own
 * (`init.test.ts` digests every file this verb touches, and `cli.writes.golden.txt` pins
 * every line it prints).
 *
 * IT REPEATS `mnema brief --help` ON PURPOSE, including the half that page was corrected
 * to carry: the `>` replaces the whole of the file it names. That clause is not decoration
 * beside a recipe — it is the reason the recipe names `MNEMA.md` and not `AGENTS.md`,
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
 * default only where no `CLAUDE.md` exists (code.claude.com/docs/en/memory) — 0 of 299
 * sessions on one machine loaded one, in two projects that keep both files. And it never
 * named the route that needs no file at all, which is the plugin: its `SessionStart`
 * handlers hand the document and the notes to every session. So the block now says the
 * plugin first, and the file only for a session the plugin does not reach.
 */
export const REACHES_AN_AGENT = [
  'mnema writes no file of yours. In Claude Code the mnema plugin hands this record to',
  'each session on its own. Without it, `mnema brief > MNEMA.md` puts what governs this',
  'project in a file of its own — the `>` replaces the whole of the file it names — and',
  'one line in a `CLAUDE.md` brings that file in (an `AGENTS.md` is read there only',
  'where no `CLAUDE.md` exists):',
];

/**
 * The line that goes in a file this product did not write, printed at the depth that means
 * VERBATIM.
 *
 * It names `MNEMA.md` because the recipe above does, and the two are one offer: a line
 * pointing at a file nobody made reaches a reader and tells it nothing. It is the shape
 * `mnema brief --help` publishes — the line `@MNEMA.md` in a `CLAUDE.md` — said as the
 * literal to paste rather than as a description of one, which is the difference between a
 * recommendation a person can act on and one they have to compose.
 *
 * IT WAS A SENTENCE — "What governs the work here is in `MNEMA.md`." — and a sentence is
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
      // The ROOT is a directory this run discovered from the cwd, and a directory name
      // is the value this whole class was first measured on: a checkout, an archive or
      // a dependency can carry a newline in one and nobody typed it. The anchor beside
      // it cannot — `mnid:` and 64 hex (see {@link onOneLine}).
      if (result.created) {
        io.out(onOneLine`Initialized mnema project at ${result.root}`);
        io.out(render(fact(`identity: ${result.anchor}`)));
        reportIdentity(result.identity, io, render);
        io.out('');
        for (const line of REACHES_AN_AGENT) io.out(render(fact(line)));
        io.out(render(fact(THE_LINE_IN_THEIRS, 2)));
      } else {
        io.out(onOneLine`Already a mnema project at ${result.root} — nothing to found.`);
        io.out(render(fact(`identity: ${result.anchor}`)));
      }
    });
  return mutatesTheRecord(init);
}

/**
 * Reports what establishing the identity did, on the one occasion it matters:
 * the run that created the tree.
 *
 * The line that earns its place is the backup key's — a key the person cannot
 * regenerate and cannot recover, because mnema has no central recovery. When
 * this run created it, the person is told WHERE the private half is and that it
 * has to leave the machine: a backup that stays on this disk is lost with the
 * disk, which is the exact loss it exists to survive. That warning is printed
 * only on the run that creates the key — repeated on every init it would become
 * noise a person learns to scroll past.
 *
 * A registered key this tree refused is always reported, never swallowed: a
 * person who believes they hold a usable backup and does not is worse off than
 * one who knows. For the same reason every OTHER key the tree enrolled is named
 * too — the backup is not the only key a roster can hold, and enrolling one
 * changes WHO may speak for the identity. That is not something to learn by
 * reading the chain later.
 */
function reportIdentity(identity: InitResult['identity'], io: CliIo, render: Render): void {
  if (identity === undefined) return;
  const backup = identity.backup;
  if (backup?.created === true) {
    io.out(
      render(
        fact(
          onOneLine`backup key: created and enrolled — private half at ${backup.privateKeyPath}`,
        ),
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
