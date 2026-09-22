/**
 * WHAT SHIPS CITES ONLY WHAT SHIPS — no file this repository publishes may point a reader
 * at a document the repository does not publish.
 *
 * WHERE THIS COMES FROM. Seven doc-comments in non-test `src` cited this project's local
 * workbench — `.refactor/active/<delivery>/report.md`, `RECONSTRUCTION.md`, a ledger
 * in `ARCHITECTURE.md`, a study under `.refactor/decisions/`. That directory is
 * `.gitignore`d, so `git ls-files` returns none of those files and nobody outside this
 * machine has one. And the citations SHIPPED: `tsconfig.base.json` sets no
 * `removeComments`, so `tsc` preserves doc-comments, and thirteen files of the built
 * `dist/` carried them — nine of `packages/code/dist/`, which `package.json` publishes as
 * `files: ["dist/"]`. An install put the name of an internal report onto somebody's disk,
 * and a product whose whole subject is a claim you can check was resting claims on
 * documents no reader could open.
 *
 * WHAT THE FIX WAS, because it is not "delete the reference". Each citation was holding a
 * sentence up. The substantive fact was inline in six of the seven already — the numbers,
 * the falsified premise, the named test — so the sentence stands on its own once the
 * pointer goes; the two that did not (`mcp/server.ts`, `edit-rules-push.ts`) now cite
 * `measurements/p1/`, which this repository DOES publish.
 *
 * THE REACH IS WHAT TRAVELS, AND IT IS ASKED OF GIT. A hand-written list of packages
 * carries whoever wrote it's blind spot — the first sweep of this rule was written against
 * a package's own `src` alone and missed `plugin/hooks/session-start.mjs`, which cited the
 * same
 * workbench and is code the Claude Code marketplace installs on somebody's machine. So the
 * corpus is every tracked file under a package's `src` or under `plugin/`, taken from
 * `git ls-files`: what git does not hand out is, by definition, what a stranger does not
 * have.
 *
 * TESTS ARE DELIBERATELY OUT, and the argument is not "they don't travel" alone. They do
 * not — `files: ["dist/"]` ships no test — but the load-bearing reason is that a test is
 * where a name like this BELONGS. `src/outside-the-record.test.ts` holds
 * `.refactor/decisions` as a fixture on purpose: it is the directory a reader of that
 * module would most expect in the published list, so it is the sharpest case that the list
 * excludes it. Extending this guard over tests would turn that file red over code that is
 * exactly right — the false accusation this workspace has already paid for once.
 *
 * WHAT IT DOES NOT COVER. It reads NAMES, not reachability: a citation of a file that is
 * tracked today and deleted tomorrow goes unnoticed, and a sentence that invokes authority
 * without naming anything ("the bench measured it") is invisible to it. The second is not
 * an oversight that can be closed by adding `bench` to the list below — counted after this
 * delivery, that word carries seventeen uses across fourteen non-test source files, and
 * every one of them either states its fact inline or names something git hands out. There
 * it means the repository a reader is already looking at, not a document, and a guard
 * accusing them would be red over correct code.
 *
 * `.refactor` IS SPELLED WITH THE DOT for the same reason: `refactor` alone appears in
 * `chain/src/events/vectors.ts` as the English word, in a sentence about byte layout.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The workspace root — this file is `packages/code/tests/…`. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * WHAT A PUBLISHED FILE MAY NOT NAME, each with why it is here rather than as a bare list.
 *
 * These are DOCUMENTS — a directory and two files a reader would have to open. A WORD whose
 * definition only the workbench holds is a citation too, and it is the sibling guard's:
 * `a-label-a-stranger-can-look-up.test.ts` sweeps every tracked file, tests included, for
 * the workbench's numbered rules and its Portuguese vocabulary. The workbench's own name
 * for itself used to be a row here and moved there, because that guard reads tests and
 * this one deliberately does not, so the word is refused in one place over the larger reach.
 */
const NOT_PUBLISHED: readonly { readonly spelling: string; readonly why: string }[] = [
  { spelling: '.refactor', why: 'the local workbench directory; `.gitignore`d' },
  { spelling: 'RECONSTRUCTION.md', why: 'a workbench document; `git ls-files` has no such file' },
  { spelling: 'ARCHITECTURE.md', why: 'a workbench document; `git ls-files` has no such file' },
];

/** A test file, in any of the extensions this workspace writes them in. */
const A_TEST = /\.test\.[cm]?[jt]sx?$/;

/**
 * What travels: a package's own source, and the plugin the marketplace installs. The
 * shape is matched against the path git printed, so a package added next month is swept
 * without anybody remembering to add it.
 */
const A_PUBLISHED_PATH = /^(?:packages\/[^/]+\/src\/|plugin\/)/;

/** Every tracked file this repository publishes, asked of git. */
const PUBLISHED: readonly string[] = execFileSync('git', ['ls-files'], {
  cwd: ROOT,
  encoding: 'utf-8',
  maxBuffer: 32 * 1024 * 1024,
})
  .split('\n')
  .filter((where) => A_PUBLISHED_PATH.test(where) && !A_TEST.test(where));

