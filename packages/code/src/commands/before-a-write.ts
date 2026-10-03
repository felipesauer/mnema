/**
 * `mnema before-a-write --host <host>` — the per-edit gate, for a host whose hooks are processes.
 *
 * WHAT IT IS FOR. A rule of the record linked to a path with `asks-for-a-person` holds a write
 * under that path until a person decides, and one linked with `refuses-a-write` does not let it
 * happen. Claude Code gets both from the MCP tool its hook calls (`rules_before_an_edit`); the
 * agents of VS Code and of Cursor run only command hooks. VS Code 1.137 holds a write for a person
 * when a command answers `ask` and refuses it on `deny`; Cursor's agent ignores `ask` and honours
 * `deny` (`measurements/hooks-by-host/`). This is the command. It reads the payload the host
 * hands a hook on stdin, and it answers the reply that host reads, on stdout.
 *
 * IT DECIDES NOTHING OF ITS OWN, and the two things it could have decided twice are not here.
 * WHAT a write meets is `whatAWriteMeets`, the one site the MCP tool passes through too, which
 * puts a refusal over an asking. WHAT is recorded is the same facts in the same order: one
 * `channel.refused` or `channel.asked` per rule, citing the rule and the path, appended and
 * signed BEFORE the reply is composed, so a record that cannot be written stops nobody. What
 * differs is only the door: the host's payload is read by `host-hook.ts`, and the reply is
 * shaped there.
 *
 * A HOST THAT DOES NOT ASK IS NOT ASKED, AND NOTHING IS RECORDED AS IF IT HAD BEEN. Where a write
 * only asks, the Cursor door answers silence and appends nothing: the file would be written, and
 * a `channel.asked` would say a person was asked ({@link asksAPerson}).
 *
 * WHAT IT DOES NOT CARRY, AND WHY: the rules that only `govern` a path. The MCP tool hands those
 * over beside the result of the write, and records that the push served ONCE PER RUN — its
 * connection remembers the run. A process started per write remembers nothing, so it would record
 * one `channel.served` on every edit of a governed file, the thousands-of-writes shape the fact's
 * own declaration refuses (`channel.served`, `@mnema/chain`). So this door carries the gate alone,
 * and the service it records rides with each asking — askings are discrete, and each one is the
 * gate having spoken. A refusal records no service: each `channel.refused` is the refusal itself.
 * VS Code puts a hook's text inside the tool result (measured), so the push could travel this way
 * the day a run can be remembered across processes.
 *
 * EVERY OUTCOME THAT IS NOT A REFUSAL OR AN ASKING IS THE EMPTY REPLY `{}`, which the host reads
 * as nothing to say: a tool that is not a write (VS Code runs this hook for every tool), no
 * project here, the channels switched off (`mnema switch off edit-asks-a-person`, `mnema switch
 * off edit-refuses-a-write`), no rule asking or refusing at the path, a record that would not
 * take the fact. The notes beside it are for a person who ran the verb by hand and
 * for the host's own log; nothing reads them to decide.
 */

import { dirname } from 'node:path';
import { catalogUpcasters } from '@mnema/chain';
import { chainRootForScope, type DiscoveryEnv, resolveScope, resolveTrees } from '@mnema/core';
import {
  openTreeForWriting,
  recordChannelAsked,
  recordChannelRefused,
  recordChannelServed,
} from '@mnema/core/write';
import { anchorsBefore, foundingsSince, treesOf } from '../a-new-identity.js';
import { asksAPerson, pathsOfAWrite, replyFor } from '../host-hook.js';
import type { HookHost } from '../host-names.js';
import type { HookSaid } from '../mcp/hook-reply.js';
import { ASKS_A_PERSON_CHANNEL, REFUSES_A_WRITE_CHANNEL } from '../record-framing.js';
import { withScopedCaches } from '../tree-sources.js';
import { type WriteVerdict, whatAWriteMeets } from '../what-a-write-meets.js';

/** What the command needs — injected so it is testable. */
export interface BeforeAWriteContext {
  /** Where the host started the hook: the project is resolved from it, and a relative path too. */
  readonly cwd: string;
  /** The discovery environment (`$HOME`, `$MNEMA_HOME`). */
  readonly env: DiscoveryEnv;
}

/**
 * The reply for the host, and what the run has to say beside it.
 *
 * There is no failure arm, and that is the contract rather than an omission: this runs inside
 * somebody else's session, on every tool call of it, and every way of not asking or refusing
 * answers the same empty reply. What went wrong, when something did, is a note.
 */
