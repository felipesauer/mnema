/**
 * `mnema tally` — a fact about the session a hook fires in: how many files its own tool
 * calls wrote, and how many decisions were recorded since it opened.
 *
 * WHAT IT IS FOR. Measured in the field, an agent that edits a project records almost nothing
 * unless somebody asks, and it is the end of a response and the moment before a conversation is
 * compacted that nobody is looking. This says, at those two points, what the session did and
 * what the record holds from it — and nothing about what to do. The product has no standing to
 * tell a session its business, and a host reads text that is framed as an order differently from
 * text that states a fact (`record-framing.ts`); so the line is a count and the words around it
 * say what was counted.
 *
 * NO MODEL AND NO GUESSING. The files come from the transcript the host names in the payload
 * (`what-the-session-did.ts`); the decisions come from the record — every decision of the
 * project's own trees created at or after the instant the transcript opens. That instant is the
 * only thing tying a decision to a session, so the line says "recorded since it opened" and not
 * "recorded by it": a second session of the same project in the same hours is counted too, and
 * so is a decision a person recorded by hand.
 *
 * IT SPEAKS ONLY WHEN IT HAS SOMETHING TO COUNT. At `Stop` it speaks after a response that wrote a
 * file — the host fires that event after every response, and a line after a response that wrote
 * nothing would be noise a person learns to read past. Before a compaction it speaks whenever the
 * session wrote any file. Every other outcome is the empty reply `{}`: a hook that is not one of
 * these two, no project here, the channel switched off, a transcript this cannot read. What went
 * wrong, when something did, is a note on the second stream, and nothing reads it to decide.
 *
 * WHERE THE LINE LANDS IS THE HOST'S. It is written as the `systemMessage` of the reply, the field
 * every hook reply may carry, and which host shows it, to whom, was not measured.
 */

import { channelIsOn } from '@mnema/copilot';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { SESSION_TALLY_CHANNEL } from '../record-framing.js';
import { withScopedCaches } from '../tree-sources.js';
import { whatTheSessionDid } from '../what-the-session-did.js';

/** What the command needs — injected so it is testable. */
export interface SessionTallyContext {
  /** Where the host started the hook: the project is resolved from it. */
  readonly cwd: string;
  /** The discovery environment (`$HOME`, `$MNEMA_HOME`). */
  readonly env: DiscoveryEnv;
}

/** The reply for the host, and what the run has to say beside it. */
export interface SessionTallyDone {
  readonly ok: true;
  /** The JSON the host reads on stdout — `{}` unless there is something to count. */
  readonly reply: object;
  /** Lines for the second stream: why a count that could have been made was not. */
  readonly notes: readonly string[];
}

/** The two events this answers, by the name the host gives them in the payload. */
const STOP = 'Stop';
const BEFORE_A_COMPACTION = 'PreCompact';

/** The silence, with what to say about it on the second stream. */
function silent(notes: readonly string[] = []): SessionTallyDone {
  return { ok: true, reply: {}, notes };
}

/** How many of a thing, in the words the line uses for it. */
function counted(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The line a session is told: what was counted, from where, and nothing else.
 *
 * There is exactly one sentence, and it says what the numbers are the numbers OF, because
 * "this session edited 7 files" would claim the calls of a subagent too.
 */
function tallyLine(input: {
  readonly event: string;
  readonly files: number;
  readonly decisions: number;
}): string {
  const lead =
    input.event === BEFORE_A_COMPACTION ? 'This conversation is about to be compacted. ' : '';
  return (
    `${lead}Since this session opened, its own tool calls wrote ` +
    `${counted(input.files, 'file', 'files')}, and ` +
    `${counted(input.decisions, 'decision was', 'decisions were')} recorded in this project’s record.`
  );
}

/** Answers the hook payload `input.payload`: the line, or `{}` when there is nothing to count. */
export function runSessionTally(
  ctx: SessionTallyContext,
  input: { readonly payload: string },
): SessionTallyDone {
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(input.payload);
    if (typeof parsed !== 'object' || parsed === null) return silent();
    payload = parsed as Record<string, unknown>;
  } catch {
    return silent(['The hook input was not JSON, so nothing was counted.']);
  }
  const event = payload['hook_event_name'];
  if (event !== STOP && event !== BEFORE_A_COMPACTION) return silent();
  const transcript = payload['transcript_path'];
  if (typeof transcript !== 'string' || transcript === '') {
    return silent([`The ${event} input named no transcript, so nothing was counted.`]);
  }

  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) return silent();

  return withScopedCaches(trees, (sources): SessionTallyDone => {
    // The channel is asked BEFORE the transcript is read: a transcript can be tens of megabytes,
    // and a channel somebody switched off must not keep paying for it after every response.
    if (!channelIsOn(sources, SESSION_TALLY_CHANNEL)) return silent();

    const did = whatTheSessionDid(transcript, ctx.cwd);
    if (did === undefined) return silent([`The transcript ${transcript} could not be read.`]);
    if (did.editedFiles.length === 0) return silent();
    if (event === STOP && !did.lastResponseEdited) return silent();
    const since = did.openedAt === undefined ? Number.NaN : Date.parse(did.openedAt);
    if (Number.isNaN(since)) {
      return silent([
        'The transcript carries no instant, so no decision could be counted against it.',
      ]);
    }

    const decisions = sources
      .filter((source) => source.scope !== 'global')
      .reduce(
        (total, source) =>
          total +
          source.cache.listDecisions().filter((one) => Date.parse(one.createdAt) >= since).length,
        0,
      );
    return {
      ok: true,
      reply: { systemMessage: tallyLine({ event, files: did.editedFiles.length, decisions }) },
      notes: [],
    };
  });
}
