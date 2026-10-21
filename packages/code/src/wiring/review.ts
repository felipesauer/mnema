/**
 * `mnema decision review`: the person's way through the decisions awaiting a judgement.
 *
 * It is interactive and it is a person's: it asks at a terminal, and it signs with the person's
 * own key. `MNEMA_AGENT_KEY` is NOT read here (`hereWriting` is what would read it), and the
 * verb says so when the variable is set, because an accept that an agent's key signed is an
 * agent's accept and this door exists so that a person need not copy an id.
 *
 * Every verdict goes through `runDecisionTransition`, the function `decision move` calls: the gate
 * that asks for the note, the key, the state machine and the refusal codes are that function's,
 * and a refusal on one decision is said and the review goes on to the next.
 */

import { agentKeyFromEnvironment, discoveryEnv } from '../env.js';
import { fact } from '../presentation/detail.js';
import { proposalLines, reviewedSummary } from '../presentation/reviewed.js';
import { linkBreakNotice } from './integrity.js';
import { reportRefusal } from './report.js';
import { PIN_REFUSED } from './run-pin.js';
import type { Wiring } from './verb.js';

const NEEDS_A_PERSON = 'DECISION_REVIEW_NEEDS_A_PERSON';

/** The note a review carries when the person writes none. */
export function defaultReviewNote(today: string): string {
  return `${today}, reviewed with mnema decision review`;
}

/** What the person answered at one decision, read from the line they typed. */
export type Verdict =
  | { readonly action: 'accept' | 'reject'; readonly note?: string }
  | { readonly action: 'skip' }
  | { readonly action: 'quit' }
  | { readonly action: 'again' };

/**
 * The line read as a verdict. The first word is the choice (a letter or the word); for an accept
 * or a reject the rest of the line, when there is one, is the note for THAT decision. Anything
 * else asks again.
 */
export function verdictOf(line: string): Verdict {
  const [head = '', ...rest] = line.trim().split(/\s+/);
  const note = rest.join(' ').trim();
  const word = head.toLowerCase();
  if (word === 'a' || word === 'accept') {
    return { action: 'accept', ...(note !== '' ? { note } : {}) };
  }
  if (word === 'r' || word === 'reject') {
    return { action: 'reject', ...(note !== '' ? { note } : {}) };
  }
  if (word === 's' || word === 'skip') return { action: 'skip' };
  if (word === 'q' || word === 'quit') return { action: 'quit' };
  return { action: 'again' };
}

/** Runs the review. Nothing is written before the terminal is known to be one. */
export async function reviewDecisions(wiring: Wiring): Promise<void> {
  const { io, render, pinnedRun } = wiring;
  const ctx = { cwd: process.cwd(), env: discoveryEnv() };
  const { proposalsToReview } = await import('../commands/decision-review.js');
  const read = proposalsToReview(ctx);
  if (!read.ok) {
    reportRefusal(wiring, read);
    return;
  }
  for (const line of linkBreakNotice(read.linkBreaks)) io.err(render(line));
  const { proposals } = read;
  if (proposals.length === 0) {
    io.out('Nothing awaiting a judgement.');
    return;
  }
  if (io.aPersonIsHere !== true || io.ask === undefined) {
    const ids = proposals.map((one) => one.id).join(' ');
    reportRefusal(wiring, {
      reason: 'REFUSED',
      code: NEEDS_A_PERSON,
      message:
        `a review is asked at a terminal, and this is not one. ${proposals.length} decision(s) await a judgement, ` +
        `and \`mnema decision move accept ${ids} --note "<why>"\` (or \`reject\`) rules them without one. ` +
        'Nothing was written.',
    });
    return;
  }
  const ask = io.ask;
  const run = pinnedRun();
  if (run === PIN_REFUSED) {
    io.fail();
    return;
  }
  if (agentKeyFromEnvironment(process.env) !== undefined) {
    io.err(
      render(
        fact(
          'MNEMA_AGENT_KEY is set and is not used here: a review is yours, and what you rule is signed with your own key.',
          0,
        ),
      ),
    );
  }

  const fallback = defaultReviewNote(new Date().toISOString().slice(0, 10));
  const typed = (await ask(`Note for the verdicts of this review [${fallback}]: `)).trim();
  const shared = typed !== '' ? typed : fallback;
  const { runDecisionTransition } = await import('../commands/decision-transition.js');
  const { movedLine } = await import('../moved-record.js');

  const counts = { accepted: 0, rejected: 0, skipped: 0 };
  let position = 0;
  for (const proposal of proposals) {
    position += 1;
    io.out('');
    for (const line of proposalLines(proposal, position, proposals.length)) io.out(render(line));
    let verdict: Verdict = { action: 'again' };
    while (verdict.action === 'again') {
      verdict = verdictOf(
        await ask('(a)ccept, (r)eject, (s)kip, (q)uit; a note may follow a or r: '),
      );
    }
    if (verdict.action === 'quit') {
      counts.skipped += proposals.length - position + 1;
      break;
    }
    if (verdict.action === 'skip') {
      counts.skipped += 1;
      continue;
    }
    const result = runDecisionTransition(
      { ...ctx, say: (line) => io.err(render(fact(line, 0))) },
      {
        id: proposal.id,
        action: verdict.action,
        proof: { note: verdict.note ?? shared },
        ...(run !== undefined ? { run } : {}),
      },
    );
    if (result.ok) {
      io.out(movedLine('decision', result.adr, result.id, result.to));
      if (verdict.action === 'accept') counts.accepted += 1;
      else counts.rejected += 1;
    } else {
      reportRefusal(wiring, result);
      counts.skipped += 1;
    }
  }
  io.out('');
  io.out(reviewedSummary(counts));
}
