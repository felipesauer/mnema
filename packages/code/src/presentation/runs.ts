/**
 * How a RUN is worded, wherever one is reported.
 *
 * `focus` lists the open runs and `resume` names the last one, and both need the
 * same three things said the same way: how long it has been open, how long since it
 * recorded anything, and what a run IS for the reader who has none. Two readings
 * wording that twice is two wordings, and the second one to change would be the one
 * nobody noticed.
 */

import { fact } from './detail.js';

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
export const NO_RUNS_HINT = [
  fact("A run is an agent's working session. An MCP client opens one per connection;"),
  fact('on the command line, `mnema run start --which <agent>` opens one.'),
  fact('Work you do yourself is recorded without one.'),
];

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
