/**
 * One run of the Action, with everything outside the process handed in.
 *
 * `judge` reads the record at the pull request's base and at what is checked out, asks `mnema`
 * which changed files a rule addresses, writes the comment, and says whether the check fails.
 * Handed a checker key, it also has `mnema check run` record, in the working tree, whether each
 * rule in force held (the one write it makes, and never a commit or a push). The only thing it
 * sends anywhere is the comment, through the `GitHub` it is given.
 */

import { renderComment, renderNoRecord, worthSaying } from './comment.js';
import type { GitHub } from './github.js';
import {
  approvedByAnotherPerson,
  bothReadings,
  type GovernedFile,
  isGoverned,
  leftOutOf,
  needingAPerson,
  rulesInForce,
} from './governed.js';
import { decisionLabels, eventsAdded, readEvents, whatItDoes } from './record.js';

/** The most changed files `mnema rules` is asked about, one process each. */
export const MOST_ASKED = 200;

/** What the run needs from the repository and from `mnema`. */
export interface World {
  readonly git: {
    hasCommit(sha: string): boolean;
    /** The text of every record file (`.mnema/tails/**.jsonl`) the commit holds. */
    recordAt(ref: string): string[];
  };
  readonly mnema: {
    /**
     * `mnema verify --require=signed --since <base>`: whether it exited zero, and what it said.
     * `--since` is what catches a record cut back to an earlier, honest state (the newest events
     * taken with the checkpoint that covered them), which no reading of the record alone can see,
     * and a tail the pull request brings that names another record than the base's, or names no
     * record where a tail of the base names it, which `said` names by its id. Over a base whose
     * record has no name yet, a tail that names no record passes with a note.
     */
    verify(base: string): { passed: boolean; said: string };
    /** `mnema rules <path> --json`, parsed, over what is checked out. */
    rules(path: string): unknown;
    /**
     * The same question asked of the record as the commit `base` holds it, which a pull request
     * cannot have edited. `close` removes what was made to ask it.
     */
    rulesAt(base: string): { rules(path: string): unknown; close(): void };
    /**
     * `mnema check run`, signing with the checker key whose private half is `key`: whether it
     * exited zero (every check passed) and what it said.
     */
    checkRun(key: string): { passed: boolean; said: string };
  };
  readonly github: GitHub;
  readonly log: { info(line: string): void; warning(line: string): void };
}

/** What the pull request is. */
export interface PullRequest {
  readonly baseSha: string;
  readonly author: string;
  readonly requireApprovalForAsks: boolean;
  /** The private half of a checker key the record enrolls, from a secret. Absent: no check runs. */
  readonly checkerKey?: string;
}

/** What the run concluded. */
export interface Verdict {
  readonly failed: boolean;
  /** Why it failed, one line each; empty when it did not. */
  readonly reasons: readonly string[];
}

const textsOf = (texts: readonly string[]) => texts.flatMap(readEvents);

export async function judge(world: World, pr: PullRequest): Promise<Verdict> {
  const reasons: string[] = [];

  if (!world.git.hasCommit(pr.baseSha)) {
    throw new Error(
      `the base commit ${pr.baseSha} is not in this clone; check out the whole history so the record can be compared`,
    );
  }
  const headTexts = world.git.recordAt('HEAD');
  const baseTexts = world.git.recordAt(pr.baseSha);
  if (headTexts.length === 0 && baseTexts.length === 0) {
    world.log.info('::notice::this repository holds no mnema record');
    try {
      world.log.info(`comment ${await world.github.upsertComment(renderNoRecord(), true)}`);
    } catch (error) {
      world.log.warning(
        `the comment was not written: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { failed: false, reasons };
  }

  const verification = world.mnema.verify(pr.baseSha);
  if (!verification.passed) {
    reasons.push('the record does not verify as signed, as the base record grown');
  }

  const head = textsOf(headTexts);
  const record = whatItDoes(eventsAdded(textsOf(baseTexts), head), decisionLabels(headTexts));

  // A file renamed leaves one path and takes another; the rules of both judge it, so a rename
  // cannot carry a protected file out from under its rule.
  const changed = (await world.github.changedFiles())
    .flatMap(({ path, renamedFrom }): { path: string; rename?: string }[] =>
      renamedFrom === undefined
        ? [{ path }]
        : [
            { path, rename: `renamed from ${renamedFrom}` },
            { path: renamedFrom, rename: `renamed to ${path}` },
          ],
    )
    .filter(({ path }) => !path.startsWith('.mnema/'));
  const asked = changed.slice(0, MOST_ASKED);
  // The rules that judge the files are the base's, so a pull request cannot lift a rule off the
  // very files it edits; a rule it adds counts as well, since it can only add protection. A base
  // with no record has no rules to read.
  const atBase = baseTexts.length > 0 ? world.mnema.rulesAt(pr.baseSha) : undefined;
  let read: GovernedFile[];
  try {
    read = asked.map(({ path, rename }) => {
      const here = rulesInForce(path, world.mnema.rules(path));
      const both =
        atBase === undefined ? here : bothReadings(rulesInForce(path, atBase.rules(path)), here);
      return rename === undefined ? both : { ...both, rename };
    });
  } finally {
    atBase?.close();
  }
  const governed = read.filter(isGoverned);
  // A tail of another record holds no rule here: the readings left it out, and the comment says
  // which, whether or not a changed file was addressed (FORMAT.md section 6.10).
  const anotherRecord = leftOutOf(read);

  let approval: { asking: GovernedFile[]; approved: boolean } | undefined;
  if (pr.requireApprovalForAsks) {
    const asking = needingAPerson(governed);
    const approved =
      asking.length === 0 || approvedByAnotherPerson(await world.github.reviews(), pr.author);
    approval = { asking, approved };
    if (!approved) {
      if (asking.some((file) => file.asks.length > 0)) {
        reasons.push('a rule asks for a person and no one but the author has approved');
      }
      if (asking.some((file) => file.refuses.length > 0)) {
        reasons.push(
          'a rule refuses a write to a changed file and no one but the author has approved',
        );
      }
    }
  }

  // Before the comment, so that the comment carries the results; the run only writes the
  // record's own files, which everything above had already read.
  let checks: { passed: boolean; said: string } | undefined;
  if (pr.checkerKey !== undefined) {
    checks = world.mnema.checkRun(pr.checkerKey);
    for (const line of checks.said.split('\n')) if (line.trim() !== '') world.log.info(line);
    if (!checks.passed) reasons.push('a rule’s check did not pass, or the checks did not run');
  }

  const report = {
    verification,
    record,
    governed,
    anotherRecord,
    notAsked: changed.length - asked.length,
    rulesFromBase: atBase === undefined ? undefined : pr.baseSha,
    approval,
    ...(checks !== undefined ? { checks } : {}),
  };
  try {
    const done = await world.github.upsertComment(renderComment(report), !worthSaying(report));
    world.log.info(`comment ${done}`);
  } catch (error) {
    world.log.warning(
      `the comment was not written: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { failed: reasons.length > 0, reasons };
}
