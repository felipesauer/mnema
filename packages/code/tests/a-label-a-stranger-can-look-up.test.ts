/**
 * A LABEL A STRANGER CAN LOOK UP — no file this repository hands out may lean on a word
 * whose definition only the local workbench holds.
 *
 * WHERE THIS COMES FROM. The workbench this project is built from numbers its working rules
 * and calls them by a Portuguese word, and both leaked into the code the rules were applied
 * to: *"at one site because it is one rule (A3)"*, *"the shape amarra A2 exists to kill"*,
 * *"THE ELO"* over a case proving that an option reaches what it feeds. The definitions live
 * in a `.gitignore`d directory, so `git ls-files` returns none of them and nobody with a
 * clone can find out what `A3` is — asked of every tracked file, `measurements/` included,
 * nothing defines one. Thirteen of those lines were in non-test `src`, across eleven files,
 * and `tsc` keeps comments, so the built `dist/` carried them to every install. It is the
 * class `what-ships-cites-only-what-ships.test.ts` closed for documents — a citation the
 * reader cannot open — and this closes it for labels.
 *
 * WHAT THE FIX WAS, because it is not "delete the label". Each one was holding a sentence
 * up. Where the principle was already written beside it (*"ONE RULE FOR THE STATUS, at one
 * site because it is one rule"*) the label went and the sentence stands. Where the label was
 * the sentence's only support, the principle is now written out in words: *"a public option
 * with no production caller"* where `A2` stood.
 *
 * A NUMBERED LIST THE REPOSITORY DOES DEFINE IS NOT THIS, and it looks exactly like it.
 * `G1`–`G7` read as the same kind of label, and the first draft of this guard refused them;
 * but `measurements/p1/round-2/arms.md` defines them in a table a clone has, and the harness
 * beside it cites them as *"G5 of `arms.md`"*, which is a citation anybody can open. So they
 * are not a row. Eight lines had used them bare — three of them in shipped `src` and one in
 * the plugin's hook, naming no file at all — and those now say the principle in words, which
 * loses nothing; a case below reads the definitions out of the files that hold them, so a
 * row that would accuse one is refused before it can be written.
 *
 * THE REACH IS EVERY FILE GIT HANDS OUT, TESTS INCLUDED — the opposite choice from the
 * sibling guard, and for a reason that does not transfer. That guard leaves tests out
 * because a fixture there has to NAME the workbench's directory to test that the product
 * excludes it. No test needs a workbench label to test anything: the suite is green with
 * every one of them gone, which is the measurement. What is NOT swept is listed in
 * {@link NOT_SWEPT} with the reason each, plus binary files and this file.
 *
 * THE LIST IS WHAT LEAKED, NOT WHAT COULD. The Portuguese rows are words that turned up in
 * English comments. Words the workbench uses that never leaked are not rows, and one of them
 * is why: `core/src/adr/read.test.ts` holds Portuguese ADRs on purpose — importing them is
 * the product's job — and one of its fixture sentences uses `entrega`, which is also a
 * workbench word. A row for it would accuse a fixture that is exactly right. The same cost
 * stands behind every Portuguese row that IS here: the day a Portuguese fixture needs one of
 * them, that is the case this list is wrong about, and it is argued here rather than dodged.
 *
 * WHAT IT DOES NOT COVER. A label with no family. `L4`, `E3`, `S2`, `P2`–`P4` and a battery
 * row `M9.4` stood in the tree as one-offs, defined nowhere, and were removed by hand in the
 * same change — but nothing here would catch the next one: a single letter and a digit
 * cannot be forbidden without accusing the format's `T1`–`T4`, the Unicode blocks `C0` and
 * `C1`, `P1` (the measurement `measurements/p1/protocol.md` publishes and defines) or the
 * `G1`–`G7` above. And English process words — a delivery, a battery, the bench — are the
 * sibling's argument, which stands: where they appear, the fact is stated inline.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The workspace root — this file is `packages/code/tests/…`. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** This file, spelled the way `git ls-files` spells it. */
const ITSELF = relative(ROOT, fileURLToPath(import.meta.url));

/**
 * WHAT NO FILE HERE MAY LEAN ON, each with why it is a row.
 *
 * The label is CASE-SENSITIVE and bounded by anything that is not a letter, a digit or `_`:
 * a digest is lower-case hex, so `a3f9…` is not `A3`, and `0xA1` is not `A1`. The bound is
 * not the hyphen, so a range written `A1-A14` is two labels, as `A5/A10` was. The words are
 * case-insensitive, because the comments that carried them shouted (`THE ELO`) as often as
 * they did not.
 *
 * `A<n>` would accuse a paper size (`A4`) or a spreadsheet's `A1`. Measured before the row
 * was written: every standalone `A` with a digit in the tree was a workbench label, and
 * none was either of those.
 */
