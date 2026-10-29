/**
 * `mnema before-a-write --host <host>`: the per-edit gate, for a host whose hooks are processes.
 *
 * WHAT IT IS FOR. A rule of the record linked to a path with `asks-for-a-person` holds a write
 * under that path until a person decides, and one linked with `refuses-a-write` does not let it
 * happen. Claude Code gets both from the MCP tool its hook calls (`rules_before_an_edit`); the
 * agents of VS Code and of Cursor run only command hooks. VS Code 1.137 holds a write for a person
 * when a command answers `ask` and refuses it on `deny`; Cursor's agent ignores `ask` and honours
 * `deny`. This is the command. It reads the payload the host
 * hands a hook on stdin, and it answers the reply that host reads, on stdout.
 *
 * IT DECIDES NOTHING OF ITS OWN, and the two things it could have decided twice are not here.
 * WHAT a write meets is `whatAWriteMeets`, the one site the MCP tool passes through too, which
 * puts a refusal over an asking. WHAT is recorded is the same facts in the same order: one
 * `channel.refused` or `channel.asked` per rule, citing the rule and the path, appended and
 * signed BEFORE the reply is composed. A record that cannot take them in time still refuses or
 * asks, and the reason says the fact is missing (`recordTheCharge`). What
 * differs is only the door: the host's payload is read by `host-hook.ts`, and the reply is
 * shaped there.
 *
 * A HOST THAT DOES NOT ASK IS NOT ASKED, AND NOTHING IS RECORDED AS IF IT HAD BEEN. Where a write
 * only asks, the Cursor door answers silence and appends nothing: the file would be written, and
 * a `channel.asked` would say a person was asked ({@link asksAPerson}).
 *
 * WHAT IT CARRIES BESIDE THE GATE, FOR THE HOSTS THAT TAKE IT (`pushes` in the host table): the
 * rules that `govern` the path, composed by the one function the MCP tool composes them with
 * (`readThePush`, then `editRulesToldAcross`), as the `additionalContext` of the same reply, where
 * no rule refuses the write. THIS PARAGRAPH SAID THE OPPOSITE: that this door "carries the gate
 * alone", because the push is recorded as served ONCE PER RUN, and a process started per write
 * remembers no run, so it would record one `channel.served` on every edit of a governed file, the
 * thousands-of-writes shape the fact's own declaration refuses (`channel.served`, `@mnema/chain`).
 * WHAT FALSIFIED IT is that a session of the host does have an id, which all three hosts that push
 * hand the hook (`session_id`, held by their cases of arrival), and this machine already keeps a
 * small file per session outside the record (`session-journal.ts`): the service is recorded the
 * first time a session is pushed to and remembered there (`takeTheFirstServing`), so a session of
 * a thousand edits leaves one fact. Held by `a-rule-is-pushed-beside-a-write.test.ts`. A payload
 * with no session id is pushed nothing and says so on the second stream: a push without its fact
 * is what the fact exists to prevent. A refusal records no service: each `channel.refused` is the
 * refusal itself, and nothing is pushed beside it, because the call ends there.
 *
 * EVERY OUTCOME THAT IS NOT A REFUSAL OR AN ASKING IS THE EMPTY REPLY `{}`, which the host reads
 * as nothing to say: a tool that is not a write (VS Code runs this hook for every tool), no
 * project here, the channels switched off (`mnema switch off edit-asks-a-person`, `mnema switch
 * off edit-refuses-a-write`), no rule asking or refusing at the path. The notes beside it are for a person who ran the verb by hand and
 * for the host's own log; nothing reads them to decide.
 *
 * A RECORD THAT CANNOT BE READ IS A REFUSAL, NOT A SILENCE: a stored line the reader refuses
 * means which rules apply cannot be known, so every write that reads that tree is answered `deny`
 * (the project's, or every project's for the machine-global tree), with the tree and the reader's
 * refusal in the reason and nothing recorded ({@link refusalOfAnUnreadableRecord}).
 */

