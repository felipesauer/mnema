/**
 * THE ATTRIBUTION FOOTER IS REFUSED BEFORE IT REACHES THE TRUNK, AND NOTHING ELSE IS.
 *
 * WHERE THIS COMES FROM. This repository does not credit the tool that wrote a change in the
 * change's own record. That rule is old, it is explicit, and for 243 pull requests it held
 * because a person remembered it every time. A sweep on 2026-09-11 found `main-v1` carrying ONE
 * co-author trailer and THIRTEEN `Generated with [Claude Code]` lines, and NINETEEN more in the
 * DESCRIPTIONS of merged pull requests, #361 to #616. Three of the four deliveries around the
 * leak were read by hand before their merge; the fourth was not, and it is the one that carried
 * it. Undoing it took 194 rewritten commits and a force-push onto a protected branch.
 *
 * SO THE PROPERTY HAS TWO HALVES AND THIS FILE SPENDS AS MUCH ON THE SECOND. A guard that
 * refuses the footer is worth nothing if it also refuses the 13 legitimate `Co-authored-by:
 * dependabot[bot]` trailers on this trunk — it would block the next dependency bump and be
 * switched off that afternoon — or if it refuses the word `claude`, which is a VALUE of this
 * product (`which: 'claude'`) and the subject of `plugin/`. The six cases the delivery was
 * accepted against are three reds and three greens, and the greens are load-bearing:
 *
 *   1. a commit carrying `Co-Authored-By: Claude …`                            → red
 *   2. a commit carrying `🤖 Generated with [Claude Code](…)`                   → red
 *   3. the same footer in the pull request BODY only, every commit clean       → red
 *   4. a dependabot commit, `Co-authored-by: dependabot[bot]`                  → GREEN
 *   5. a commit that only MENTIONS `claude`, in prose or in a fixture value    → GREEN
 *   6. a scan that examined zero commits                                       → red, by name
 *
 * CASE 3 IS THE ONE THAT ALMOST ESCAPED. The body is not git — it is a field of the GitHub API —
 * and it carried 19 of the 33 leaks. A guard over commit messages alone leaves the larger half
 * open, so `the scan reads both surfaces` below fails if either stops being handed over.
 *
 * CASE 6 IS THE SHAPE THIS BENCH HAS BEEN BITTEN BY THREE TIMES. An instrument handed an empty
 * universe reports the property as HOLDING: a shallow checkout, an unfetched base, or a range
 * written backwards all yield zero commits, and zero commits carry no footer. The scan refuses
 * with a phrase of its own, `THE_CANARY`, which is imported here rather than quoted.
 *
 * THE RULE IS EXERCISED AGAINST REAL GIT, NOT ONLY AGAINST THE SEAM. `commitsIn` shells out, so
 * the cases that matter build a repository under a temp directory of their own (A6) and commit
 * into it. A seam that is never checked against git is a second definition of what a commit is,
 * and this guard's whole failure mode is two definitions of one rule.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  asProse,
  attributionIn,
  commitsIn,
  judge,
  main,
  NO_PULL_REQUEST,
  pullRequestFrom,
  rangeFrom,
  THE_CANARY,
  THE_FOOTERS,
} from '../../../.github/the-link-cannot-come-back/scan.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** A temp directory of this file's own, so nothing here writes the working tree (A6). */
let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-the-link-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** `git` in the sandbox, with an identity of its own so no machine's config decides the author. */
function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: sandbox,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'A Person',
      GIT_AUTHOR_EMAIL: 'person@example.invalid',
      GIT_COMMITTER_NAME: 'A Person',
      GIT_COMMITTER_EMAIL: 'person@example.invalid',
      GIT_CONFIG_GLOBAL: join(sandbox, 'no-such-gitconfig'),
      GIT_CONFIG_SYSTEM: join(sandbox, 'no-such-gitconfig'),
    },
  });
}

/** A repository with one commit on it, and the sha of that commit as a base to range from. */
function aRepositoryWithABase(): string {
  git('init', '-q', '-b', 'trunk');
  writeFileSync(join(sandbox, 'a-file'), 'one\n');
  git('add', 'a-file');
  git('commit', '-q', '-m', 'The base of every range below');
  return git('rev-parse', 'HEAD').trim();
}

/** The footers as this repository has actually seen them written. */
const THE_CO_AUTHOR = 'Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>';
const THE_GENERATED_WITH = '🤖 Generated with [Claude Code](https://claude.com/claude-code)';

