/**
 * NO HELD-OUT TASK IS PUBLISHED BEFORE IT IS USED.
 *
 * The measurement under `measurements/p1/` withholds its tasks and commits a DIGEST of each
 * one instead, because a task published before it is used is a task the thing being measured
 * may already have read. That rule is the reason a rate from this protocol can be believed at
 * all, and it is enforced today by a hand-maintained block of `.gitignore` lines — one per task
 * per run, deliberately never a wildcard over `raw/`, because the development tasks' outputs
 * live in those same directories and ARE committed.
 *
 * WHY A TEST AND NOT THE IGNORE FILE ALONE. The ignore file is the mechanism; it is not a check.
 * A line missed when a round produces a new directory leaves the files untracked and UNIGNORED,
 * one `git add -A` away from publication — and this project has done exactly that once, with 304
 * held-out task files, and came within three days of it a second time with 312. Nothing in the
 * tree said so either time. So the rule is asserted here, over the state git would publish,
 * where a missing line is red before it is a commit.
 *
 * WHAT IT ASKS GIT FOR, and it is deliberately wider than "tracked": every path git would carry
 * if somebody staged everything — tracked files plus untracked-and-unignored ones. A held-out
 * output sitting unignored is the defect, not the commit that follows it.
 *
 * IT IS ABOUT PATHS AND NEVER ABOUT CONTENT. The task IDS are public by design — the
 * pre-registration names them, and the naming rule is that an id names a domain
 * (`a1-rounding`) and never the rule the task turns on. `cells.jsonl` carries them in every
 * line. What may not be published is a task's own files: its starting repository, its ticket,
 * its decision, its references, its discriminant, and the raw output and diffs of a cell that
 * ran it — all of which DESCRIBE the task.
 *
 * AND IT HAS TWO VALUES, which is what keeps it from being green by accident. A guard that only
 * ever asserts an absence passes just as well when its own matching is broken, so each round is
 * also required to show its DEVELOPMENT tasks' outputs published. Those are open by rule: the
 * harness may be iterated against them, so they carry no reveal, and their presence proves this
 * file can see a task path when there is one to see.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The workspace root — this file is `packages/code/tests/…`. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * EVERYTHING GIT WOULD PUBLISH, asked of git itself.
 *
 * `--cached` is what is committed and `--others --exclude-standard` is what is not committed and
 * not ignored either. A walk over a list of directories would carry whoever wrote the list's
 * blind spot; this carries git's, which is the one that decides what leaves the machine.
 */
const PUBLISHABLE: readonly string[] = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { cwd: ROOT, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 },
)
  .split('\n')
  .filter((where) => where !== '');

type Split = {
  readonly development: readonly string[];
  readonly held_out: readonly string[];
};

/** The rounds, and where each one's split is. Round 1 is at the root of the directory. */
const ROUNDS = [
  { round: 1, dir: 'measurements/p1' },
  { round: 2, dir: 'measurements/p1/round-2' },
  { round: 3, dir: 'measurements/p1/round-3' },
] as const;

function splitOf(dir: string): Split {
  return JSON.parse(readFileSync(join(ROOT, dir, 'split.json'), 'utf-8')) as Split;
}

/**
 * Every publishable path that is ABOUT a task with this id.
 *
 * Two shapes, and both of them have happened. A directory segment equal to the id is the task
 * itself, wherever somebody moved or copied it to. A file whose name begins with the id and a
 * hyphen is a cell's output or diff (`a2-due-day-base-r1.stdout.json`), which is the shape that
 * sat unignored in this tree. The hyphen matters: without it `a1-rounding` would claim
 * `a10-stock-cost`, and a guard that over-matches gets loosened until it stops guarding.
 */
function pathsAbout(id: string): readonly string[] {
  return PUBLISHABLE.filter((where) => {
    const parts = where.split('/');
    if (parts.slice(0, -1).includes(id)) return true;
    const name = parts[parts.length - 1];
    return name === id || name.startsWith(`${id}-`);
  });
}

describe.each(ROUNDS)('round $round', ({ dir }) => {
  const split = splitOf(dir);

  it('holds its held-out tasks back — no file of one is publishable', () => {
    expect(split.held_out.length).toBeGreaterThan(0);
    for (const id of split.held_out) {
      expect(
        pathsAbout(id),
        `${id} is held out and these paths describe it — a task published before it is used is a task the measured thing may have read`,
      ).toEqual([]);
    }
  });

  it('and publishes its development tasks, which is how this file knows it can see one', () => {
    // The second value. Development tasks are open by rule: the harness is free to be iterated
    // against them, so their raw output and diffs are committed beside the capture. If NONE of
    // them is visible here, the matching above found nothing for a reason that has nothing to do
    // with the held-out tasks being held back.
    expect(split.development.length).toBeGreaterThan(0);
    const seen = split.development.filter((id) => pathsAbout(id).length > 0);
    expect(
      seen.length,
      `no path of ${split.development.join(', ')} is publishable, so the absences above prove nothing`,
    ).toBeGreaterThan(0);
  });
});

describe('and the instrument was published without them', () => {
  it('carries no task of any round inside it', () => {
    // The delivery that published `measurements/p1/harness/` moved a runner out of a workbench
    // whose task directories were its SIBLINGS, which is the arrangement that drags them along.
    // The case above already covers it by id; this one covers the shape a task has even if it
    // arrived under a name no split names.
    const inside = PUBLISHABLE.filter((where) => where.startsWith('measurements/p1/harness/'));
    expect(inside.length).toBeGreaterThan(30);
    for (const where of inside) {
      for (const shape of ['/ticket.txt', '/decision.md', '/refs/good/', '/refs/bad/', '/repo/']) {
        expect(where.includes(shape), `${where} has the shape of a task`).toBe(false);
      }
    }
  });
});
