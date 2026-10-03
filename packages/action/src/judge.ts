/**
 * One run of the Action, with everything outside the process handed in.
 *
 * `judge` reads the record at the pull request's base and at what is checked out, asks `mnema`
 * which changed files a rule addresses, writes the comment, and says whether the check fails.
 * It writes nothing to the record and pushes nothing: the only thing it sends anywhere is the
 * comment, through the `GitHub` it is given.
 */

import { renderComment, renderNoRecord, worthSaying } from './comment.js';
import type { GitHub } from './github.js';
import {
  approvedByAnotherPerson,
  askingForAPerson,
  type GovernedFile,
  isGoverned,
  rulesInForce,
} from './governed.js';
import { eventsAdded, readEvents, whatItDoes } from './record.js';

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
    /** `mnema verify --require=signed`: whether it exited zero, and what it said. */
    verify(): { passed: boolean; said: string };
    /** `mnema rules <path> --json`, parsed. */
    rules(path: string): unknown;
  };
  readonly github: GitHub;
  readonly log: { info(line: string): void; warning(line: string): void };
}

/** What the pull request is. */
export interface PullRequest {
  readonly baseSha: string;
  readonly author: string;
  readonly requireApprovalForAsks: boolean;
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

  const verification = world.mnema.verify();
  if (!verification.passed) reasons.push('the record does not verify as signed');

  const head = textsOf(headTexts);
  const record = whatItDoes(eventsAdded(textsOf(baseTexts), head), head);

  const changed = (await world.github.changedFiles()).filter((path) => !path.startsWith('.mnema/'));
  const asked = changed.slice(0, MOST_ASKED);
  const governed: GovernedFile[] = asked
    .map((path) => rulesInForce(path, world.mnema.rules(path)))
    .filter(isGoverned);

  let approval: { asking: GovernedFile[]; approved: boolean } | undefined;
  if (pr.requireApprovalForAsks) {
    const asking = askingForAPerson(governed);
    const approved =
      asking.length === 0 || approvedByAnotherPerson(await world.github.reviews(), pr.author);
    approval = { asking, approved };
    if (!approved) reasons.push('a rule asks for a person and no one but the author has approved');
  }

  const report = {
    verification,
    record,
    governed,
    notAsked: changed.length - asked.length,
    approval,
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