export interface BeforeAWriteDone {
  readonly ok: true;
  /** The JSON the host reads on stdout — `{}` unless the record asks or refuses. */
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
    reply: (said) => replyFor(input.host, said),
  });
}

/**
 * What a write at `input.paths` meets in this project's record, answered in the reply `input.reply`
 * shapes — the half of {@link runBeforeAWrite} that does not depend on how a host spells a payload,
 * so a caller that already holds the paths (a program's own hook) asks the same question and gets
 * the same facts appended. `which` is the name the facts are recorded under; `asks` is whether the
 * caller can hold a write for a person (where it cannot, an asking is silence, and nothing is
 * recorded as if a person had been asked).
 */
export function runBeforeAPath(
  ctx: BeforeAWriteContext,
  input: {
    readonly which: string;
    readonly paths: readonly string[];
    readonly asks: boolean;
    readonly reply: (said: HookSaid) => object;
  },
): BeforeAWriteDone {
  const { paths } = input;
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) return silent();
  // The project root is the PARENT of its `.mnema/`, the directory every address is written
  // against; a relative path is the host's, written against where it started the hook.
  const root = dirname(trees.projectPublic);
  const met = withScopedCaches(trees, (sources) =>
    whatAWriteMeets(sources, { paths, root, from: ctx.cwd }),
  );
  // WHERE THE HOST DOES NOT ASK, AN ASKING IS NOT ONE: the write would go through, and the
  // record would say a person was asked.
  if (met === undefined || (met.grade === 'ask' && !input.asks)) return silent();

  // THE ORDER IS THE MCP TOOL'S: the facts are appended, and only then does the reply carry the
  // charge. What the write founded, if it was this key's first in the tree, rides in the reason —
  // the one field of the reply anybody reads; the line on the second stream would be dropped.
  const before = anchorsBefore(treesOf(trees));
  let recorded: { readonly ok: true } | { readonly ok: false; readonly why: string };
  try {
    recorded = recordWhatItMet(trees, met, input.which);
  } catch (error) {
    recorded = { ok: false, why: error instanceof Error ? error.message : String(error) };
  }
  if (!recorded.ok) {
    const did = met.grade === 'refuse' ? 'refused' : 'asked';
    return silent([
      `The ${did} write could not be recorded, so nothing was ${did}: ${recorded.why}`,
    ]);
  }
  const reason = [met.reason, ...foundingsSince(before)].join('\n\n');
  const said = met.grade === 'refuse' ? { refuse: reason } : { ask: reason };
  return { ok: true, reply: input.reply(said), notes: [] };
}

/**
 * Appends one `channel.refused` or `channel.asked` per rule per path the write met, and — for an
 * asking only — the one `channel.served` of this asking, under one checkpoint: the facts the MCP
 * tool appends, in the tree they are routed to. The facts decide the answer; the service fact is
 * attempted and never un-asks. A refusal has no service fact, because it is itself the fact.
 */
function recordWhatItMet(
  trees: ReturnType<typeof resolveTrees>,
  met: WriteVerdict,
  which: string,
): { readonly ok: true } | { readonly ok: false; readonly why: string } {
  const refusing = met.grade === 'refuse';
  const scope = resolveScope(refusing ? 'channel.refused' : 'channel.asked', { which });
  const writer = openTreeForWriting(trees, scope);
  const ctx = {
    writer,
    layout: { root: chainRootForScope(trees, scope) as string },
    upcasters: catalogUpcasters(),
  };
  const channel = refusing ? REFUSES_A_WRITE_CHANNEL : ASKS_A_PERSON_CHANNEL;
  for (const at of met.at) {
    for (const rule of at.rules) {
      const input = {
        channel,
        rule: rule.id,
        path: at.relative ?? at.path,
        which,
      };
      const done = refusing ? recordChannelRefused(ctx, input) : recordChannelAsked(ctx, input);
      if (!done.ok) {
        writer.checkpoint();
        return { ok: false, why: done.message };
      }
    }
  }
  // A SERVICE FACT THAT DID NOT LAND IS A GAP IN THE EVIDENCE, NOT AN UN-ASKING: the askings are
  // on the chain, so the charge rides — the MCP tool's rule for the same two facts.
  if (!refusing) recordChannelServed(ctx, { channel: ASKS_A_PERSON_CHANNEL, which });
  writer.checkpoint();
  return { ok: true };
}
