/**
 * How a RUN is worded, wherever one is reported.
 *
 * `focus` lists the open runs, `resume` names the last one and `status` says where the
 * actor left off as one half of a wider answer, and all three need the same things said
 * the same way: how long a run has been open, how long since it recorded anything, WHAT
 * was written in it, what the LAST one was, how many are still open, and what a run IS
 * for the reader who has none. Three readings wording that separately is three wordings,
 * and the second one to change would be the one nobody noticed.
 */

import type { Resume } from '@mnema/copilot';
import type { WrittenInRun } from '@mnema/core';
import { oneLine } from '../one-line.js';
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
 *
 * THE GOAL IS COLLAPSED HERE, in the phrase, and that is the whole reason the collapse
 * moved. It is text whoever opened the session typed, and both readings print it: one
 * of them collapsed it at its own line and the other did not, so the same run with the
 * same goal came out as one line through `resume` and as two through `status`. A rule
 * applied by the CALLER is a rule with as many doors as there are callers, and the
 * second door is always the one nobody looked at. The other values are the record's
 * own — a uuid, a word of a closed pair, two durations this module words out of
 * numbers — so the goal is the one thing on the phrase there is anything to collapse.
 *
 * The ` — ` is a CHUNK of its own template rather than the head of the goal, which is
 * the rule `wiring/on-one-line.ts` states and the reason the three halves are joined
 * rather than nested: a fragment carrying its own punctuation, collapsed, loses the
 * space it opens with, and `for a — g` becomes `for a— g`.
 *
 * WHAT WAS WRITTEN RIDES IT WHETHER THE RUN IS OPEN OR ENDED, which is the one part of
 * this phrase that is NOT under the age's rule. An age beside an ended run would read
 * as time still passing; a tally beside one reads as what that session did, and the
 * reader of an ENDED run is exactly the person asking "where was I" — the question this
 * phrase exists for. Asserted in `cli-e2e.test.ts` — "`resume` says what was written in
 * the run, ended or open".
 */
export function lastRunPhrase(run: {
  readonly id: string;
  readonly open: boolean;
  readonly goal?: string;
  readonly ageSeconds?: number;
  readonly idleSeconds?: number;
  readonly wrote: readonly WrittenInRun[];
}): string {
  return (
    `last run ${run.id} (${run.open ? 'open' : 'ended'})` +
    (run.goal === undefined ? '' : ` — ${oneLine(run.goal)}`) +
    (run.open ? runAgeSuffix(run) : '') +
    wroteSuffix(run)
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
 * WHAT was written in a run — the tally per kind, commonest first, appended to the
 * run's OWN line.
 *
 * The order and the entries are the projection's (`core`'s `run.ts`); this only words
 * them. It is the answer to the complaint that put this clause here: every reading of a
 * run reported the CONTAINER — an id, a goal, two durations — and none of them said
 * what was put in it, so a session that recorded a decision and one that recorded
 * nothing but a memory printed the same line.
 *
 * IT IS UNCUT, and that is the projection's ceiling kept rather than a second decision
 * made here. The entries are over the event catalog, a closed union, so the clause is
 * bounded by the number of kinds however long the session ran — which is why there is
 * no `+N more` and no total beside it, the shape the four lists of `status` need
 * because a record holds entities without limit.
 *
 * WHAT THAT BOUND COSTS, measured rather than assumed: the golden transcript pins one
 * run that every write of the fixture was pinned to — 10 kinds, 30 facts — and its
 * clause is 10 entries and about 210 characters (`cli.reads.golden.txt`, "the run that
 * did something"). That is the worst shape a real record produces, and it wraps on a
 * narrow terminal rather than truncating. The trade is deliberate: a cut here would be
 * a second observable decision to document and to keep in step with the projection's
 * order, in exchange for a line that is already the LONGEST one this file can word.
 *
 * "wrote nothing" IS SAID, and it is said even beside {@link runAgeSuffix}'s own
 * "nothing recorded in it", which for an OPEN run is the same fact from the other axis.
 * The two are left to agree rather than one being dropped: dropping this half when the
 * other happens to be present would make the clause conditional on the run being open,
 * which is the rule written in two places — and the case that needs it most is the
 * ENDED run, where `runAgeSuffix` does not run at all and silence would be the only
 * answer a reader got.
 *
 * THE SITE THIS CLAUSE DELIBERATELY DOES NOT REACH is `mnema usage`, which is the
 * other reading in this package that lists runs (`presentation/usage.ts`). It was found
 * by asking who reads `listRuns`, not by anybody's list, and it is left alone because
 * it answers a different question: what a session COST, joined to the host's
 * transcripts, in a fixed-width table whose closing statement says the numbers are not
 * the record's. What a run wrote is the record's, and putting it in that table would
 * mix the two halves the report exists to keep apart.
 *
 * Nothing here goes through `oneLine`: every value on this clause is the record's own
 * — a kind is one of the catalog's literals and a count is a number — so there is no
 * text an actor typed for a newline to hide in. That is the classification
 * `tests/the-line-a-reading-words-is-one-line.test.ts` holds for this line.
 */
export function wroteSuffix(run: { readonly wrote: readonly WrittenInRun[] }): string {
  if (run.wrote.length === 0) return ' · wrote nothing';
  return ` · wrote ${run.wrote.map((w) => `${w.count} ${w.kind}`).join(', ')}`;
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
