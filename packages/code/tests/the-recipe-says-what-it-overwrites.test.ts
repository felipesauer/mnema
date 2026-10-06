/**
 * WHEREVER THIS PRODUCT PUBLISHES THE RECIPE, IT SAYS WHAT THE REDIRECTION DOES.
 *
 * THE DEFECT THIS WAS WRITTEN FOR, measured on a real repository. The first example on
 * `mnema brief --help` was `mnema brief > AGENTS.md`, and on the project it was measured
 * against that file held 126 lines of the repository's own method — its skills, its
 * plugins, its local prohibitions — and not one mention of mnema. Running the line the
 * product taught would have replaced all of it. `AGENTS.md` is an open convention with
 * tens of thousands of repositories behind it, so a file with content in it is the
 * ORDINARY case and not the exceptional one, and the recipe was published as though the
 * destination were free.
 *
 * WHY IT IS A TEXT GUARD AND NOT A REFUSAL, which is the whole shape of the fix. This
 * verb writes nothing: the `>` is the shell's, not the product's, and `brief` never
 * learns the name of the file or that there was one. So there is no moment at which
 * anything could check, refuse, back up or merge — the only place the truncation can be
 * named is the text that teaches the redirection, BEFORE somebody types it. Making the
 * verb write would answer this differently and is a different product.
 *
 * ONE SENTENCE, READ IN N PLACES. The recipe is published three times — the help page a
 * person reads before typing, {@link HOW_TO_REGENERATE} inside the generated document,
 * read by whoever finds a stale copy, and the block `mnema init` prints to the person who
 * has just founded a project — and they used to be able to drift because nothing compared
 * them. {@link SAYS_WHAT_IT_DOES} is the one reading: every publisher carries the same
 * clause, so a wording changed in one of them and not the others is red here rather than a
 * divergence nobody sees.
 *
 * AND THE PAGES, READ THE SAME WAY. `the-shell-a-page-publishes-is-the-shell-that-runs.test.ts`
 * says the `>` of this recipe on a page is ruled on HERE, and until the case that reads them this
 * file read no Markdown at all: `packages/code/README.md` published `mnema brief > MNEMA.md` and
 * nothing compared it. Every tracked page is swept now, passage by passage, and a publication
 * has to say what it does in its own passage — or, for a fenced block, in the one introducing it.
 *
 * AND THE PUBLISHERS COME OFF THE PROGRAM. The pages are walked with `everyCommandOf`,
 * the same walk the parser's refusals and the completion tree use, so a page that copies
 * the recipe tomorrow — a `brief` subcommand, a verb that suggests the redirection in its
 * own help — is caught by carrying the recipe, not by being on a list in this file. That
 * is the N+1 this guard exists for; a list here would be the defect it was written to
 * catch.
 *
 * TWO PUBLISHERS ARE NOT ON A HELP PAGE, AND THEY ARE READ BY IMPORT. The generated
 * document and `init`'s block are printed at RUN time, so the walk cannot reach them and
 * naming them here is the only way they are read at all — which is exactly the list this
 * file says would be the defect, so it is worth saying what keeps it honest: each is
 * imported from the module that OWNS the text, not transcribed, so a publisher whose
 * wording moves is compared with the others on the next run. What a list of imports cannot
 * catch is a FOURTH publisher of this shape, printed at run time and named nowhere; that
 * is the hole this guard has, and `init`'s block was in it until this line was written.
 */

import type { Brief } from '@mnema/context';
import { describe, expect, it } from 'vitest';
import { buildProgram, type CliIo } from '../src/cli.js';
import { briefDocument } from '../src/presentation/brief.js';
import { REACHES_AN_AGENT, THE_LINE_IN_THEIRS } from '../src/wiring/init.js';
import { everyCommandOf, pathOf } from '../src/wiring/misuse.js';
import { read } from './support/published-examples.js';
import { linesOf, trackedPages } from './support/reading-a-shell-line.js';

/** A silent port: nothing here runs a verb, it only reads what they declare. */
const silent: CliIo = { out: () => {}, err: () => {}, fail: () => {} };

/**
 * What makes a text a PUBLICATION of the recipe: it shows the redirection being typed.
 *
 * The destination is deliberately not in the pattern. What the guard is about is the
 * `>`, and a recipe that redirected somewhere else entirely would carry exactly the same
 * hazard — so matching a file name here would let the next publication out by renaming
 * its example.
 */
const PUBLISHES_THE_RECIPE = /mnema brief >/;

/**
 * The clause that has to be beside it. It is a fragment rather than the whole sentence
 * so the two publishers can word the rest for their own reader, and it carries BOTH
 * facts: that the file is replaced, and that it is replaced whole — "replaces the file"
 * alone reads, to somebody with a file they care about, as an update of it.
 */
const SAYS_WHAT_IT_DOES = /replaces the whole of the file it names/i;