import { dirname } from 'node:path';
import { catalogUpcasters, listPrivateKeyFingerprints } from '@mnema/chain';
import { channelIsOn, type RulesAtPath, type RunHere, runsHere } from '@mnema/context';
import {
  agentSignsIn,
  chainRootForScope,
  type DiscoveryEnv,
  resolveScope,
  resolveTrees,
  systemClock,
  withAgentKey,
} from '@mnema/core';
import {
  authorizingAnchor,
  openTreeForWriting,
  recordChannelAsked,
  recordChannelRefused,
  recordChannelServed,
  recordedAnchorOf,
  signerFor,
} from '@mnema/core/write';
import { anchorsBefore, foundingsSince, treesOf } from '../a-new-identity.js';
import { editRulesToldAcross, readThePush, type ThePush } from '../edit-rules-push.js';
import { asksAPerson, pathsOfAWrite, replyFor } from '../host-hook.js';
import { type HookHost, hookTextOf, pushesWithTheGate } from '../host-names.js';
import { withInheritedSource } from '../inherited-record.js';
import { recordTrees } from '../intelligence-source.js';
import type { HookSaid } from '../mcp/hook-reply.js';
import { type HookCeiling, hookCeilingOf } from '../presentation/within-a-hook.js';
import {
  ASKS_A_PERSON_CHANNEL,
  EDIT_PUSH_CHANNEL,
  REFUSES_A_WRITE_CHANNEL,
} from '../record-framing.js';
import { sessionIdOf, takeTheFirstServing } from '../session-journal.js';
import { caches, withScopedCaches } from '../tree-sources.js';
import {
  recordTheCharge,
  refusalOfAnUnreadableRecord,
  UNREADABLE_RECORD_NOTE,
  unrecordedCharge,
  type WriteVerdict,
  whatAWriteMeets,
} from '../what-a-write-meets.js';
import { CHARGING_CHANNELS, withWhoIsHere } from '../who-is-here.js';

/** What the command needs: injected so it is testable. */
export interface BeforeAWriteContext {
  /** Where the host started the hook: the project is resolved from it, and a relative path too. */
  readonly cwd: string;
  /** The discovery environment (`$HOME`, `$MNEMA_HOME`). */
  readonly env: DiscoveryEnv;
  /**
   * The agent whose key signs what this hook records, where the project's record enrols it:
   * `--agent-key`. Where it does, the facts' `which` is the name the record gives that key,
   * not the host's name; anywhere else the person's key signs and `which` is the host.
   */
  readonly agentKey?: string | undefined;
}

/**
 * The reply for the host, and what the run has to say beside it.
 *
 * There is no failure arm, and that is the contract rather than an omission: this runs inside
 * somebody else's session, on every tool call of it, and every way of not asking or refusing
 * answers the same empty reply, except a record that cannot be read, which refuses. What went
 * wrong, when something did, is a note.
 */
export interface BeforeAWriteDone {
  readonly ok: true;
  /** The JSON the host reads on stdout: `{}` unless the record asks or refuses. */
  readonly reply: object;
  /** Lines for the second stream: why a write that should have been read was not. */
  readonly notes: readonly string[];
}

/** The silence, with what to say about it on the second stream. */
function silent(notes: readonly string[] = []): BeforeAWriteDone {
  return { ok: true, reply: {}, notes };
}

/**
 * Answers the hook payload `input.payload` for `input.host`: `deny`, citing the rules, when a rule
 * of this project's record refuses a write at a path it touches; `ask` when one asks for a person
 * (and the host holds a write for one); `{}` otherwise.
 */
export function runBeforeAWrite(
  ctx: BeforeAWriteContext,
  input: { readonly host: HookHost; readonly payload: string },
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
    return silent([`The ${tool} input named no path this command can read, so nothing was asked.`]);
  }
  return runBeforeAPath(ctx, {
    which: input.host,
    paths,
    asks: asksAPerson(input.host),
    ceiling: hookCeilingOf(hookTextOf(input.host)),
    reply: (said) => replyFor(input.host, said),
    // THE HOSTS THAT TAKE THE PUSH (their `pushes` cell says yes) are handed the rules beside a
    // write that goes through, under the id of the session the host gave the hook.
    ...(pushesWithTheGate(input.host)
      ? { push: { session: sessionIdOf((payload as Record<string, unknown>)['session_id']) } }
      : {}),
  });
}

