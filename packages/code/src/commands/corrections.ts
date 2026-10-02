/**
 * `mnema corrections` — what a person corrected in the session a `Stop` hook fires in, recorded as
 * decisions awaiting a judgement.
 *
 * WHAT IT IS FOR. The moments a person says "no, use Y" are decisions made by the one with the
 * authority to make them, and they are the ones an agent least often records
 * (`user-corrections.ts` says how they are found, and what that does not claim). This reads the
 * transcript the host names, finds the openings that correct, and records each as a `proposed`
 * decision — the state that exists for a person to accept or reject — citing the transcript line it
 * came from. No model is called.
 *
 * IT IS OFF UNTIL SOMEBODY SWITCHES IT ON (`mnema switch on user-corrections`), because it is the
 * one reader that reads a conversation's WORDS, and it writes. What it writes is quoted from the
 * person's own sentence, so the proposals go to the PRIVATE tree: a sentence typed into a chat is not
 * written to be committed, and a clone must never get it.
 *
 * ONCE PER CORRECTION. A `Stop` fires after every response over the same transcript, so each
 * proposal carries the session and the line it came from, and a correction whose marker is already
 * in a decision of this project is not recorded again. At most {@link MOST_PER_STOP} are recorded
 * at a `Stop`: the next one continues from where this left off, and a long old session is not turned
 * into a flood of proposals in one response.
 *
 * IT SPEAKS ONLY WHEN IT RECORDED SOMETHING, in a line that says how many and under which ADR labels
 * and carries none of the person's words. Every other outcome is the empty reply `{}`; what went wrong
 * is a note on the second stream, and nothing reads it to decide.
 */

import { channelIsOn } from '@mnema/copilot';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { STARTS_OFF, USER_CORRECTIONS_CHANNEL } from '../record-framing.js';
import { withScopedCaches } from '../tree-sources.js';
import { type Correction, correctionsIn } from '../user-corrections.js';
import { whatThePersonSaid } from '../what-the-session-did.js';
import { runDecision } from './decision.js';

/** What the command needs — injected so it is testable. */
export interface CorrectionsContext {
  /** Where the host started the hook: the project is resolved from it. */
  readonly cwd: string;
  /** The discovery environment (`$HOME`, `$MNEMA_HOME`). */
  readonly env: DiscoveryEnv;
}

/** The reply for the host, and what the run has to say beside it. */
export interface CorrectionsDone {
  readonly ok: true;
  /** The JSON the host reads on stdout — `{}` unless something was recorded. */
  readonly reply: object;
  /** Lines for the second stream: what was found and not recorded, and why. */
  readonly notes: readonly string[];
}

/** The most proposals one `Stop` records. */
export const MOST_PER_STOP = 5;

/** The name the proposals are recorded under: the actor is a reader, not a person and not a model. */
const READER = 'mnema-user-corrections';

/** The longest title a proposal is given; the whole sentence is in its rationale. */
const TITLE_LENGTH = 100;

/** What identifies a correction across the many `Stop`s that read one transcript. */
function markerOf(correction: Correction): string {
  // Closed by a bracket, so line 1 is not found inside line 12.
  return `[host transcript, session ${correction.session ?? 'unknown'}, line ${correction.line}]`;
}

/** The silence, with what to say about it on the second stream. */
function silent(notes: readonly string[] = []): CorrectionsDone {
  return { ok: true, reply: {}, notes };
}

/** The title a proposal is given: the opening of what the person said, cut on one line. */
function titleOf(sentence: string): string {
  const cut =
    sentence.length <= TITLE_LENGTH
      ? sentence
      : `${sentence.slice(0, TITLE_LENGTH - 1).trimEnd()}…`;
  return `Correction: ${cut}`;
}

/** The reason a proposal carries: what was said, the shape it matched, where it is from. */
function rationaleOf(correction: Correction): string {
  return (
    `The person corrected the agent in a session, in these words: “${correction.sentence}” — ` +
    `matched by the shape “${correction.shape}”. Nobody has ruled whether it is a decision to keep. ` +
    `Source: ${markerOf(correction)}.`
  );
}

/** Answers the hook payload `input.payload`: records the corrections it finds, or `{}`. */
export function runCorrections(
  ctx: CorrectionsContext,
  input: { readonly payload: string },
): CorrectionsDone {
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(input.payload);
    if (typeof parsed !== 'object' || parsed === null) return silent();
    payload = parsed as Record<string, unknown>;
  } catch {
    return silent(['The hook input was not JSON, so no correction was read.']);
  }
  if (payload['hook_event_name'] !== 'Stop') return silent();
  const transcript = payload['transcript_path'];
  if (typeof transcript !== 'string' || transcript === '') {
    return silent(['The Stop input named no transcript, so no correction was read.']);
  }
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) return silent();

  // THE CHANNEL IS ASKED BEFORE THE TRANSCRIPT IS READ: this one starts off, so for most
  // sessions the answer is no, and a conversation's words are never opened.
  const candidates = withScopedCaches(trees, (sources): readonly Correction[] => {
    if (!channelIsOn(sources, USER_CORRECTIONS_CHANNEL, STARTS_OFF)) return [];
    const recorded = sources
      .filter((source) => source.scope !== 'global')
      .flatMap((source) => source.cache.listDecisions().map((one) => one.rationale));
    return correctionsIn(whatThePersonSaid(transcript)).filter(
      (one) => !recorded.some((rationale) => rationale.includes(markerOf(one))),
    );
  });
  if (candidates.length === 0) return silent();

  const notes: string[] = [];
  const adrs: string[] = [];
  for (const one of candidates.slice(0, MOST_PER_STOP)) {
    const done = runDecision(ctx, {
      title: titleOf(one.sentence),
      rationale: rationaleOf(one),
      scope: 'private',
      which: READER,
    });
    if (done.ok) adrs.push(done.adr);
    else {
      notes.push(
        `The correction at line ${one.line} was not recorded: ${done.reason === 'REFUSED' ? done.message : done.reason}`,
      );
    }
  }
  if (adrs.length === 0) return silent(notes);
  const n = adrs.length;
  return {
    ok: true,
    reply: {
      systemMessage:
        `${n} ${n === 1 ? 'correction' : 'corrections'} the person made in this session ` +
        `${n === 1 ? 'was' : 'were'} recorded as ${n === 1 ? 'a proposed decision' : 'proposed decisions'} in ` +
        `this machine’s private tree: ${adrs.join(', ')}.`,
    },
    notes,
  };
}