/**
 * The trailer block of the 13 dependabot commits on this trunk, copied off one of them. It is
 * here as a LITERAL rather than read out of the history, because a fixture read from a tree the
 * delivery might one day rewrite stops being a fixture.
 */
const THE_DEPENDABOT_TRAILERS = [
  'Signed-off-by: dependabot[bot] <support@github.com>',
  'Co-authored-by: dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>',
].join('\n');

/**
 * A LONG ORDINARY MESSAGE OF THIS TRUNK, written out here rather than read from the history,
 * because a fixture read out of a tree the delivery might rewrite stops being a fixture.
 */
const AN_ORDINARY_MESSAGE = [
  'The example a package publishes is type-checked (#617)',
  '',
  'WHERE THIS COMES FROM. The README of `@mnema/code` carries a block a reader is meant to',
  'paste, and nothing compiled it. Two of the four had drifted: one named a flag the verb no',
  'longer takes, and one called `which` with a value the parser rejects.',
  '',
  'The host this product is written against is Claude Code, and `which` answers with the',
  "handle of the agent that wrote a thing — `which: 'claude'` is a value the product produces,",
  'so a scan for the word would accuse this paragraph. Anthropic publishes the plugin format',
  '`plugin/` documents; that is named here for the same reason.',
  '',
  'WHAT IT DOES NOT COVER. A block that type-checks can still be wrong about what it prints,',
  'which is `the example a package publishes is the example that runs` and not this.',
  '',
  'The release notes upstream say this PR was generated with [Release Please], which is theirs',
  'and not ours.',
  '',
  'Signed-off-by: A Person <person@example.invalid>',
  'Co-authored-by: Another Person <another@example.invalid>',
].join('\n');

describe('the two footers this trunk refuses', () => {
  it('refuses a co-author trailer that names the tool, and the one that names its vendor', () => {
    expect(attributionIn(THE_CO_AUTHOR, 'x').map((one) => one.footer)).toEqual([
      'co-authored-by-the-tool',
    ]);
    expect(attributionIn('Co-authored-by: Somebody <someone@anthropic.com>', 'x')).toHaveLength(1);
  });

  it('refuses the generated-with footer by its name and, separately, by its link', () => {
    expect(attributionIn(THE_GENERATED_WITH, 'x').map((one) => one.footer)).toEqual([
      'generated-with-claude-code',
    ]);
    // The emoji, the spacing and the bracket text are cosmetic; the LINK is the thing this
    // delivery is named after, so it is reachable on its own.
    expect(attributionIn('See https://claude.com/claude-code for more.', 'x')).toHaveLength(1);
  });

  it('reaches a footer smuggled in under indentation', () => {
    // A quoted message is indented, and a footer under two spaces is still a footer.
    expect(attributionIn(`  ${THE_CO_AUTHOR}`, 'x')).toHaveLength(1);
    expect(attributionIn(`> ${THE_CO_AUTHOR}`, 'x')).toHaveLength(1);
  });

  it('names the surface, the line and the text of every finding', () => {
    // A red that says only "attribution found" sends the reader looking, which is the seven
    // weeks this guard exists to not repeat.
    const found = attributionIn(`A subject\n\nA body\n\n${THE_CO_AUTHOR}`, 'commit abc1234 (x)');
    expect(found[0]).toMatchObject({ where: 'commit abc1234 (x)', at: 5, line: THE_CO_AUTHOR });
  });
});