/**
 * What a write at `input.paths` meets in this project's record, answered in the reply `input.reply`
 * shapes: the half of {@link runBeforeAWrite} that does not depend on how a host spells a payload,
 * so a caller that already holds the paths (a program's own hook) asks the same question and gets
 * the same facts appended. `which` is the name the facts are recorded under; `asks` is whether the
 * caller can hold a write for a person (where it cannot, an asking is silence, and nothing is
 * recorded as if a person had been asked).
 */
export function runBeforeAPath(ctx: BeforeAWriteContext, input: APathAsked): BeforeAWriteDone {
  // A RECORD THAT CANNOT BE READ REFUSES THE WRITE: which rules apply is what cannot be known, and
  // silence would be read by the host as leave to write. Nothing is recorded, because a fact of
  // refusal cites a rule. Only the unreadable line is caught; anything else is thrown on.
  try {
    return whatAPathMeets(ctx, input);
  } catch (error) {
    const read = recordTrees(resolveTrees(ctx.cwd, ctx.env), undefined);
    const refusal = refusalOfAnUnreadableRecord(error, read);
    if (refusal === undefined) throw error;
    return { ok: true, reply: input.reply({ refuse: refusal }), notes: [UNREADABLE_RECORD_NOTE] };
  }
}

/** What {@link runBeforeAPath} is asked. */
export interface APathAsked {
  readonly which: string;
  readonly paths: readonly string[];
  readonly asks: boolean;
  /** What the host keeps of a hook's text; Claude Code's where omitted. */
  readonly ceiling?: HookCeiling;
  readonly reply: (said: HookSaid) => object;
  /**
   * Present where the caller takes the rules of the record beside a write that goes through
   * (`pushes` in the host table), with the id of the session the host gave the hook, or none: the
   * service of the push is remembered per session (`takeTheFirstServing`), so a payload with no id
   * is pushed nothing. `only` is a caller that runs AFTER the write (`beside-a-write`): the gate is
   * not asked at all, so nothing is refused, asked or recorded as charged, and only the rules and
   * the service of the push are read and recorded.
   */
  readonly push?: { readonly session: string | undefined; readonly only?: true };
}

function whatAPathMeets(ctx: BeforeAWriteContext, input: APathAsked): BeforeAWriteDone {
  const { paths } = input;
  const resolved = resolveTrees(ctx.cwd, ctx.env);
  // A name this product does not enrol still asks for an agent: its trees refuse what the hook would
  // record, and the person's key does not stand in. The charge itself is answered all the same.
  const trees =
    ctx.agentKey === undefined ? resolved : withAgentKey(resolved, ctx.env, ctx.agentKey);
  if (trees.projectPublic === undefined) return silent();
  // The project root is the PARENT of its `.mnema/`, the directory every address is written
  // against; a relative path is the host's, written against where it started the hook.
  const root = dirname(trees.projectPublic);
  const { met, others, pushes } = withScopedCaches(trees, (sources) => {
    // THE SWITCH OF THE PUSH IS ASKED BEFORE ANY RULE IS DERIVED, as the MCP tool asks it: switched
    // off, the reply is the gate's alone and the derivation behind the text never runs.
    const pushing = input.push !== undefined && channelIsOn(sources, EDIT_PUSH_CHANNEL);
    // THE RECORD THIS PROJECT INHERITS is read beside its own: a rule of it that refuses or asks at
    // the path applies here as the project's would, and says where it comes from.
    const read = withInheritedSource(trees, sources, (all) => {
      const found =
        input.push?.only === true
          ? undefined
          : whatAWriteMeets(all, { paths, root, from: ctx.cwd });
      // WHERE THE HOST DOES NOT ASK, AN ASKING IS NOT ONE: the write would go through, and the
      // record would say a person was asked.
      const gate =
        found === undefined || (found.grade === 'ask' && !input.asks) ? undefined : found;
      // A REFUSAL ENDS THE CALL: there is no write for the rules to ride beside.
      const pushed =
        pushing && gate?.grade !== 'refuse'
          ? paths.map((path) =>
              readThePush(all, sources, { path, root, from: ctx.cwd }, gate === undefined),
            )
          : [];
      return { gate, pushed };
    });
    // A push with no rule in force still speaks when it carries the line of a rule moved apart.
    const spoken = read.pushed.filter((one) => one.at.rules.length > 0 || one.apart !== undefined);
    // WHO ELSE WAS CHARGED AT THE PATH is read only where the hook is going to speak, so the
    // ordinary case, a write nothing charges, pays nothing for it.
    const place = read.gate?.at[0] ?? spoken[0]?.at;
    return {
      met: read.gate,
      others: place === undefined ? [] : otherRunsAt(trees, sources, place),
      pushes: spoken,
    };
  });
  if (met === undefined && pushes.length === 0) return silent();

  // THE ORDER IS THE MCP TOOL'S: the facts are appended, and only then does the reply carry the
  // charge. What the write founded, if it was this key's first in the tree, rides in the reason:
  // the one field of the reply anybody reads; the line on the second stream would be dropped.
  // THE CHARGE STANDS WHETHER ITS FACTS LAND OR NOT ({@link recordTheCharge}): decided by reading,
  // it is answered whatever the append does, and a fact that could not be written is said in the
  // reason and on the second stream, never by letting the write through.
  const before = anchorsBefore(treesOf(trees));
  const recorded =
    met === undefined
      ? { ok: true as const }
      : recordTheCharge(() => recordWhatItMet(trees, met, input.which));
  const unrecorded =
    met === undefined || recorded.ok ? [] : [unrecordedCharge(met.grade, recorded.why)];
  // WHAT IS PUSHED, once it is known there is something to push and a session to remember it by.
  const pushed =
    met?.grade === 'refuse' || input.push === undefined
      ? { text: undefined, notes: [] }
      : beside(trees, input, pushes, before);
  if (met === undefined) {
    return {
      ok: true,
      reply:
        pushed.text === undefined
          ? {}
          : input.reply({ context: withWhoIsHere(pushed.text, others, input.ceiling) }),
      notes: pushed.notes,
    };
  }
  const reason = withWhoIsHere(
    [met.reason, ...unrecorded, ...foundingsSince(before)].join('\n\n'),
    others,
    input.ceiling,
  );
  const said =
    met.grade === 'refuse'
      ? { refuse: reason }
      : { ask: reason, ...(pushed.text === undefined ? {} : { context: pushed.text }) };
  return { ok: true, reply: input.reply(said), notes: [...unrecorded, ...pushed.notes] };
}

