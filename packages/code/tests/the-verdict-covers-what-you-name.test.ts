/**
 * `mnema verify --workspace` — ONE verdict over the projects the caller names, and the
 * three answers it has to keep apart.
 *
 * The verb covered the two trees of ONE project and stopped there, which is the worst
 * of the three states this question can be in: the product MODELS several projects
 * open at once (the MCP session carries them), and the verdict stopped at the one the
 * caller was standing in. An auditor with five projects ran five commands, got five
 * exit codes, and combined them by a rule they invented in a shell loop — and the rule
 * a `for` loop invents is not this product's.
 *
 * THE SET IS NAMED, NEVER SEARCHED FOR. On the MCP surface the host announces the
 * workspace; a CLI has no host, so the announcer is the person. Walking the disk would
 * have the product GUESSING which projects were meant, and reaching a stranger's
 * project in a folder next door.
 *
 * THE THREE ANSWERS, and every case here is about keeping them apart:
 *
 *   - a project whose record was replayed — it carries a level, and the aggregate is
 *     the WEAKEST of them, so no project passes on another's proof;
 *   - a project with a break — it takes the aggregate down and the line says WHICH one,
 *     because an aggregate alone hides the project that pulled it there;
 *   - a path that holds NO record — not a pass and not a break. Counting it as verified
 *     would let an empty directory carry a CI gate, which is the no-op `verify` has
 *     already been once; counting it as broken would say a chain failed to replay when
 *     none was read. It is reported, left out of the LEVEL, and counted at the end.
 *
 * AND THE THIRD ANSWER USED TO STOP THERE, WHICH IS WHAT THESE CASES NOW SEPARATE. Out
 * of the level was read as out of the exit too, so `verify --workspace ./good ./typo`
 * came back zero over a project nobody verified — while the other two shapes of this
 * verb already refused (a lone unfounded directory says `No mnema project here`, and a
 * set where EVERY path holds none says `Nothing was verified`). One rule, three cases,
 * and one of them disagreed with the other two. Naming a path is asserting that it is a
 * project, so a path that is not one makes the exit non-zero, and `--allow-no-record`
 * is the caller declaring the gap is theirs. It tolerates ABSENCE and never a BREAK,
 * which is the case below that separates the two.
 *
 * Every fixture is built by the PRODUCT — `mnema init`, `mnema task` — and then edited
 * on disk the way an adversary or a `git clone` would. Nothing writes an event by hand.
 * Both channels are read on every case: the lines a person reads and the exit a CI step
 * reads.
 */