describe('what it must never refuse', () => {
  it('lets the 13 dependabot trailers through, with no allowlist doing it', () => {
    // NOT AN EXEMPTION. `dependabot[bot]` is not named anywhere in the scan; its trailer passes
    // because its VALUE names neither the vendor nor the tool, which is the same reason a human
    // co-author's would. An exemption would be a hole with a name on it.
    expect(attributionIn(`Bump a dependency\n\n${THE_DEPENDABOT_TRAILERS}`, 'x')).toEqual([]);
    const scan = readFileSync(join(ROOT, '.github/the-link-cannot-come-back/scan.mjs'), 'utf-8');
    const rule = scan.slice(scan.indexOf('export const THE_FOOTERS'), scan.indexOf('THE_CANARY ='));
    expect(rule, 'the rule carries an allowlist, which is a hole with a name on it').not.toMatch(
      /dependabot/i,
    );
  });

  it('lets an upstream release note that credits the tool for somebody else through', () => {
    // MEASURED, NOT IMAGINED: three of the 13 dependabot commits on this trunk embed upstream
    // release notes that read `<strong>Claude Opus 4.8</strong>`, and six embed `This PR was
    // generated with [Release Please]`. A substring scan accuses all nine.
    expect(
      attributionIn('<strong>Pduhard</strong> and <strong>Claude Opus 4.8</strong> in #2', 'x'),
    ).toEqual([]);
    expect(attributionIn('(claude-opus-4-8)</strong> in <a href="#">#3</a>', 'x')).toEqual([]);
    expect(attributionIn('This PR was generated with [Release Please]. See docs.', 'x')).toEqual(
      [],
    );
  });

  it('lets the word through where it is this product speaking', () => {
    // `which: 'claude'` is a value this product produces and `plugin/` documents a host plugin.
    // A guard over the WORD accuses the product it is defending.
    expect(attributionIn("the verb answers `which: 'claude'`", 'x')).toEqual([]);
    expect(attributionIn('Teach the plugin how Claude Code loads a skill', 'x')).toEqual([]);
    expect(attributionIn('Anthropic is named in this sentence and nowhere else', 'x')).toEqual([]);
  });

  it('says nothing about a long ordinary commit message — the zero control', () => {
    // THE CONTROL THE MUTATION BATTERY IS READ AGAINST, and it is deliberately a HARD one: it
    // is as long as a real message on this trunk, it names the vendor, it names the tool, it
    // carries a legitimate trailer and it carries a bracketed generated-with that is somebody
    // else's. A mutation that turns this red widened the rule; a mutation that leaves the six
    // cases above green and this one green too changed nothing at all.
    expect(attributionIn(AN_ORDINARY_MESSAGE, 'x')).toEqual([]);
  });
});

describe('the scan reads both surfaces, and refuses rather than reads nothing', () => {
  const aCommit = (message: string) => ({ sha: 'abc1234def', subject: 'A subject', message });

  it('goes red on the footer in a commit', () => {
    const result = judge({
      commits: [aCommit(`A subject\n\n${THE_CO_AUTHOR}`)],
      pullRequest: { title: 'A title', body: 'A body' },
    });
    expect(result).toMatchObject({ verdict: 'attribution-found', code: 1 });
  });

  it('goes red on the footer in the pull request body with every commit clean', () => {
    // THE HALF THAT ALMOST ESCAPED: 19 of the 33 leaks were here and nowhere else.
    const result = judge({
      commits: [aCommit('A subject\n\nA clean body.')],
      pullRequest: { title: 'A title', body: `Some description.\n\n${THE_GENERATED_WITH}` },
    });
    expect(result).toMatchObject({ verdict: 'attribution-found', code: 1 });
    expect(result.found[0]?.where).toBe('the pull request body');
  });

  it('goes red on the footer in the pull request title', () => {
    const result = judge({
      commits: [aCommit('A subject\n\nA clean body.')],
      pullRequest: { title: THE_GENERATED_WITH, body: '' },
    });
    expect(result.found[0]?.where).toBe('the pull request title');
  });

  it('is green on a dependabot change, both surfaces', () => {
    const result = judge({
      commits: [aCommit(`Bump a dependency\n\n${THE_DEPENDABOT_TRAILERS}`)],
      pullRequest: { title: 'Bump a dependency', body: 'Release notes about Claude Opus 4.8.' },
    });
    expect(result).toMatchObject({ verdict: 'clean', code: 0, found: [] });
    expect(result.examinedCommits).toBe(1);
    expect(result.examinedPullRequest).toBe(true);
  });

  it('refuses when it examined no commit, by the canary and not by an exit 0', () => {
    const result = judge({ commits: [], pullRequest: { title: '', body: '' } });
    expect(result).toMatchObject({ verdict: 'ruler-broken', code: 2, why: THE_CANARY });
    expect(asProse(result)).toContain('RULER BROKEN');
  });

  it('refuses when no pull request was handed over at all', () => {
    const result = judge({ commits: [aCommit('A subject')], pullRequest: null });
    expect(result).toMatchObject({ verdict: 'ruler-broken', code: 2, why: NO_PULL_REQUEST });
  });

  it('says out loud when only the commits were read', () => {
    // `--commits-only` is the honest way to run half the rule, and the page says so. The case
    // that reads `ci.yml` is what stops the workflow from using it.
    const result = judge({ commits: [aCommit('A subject')], pullRequest: 'not-asked' });
    expect(result.code).toBe(0);
    expect(result.examinedPullRequest).toBe(false);
    expect(asProse(result)).toContain('NOT examined');
  });

  it('counts the footers it is built from rather than a number written twice', () => {
    expect(
      asProse(judge({ commits: [aCommit('A subject')], pullRequest: { title: '', body: '' } })),
    ).toContain(`${THE_FOOTERS.length} footers`);
  });
});