/** A record with nothing in it — the document prints its recipe in every state. */
const EMPTY_BRIEF: Brief = {
  decisions: [],
  skills: [],
  collisions: [],
  divergent: [],
  addressed: 0,
  asking: 0,
  refusing: 0,
  decisionsAwaiting: 0,
  skillsAwaiting: 0,
  editPush: { channel: 'edit-rules-push', on: true },
  asksAPerson: { channel: 'edit-asks-a-person', on: true },
  refusesAWrite: { channel: 'edit-refuses-a-write', on: true },
};

/**
 * Every text this product puts in front of a reader, by the name of the surface.
 *
 * THE PAGE IS CAPTURED AND NOT ASKED FOR, and the difference is the whole guard.
 * `helpInformation()` returns the usage, the description and the options — and NOT the
 * block a verb registers with `addHelpText`, which is exactly where every recipe in this
 * program lives. A first version of this file read that method, and its scan came back
 * with the page missing the only lines it was written to rule on. So the text is what
 * `outputHelp` writes, which is what a person at the terminal gets.
 *
 * The output is redirected per COMMAND rather than on the program, because commander
 * copies the configuration into a subcommand when it is created; setting it on the parent
 * afterwards would leave every child writing to the real stdout.
 */
function everyPublishedText(): ReadonlyMap<string, string> {
  const texts = new Map<string, string>();
  for (const command of everyCommandOf(buildProgram(silent).program)) {
    const page = pathOf(command).join(' ');
    let captured = '';
    command.configureOutput({
      writeOut: (chunk: string) => {
        captured += chunk;
      },
      writeErr: (chunk: string) => {
        captured += chunk;
      },
    });
    command.outputHelp();
    texts.set(`mnema ${page} --help`, captured);
  }
  texts.set('the generated document', briefDocument(EMPTY_BRIEF).join('\n'));
  texts.set('the init recommendation', [...REACHES_AN_AGENT, THE_LINE_IN_THEIRS].join('\n'));
  return texts;
}

/**
 * A page as its PASSAGES: a fenced block is one, and outside a fence a run of lines with no
 * blank line between them is one — a paragraph, a list item, a table. Read through `linesOf`,
 * the one reading of what is fenced that every guard over the pages shares.
 */
function passagesOf(
  markdown: string,
): { readonly at: number; readonly fenced: boolean; readonly text: string }[] {
  const passages: {
    at: number;
    fenced: boolean;
    lines: string[];
    last: number;
    fence: string | null;
  }[] = [];
  for (const { at, fence, source } of linesOf(markdown)) {
    const open = passages.at(-1);
    const continues =
      open !== undefined &&
      open.last === at - 1 &&
      open.fence === fence &&
      (fence !== null || source.trim() !== '');
    if (fence === null && source.trim() === '') continue;
    if (continues) {
      open.lines.push(source);
      open.last = at;
    } else {
      passages.push({ at, fenced: fence !== null, lines: [source], last: at, fence });
    }
  }
  return passages.map(({ at, fenced, lines }) => ({ at, fenced, text: lines.join('\n') }));
}

/**
 * Every place a tracked Markdown page publishes the recipe, with the text that has to say what
 * it does: the passage itself, and — for a fenced block — the passage that introduces it, which
 * is where a page says what a block is about to do. Keyed `<page>:<line>`.
 *
 * THE PAGES ARE SWEPT, NOT LISTED, in the shape of the shell guard's sweep: `git ls-files '*.md'`
 * is the reach, and {@link PAGES_PUBLISHING} below is a reconciliation, never a filter.
 */
function everyPublishedPassage(): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const page of trackedPages()) {
    const passages = passagesOf(read(page));
    passages.forEach((passage, index) => {
      if (!PUBLISHES_THE_RECIPE.test(passage.text)) return;
      const before = passage.fenced ? (passages[index - 1]?.text ?? '') : '';
      found.set(`${page}:${passage.at}`, `${before}\n${passage.text}`);
    });
  }
  return found;
}

/**
 * The pages that publish the recipe today, and how many passages each. Compared with what the
 * sweep found in BOTH directions, so a page that starts publishing it is read here the day it
 * does, and one whose publications vanish tells a broken sweep from a changed workspace.
 */
const PAGES_PUBLISHING: Readonly<Record<string, number>> = {
  'docs/first-record.md': 1,
  'packages/code/README.md': 2,
  'plugin/README.md': 1,
};