/** One citation: where it is, and which unpublishable name it spells. */
interface Citation {
  readonly line: number;
  readonly spelling: string;
}

/**
 * THE RULE, IN ONE FUNCTION WITH EVERY CALLER. The corpus case asks it, and so does every
 * case that pins a legitimate path — a second reading of "does this text cite the
 * workbench" is a second rule, and the two disagree the first time one of them moves.
 *
 * It reads the raw text and not `codeOnly`: the defect lives in the COMMENTS, which is
 * exactly what `codeOnly` blanks. That inverts the usual precaution here and brings back
 * the risk it was built for — a guard that quotes what it forbids accuses itself — so this
 * file sits in `tests/`, which `A_PUBLISHED_PATH` does not match, and a case below asserts
 * that it does not.
 */
function citationsIn(text: string): Citation[] {
  const found: Citation[] = [];
  text.split('\n').forEach((text_line, index) => {
    for (const { spelling } of NOT_PUBLISHED) {
      if (text_line.includes(spelling)) found.push({ line: index + 1, spelling });
    }
  });
  return found;
}

/** The bytes of a published file, read so that a non-UTF-8 fixture is searched too. */
const textOf = (where: string): string => readFileSync(join(ROOT, where)).toString('latin1');

describe('what this repository publishes cites only what this repository publishes', () => {
  /**
   * NOT VACUOUS, AND THIS IS THE CASE THAT SAYS SO. A sweep for an absence answers `0` both
   * when the corpus is clean and when the corpus is empty, and the second reading agrees
   * with the hypothesis instead of testing it. So the reach is pinned by the files this
   * delivery actually cleaned, in three packages and the plugin: a `A_PUBLISHED_PATH` that
   * stops matching, a `git ls-files` that stops answering, or a rename takes this red and
   * names what went.
   */
  it('sweeps the files that carried the defect, so an empty corpus cannot pass as a clean one', () => {
    expect(PUBLISHED).toEqual(
      expect.arrayContaining([
        'packages/chain/src/chain/writer.ts',
        'packages/code/src/commands/usage.ts',
        'packages/code/src/outside-the-record.ts',
        'packages/code/src/transcripts.ts',
        'packages/code/src/tree-sources.ts',
        'packages/code/src/wiring/index.ts',
        'packages/copilot/src/context/unread.ts',
        'plugin/hooks/session-start.mjs',
      ]),
    );
    expect(PUBLISHED.length).toBeGreaterThan(300);
  });

  it('holds no citation of anything a stranger cannot open', () => {
    const accused = PUBLISHED.flatMap((where) =>
      citationsIn(textOf(where)).map(({ line, spelling }) => `${where}:${line} — ${spelling}`),
    );
    expect(accused).toEqual([]);
  });

  /**
   * EVERY SPELLING FIRES. A row that matches nothing is a row that has quietly stopped
   * being a rule, and every row here matches nothing in the corpus today — which is the
   * difference between "absent" and "not looked for".
   */
  it('finds each spelling it forbids, so no row of the list is decorative', () => {
    for (const { spelling } of NOT_PUBLISHED) {
      expect(citationsIn(`a doc-comment mentioning ${spelling} here`)).toEqual([
        { line: 1, spelling },
      ]);
    }
  });

  /**
   * THE FALSE ACCUSATION THIS GUARD HAS A KNOWN WAY OF MAKING. `~/.claude/` is not the
   * discriminant: `transcripts.ts` names `~/.claude/projects/` because that is the host
   * directory it reads and without it the module has no subject, and `wiring/skill.ts`
   * names `~/.claude/skills` to say it is NOT the default, because writing there would be
   * editing another product's configuration. Both are the product doing its job, both are
   * in the corpus above, and an instrument that reddened over them would be worse than none.
   */
  it('says nothing about the host directories the product legitimately names', () => {
    expect(
      citationsIn('Claude Code writes one JSON object per line under `~/.claude/projects/`'),
    ).toEqual([]);
    expect(citationsIn('A default of `~/.claude/skills` would have this land elsewhere')).toEqual(
      [],
    );
    for (const where of ['packages/code/src/transcripts.ts', 'packages/code/src/wiring/skill.ts']) {
      expect(PUBLISHED).toContain(where);
      expect(textOf(where)).toContain('.claude');
      expect(citationsIn(textOf(where))).toEqual([]);
    }
  });

  /**
   * THE GUARD IS NOT ITS OWN CORPUS. This file spells every forbidden name twice over, and
   * a sweep of raw text that reached it would accuse it on the strength of its own
   * documentation — which is how a sibling guard in this workspace once listed itself.
   */
  it('does not sweep itself, which is the only reason it may quote what it forbids', () => {
    const itself = 'packages/code/tests/what-ships-cites-only-what-ships.test.ts';
    expect(A_PUBLISHED_PATH.test(itself)).toBe(false);
    expect(PUBLISHED).not.toContain(itself);
    expect(citationsIn(textOf(itself)).length).toBeGreaterThan(0);
  });
});