/** What the second stream says where a push was owed and the payload gave no session to remember it by. */
const NO_SESSION_NOTE =
  'The hook input carried no session id, so the rules addressed at this path were not handed over beside the write.';

/**
 * The text a write that goes through is handed beside it, and what to say on the second stream, or
 * nothing where no session is known to remember the push by.
 *
 * THE TEXT IS COMPOSED AS THE MCP TOOL COMPOSES IT: what the write founded, then the line that says a
 * rule was moved apart, share the ceiling with the rules (`editRulesToldAcross`), so the host, which
 * measures one string, never gets a text it replaces by a file path. The service fact is recorded
 * BEFORE the founding is read, since recording is what can found, and never recorded for a push that
 * is not made.
 */
function beside(
  trees: ReturnType<typeof resolveTrees>,
  input: APathAsked,
  pushes: readonly ThePush[],
  before: ReturnType<typeof anchorsBefore>,
): { readonly text: string | undefined; readonly notes: readonly string[] } {
  if (pushes.length === 0) return { text: undefined, notes: [] };
  const session = input.push?.session;
  if (session === undefined) return { text: undefined, notes: [NO_SESSION_NOTE] };
  recordTheService(trees, input.which, session);
  const apart = [...new Set(pushes.flatMap((one) => (one.apart === undefined ? [] : [one.apart])))];
  const text = editRulesToldAcross(
    pushes.map((one) => one.at),
    [...foundingsSince(before), ...apart],
    input.ceiling,
  );
  return { text, notes: [] };
}

/**
 * Records that the push was live in this session, ONCE: the first time the session is pushed to, and
 * never again for it, remembered outside the record (`takeTheFirstServing`). A fact that cannot be
 * written is a gap in the evidence and never a push less: the marker is given back, so the next edit
 * of the session tries again, and the reply goes out whatever happened here.
 */
