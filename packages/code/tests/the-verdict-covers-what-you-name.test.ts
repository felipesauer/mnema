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
 *     already been once; counting it as broken would fail a set for naming a directory
 *     nobody has founded yet. It is reported, left out of the aggregate, and counted at
 *     the end — and when EVERY path is one, the exit may not be zero.
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
  it('gets its own line, is counted, and does NOT lower the verdict of the rest', async () => {
    // The half that discriminates. `verify` over an absent root answers green with no
    // signature checked — so a path folded in as though it were a tree would drag the
    // set to `hash-chain-only` and fail the signature gate over projects that are all
    // fully signed.
    await found('alpha');
    await found('beta');
    bare('not-a-project');

    const said = await mnema('verify', '--workspace', 'alpha', 'not-a-project', 'beta');
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
    // Every path still got its own line: what was named is accounted for, one by one.
    expect(said.lines.filter((line) => line.includes('no record here'))).toHaveLength(2);
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

  it('cannot forge a line, through any of the three places a path is printed', async () => {
    // Three sites, one rule, and a fixture that drives all of them at once: the tree's
    // label (with the issues under it), the line of a path holding no record, and the
    // names beside the level in the requirement line.
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
    await mnema('verify', '--workspace', 'alpha', 'beta', 'not-a-project');

    const before = digest(sandbox);
    const said = await mnema('verify', '--workspace', 'alpha', 'beta', 'not-a-project', '--global');
    expect(said.failed, said.issues.join(' / ')).toBe(false);
    expect(said.lines.filter((line) => / public: /.test(line))).toHaveLength(2);
    expect(digest(sandbox)).toBe(before);
  });
});