describe('the scan reads real git, and reads every commit of a range', () => {
  it('finds a footer on the THIRD of four commits', () => {
    // TRAP TWO OF THE DELIVERY, PINNED. A guard that reads only the tip is green over a branch
    // whose third commit carries the footer, and on a `pull_request` the tip is a merge commit
    // that carries nobody's message.
    const base = aRepositoryWithABase();
    writeCommit('One');
    writeCommit('Two');
    writeCommit(`Three\n\n${THE_CO_AUTHOR}`);
    writeCommit('Four');
    const commits = commitsIn(`${base}..HEAD`, sandbox);
    expect(commits, 'the range read fewer than the four commits on it').toHaveLength(4);
    const result = judge({ commits, pullRequest: { title: 'A title', body: 'A body' } });
    expect(result).toMatchObject({ verdict: 'attribution-found', code: 1 });
    expect(result.found[0]?.where).toContain('(Three)');
  });

  it('reads the body of a commit and not only its subject', () => {
    const base = aRepositoryWithABase();
    writeCommit(`A subject that is clean\n\nA paragraph.\n\n${THE_GENERATED_WITH}`);
    const [only] = commitsIn(`${base}..HEAD`, sandbox);
    expect(only?.subject).toBe('A subject that is clean');
    expect(attributionIn(only?.message ?? '', 'x')).toHaveLength(1);
  });

  it('refuses over a range whose base is not in this history', () => {
    // WHAT A SHALLOW CHECKOUT LOOKS LIKE FROM IN HERE: `git rev-list` exits non-zero, and the
    // scan reports RULER BROKEN with `fetch-depth` named rather than sweeping clean.
    aRepositoryWithABase();
    const missing = '0'.repeat(40);
    expect(() => commitsIn(`${missing}..HEAD`, sandbox)).toThrow();
  });

  it('is green over the last commits of this very repository', () => {
    // NOT VACUOUS. The trunk was swept and rewritten on 2026-09-11; if this ever goes red the
    // footer came back, which is the whole claim.
    const commits = commitsIn('HEAD~5..HEAD', ROOT);
    expect(commits, 'the range over this repository read nothing').toHaveLength(5);
    expect(judge({ commits, pullRequest: 'not-asked' }).found).toEqual([]);
  });
});

describe('the scan is wired where it can be right', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  const workflow = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf-8');
  const THE_SCRIPT = '.github/the-link-cannot-come-back/scan.mjs';

  it('is a script of this repository, and CI and the manifest name the same file', () => {
    // Two ways to invoke one instrument is two things to keep in step. CI runs `node <path>`
    // rather than the pnpm alias, so that a package manager failing to set itself up cannot
    // redden a guard about attribution; this is what stops the two from drifting apart.
    expect(manifest.scripts['the-link-cannot-come-back']).toContain(THE_SCRIPT);
    expect(workflow).toContain(`run: node ${THE_SCRIPT}`);
  });

  it('runs on the pull request, where both halves of the rule exist', () => {
    const job = theJob();
    expect(job, 'ci.yml has no job for this guard').not.toBe('');
    // On `push` the commit is already in the trunk: a red there repairs nothing and blocks the
    // merges behind it, and the description half does not exist on that event at all.
    expect(job).toContain("if: github.event_name == 'pull_request'");
  });

  it('checks out the whole history, or the scan would refuse on every run', () => {
    // TRAP TWO. A default checkout on a `pull_request` is depth 1 and the base commit is not
    // in it; `git rev-list` then exits non-zero and the guard's normal state becomes RULER
    // BROKEN, which is a guard nobody reads.
    expect(theJob()).toContain('fetch-depth: 0');
  });

  it('never passes --commits-only, which would leave nineteen of the leaks unread', () => {
    expect(theJob()).not.toContain('--commits-only');
  });

  it('does not commit what it writes on a runner', () => {
    const tracked = execFileSync('git', ['ls-files', 'the-link-cannot-come-back.json'], {
      cwd: ROOT,
      encoding: 'utf-8',
    });
    expect(tracked.trim()).toBe('');
    expect(readFileSync(join(ROOT, '.gitignore'), 'utf-8')).toContain(
      'the-link-cannot-come-back.json',
    );
  });

  /** The job of this guard, as text, or `''` when `ci.yml` has none. */
  function theJob(): string {
    const at = workflow.indexOf('\n  the-link-cannot-come-back:');
    return at === -1 ? '' : workflow.slice(at);
  }
});

