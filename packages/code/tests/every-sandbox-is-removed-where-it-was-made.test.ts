/**
 * EVERY FILE THAT MAKES A SANDBOX UNDER `tmpdir()` ALSO REMOVES ONE.
 *
 * WHERE THIS COMES FROM. `packages/copilot/tests/support/chain.ts` made a sandbox with
 * `mkdtempSync(join(tmpdir(), 'mnema-copilot-'))` and nothing in that file removed anything.
 * Measured on 21/08/2026: **296 directories per suite run**, **47.237** of them left in `/tmp`,
 * the newest one from the run that counted them. Three days of that had gone unnoticed because
 * a leaked directory costs nothing anybody looks at.
 *
 * AND THE FIFTEEN CALLERS ALL CLEANED UP, which is the part worth writing down. Every test file
 * using that helper had an `afterEach` doing `rmSync(bench.root, …)` — and `bench.root` is the
 * CHAIN root, several levels inside the sandbox. They emptied the sandbox and left the sandbox.
 * So the defect was not missing cleanup; it was cleanup aimed at what the helper EXPOSED rather
 * than at what the helper CREATED, in a place that was not the place that created it. The fix
 * is A6 read strictly — whoever creates destroys, in the same function — and this case is the
 * cheapest thing that would have gone red on it.
 *
 * THE DISCRIMINANT IS "CREATES IN `tmpdir()`", NOT "CALLS `mkdtemp`". This distinction is the
 * whole instrument, and getting it wrong was the first thing that happened when the sweep was
 * done by hand: `packages/code/tests/support/pty.ts` calls `mkdtempSync` and contains no
 * `rmSync` anywhere, so a rule reading "makes a temp dir and never removes one" accuses it —
 * and it is innocent, because it makes its directory inside `fixture.scratch`, a sandbox its
 * caller owns and its caller removes. There is a case below that holds exactly that file
 * against exactly that mistake, because an instrument that has a known way of being wrong needs
 * a case about being wrong that way.
 *
 * WHAT THIS DOES NOT COVER, said out loud rather than left to be found later. It reads the file,
 * not the path: a file that creates one sandbox and removes a different one satisfies it — which
 * is precisely what those fifteen callers did. Answering that needs the created path followed to
 * the removal, and the shape that would do it (bind the name on the left of the `mkdtemp` and
 * demand it inside an `rmSync`) was tried against this corpus and accused six innocent files,
 * all of which collect their roots into an array and remove them through a loop variable. Six
 * false accusations buys nothing, so it is not that rule. The path is guarded where the path is
 * known instead — `packages/copilot/tests/the-bench-leaves-nothing-behind.test.ts` watches the
 * real `/tmp` across two tests and names the directory that survived.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The workspace root — this file is `packages/code/tests/…`. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * EVERY SOURCE THE WORKSPACE HOLDS, ASKED OF GIT. A hand-written list of directories carries
 * whoever wrote it's blind spot, and a package added next month would simply not be swept.
 */
const SOURCES: readonly string[] = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { cwd: ROOT, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 },
)
  .split('\n')
  .filter((where) => /\.(ts|mts|cts|js|mjs|cjs)$/.test(where));

/** One call to `mkdtempSync`, with whatever follows it on its line. */
const A_MAKING = /mkdtempSync\(([^;]*)/g;
/** The base that call builds on, when the base is the machine's own temp directory. */
const THE_MACHINES_TEMP = /\btmpdir\(\)/;
/** A base at all — some expression is being passed. This is what makes "unreadable" mean it. */
const SOME_BASE = /\S/;
/** A removal — any removal, since this case reads the file and not the path (see the header). */
const A_REMOVAL = /\brmSync\(/;

interface Making {
  readonly where: string;
  readonly line: number;
  readonly onTheMachinesTemp: boolean;
  readonly readable: boolean;
}

/** Every `mkdtempSync` in the workspace, classified by the base it builds on. */
const MAKINGS: readonly Making[] = SOURCES.flatMap((where) => {
  const text = readFileSync(join(ROOT, where), 'utf-8');
  if (!text.includes('mkdtempSync(')) return [];
  return text.split('\n').flatMap((line, index) =>
    [...line.matchAll(A_MAKING)].map((said) => {
      const rest = said[1] ?? '';
      return {
        where,
        line: index + 1,
        onTheMachinesTemp: THE_MACHINES_TEMP.test(rest),
        readable: SOME_BASE.test(rest),
      };
    }),
  );
});

/** The files that put a directory under `tmpdir()`, and what each of them says about removal. */
const CREATORS = [...new Set(MAKINGS.filter((m) => m.onTheMachinesTemp).map((m) => m.where))]
  .sort()
  .map((where) => ({ where, removes: A_REMOVAL.test(readFileSync(join(ROOT, where), 'utf-8')) }));

describe('the instrument reads what it claims to read', () => {
  it('found the makings at all', () => {
    // NOT VACUOUS: a rename of `mkdtempSync`, a move of the packages, or a `git ls-files` that
    // came back empty would leave every case below passing over nothing at all.
    expect(
      MAKINGS.length,
      'no call to mkdtempSync was found anywhere in the workspace',
    ).toBeGreaterThan(100);
    expect(
      new Set(CREATORS.map((c) => c.where.split('/')[1])).size,
      'sandboxes under tmpdir() were found in only one package — the sweep is too narrow',
    ).toBeGreaterThan(1);
  });

  it('says so when it cannot read a making, rather than passing it over', () => {
    // A making split across lines would arrive here with nothing after the paren. Reporting it
    // is the difference between an instrument with a gap and an instrument that hides one.
    const unreadable = MAKINGS.filter((m) => !m.readable).map((m) => `${m.where}:${m.line}`);
    expect(unreadable, 'a call to mkdtempSync is written in a shape this case cannot read').toEqual(
      [],
    );
  });

  it('does not accuse a sandbox made inside a sandbox the caller owns', () => {
    // THE INSTRUMENT'S OWN CASE. `support/pty.ts` calls mkdtempSync and has no rmSync at all,
    // so it is the exact file a rule about "mkdtemp without cleanup" gets wrong — and it is
    // innocent, because its base is `fixture.scratch`. If this case ever goes red because that
    // file changed, the answer is to pick another innocent file, not to widen the rule.
    const pty = MAKINGS.filter((m) => m.where === 'packages/code/tests/support/pty.ts');
    expect(
      pty.length,
      'support/pty.ts no longer makes a sandbox — pick another innocent file',
    ).toBe(1);
    expect(
      pty[0]?.onTheMachinesTemp,
      'support/pty.ts is being read as making one under tmpdir()',
    ).toBe(false);
    expect(
      A_REMOVAL.test(readFileSync(join(ROOT, 'packages/code/tests/support/pty.ts'), 'utf-8')),
      'support/pty.ts now removes something, so it no longer discriminates the two rules',
    ).toBe(false);
    expect(CREATORS.map((c) => c.where)).not.toContain('packages/code/tests/support/pty.ts');
  });
});

describe('a sandbox under tmpdir() is removed by the file that made it', () => {
  it('leaves nothing behind, in every file that makes one', () => {
    const leaking = CREATORS.filter((c) => !c.removes).map((c) => c.where);
    expect(
      leaking,
      'these files make a directory under tmpdir() and never remove one — every run of the suite leaves them in /tmp',
    ).toEqual([]);
  });
});