function recordTheService(
  trees: ReturnType<typeof resolveTrees>,
  which: string,
  session: string,
): void {
  const taken = takeTheFirstServing(trees, session, EDIT_PUSH_CHANNEL, which);
  if (taken === undefined) return;
  try {
    const scope = resolveScope('channel.served', { which });
    const named = agentSignsIn(trees, scope)?.name ?? which;
    const writer = openTreeForWriting(trees, scope);
    const ctx = {
      writer,
      layout: { root: chainRootForScope(trees, scope) as string },
      upcasters: catalogUpcasters(),
    };
    const done = writer.exclusively(() => {
      const appended = recordChannelServed(ctx, { channel: EDIT_PUSH_CHANNEL, which: named });
      writer.checkpoint();
      return appended;
    });
    if (!done.ok) taken.release();
  } catch {
    taken.release();
  }
}

/**
 * Appends one `channel.refused` or `channel.asked` per rule per path the write met, and, for an
 * asking only, the one `channel.served` of this asking, under one checkpoint: the facts the MCP
 * tool appends, in the tree they are routed to. The facts decide the answer; the service fact is
 * attempted and never un-asks. A refusal has no service fact, because it is itself the fact.
 */
function recordWhatItMet(
  trees: ReturnType<typeof resolveTrees>,
  met: WriteVerdict,
  which: string,
): { readonly ok: boolean; readonly why?: string } {
  const refusing = met.grade === 'refuse';
  const scope = resolveScope(refusing ? 'channel.refused' : 'channel.asked', { which });
  // WHERE THE RECORD ENROLS THE AGENT'S KEY, THE FACTS ARE ITS: signed by it, under the name the
  // record gave it. The host's name stands everywhere else (the person's key signs there).
  const named = agentSignsIn(trees, scope)?.name ?? which;
  const writer = openTreeForWriting(trees, scope);
  const ctx = {
    writer,
    layout: { root: chainRootForScope(trees, scope) as string },
    upcasters: catalogUpcasters(),
  };
  const channel = refusing ? REFUSES_A_WRITE_CHANNEL : ASKS_A_PERSON_CHANNEL;
  // The facts, the service fact and their signature in ONE hold of the tail's lock.
  return writer.exclusively(() => {
    for (const at of met.at) {
      for (const rule of at.rules) {
        const input = {
          channel,
          rule: rule.id,
          path: at.relative ?? at.path,
          which: named,
        };
        const done = refusing ? recordChannelRefused(ctx, input) : recordChannelAsked(ctx, input);
        if (!done.ok) {
          writer.checkpoint();
          return { ok: false, why: done.message };
        }
      }
    }
    // A SERVICE FACT THAT DID NOT LAND IS A GAP IN THE EVIDENCE, NOT AN UN-ASKING: the askings are
    // on the chain, so the charge rides, the MCP tool's rule for the same two facts.
    if (!refusing) recordChannelServed(ctx, { channel: ASKS_A_PERSON_CHANNEL, which: named });
    writer.checkpoint();
    return { ok: true };
  });
}

/**
 * The other runs of this machine charged at `place`, the first path the write met or the first one the
 * push is made for (`runsHere`), or none.
 *
 * THIS PROCESS HAS NO RUN OF ITS OWN to leave out, so a run of the agent that is writing, one it
 * opened through the server, is named like any other, and the sentence names the agent so that
 * its reader can tell. The identity asked for is the machine's own, decided as a write decides
 * it; a key the record cannot place says no one rather than fail a hook that has to answer.
 */
function otherRunsAt(
  trees: ReturnType<typeof resolveTrees>,
  sources: Parameters<typeof caches>[0],
  place: Pick<RulesAtPath, 'path' | 'relative'>,
): readonly RunHere[] {
  try {
    // A machine with no key of its own is answered no one BEFORE a signer is asked for: asking a
    // signer mints a key, and a read must not found somebody to look for.
    if (listPrivateKeyFingerprints({ root: trees.keyRoot }).length < 1) return [];
    const asked = {
      writer: signerFor(trees, 'public'),
      layout: { root: chainRootForScope(trees, 'public') as string },
      upcasters: catalogUpcasters(),
    };
    const actor = recordedAnchorOf(asked)?.anchor ?? authorizingAnchor(asked);
    return runsHere(caches(sources), {
      path: place.relative ?? place.path,
      actor,
      asOf: systemClock(),
      sessionRuns: [],
      channels: CHARGING_CHANNELS,
    });
  } catch {
    return [];
  }
}