import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { listTails, orderedSegments } from '@mnema/chain';
import { resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { runVerify, type TreeVerdict } from '../src/commands/verify.js';

let sandbox: string;
let originalCwd: string;
let originalXdg: string | undefined;
let originalHome: string | undefined;

/** What one invocation said, on both channels. */
interface Said {
  readonly lines: readonly string[];
  readonly issues: readonly string[];
  readonly failed: boolean;
}

function capture(): { io: CliIo; out: string[]; err: string[]; failed: () => boolean } {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  return {
    io: {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      fail: () => {
        failed = true;
      },
    },
    out,
    err,
    failed: () => failed,
  };
}

/** Runs `mnema <argv>` the way the binary does, and reads both channels. */
async function mnema(...argv: readonly string[]): Promise<Said> {
  const c = capture();
  await run([...argv], c.io);
  return { lines: c.out, issues: c.err, failed: c.failed() };
}

/** The discovery environment every project in the sandbox resolves against. */
function env(): { xdgDataHome: string; home: string } {
  return { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') };
}

/** The trees of one project of the sandbox. */
function trees(project: string): { publicRoot: string; privateRoot: string } {
  const resolved = resolveTrees(join(sandbox, project), env());
  return {
    publicRoot: resolved.projectPublic as string,
    privateRoot: resolved.projectPrivate as string,
  };
}

/** The line the report gave one tree of one project. */
function lineFor(said: Said, project: string, scope: 'public' | 'private'): string | undefined {
  return said.lines.find((line) => line.startsWith(`${join(sandbox, project)} ${scope}: `));
}

/** The closing statement — the one line that says what the reading covered. */
function closing(said: Said): string {
  return said.lines.find((line) => line.includes('path(s) named →')) as string;
}

/** The first tail's only segment file in a tree, and the checkpoints beside it. */
function storedFiles(root: string): { segment: string; checkpoints: string } {
  const tail = listTails({ root })[0] as string;
  const segment = orderedSegments({ root }, tail)[0] as string;
  return { segment, checkpoints: join(dirname(segment), 'checkpoints.jsonl') };
}

/** The stored lines of a file, without the empty tail element. */
function lines(file: string): string[] {
  return readFileSync(file, 'utf-8').split('\n').filter(Boolean);
}

/**
 * Edits a stored event so the HASH CHAIN is what catches it — the same tamper every
 * other case of this verb is driven by.
 */
function tamper(root: string): void {
  const { segment } = storedFiles(root);
  const stored = lines(segment);
  const first = JSON.parse(stored[0] as string) as { event: { at: string } };
  first.event.at = '1999-01-01T00:00:00.000Z';
  stored[0] = JSON.stringify(first);
  writeFileSync(segment, `${stored.join('\n')}\n`, 'utf-8');
}

/** Empties a tail's checkpoints: the signatures gone, the events left. */
function deleteSignatures(root: string): void {
  writeFileSync(storedFiles(root).checkpoints, '', 'utf-8');
}

/**
 * A content digest of every file under `dir`, so a read that must write nothing can be
 * proven byte-identical — the shape `guard.test.ts` established and `tail list` reuses.
 */
function digest(dir: string): string {
  const hash = createHash('sha256');
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        hash.update(`L:${relative(dir, full)}\n`);
      } else if (entry.isDirectory()) {
        hash.update(`D:${relative(dir, full)}\n`);
        walk(full);
      } else {
        hash.update(`F:${relative(dir, full)}:${statSync(full).size}:`);
        hash.update(readFileSync(full));
        hash.update('\n');
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
}

/** Founds a project in the sandbox and records one task in it, through the CLI. */
async function found(project: string, ...scope: readonly string[]): Promise<void> {
  const dir = join(sandbox, project);
  mkdirSync(dir, { recursive: true });
  process.chdir(dir);
  const initiated = await mnema('init');
  expect(initiated.failed, initiated.issues.join(' / ')).toBe(false);
  const recorded = await mnema('task', `work in ${project}`, ...scope);
  expect(recorded.failed, recorded.issues.join(' / ')).toBe(false);
  process.chdir(sandbox);
}

/** A directory that is no project: nothing in it, and no `.mnema/` above it. */
function bare(name: string): string {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-workspace-'));
  originalCwd = process.cwd();
  originalXdg = process.env.XDG_DATA_HOME;
  originalHome = process.env.HOME;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  process.env.HOME = join(sandbox, 'home');
  delete process.env.MNEMA_RUN;
  process.chdir(sandbox);
});

afterEach(() => {
  delete process.env.MNEMA_RUN;
  process.chdir(originalCwd);
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('without the flag, nothing moved', () => {
  it('prints the same bytes it always has: the tree, a colon, the chain’s own summary', async () => {
    // THE NON-REGRESSION, said explicitly rather than left to the golden — for the day
    // somebody "improves" the sentence of a lone project while adding to the set. The
    // comparison is against a source this surface cannot influence (the chain's own
    // `summary`), which is the same assertion `the-verdict-is-parts.test.ts` carries.
    await found('alpha');
    process.chdir(join(sandbox, 'alpha'));

    const bareRun = await mnema('verify');
    const done = runVerify({
      cwd: join(sandbox, 'alpha'),
      env: env(),
      requirement: 'chained',
      global: false,
    });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const verdicts = done.trees.filter((one): one is TreeVerdict => one.kind === 'verdict');
    // The comparison below is over a list, so the list is asserted to hold something:
    // a fixture whose trees all came back empty would make this whole case vacuous.
    expect(verdicts.length).toBeGreaterThan(0);
    for (const tree of verdicts) {
      expect(bareRun.lines).toContain(`${tree.scope}: ${tree.result.summary}`);
    }
    // No project qualifies a name, no closing statement, and not a byte naming a path:
    // every one of those is something the set adds and the lone reading must not have.
    expect(bareRun.lines.filter((line) => line.includes(sandbox))).toEqual([]);
    expect(bareRun.lines.filter((line) => line.includes('path(s) named'))).toEqual([]);
    expect(bareRun.failed).toBe(false);
  });
});

describe('two sound projects', () => {
  it('gives each its own lines and ONE verdict over both', async () => {
    await found('alpha');
    await found('beta');

    const said = await mnema('verify', '--workspace', 'alpha', 'beta');
    expect(said.failed, said.issues.join(' / ')).toBe(false);
    expect(lineFor(said, 'alpha', 'public')).toContain('local integrity verified (T1/T2/T4)');
    expect(lineFor(said, 'beta', 'public')).toContain('local integrity verified (T1/T2/T4)');
    // Both trees of both projects: the set does not cover half of each project.
    expect(said.lines.filter((line) => / (public|private): /.test(line))).toHaveLength(4);
    expect(closing(said)).toContain('2 path(s) named → 2 distinct: 2 project(s) covered');
    // A SET WITH NO HOLE IN IT SAYS NOTHING ABOUT ONE. The rule about a path holding no
    // record is stated with the counts, as every rule under this closing statement is,
    // but nothing here was tolerated and nothing was refused — so neither the escape's
    // echo nor the coverage line appears, and stderr is empty.
    expect(closing(said)).not.toContain('did not move it');
    // The COUNT and not the rule: the rule sentence says the words "holding no record"
    // whatever the set is, so the discriminating form is the count clause ending there.
    expect(closing(said)).toContain('2 distinct: 2 project(s) covered.');
    expect(said.issues).toEqual([]);

    // The aggregate is a level, and it is the one the exit is decided by: everything
    // here is signature-covered, so the signature gate passes and the witness gate
    // does not — over the WHOLE set, from one invocation.
    expect((await mnema('verify', '--workspace', 'alpha', 'beta', '--require=signed')).failed).toBe(
      false,
    );
    const gated = await mnema('verify', '--workspace', 'alpha', 'beta', '--require=witnessed');
    expect(gated.failed).toBe(true);
    expect(gated.issues.join('\n')).toContain(
      'requirement not met: --require=witnessed needs externally-witnessed, ' +
        'the weakest of what was covered is fully-signed',
    );
  });
});

describe('one sound and one broken', () => {
  it('takes the WORST, exits on it, and names which project it is', async () => {
    await found('alpha');
    await found('beta');
    tamper(trees('beta').publicRoot);

    const said = await mnema('verify', '--workspace', 'alpha', 'beta');
    // The aggregate alone does not say who: two assertions, because a report that only
    // failed would send an auditor to open five projects by hand.
    expect(said.failed).toBe(true);
    expect(lineFor(said, 'beta', 'public')).toContain('local integrity FAILED');
    // And the sound project keeps its own verdict — the break is not smeared over it.
    expect(lineFor(said, 'alpha', 'public')).toContain('local integrity verified (T1/T2/T4)');
    expect(lineFor(said, 'alpha', 'public')).not.toContain('FAILED');

    // stderr is read on its own by whatever redirected it, so the evidence names the
    // PROJECT as well as the tree — otherwise a tail id sends a reader to the wrong
    // repository.
    const evidence = said.issues.join('\n');
    expect(evidence).toContain(`issue [T1] ${join(sandbox, 'beta')} public `);
    expect(evidence).not.toContain(`issue [T1] ${join(sandbox, 'alpha')} public `);
  });
});

describe('two names of one record', () => {
  it('is ONE project when the same path is named twice', async () => {
    await found('alpha');

    const said = await mnema('verify', '--workspace', 'alpha', 'alpha');
    expect(said.failed, said.issues.join(' / ')).toBe(false);
    expect(said.lines.filter((line) => / public: /.test(line))).toHaveLength(1);
    // The collapse is SAID, not silent: a reader who named two paths and sees one
    // project has to be told the two were one record.
    expect(closing(said)).toContain('2 path(s) named → 1 distinct: 1 project(s) covered');
  });

  it('is ONE project when the second name reaches it through a SYMLINK', async () => {
    // The other path to the same defect, and the one that is invisible to any dedupe
    // over the TEXT: tree resolution never canonicalizes, so `/link/.mnema` and
    // `/alpha/.mnema` are two strings for one chain. Folded twice, one project's level
    // would be counted twice in an aggregate a reader counts by lines.
    await found('alpha');
    symlinkSync(join(sandbox, 'alpha'), join(sandbox, 'link-to-alpha'));

    const said = await mnema('verify', '--workspace', 'alpha', 'link-to-alpha');
    expect(said.failed, said.issues.join(' / ')).toBe(false);
    expect(said.lines.filter((line) => / public: /.test(line))).toHaveLength(1);
    expect(closing(said)).toContain('2 path(s) named → 1 distinct: 1 project(s) covered');
    // The line names the path the caller reached it BY — the first of the two.
    expect(lineFor(said, 'alpha', 'public')).toBeDefined();
  });

  it('is ONE project when a name is a SUBDIRECTORY of one already named', async () => {
    // The walk-up makes every directory inside a project resolve to that project, which
    // is what makes `mnema verify` work from anywhere. Named alongside its own project,
    // it is the same record and must be counted once.
    await found('alpha');
    mkdirSync(join(sandbox, 'alpha', 'src', 'deep'), { recursive: true });

    const said = await mnema('verify', '--workspace', 'alpha', join('alpha', 'src', 'deep'));
    expect(said.failed, said.issues.join(' / ')).toBe(false);
    expect(said.lines.filter((line) => / public: /.test(line))).toHaveLength(1);
    expect(closing(said)).toContain('2 path(s) named → 1 distinct: 1 project(s) covered');
  });
});

describe('a named path that holds no record', () => {
  it('gets its own line, is counted, and does NOT lower the LEVEL of the rest', async () => {
    // The half that discriminates. `verify` over an absent root answers green with no
    // signature checked — so a path folded in as though it were a tree would drag the
    // set to `hash-chain-only` and fail the signature gate over projects that are all
    // fully signed. The escape is on here so this case rules on the LEVEL alone: what
    // the path does to the exit is the case below, and mixing the two would leave this
    // one green whichever way either rule went.
    await found('alpha');
    await found('beta');
    bare('not-a-project');

    const said = await mnema(
      'verify',
      '--workspace',
      'alpha',
      'not-a-project',
      'beta',
      '--allow-no-record',
    );
    expect(said.failed, said.issues.join(' / ')).toBe(false);
    expect(said.lines).toContain(
      `${join(sandbox, 'not-a-project')}: no record here — no \`.mnema/\` is at this path ` +
        'or above it, so there is nothing to rule on',
    );
    // It claims nothing: no level, no layer, and not the word a pass uses.
    const own = said.lines.find((line) =>
      line.startsWith(`${join(sandbox, 'not-a-project')}: `),
    ) as string;
    expect(own).not.toContain('verified');
    expect(own).not.toContain('FAILED');
    expect(closing(said)).toContain(
      '3 path(s) named → 3 distinct: 2 project(s) covered, 1 holding no record',
    );

    const gated = await mnema(
      'verify',
      '--workspace',
      'alpha',
      'not-a-project',
      'beta',
      '--require=signed',
      '--allow-no-record',
    );
    expect(gated.failed, gated.issues.join(' / ')).toBe(false);
  });

  it('does not RAISE it either: the aggregate stays the weakest COVERED project', async () => {
    // The other direction, with the two rules crossed in one fixture: one sound project,
    // one whose signatures are gone, and a path with no record between them. The level
    // has to be the weak project's — not the sound one's (which would be the aggregate
    // read the wrong way round) and not the empty path's (which is in no fold at all).
    // The names beside the level are the discriminator: a path folded in as a verdict
    // would appear there, because `verify` over an absent root answers at exactly the
    // level this fixture's weak project is at.
    //
    // THE ESCAPE IS ON, AND IT IS WHAT KEEPS THIS CASE FROM GOING BLIND. Without it the
    // set exits non-zero for the path as well as for the level, so `failed` would stay
    // true with the requirement comparison deleted — the exit assertion would be true
    // of a fixture that proved nothing about a level at all.
    await found('alpha');
    await found('beta');
    deleteSignatures(trees('beta').publicRoot);
    bare('not-a-project');

    const said = await mnema(
      'verify',
      '--workspace',
      'alpha',
      'not-a-project',
      'beta',
      '--require=signed',
      '--allow-no-record',
    );
    expect(said.failed).toBe(true);
    expect(said.issues.join('\n')).toContain(
      `the weakest of what was covered is hash-chain-only (${join(sandbox, 'beta')})`,
    );
    expect(closing(said)).toContain(
      '3 path(s) named → 3 distinct: 2 project(s) covered, 1 holding no record',
    );
  });
});

describe('naming a path is asserting that it is a project', () => {
  it('exits non-zero and NAMES the path, beside projects that verified', async () => {
    // The defect this rule closes, in the shape it was measured in: one sound project
    // and one path that is no project. It came back zero, so a CI gate went green over
    // a repository nobody had verified — and in CI nobody reads the lines.
    //
    // TWO ASSERTIONS, because the exit alone does not say WHICH path: a reader of a CI
    // log has one line to act on, and "one of the five paths you named" is not
    // something they can act on.
    await found('alpha');
    bare('typo');

    const said = await mnema('verify', '--workspace', 'alpha', 'typo');
    expect(said.failed).toBe(true);
    const why = said.issues.join('\n');
    expect(why).toContain('not every named path holds a record');
    expect(why).toContain(join(sandbox, 'typo'));
    // And it names the escape, so the caller who meant it can say so.
    expect(why).toContain('--allow-no-record');
    // The project that DID verify still verified — the refusal is about the set, and it
    // is not smeared over the record that was read.
    expect(lineFor(said, 'alpha', 'public')).toContain('local integrity verified (T1/T2/T4)');
  });

  it('is accepted when the caller declares it, and the report SAYS it was', async () => {
    // The escape gives back exactly what this set did before the rule: the path stays
    // out of the level, out of the exit, and counted. What it must not do is go quiet
    // about it — an exit of zero over a set with a hole in it is the thing the reader
    // has to be told, and stderr is empty by then.
    await found('alpha');
    bare('typo');

    const said = await mnema('verify', '--workspace', 'alpha', 'typo', '--allow-no-record');
    expect(said.failed, said.issues.join(' / ')).toBe(false);
    expect(closing(said)).toContain(
      '`--allow-no-record` said otherwise, so the 1 holding none did not move it',
    );
    // The path is still reported and still counted: tolerated is not hidden.
    expect(closing(said)).toContain(
      '2 path(s) named → 2 distinct: 1 project(s) covered, 1 holding no record',
    );
    expect(said.lines.filter((line) => line.includes('no record here'))).toHaveLength(2);
  });

  it('tolerates ABSENCE and never a BREAK — the two the flag could confuse', async () => {
    // The case that separates the two things one flag could swallow. A set with the
    // escape on AND a project whose chain is tampered with must still exit non-zero:
    // a flag that turned `mnema verify` into a no-op over a forged record is the defect
    // the whole verb exists against, and it would arrive here disguised as leniency.
    await found('alpha');
    await found('beta');
    tamper(trees('beta').publicRoot);
    bare('typo');

    const said = await mnema('verify', '--workspace', 'alpha', 'typo', 'beta', '--allow-no-record');
    expect(said.failed).toBe(true);
    expect(lineFor(said, 'beta', 'public')).toContain('local integrity FAILED');
    // And the reason is the break, not the path: the path was tolerated and says so.
    expect(closing(said)).toContain('`--allow-no-record` said otherwise');
    expect(said.issues.join('\n')).not.toContain('not every named path holds a record');
    expect(said.issues.join('\n')).toContain(`issue [T1] ${join(sandbox, 'beta')} public `);
  });

  it('says BOTH when the level is too weak and a path holds no record', async () => {
    // Two criteria, two fixes, and neither masked by the other: a reader told only
    // about the level would correct the level, run it again, and meet the path. The
    // coverage line comes first because it questions the SET the level was over.
    await found('alpha');
    await found('beta');
    deleteSignatures(trees('beta').publicRoot);
    bare('typo');

    const said = await mnema('verify', '--workspace', 'alpha', 'typo', 'beta', '--require=signed');
    expect(said.failed).toBe(true);
    const why = said.issues.join('\n');
    expect(why).toContain(`not every named path holds a record: 1 path(s) hold none`);
    expect(why).toContain(
      `the weakest of what was covered is hash-chain-only (${join(sandbox, 'beta')})`,
    );
    // Order, asserted rather than assumed: the set before the level.
    expect(why.indexOf('not every named path')).toBeLessThan(why.indexOf('requirement not met'));
  });

  it('counts DISTINCT paths, so two names of one bare directory are one', async () => {
    // The dedupe is the set's rule and it holds over this one too: a caller who named
    // the same unfounded directory twice has one hole, not two, and a count that said
    // two would be the report disagreeing with the lines it just printed.
    await found('alpha');
    bare('typo');
    symlinkSync(join(sandbox, 'typo'), join(sandbox, 'link-to-typo'));

    const said = await mnema('verify', '--workspace', 'alpha', 'typo', 'typo', 'link-to-typo');
    expect(said.failed).toBe(true);
    expect(said.issues.join('\n')).toContain('not every named path holds a record: 1 path(s)');
    expect(closing(said)).toContain(
      '4 path(s) named → 2 distinct: 1 project(s) covered, 1 holding no record',
    );
  });

  it('is refused as a declaration with no subject when no set was named', async () => {
    // A bare `verify` names no paths, so there is nothing here for the flag to
    // tolerate — and a caller who wrote it believes they relaxed something. Ignoring it
    // silently is how a CI step ends up asking for a leniency it never got.
    await found('alpha');
    process.chdir(join(sandbox, 'alpha'));

    const said = await mnema('verify', '--allow-no-record');
    expect(said.failed).toBe(true);
    expect(said.issues.join('\n')).toContain(
      '`--allow-no-record` is about the paths a set names, and this invocation named none',
    );
    // It refused rather than ruling: no verdict came out of this invocation.
    expect(said.lines).toEqual([]);
  });
});

describe('every named path holds no record', () => {
  it('is NOT verified and does NOT exit zero — the case that makes this a gate', async () => {
    // The whole set outside the aggregate: there is nothing to fold, so there is no
    // verdict. A zero here would be `mnema verify` passing a CI gate over a set of
    // empty directories, which is the no-op this verb has already been once.
    bare('nothing-here');
    bare('nothing-there');

    const said = await mnema('verify', '--workspace', 'nothing-here', 'nothing-there');
    expect(said.failed).toBe(true);
    expect(said.lines.join('\n')).not.toContain('verified');
    expect(closing(said)).toContain(
      '2 path(s) named → 2 distinct: no project covered, 2 holding no record',
    );
    expect(said.issues.join('\n')).toContain(
      'Nothing was verified: none of the 2 path(s) named holds a record.',
    );
    // ONE sentence, and it is this one. The rule that a path holding no record makes
    // the exit non-zero is true of every path here, so a second line naming them would
    // sit under this one telling a reader that SOME of the set is missing where this
    // already says all of it is.
    expect(said.issues.join('\n')).not.toContain('not every named path holds a record');
    // Every path still got its own line: what was named is accounted for, one by one.
    expect(said.lines.filter((line) => line.includes('no record here'))).toHaveLength(2);
  });

  it('stays non-zero with the escape declared, and still says only that', async () => {
    // The escape accepts a gap in a set that was READ; it does not open the case where
    // there was nothing to read. A zero here would be the flag doing exactly what it
    // was written not to do — passing a CI gate over a set of empty directories — and
    // the closing statement must not claim the paths "did not move the exit" directly
    // above the line that exits on them.
    bare('nothing-here');
    bare('nothing-there');

    const said = await mnema(
      'verify',
      '--workspace',
      'nothing-here',
      'nothing-there',
      '--allow-no-record',
    );
    expect(said.failed).toBe(true);
    expect(said.issues.join('\n')).toContain('Nothing was verified: none of the 2 path(s) named');
    expect(said.issues.join('\n')).not.toContain('not every named path holds a record');
    expect(closing(said)).not.toContain('did not move it');
  });

  it('stays non-zero however loose the minimum is, because there is no level at all', async () => {
    // `--require=chained` is the loosest thing a caller can declare, and it must not
    // turn "nothing was judged" into a pass: the requirement is compared against a
    // level, and there is none.
    bare('nothing-here');

    const said = await mnema('verify', '--workspace', 'nothing-here', '--require=chained');
    expect(said.failed).toBe(true);
    expect(said.issues.join('\n')).toContain('Nothing was verified');
  });
});

describe('a project directory is text from outside the record', () => {
  /**
   * A directory whose NAME is a whole line of this report — the forgery this reading is
   * the sharpest case of, since it prints one line per tree per project and then counts
   * the projects those lines are.
   */
  const FORGED = 'evil\n/somewhere/else public: local integrity verified (T1/T2/T4)';

  it('cannot forge a line, through any of the four places a path is printed', async () => {
    // Four sites, one rule, and a fixture that drives all of them at once: the tree's
    // label (with the issues under it), the line of a path holding no record, the names
    // beside the level in the requirement line, and the paths named by the line that
    // says not every named path holds a record. The fourth arrived with that line — it
    // is the shape this rule keeps taking, since every new sentence about a set is a
    // new place a directory becomes text — so the invocation below deliberately does
    // NOT declare the escape: with it, the fourth site would never be reached and this
    // case would be green over a site it never read.
    await found('alpha');
    deleteSignatures(trees('alpha').publicRoot);
    const forgedProject = join(sandbox, `p-${FORGED}`);
    mkdirSync(forgedProject, { recursive: true });
    process.chdir(forgedProject);
    expect((await mnema('init')).failed).toBe(false);
    process.chdir(sandbox);
    const forgedBare = join(sandbox, `b-${FORGED}`);
    mkdirSync(forgedBare, { recursive: true });

    const said = await mnema(
      'verify',
      '--workspace',
      forgedProject,
      forgedBare,
      'alpha',
      '--require=signed',
    );
    expect(said.failed).toBe(true);
    // Not one line of either stream is the forged verdict standing on its own.
    for (const line of [...said.lines, ...said.issues]) {
      expect(line).not.toBe('/somewhere/else public: local integrity verified (T1/T2/T4)');
      expect(line).not.toContain('\n');
    }
    // And the counts still match what a reader counts: two projects, one bare path.
    expect(closing(said)).toContain(
      '3 path(s) named → 3 distinct: 2 project(s) covered, 1 holding no record',
    );
    // Counted by the PREFIX each project's own lines carry, never by searching for
    // ` public: ` — the forged name holds that string, so a count by content would be
    // counting the forgery as evidence against itself.
    const flat = (text: string): string => text.replace(/\s+/g, ' ');
    for (const project of [forgedProject, join(sandbox, 'alpha')]) {
      expect(
        said.lines.filter((line) => line.startsWith(`${flat(project)} public: `)),
      ).toHaveLength(1);
    }
    expect(said.lines.filter((line) => line.includes('no record here'))).toHaveLength(3);
    expect(said.lines.filter((line) => line.startsWith(`${flat(forgedBare)}: `))).toHaveLength(1);
    // THE FOURTH SITE, read on its own: the sentence that names the uncovered paths ran
    // (otherwise the loop above proves nothing about it), and the name it printed is
    // the collapsed one.
    const named = said.issues.filter((line) =>
      line.includes('not every named path holds a record'),
    );
    expect(named).toHaveLength(1);
    expect(named[0]).toContain(flat(forgedBare));
    expect(named[0]).not.toContain(forgedBare);
  });
});

describe('it is a READ, over every project of the set', () => {
  it('leaves the whole sandbox byte-identical — chains, caches and keys', async () => {
    // The strongest form, the mould `tail list` and `usage` use: hash everything the
    // invocation could touch, in every project of the set and in the shared key root.
    // A verifier that opened a writer to answer would be caught here and by nothing
    // lighter — and the set multiplies the exposure by the number of projects.
    await found('alpha');
    await found('beta', '--scope', 'private');
    bare('not-a-project');
    // Read once first, so anything a first read builds (a projection cache) is already
    // there and the digest measures THIS invocation.
    // The escape rides along so the exit assertion below stays a check that nothing
    // went wrong: the set holds a path with no record on purpose (a verifier that
    // opened a writer would do it there as readily as anywhere), and without the
    // declaration the exit would be non-zero for a reason this case is not about.
    await mnema('verify', '--workspace', 'alpha', 'beta', 'not-a-project', '--allow-no-record');

    const before = digest(sandbox);
    const said = await mnema(
      'verify',
      '--workspace',
      'alpha',
      'beta',
      'not-a-project',
      '--global',
      '--allow-no-record',
    );
    expect(said.failed, said.issues.join(' / ')).toBe(false);
    expect(said.lines.filter((line) => / public: /.test(line))).toHaveLength(2);
    expect(digest(sandbox)).toBe(before);
  });
});