describe('every place that publishes the recipe says what the redirection does', () => {
  it('finds the publications at all, and there is more than one', () => {
    // Non-vacuity, and it is the failure this guard is likeliest to have: a walk that
    // returned nothing, or a pattern that stopped matching, would leave the case below
    // green over a product that had dropped the sentence entirely.
    const publishers = [...everyPublishedText()]
      .filter(([, text]) => PUBLISHES_THE_RECIPE.test(text))
      .map(([where]) => where);
    expect(publishers).toContain('mnema brief --help');
    expect(publishers).toContain('the generated document');
    expect(publishers).toContain('the init recommendation');
    expect(publishers.length).toBeGreaterThanOrEqual(3);
  });

  it('names the truncation in each of them', () => {
    for (const [where, text] of everyPublishedText()) {
      if (!PUBLISHES_THE_RECIPE.test(text)) continue;
      const missing = `${where} publishes the recipe and does not say the file is replaced`;
      expect(SAYS_WHAT_IT_DOES.test(text), missing).toBe(true);
    }
  });

  it('has a probe of its own for both patterns', () => {
    // The instrument's own case. A guard whose reading is two regexes is a guard that can
    // go quiet by having one of them stop matching, and this bench has paid for a scanner
    // that reported zero because it was broken rather than because the rule held.
    expect(PUBLISHES_THE_RECIPE.test('  mnema brief > MNEMA.md   the record')).toBe(true);
    expect(PUBLISHES_THE_RECIPE.test('mnema brief | diff - MNEMA.md')).toBe(false);
    expect(SAYS_WHAT_IT_DOES.test('REPLACES the whole of the file it names:')).toBe(true);
    // And what it must NOT accept: the weaker sentence the fix was chosen over.
    expect(SAYS_WHAT_IT_DOES.test('The `>` replaces the file it names.')).toBe(false);
  });

  it('offers a destination that is not already somebody else’s file', () => {
    // The other half of the fix, and it is what the truncation warning is FOR. Saying
    // that `>` replaces a file leaves a reader who has an `AGENTS.md` with nowhere to
    // go; the help answers that in the same place, with a name that collides with no
    // convention, and says what it costs — the host reads the file it reads, and this
    // one only when that file imports it. (This sentence said "an agent host reads
    // `AGENTS.md` on its own", and the host the plugin is for reads one only where no
    // `CLAUDE.md` exists.)
    const help = everyPublishedText().get('mnema brief --help') ?? '';
    expect(help).toContain('mnema brief > MNEMA.md');
    expect(help).toContain('AGENTS.md');
    expect(help).toContain('somebody’s');
    // And the generated document names NO file: it cannot know where it was put, and a
    // name printed there is read as the name that was used.
    const document = everyPublishedText().get('the generated document') ?? '';
    expect(document).toContain('<this file>');
    expect(document).not.toContain('AGENTS.md');
    // `init` offers the same destination and the same alternative, and it offers the line
    // to put in the other file as a LITERAL rather than as a description of one — which is
    // the half the help page cannot give, because it is read by somebody who already knows
    // what they wanted. A recommendation the reader has to compose is one they do not make.
    // THE LITERAL IS AN IMPORT NOW, `@MNEMA.md`, where it was a sentence naming the file:
    // the host reads a sentence's file only if the agent opens it, and expands an import.
    const founding = everyPublishedText().get('the init recommendation') ?? '';
    expect(founding).toContain('mnema brief > MNEMA.md');
    expect(founding).toContain('AGENTS.md');
    expect(founding).toContain('\n@MNEMA.md');
    expect(founding).not.toContain('What governs the work here is in');
  });
  it('reads the pages too, and every page that publishes it says what it does', () => {
    // THE PAGES, which this file did not read while the shell guard said it did: that guard's
    // `THE_SHELL_IS_NOT_OURS` hands the `>` in `mnema brief > MNEMA.md` to this one, and until
    // this case the text read here was the help pages and two texts printed at run time.
    const passages = everyPublishedPassage();
    const perPage: Record<string, number> = {};
    for (const where of passages.keys()) {
      const page = where.slice(0, where.lastIndexOf(':'));
      perPage[page] = (perPage[page] ?? 0) + 1;
    }
    expect(perPage).toEqual(PAGES_PUBLISHING);
    const silent = [...passages]
      .filter(([, text]) => !SAYS_WHAT_IT_DOES.test(text))
      .map(([where]) => where);
    expect(
      silent,
      'these passages publish the recipe and do not say the file is replaced whole',
    ).toEqual([]);
  });

  it('cuts a page into the passages a reader reads together', () => {
    // THE READING'S OWN CASE. A paragraph, a list item and a table are one passage each; a
    // fenced block is one, and carries the passage before it; a blank line ends a passage.
    const page = [
      'Intro line one,',
      'and two.',
      '',
      '```sh',
      'mnema brief > MNEMA.md',
      '```',
      '| a | b |',
      '| - | - |',
      '',
      'Last.',
    ].join('\n');
    expect(passagesOf(page)).toEqual([
      { at: 1, fenced: false, text: 'Intro line one,\nand two.' },
      { at: 5, fenced: true, text: 'mnema brief > MNEMA.md' },
      { at: 7, fenced: false, text: '| a | b |\n| - | - |' },
      { at: 10, fenced: false, text: 'Last.' },
    ]);
  });
});