describe('the scan takes its range and its pull request off the runner, never off a shell', () => {
  /** An event payload as a runner writes it, in this sandbox. */
  function anEvent(payload: unknown): string {
    const at = join(sandbox, 'event.json');
    writeFileSync(at, JSON.stringify(payload));
    return at;
  }

  it('reads both ends of the range out of the payload', () => {
    const at = anEvent({ pull_request: { base: { sha: 'aaa' }, head: { sha: 'bbb' } } });
    expect(rangeFrom([], at)).toBe('aaa..bbb');
  });

  it('prefers an explicit --range, so it can be run by hand', () => {
    const at = anEvent({ pull_request: { base: { sha: 'aaa' }, head: { sha: 'bbb' } } });
    expect(rangeFrom(['--range', 'x..y'], at)).toBe('x..y');
  });

  it('has no range at all when the event names no pull request', () => {
    expect(rangeFrom([], anEvent({ ref: 'refs/heads/main-v1' }))).toBe(null);
    expect(rangeFrom([], undefined)).toBe(null);
  });

  it('reads the description off the event file rather than off an input', () => {
    // A description is text a stranger wrote. On a public repository, `${{ github.event.
    // pull_request.body }}` in a `run:` hands that stranger the runner; a file read cannot.
    const at = anEvent({ pull_request: { title: 'A title', body: 'A body' } });
    expect(pullRequestFrom(at)).toEqual({ title: 'A title', body: 'A body' });
    expect(workflowMentionsTheBodyAsAnInput()).toBe(false);
  });

  it('treats an empty description as examined and empty, not as missing', () => {
    const at = anEvent({ pull_request: { title: 'A title', body: null } });
    expect(pullRequestFrom(at)).toEqual({ title: 'A title', body: '' });
  });

  it('has no pull request when there is no event, and none when the file is unreadable', () => {
    expect(pullRequestFrom(undefined)).toBe(null);
    expect(pullRequestFrom(join(sandbox, 'no-such-file.json'))).toBe(null);
  });

  it('drives the whole instrument end to end, through the seam', () => {
    const jsonAt = join(sandbox, 'verdict.json');
    const code = main(['--range', 'x..y', '--json', jsonAt], {
      commits: () => [{ sha: 'abc1234def', subject: 'A subject', message: THE_CO_AUTHOR }],
      pullRequest: () => ({ title: 'A title', body: 'A body' }),
    });
    expect(code).toBe(1);
    expect(JSON.parse(readFileSync(jsonAt, 'utf-8')).found).toHaveLength(1);
  });

  it('refuses through main when git could not read the range', () => {
    expect(
      main(['--range', 'x..y'], {
        commits: () => {
          throw new Error('unknown revision');
        },
        pullRequest: () => null,
      }),
    ).toBe(2);
  });

  function workflowMentionsTheBodyAsAnInput(): boolean {
    return /pull_request\.body\s*\}\}/.test(
      readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf-8'),
    );
  }
});

/** One more commit on the sandbox repository, with the message given verbatim. */
function writeCommit(message: string): string {
  writeFileSync(join(sandbox, 'a-file'), `${message}\n${Math.random()}`);
  git('add', 'a-file');
  execFileSync('git', ['commit', '-q', '--file=-'], {
    cwd: sandbox,
    input: message,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'A Person',
      GIT_AUTHOR_EMAIL: 'person@example.invalid',
      GIT_COMMITTER_NAME: 'A Person',
      GIT_COMMITTER_EMAIL: 'person@example.invalid',
      GIT_CONFIG_GLOBAL: join(sandbox, 'no-such-gitconfig'),
      GIT_CONFIG_SYSTEM: join(sandbox, 'no-such-gitconfig'),
    },
  });
  return git('rev-parse', 'HEAD').trim();
}
