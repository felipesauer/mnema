/**
 * `mnema beside-a-write --host <host>`: the rules of the record addressed at a file a write just
 * touched, handed to the model beside the write's result, for a host whose hook BEFORE a write has
 * no field for text.
 *
 * WHAT IT IS FOR. Copilot CLI's `preToolUse` answers with a decision and nothing to say beside it,
 * and Gemini CLI's `BeforeTool` too; both have a hook that runs once the tool is done and whose
 * reply carries text the model reads with the tool's output (`PostToolUse` and `AfterTool`). The
 * text is the one `before-a-write` hands Codex, Qwen Code and OpenCode in the same reply as their
 * gate, composed by the same functions (`readThePush`, then `editRulesToldAcross`), under the same
 * switch (`mnema switch off edit-rules-push`) and with the same ceiling; what differs is the moment,
 * after the write, and the shape of the reply (`replyBeside`).
 *
 * IT CHARGES NOTHING, and that is why it is a verb of its own and not `before-a-write` run again:
 * run after the write, the gate would record a second `channel.refused` or `channel.asked` for a
 * write that was already refused or already asked about. This asks `whatAWriteMeets` nothing, so it
 * can neither refuse, ask nor record a charge. The one fact it can leave is the push's own,
 * `channel.served`, once per session of the host (`takeTheFirstServing`), under the name the record
 * gives the agent's key or the host's. A payload with no session id is handed nothing, as there.
 *
 * EVERY OUTCOME IS THE EMPTY REPLY `{}`, a record that cannot be read included: the write has
 * happened, and there is nothing left to close. What went wrong, when something did, is a note for
 * the second stream, which nothing reads to decide.
 */

import { pathsOfAWrite, replyBeside } from '../host-hook.js';
import { type BesideHost, hookTextOf } from '../host-names.js';
import { hookCeilingOf } from '../presentation/within-a-hook.js';
import { sessionIdOf } from '../session-journal.js';
import {
  type BeforeAWriteContext,
  type BeforeAWriteDone,
  runBeforeAPath,
} from './before-a-write.js';

/** The silence, with what to say about it on the second stream. */
function silent(notes: readonly string[] = []): BeforeAWriteDone {
  return { ok: true, reply: {}, notes };
}

/**
 * Answers the payload of the hook that ran after a write, `input.payload`, for `input.host`: the
 * rules addressed at the paths it wrote, in the reply that host reads, or `{}`.
 */
export function runBesideAWrite(
  ctx: BeforeAWriteContext,
  input: { readonly host: BesideHost; readonly payload: string },
): BeforeAWriteDone {
  let payload: unknown;
  try {
    payload = JSON.parse(input.payload);
  } catch {
    return silent(['The hook input was not JSON, so no write was read.']);
  }
  const paths = pathsOfAWrite(input.host, payload);
  if (paths === undefined) return silent();
  if (paths.length === 0) {
    const tool = String((payload as Record<string, unknown>)['tool_name']);
    return silent([
      `The ${tool} input named no path this command can read, so nothing was handed.`,
    ]);
  }
  const done = runBeforeAPath(ctx, {
    which: input.host,
    paths,
    asks: false,
    ceiling: hookCeilingOf(hookTextOf(input.host)),
    reply: (said) => replyBeside(input.host, said.context),
    push: {
      session: sessionIdOf((payload as Record<string, unknown>)['session_id']),
      only: true,
    },
  });
  return done;
}