const WORKBENCH_VOCABULARY: readonly {
  readonly name: string;
  readonly pattern: RegExp;
  readonly why: string;
}[] = [
  {
    name: 'A<n>',
    pattern: /(?<![A-Za-z0-9_])A[1-9][0-9]?(?![A-Za-z0-9_])/,
    why: 'the numbered working rules of the workbench, defined in no file git hands out',
  },
  {
    name: 'amarra',
    pattern: /\bamarras?\b/i,
    why: 'the workbench’s Portuguese word for its working rules',
  },
  {
    name: 'elo',
    pattern: /\belos?\b/i,
    why: 'Portuguese for "link" — the workbench’s name for the case that proves an option reaches what it feeds',
  },
  { name: 'achado', pattern: /\bachados?\b/i, why: 'Portuguese for "finding"' },
  {
    name: 'sitio',
    pattern: /\bs[ií]tios?\b/i,
    why: 'Portuguese for "site", with and without the accent the workbench writes it with',
  },
  {
    name: 'bancada',
    pattern: /\bbancadas?\b/i,
    why: 'the workbench itself, in the word its process documents use',
  },
];

/**
 * WHAT IS NOT SWEPT, each with the reason — a reach with an unargued hole is a reach with a
 * blind spot, and the cases below hold each reason to still being true.
 */
const NOT_SWEPT: readonly { readonly path: RegExp; readonly why: string }[] = [
  {
    path: /^measurements\//,
    why: 'carries the same labels and is left for a change of its own; a case below goes red the day it stops carrying them, so this excuse cannot outlive its reason',
  },
  {
    path: /^pnpm-lock\.yaml$/,
    why: 'generated by pnpm and written by nobody; its 293 integrity hashes are 25,784 base64 characters, where `+A1/` turns up by chance in about one lockfile in ten (measured when this row was written), so a dependency bump would redden this guard over nothing',
  },
];

/**
 * The text of a tracked file. A NUL byte decodes to U+0000, so a binary file read this way
 * still says what it is.
 */
const textOf = (where: string): string => readFileSync(join(ROOT, where), 'utf-8');

/** A binary file, told apart the way git's own test tells one: it holds a NUL. */
const isBinary = (text: string): boolean => text.includes('\0');

/** Every tracked file, asked of git — what git does not hand out, a stranger does not have. */
const TRACKED: readonly string[] = execFileSync('git', ['ls-files'], {
  cwd: ROOT,
  encoding: 'utf-8',
  maxBuffer: 32 * 1024 * 1024,
})
  .split('\n')
  .filter((where) => where !== '');

/** Every file this sweep reads: tracked, text, not excused, and not this file. */
const CORPUS: readonly { readonly where: string; readonly text: string }[] = TRACKED.filter(
  (where) => where !== ITSELF && !NOT_SWEPT.some(({ path }) => path.test(where)),
).flatMap((where) => {
  const text = textOf(where);
  return isBinary(text) ? [] : [{ where, text }];
});

/** The text of one swept file, or nothing when the sweep does not hold it. */
const sweptText = (where: string): string | undefined =>
  CORPUS.find((file) => file.where === where)?.text;

/** One use: the line it is on, and which row of the vocabulary it spells. */
interface Label {
  readonly line: number;
  readonly name: string;
}

/**
 * THE RULE, IN ONE FUNCTION WITH EVERY CALLER. The corpus case asks it, and so does every
 * case that plants a spelling or pins a legitimate one — a second reading of "does this
 * text lean on the workbench" is a second rule, and the two disagree the first time one of
 * them moves. No pattern carries the `g` flag, so `test` keeps no position between lines.
 *
 * It reads raw text, comments included, because the comments are where the defect lived.
 * That brings back the risk a raw reading always carries — a guard that quotes what it
 * forbids accuses itself — so this file is taken out of its own corpus by name, and a case
 * below asserts both halves: that it is out, and that it would be accused if it were in.
 */
function labelsIn(text: string): Label[] {
  const found: Label[] = [];
  text.split('\n').forEach((text_line, index) => {
    for (const { name, pattern } of WORKBENCH_VOCABULARY) {
      if (pattern.test(text_line)) found.push({ line: index + 1, name });
    }
  });
  return found;
}

/** What an empty sweep says, instead of "clean". */
const RULER_BROKEN =
  'RULER BROKEN: the sweep read no files, and a sweep that reads nothing reports every absence it was asked about';

