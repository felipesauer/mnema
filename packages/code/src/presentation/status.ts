/**
 * Where things stand, for a person: the actor's session, then the four lists the
 * opening context holds — FORM A four times over, under one heading.
 *
 * The MCP surface hands the same answer back as structure, because its consumer is a
 * machine; here the consumer is a person, so it is lines. Nothing is derived on the way:
 * every item, every count and every order comes from `@mnema/copilot`'s `bootstrap`
 * exactly as it arrived, and what this module decides is only how each reads.
 *
 * NAMES, NEVER BODIES, and that is the derivation's rule kept rather than a layout
 * choice. A pattern appears as its name and a decision as its title and `ADR-<n>`
 * label; neither body is here, and `mnema show <id>` is the second read that serves one
 * (see `copilot/src/context/bootstrap.ts`). A work item carries no move list for the
 * same reason — `mnema next-actions <id>` is its second read.
 *
 * A CUT SAYS IT WAS CUT. Three of the four lists are capped by the derivation and carry
 * their own total, so each header reads `3 of 12` when it was capped and `3` when it was
 * not — the shape `search` already uses, because a capped list that does not say so is
 * read as everything there is. The adopted patterns are the fourth and carry no total,
 * so that header states the length it has and claims nothing else.
 *
 * AN EMPTY LIST IS STATED, never left out. Four sections that appear only when they have
 * something would make an empty record print the heading and nothing under it, which is
 * the exact shape the derivation's own doc calls the worst an opening read can have: an
 * empty answer that looks like an answer. So each list says it is empty in its own
 * words, and a reader can tell "nothing is waiting on anybody" from "I forgot to look".
 *
 * ONE LINE PER ITEM, which is why every field an actor wrote goes through `oneLine`: a
 * title or a pattern name holding a newline would put a second line under a header that
 * says how many there are, and that second line reads exactly like an item nothing ever
 * recorded (see `served-patterns.ts`, and `one-line-per-item.test.ts`).
 */

import type { AwaitingJudgement, Bootstrap } from '@mnema/copilot';
import { oneLine } from '../served-patterns.js';
import { fact } from './detail.js';
import { asId, column, itemLine } from './items.js';
import type { Render } from './render.js';
import { lastRunPhrase, openRunsPhrase } from './runs.js';
import { asState } from './state.js';

/**
 * How wide the column that says which machine an item awaiting a ruling belongs to.
 *
 * It is `decision`'s length, the longer of the two words the derivation's discriminant
 * can hold, so the titles beside it line up and the column never pushes a line right.
 */
const KIND_WIDTH = 'decision'.length;

/** The lines `mnema status` prints: the actor's session, then the four lists. */
export function statusReport(render: Render, status: Bootstrap, actor: string): string[] {
  return [
    `${actor} — where things stand.`,
    ...sessionLines(render, status),
    '',
    ...workLines(render, status),
    '',
    ...decisionLines(render, status),
    '',
    ...skillLines(render, status),
    '',
    ...awaitingLines(render, status),
  ];
}

/**
 * Where the actor left off — the same two facts `resume` answers with, worded by the
 * same functions so the two readings cannot drift (see `runs.ts`).
 *
 * WHAT IS NOT HERE IS `NO_RUNS_HINT`, and the reason is what that hint is FOR. It exists
 * so that an empty `focus` or `resume` — which is the whole of those answers — does not
 * read as something missing; most people working the command line have no run and never
 * will. Here the run is one half of five, the other four carry the answer, and three
 * lines explaining what a run is would push them down the screen in every session that
 * has none. `mnema resume --actor <id>` is where a reader who wants the explanation
 * finds it, unchanged.
 */
function sessionLines(render: Render, status: Bootstrap): string[] {
  const { lastRun } = status.resume;
  if (lastRun === null) return [render(fact('No runs.'))];
  return [render(fact(lastRunPhrase(lastRun))), render(fact(openRunsPhrase(status.resume)))];
}

