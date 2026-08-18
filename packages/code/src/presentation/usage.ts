/**
 * What the runs of this project cost: one line each, and a closing statement that this
 * is not part of the proof.
 *
 * THE LAST COLUMN IS A WORD OR IT IS FOUR NUMBERS, never a number standing in for a
 * word. The three answers this reading can give — attributed, ambiguous, absent — are
 * three different pieces of news, and the one that costs a reader most is the one a
 * naive report would erase: a run with no transcript printed as `0` tells a person
 * their agent worked for nothing. So absence is spelled (`no transcript`) and ambiguity
 * is spelled (`not attributed`), for the reason `tails.ts` prints `no waiver` rather
 * than leaving a column empty — a word is a difference the eye can find in a column,
 * and a blank is a question.
 *
 * TOKENS AND A MODEL ID. NEVER DOLLARS. Three products of the ecosystem study carry a
 * hardcoded price table that ages in silence, and one of them had priced EVERY
 * non-Claude model wrong through a default. Here it is not even a choice worth having:
 * the host writes no price per message, so a dollar figure on this line could only be
 * this product's own arithmetic over a table it would have to keep — a number with a
 * report's authority and nobody's measurement behind it.
 *
 * NOTHING ON THE LINE IS PROSE SOMEBODY WROTE except the agent's name, and that one is
 * collapsed with `oneLine`. Everything else is an id, a count, an instant or a word
 * this file chose. The two fields that come from OUTSIDE the record — the model id and
 * the session id — are collapsed too, and that is the one place this report differs
 * from every other: the values in a list are usually the record's, screened at the door
 * they came in through, and these arrived in a file the host wrote and nothing here
 * verified. A newline in one of them would forge a row (see `one-line.ts` for
 * the rule and what it costs when a list does not keep it).
 *
 * THE CLOSING STATEMENT IS NOT A FOOTER. It says the counts are the host's and not the
 * record's, that no signature stands behind them, and that the join to a run is this
 * command's inference — and it is on the page for the same reason `verify` says which
 * level it reached instead of saying "verified". A cost table printed by an audit tool
 * with nothing qualifying it reads as part of the proof, and this one cannot be
 * checked by anybody holding only the chain. Its claim that nothing was written to
 * produce it is held to being true by `the-cost-comes-from-the-host.test.ts`, which
 * hashes the whole sandbox — the record, the caches, the keys and the host's own store
 * — around the invocation.
 */

import type { RunSpend, UsageDone } from '../commands/usage.js';
import { oneLine } from '../one-line.js';
import { asId, column, itemLine } from './items.js';
import type { Render } from './render.js';

/** The width the agent column is padded to, so the windows below it line up. */
const AGENT_WIDTH = 14;

/** What a line says when no transcript of this project's meets the run's window. */
const ABSENT = 'no transcript';

/** What a line says when more than one does, and the reading will not choose. */
const AMBIGUOUS = 'not attributed';

/** How an open run's window is written where an ended one writes its end. */
const STILL_OPEN = 'open';

/**
 * What this report is, said once, at the end.
 *
 * Three claims, because three of them are load-bearing and a reader who takes any one
 * of them for granted has misread the table: WHERE the number comes from, that the
 * proof does not reach it, and that the row it sits on was worked out here from two
 * clocks rather than recorded by anybody.
 */
const NOT_THE_RECORD = [
  "These counts come from Claude Code's own transcripts on this machine, not from the record:",
  'nothing here is signed, `mnema verify` does not cover it, and the host deletes a transcript',
  'on a retention it decides. Which host session belongs to which run is this reading',
  'inferring it from two clocks, not a fact the record states. Nothing was written to produce it.',
].join(' ');

/** The lines `mnema usage` prints. */
export function usageReport(render: Render, listing: UsageDone): string[] {
  if (listing.runs.length === 0) {
    return [`No run is recorded here — looked in ${listing.trees.join(', ')}.`, '', NOT_THE_RECORD];
  }
  return [
    `${listing.runs.length} run(s):`,
    ...listing.runs.map((spend) =>
      render(
        itemLine([
          // The whole id: it is the handle every other reading of a run takes, and a
          // column that shortened it would make this table unusable next to them.
          asId(spend.run),
          column(oneLine(spend.agent), AGENT_WIDTH),
          window(spend),
          told(spend),
        ]),
      ),
    ),
    '',
    // The STORE is a path, and a path is the value this whole class was first measured
    // on: it is built from the machine's home and an environment this reading does not
    // own. Every other value on this report is an id, a count, an instant or a word.
    `Read from ${oneLine(listing.store)} — ${listing.sessionsInStore} host session(s) there record work in this project.`,
    NOT_THE_RECORD,
  ];
}

/** The run's window: when it opened, and when it closed or that it has not. */
function window(spend: RunSpend): string {
  return `${spend.startedAt} → ${spend.endedAt ?? STILL_OPEN}`;
}

/**
 * The last column: the four counts, or the word saying why there are none.
 *
 * The counts are written out in full — no thousands separator, no `k`, no rounding.
 * This is the column somebody copies into an accounting of what a piece of work cost,
 * and a rounded number is one that cannot be added to another one.
 */
function told(spend: RunSpend): string {
  if (spend.numbers === undefined) {
    return spend.sessions.length === 0
      ? ABSENT
      : `${AMBIGUOUS} · ${spend.sessions.length} host sessions overlap this run: ${spend.sessions.map(oneLine).join(', ')}`;
  }
  const { input, output, cacheRead, cacheCreation, models, messages, passedOver } = spend.numbers;
  const parts = [
    `in ${input} · out ${output} · cache-read ${cacheRead} · cache-write ${cacheCreation} tokens`,
    `${messages} message(s)`,
    models.length === 0 ? 'no model named' : models.map(oneLine).join(' + '),
    `session ${oneLine(spend.sessions[0] ?? '')}`,
  ];
  // Said only when there is something to say. A `0 passed over` on every line would be
  // a column of zeroes a reader learns to skip, and this is the one number on the row
  // that means "the reading did not understand part of what it read".
  if (passedOver > 0) parts.push(`${passedOver} line(s) passed over`);
  return parts.join(' · ');
}