describe('the repository leans on no label and no word that only the workbench defines', () => {
  /**
   * NOT VACUOUS, AND THIS IS THE CASE THAT SAYS SO. A sweep for an absence answers `0` both
   * when the corpus is clean and when it is empty. So the reach is pinned by files that
   * carried the defect in every place it was — three packages' `src`, a test inside `src`,
   * the suite, its support and CI — plus the plugin's hook, which ships as it is, and an
   * empty corpus fails with a sentence saying the ruler broke rather than with a count.
   */
  it('sweeps the files that carried the defect, in every place it was', () => {
    const swept = CORPUS.map(({ where }) => where);
    expect(swept.length, RULER_BROKEN).toBeGreaterThan(600);
    expect(swept).toEqual(
      expect.arrayContaining([
        'packages/chain/src/chain/witness.ts',
        'packages/code/src/commands/witness.ts',
        'packages/code/src/presentation/width.ts',
        'packages/core/src/identity/alias.ts',
        'packages/core/src/topology/routing.ts',
        'packages/chain/src/chain/second-reader-says-what-it-does-not-check.test.ts',
        'packages/code/tests/the-bare-name-asks.test.ts',
        'packages/code/tests/support/screen.ts',
        '.github/the-link-cannot-come-back/scan.mjs',
        'plugin/hooks/session-start.mjs',
      ]),
    );
  });

  it('holds no label and no word whose definition only the workbench has', () => {
    expect(CORPUS.length, RULER_BROKEN).toBeGreaterThan(0);
    const accused = CORPUS.flatMap(({ where, text }) =>
      labelsIn(text).map(({ line, name }) => `${where}:${line} — ${name}`),
    );
    expect(accused).toEqual([]);
  });

  /**
   * EVERY ROW FIRES, ON A LINE THAT REALLY LEAKED. Each line below is quoted from the tree
   * before the fix, so the planted text is what the defect produced and not what a test
   * author imagined it would look like — including the two shapes a narrower pattern would
   * have missed: a range (`A5/A10`) and a label with no brackets in running prose.
   */
  it('finds each spelling it forbids, in the shapes they leaked in, so no row is decorative', () => {
    const LEAKED: readonly { readonly name: string; readonly line: string }[] = [
      {
        name: 'A<n>',
        line: '// ONE RULE FOR THE STATUS, at one site because it is one rule (A3):',
      },
      { name: 'A<n>', line: ' * A3: THE WRITING CALLS THE FUNCTION THE READING CALLS.' },
      {
        name: 'A<n>',
        line: ' * that accuses is the other half of A5 and this is what it looks like.)',
      },
      { name: 'A<n>', line: '// A5/A10: the observable that this case used to assert is GONE' },
      { name: 'A<n>', line: ' * OFF say so with the switch that decided it (A13 — nothing here' },
      {
        name: 'A<n>',
        line: "  it('A1: enumerates every site that decides whether there is room to draw'",
      },
      {
        name: 'amarra',
        line: ' * green eighteen times out of eighteen on its own. It is the amarra this',
      },
      {
        name: 'elo',
        line: '// THE ELO. A status that never travels from the file to the sentence',
      },
      {
        name: 'achado',
        line: '// THE FOURTH IS THE ACHADO. The design of this delivery counted three',
      },
      { name: 'sitio', line: ' * A guard whose reversion is green is a sitio with no guard.' },
      { name: 'sitio', line: 'o sítio N+1 que a lista não tem' },
      { name: 'bancada', line: 'the bancada measured it' },
    ];
    for (const { name, line } of LEAKED) {
      expect(labelsIn(line), line).toEqual([{ line: 1, name }]);
    }
    expect(new Set(LEAKED.map(({ name }) => name))).toEqual(
      new Set(WORKBENCH_VOCABULARY.map(({ name }) => name)),
    );
  });

  /**
   * THE FALSE ACCUSATIONS THIS GUARD HAS KNOWN WAYS OF MAKING. A letter and a digit is a
   * shape the repository uses for things it DOES define, and a Portuguese word is a thing
   * its fixtures legitimately carry. Each line is the shape as the tree writes it.
   */
  it('says nothing about the labels the repository defines, or about words that only contain a forbidden one', () => {
    const LEGITIMATE: readonly string[] = [
      'G06 · G11 · G23 — the gaps the format names',
      '// G5 OF `measurements/p1/round-2/arms.md` IS WHAT THIS ANSWERS, and the tie is worth',
      '#> public: local integrity verified (T1/T2/T4); 1 tail(s)',
      '## 8. The external witness (T3)',
      ' * Whether a code unit may not appear raw inside a double-quoted YAML scalar: a C0',
      ' * `prosa` arm of the P1 protocol is *"the same decision, verbatim, in a',
      '| D1 | Store timestamps in UTC | three services send three zones | ABC-1 |',
      '/ok S3 the hash chain closes over 4 entries/',
      'M-1 lights it, M-a does not',
      'U+200B · V8 · 0xA1 · agent-A · A-1',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      'develop, below, melody and hello all hold the letters of a forbidden word',
      'out of *"O **estado** de cada entrega não está declarado"*, and then isolated below',
    ];
    for (const line of LEGITIMATE) expect(labelsIn(line), line).toEqual([]);

    const SWEPT_AND_LEGITIMATE: readonly { readonly where: string; readonly carries: RegExp }[] = [
      { where: 'packages/chain/FORMAT.md', carries: /\(T3\)/ },
      { where: 'packages/code/src/agent-skill.ts', carries: /\bC1\b/ },
      {
        where: 'packages/code/tests/the-converter-a-page-publishes-runs.test.ts',
        carries: /\| D1 \|/,
      },
      { where: 'packages/core/src/adr/read.test.ts', carries: /\bentrega\b/ },
    ];
    for (const { where, carries } of SWEPT_AND_LEGITIMATE) {
      const text = sweptText(where);
      expect(text, `${where} is not in the sweep`).toBeDefined();
      expect(text).toMatch(carries);
      expect(labelsIn(text ?? '')).toEqual([]);
    }
  });

  /**
   * A LABEL THE REPOSITORY DEFINES IS NEVER A ROW, read from the files that define them. The
   * format's gap ids come out of `gaps.py`, and `G1`–`G7` out of the table in the P1 round's
   * `arms.md` — the list the first draft of this guard mistook for the workbench's. A row
   * written tomorrow that would accuse either goes red HERE, naming the definition it
   * collides with, rather than as a corpus full of accusations against published words.
   */
  it('never accuses a label the repository defines, read from the files that define them', () => {
    const gaps = textOf('packages/chain/verifier/mnemaverify/gaps.py');
    const gapIds = [...new Set(gaps.match(/\bG\d+\b/g) ?? [])];
    expect(gapIds.length).toBeGreaterThan(10);
    expect(gapIds.filter((id) => labelsIn(id).length > 0)).toEqual([]);

    const arms = 'measurements/p1/round-2/arms.md';
    expect(TRACKED).toContain(arms);
    const ties = [...textOf(arms).matchAll(/^\| \*\*(G\d+)\*\* /gm)].map((match) => match[1]);
    expect(ties).toEqual(['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7']);
    expect(ties.filter((id) => labelsIn(`${id} of arms.md`).length > 0)).toEqual([]);
  });

  /**
   * EVERY EXCUSE STILL HAS ITS REASON. An exclusion whose reason has lapsed is a hole with a
   * story attached, so each is held to what it says: `measurements/` still carries the labels
   * (and the day it does not, this case says to sweep it), the lockfile is still the
   * generated file, and the proofs skipped as binary are tracked and are not text.
   */
  it('excuses only what it argues for, and says when an excuse has stopped being needed', () => {
    const measured = TRACKED.filter((where) => where.startsWith('measurements/'));
    expect(measured.length).toBeGreaterThan(0);
    const stillCarrying = measured.filter((where) => {
      const text = textOf(where);
      return !isBinary(text) && labelsIn(text).length > 0;
    });
    expect(
      stillCarrying.length,
      'measurements/ carries no workbench label any more: take its row out of NOT_SWEPT, so it is swept',
    ).toBeGreaterThan(0);

    expect(TRACKED).toContain('pnpm-lock.yaml');
    expect(textOf('pnpm-lock.yaml')).toMatch(/^lockfileVersion:/);

    const binary = TRACKED.filter((where) => where.endsWith('.ots'));
    expect(binary.length).toBeGreaterThan(0);
    for (const where of binary) {
      expect(isBinary(textOf(where))).toBe(true);
      expect(sweptText(where)).toBeUndefined();
    }
  });

  /**
   * THE GUARD IS NOT ITS OWN CORPUS, and the exclusion is load-bearing: this file is
   * tracked, it quotes every row it forbids, and a sweep that reached it would accuse it on
   * the strength of its own documentation — which is how a sibling guard in this workspace
   * once listed itself.
   */
  it('does not sweep itself, which is the only reason it may quote what it forbids', () => {
    expect(ITSELF).toBe('packages/code/tests/a-label-a-stranger-can-look-up.test.ts');
    expect(TRACKED).toContain(ITSELF);
    expect(sweptText(ITSELF)).toBeUndefined();
    const own = new Set(labelsIn(textOf(ITSELF)).map(({ name }) => name));
    expect(own).toEqual(new Set(WORKBENCH_VOCABULARY.map(({ name }) => name)));
  });
});