/**
 * The live work: what a reader still has something to do about, freshest first.
 *
 * IT SAID `actionable` UNTIL THE WORD BECAME FALSE, and the rename is the point of
 * this paragraph rather than a tidy-up. The list used to mean "has a legal move", and
 * under that rule a completed task was on it forever — `reopen` is legal from `DONE`
 * — which is how a person reading `5 actionable task(s)` on a terminal found one of
 * them marked `(DONE)`. The derivation now asks the disposition (see `copilot`'s
 * `tasks.ts`), and a word that promises "there is an action available here" would
 * still be true of the task this list correctly leaves out. `live` is what the filter
 * actually says.
 */
function workLines(render: Render, status: Bootstrap): string[] {
  if (status.work.length === 0) return ['No live tasks.'];
  return [
    `${served(status.work.length, status.workTotal)} live task(s):`,
    ...status.work.map((item) =>
      render(itemLine([asId(item.id), oneLine(item.title), asState(item.state)])),
    ),
  ];
}

/** The decisions in force — accepted, and nothing else. */
function decisionLines(render: Render, status: Bootstrap): string[] {
  if (status.decisions.length === 0) return ['No decisions in force.'];
  return [
    `${served(status.decisions.length, status.decisionsTotal)} decision(s) in force:`,
    ...status.decisions.map((item) =>
      render(itemLine([asId(item.id), item.adr, oneLine(item.title)])),
    ),
  ];
}

/**
 * The adopted patterns, by name, in the order the derivation gives them (by name), and
 * uncut — the one list with no total to report, because nothing cuts it.
 */
function skillLines(render: Render, status: Bootstrap): string[] {
  if (status.skills.length === 0) return ['No adopted patterns.'];
  return [
    `${status.skills.length} adopted pattern(s):`,
    ...status.skills.map((item) => render(itemLine([asId(item.id), oneLine(item.name)]))),
  ];
}

/**
 * What is waiting on a person: one list across all three machines, each line saying
 * which machine it is and which ruling is missing.
 *
 * The `kind` is a column of its own rather than folded into the title, because it is
 * what says which second read serves the rest of the item — `mnema show <id>` for a
 * decision's argument or a pattern's text, `mnema next-actions <id>` for the pair of
 * verdicts a task in review allows, which are different things to go and read.
 */
function awaitingLines(render: Render, status: Bootstrap): string[] {
  if (status.awaitingJudgement.length === 0) return ['Nothing awaiting a judgement.'];
  return [
    `${served(status.awaitingJudgement.length, status.awaitingJudgementTotal)} awaiting a judgement:`,
    ...status.awaitingJudgement.map((item) =>
      render(
        itemLine([
          asId(item.id),
          column(item.kind, KIND_WIDTH),
          oneLine(named(item)),
          asState(item.state),
        ]),
      ),
    ),
  ];
}

/**
 * What one item on the mixed list is CALLED, which is the one place the three kinds
 * are told apart on this surface.
 *
 * The discriminant is the derivation's own `kind`, and the claim that a third machine
 * with a waiting side "does not compile until somebody has said how its items are
 * named" was written here before there was one. It held: the day the task machine
 * joined the list, `tsc` refused this function — a task carries a `title` and no
 * `name`, so the two-armed ternary this used to be had nowhere to put it.
 *
 * The arms are spelled out per kind and there is NO `default`, which is what keeps
 * that property for the next one. An else would have compiled the day a fourth kind
 * arrived carrying a `title`, and named it wrongly; with every arm returning and none
 * catching the rest, a kind this switch does not answer leaves a path that returns
 * nothing, and a function declared `string` does not build with one.
 */
function named(item: AwaitingJudgement): string {
  switch (item.kind) {
    case 'decision':
      return `${item.adr} · ${item.title}`;
    case 'skill':
      return item.name;
    case 'task':
      return item.title;
  }
}

/**
 * How many a list shows out of how many there are — `3 of 12` when it was cut, `3` when
 * it was not.
 *
 * It is `search`'s wording, taken deliberately: a reader who has met one capped list on
 * this surface has met them all, and a second phrasing for the same fact would be a
 * second thing to learn.
 */
function served(shown: number, total: number): string {
  return total > shown ? `${shown} of ${total}` : `${total}`;
}
