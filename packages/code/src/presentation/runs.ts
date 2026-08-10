/**
 * How a RUN is worded, wherever one is reported.
 *
 * `focus` lists the open runs, `resume` names the last one and `status` says where the
 * actor left off as one half of a wider answer, and all three need the same things said
 * the same way: how long a run has been open, how long since it recorded anything, what
 * the LAST one was, how many are still open, and what a run IS for the reader who has
 * none. Three readings wording that separately is three wordings, and the second one to
 * change would be the one nobody noticed.
 */

import type { Resume } from '@mnema/copilot';
import { fact } from './detail.js';
import type { Line } from './line.js';

/**
 * What `focus` and `resume` add when an actor has no run to report.
 *
 * The empty answer is the TRUTH for most people who use the CLI: a run is an
 * agent's session, and work a person does themselves has none — nor needs one,
 * since the `who` on each fact already carries the authority a run exists to
 * delegate. Left bare, though, the answer reads as something missing (and
 * "no runs YET" reads as a state about to change, which for that person it is
 * not). So the reads say what a run is and where one comes from, and stop
 * there — no invented state, no suggestion that anything is wrong.
 */
export const NO_RUNS_HINT: readonly Line[] = [
  fact("A run is an agent's working session. An MCP client opens one per connection;"),
  fact('on the command line, `mnema run start --which <agent>` opens one.'),
  fact('Work you do yourself is recorded without one.'),
];

/**
 * The LAST run an actor had, as the words that follow whoever it is about: what it
 * is, whether it is still open, what it was for, and how it stands.
 *
 * It is worded here rather than at a call site because two readings say it — `resume`
 * leads the line with the actor (`<actor> last run …`) and `status` prints it as a fact
 * under a heading that already named them — and a run's line has four parts that have to
 * agree between the two. What each caller keeps is the SUBJECT: the phrase begins at
 * "last run", so neither has to strip an actor the other put there.
 *
 * The age rides it only while it is OPEN, which is {@link runAgeSuffix}'s rule stated
 * where the decision is made: an ended run reports its own end, and an age beside that
 * would read as time still passing in it.
 */
export function lastRunPhrase(run: {
  readonly id: string;
  readonly open: boolean;
  readonly goal?: string;
  readonly ageSeconds?: number;
  readonly idleSeconds?: number;
}): string {
  return (
    `last run ${run.id} (${run.open ? 'open' : 'ended'})` +
    `${run.goal !== undefined ? ` — ${run.goal}` : ''}` +
    `${run.open ? runAgeSuffix(run) : ''}`
  );
}

/**
 * How many of the actor's runs are still open — the second half of "where did I leave
 * off", said the same way by both readings that answer it.
 *
 * The count is the whole line on purpose: which runs those are is `focus`'s answer, and
 * repeating them here would be a second list of the same thing with no way to keep the
 * two in step.
 */
export function openRunsPhrase(resume: Resume): string {
  return `${resume.focus.openRuns.length} run(s) still open`;
}

/**
 * How long an open run has been open, and how long since it recorded anything —
 * appended to the run's OWN line.
 *
 * Both numbers come from the derivation; this only words them. It is what makes a
 * list of open runs readable at all: before it, ten runs left behind by ten sessions
 * printed as ten identical lines, and the one an agent was actually working in was
 * among them with nothing to tell it apart.
 *
 * On the SAME line, not a second one, and that is the `oneLine` rule holding rather
 * than a layout preference: a reader counts runs by lines, and a second line per run
 * would make "how many runs are open" a thing to be inferred from indentation — which
 * is exactly the inference a forged newline exists to exploit.
 *
 * "recorded nothing" is stated rather than left blank. An absent `idleSeconds` means
 * the run holds no fact of its own (a session opens its run at the first write, so
 * one with no fact is one whose write did not land), and simply omitting the second
 * half would read as "idle: unknown" — a different claim.
 *
 * A NEGATIVE age is worded as what it is: two clocks disagreeing, the writer's ahead
 * of this machine's. It is not clamped to zero anywhere on the way here, because a
 * zero would present a disagreement as a fresh run.
 *
 * It says nothing about whether the run is ALIVE, on purpose. Nothing in the record
 * speaks about a process, so an old idle run may be abandoned or may be a session
 * waiting on someone — and the two are indistinguishable from here.
 */
export function runAgeSuffix(run: {
  readonly ageSeconds?: number;
  readonly idleSeconds?: number;
}): string {
  const age =
    run.ageSeconds === undefined
      ? 'started at an instant this machine cannot read'
      : run.ageSeconds < 0
        ? `starts in ${humanDuration(-run.ageSeconds)} (this machine's clock is behind the writer's)`
        : `open ${humanDuration(run.ageSeconds)}`;
  const idle =
    run.idleSeconds === undefined
      ? 'nothing recorded in it'
      : `last recorded ${humanDuration(run.idleSeconds)} ago`;
  return ` · ${age} · ${idle}`;
}

/**
 * A duration in seconds as the two largest units that matter — `3d 4h`, `2h 14m`,
 * `41m 3s`, `9s`. Two and not three: the third digit never changes a decision, and
 * a reader scanning ten runs is comparing magnitudes.
 */
export function humanDuration(seconds: number): string {
  const units: readonly [number, string][] = [
    [86400, 'd'],
    [3600, 'h'],
    [60, 'm'],
    [1, 's'],
  ];
  const parts: string[] = [];
  let rest = Math.floor(seconds);
  for (const [size, suffix] of units) {
    const count = Math.floor(rest / size);
    rest -= count * size;
    if (count > 0) parts.push(`${count}${suffix}`);
    if (parts.length === 2) break;
  }
  // Under a second is still a duration, and `0s` says so better than an empty string.
  return parts.length === 0 ? '0s' : parts.join(' ');
}
