/**
 * `mnema before-a-write --host <host>` — the per-edit gate, for a host whose hooks are processes.
 *
 * WHAT IT IS FOR. A rule of the record linked to a path with `asks-for-a-person` holds a write
 * under that path until a person decides. Claude Code gets that from the MCP tool its hook calls
 * (`rules_before_an_edit`); VS Code's agent runs only command hooks, and VS Code 1.137 holds a
 * write for a person when a command answers `ask` (`measurements/hooks-by-host/`). This is the
 * command. It reads the payload the host hands a hook on stdin, and it answers the reply that
 * host reads, on stdout.
 *
 * IT DECIDES NOTHING OF ITS OWN, and the two things it could have decided twice are not here.
 * WHICH rules ask at a path is `whatAWriteAsks`, the one site the MCP tool passes through too.
 * WHAT is recorded is the same facts in the same order: one `channel.asked` per rule, citing the
 * rule and the path, appended and signed BEFORE the reply is composed, so a record that cannot be
 * written stops nobody. What differs is only the door: the host's payload is read by
 * `host-hook.ts`, and the reply is shaped there.
 *
 * WHAT IT DOES NOT CARRY, AND WHY: the rules that only `govern` a path. The MCP tool hands those
 * over beside the result of the write, and records that the push served ONCE PER RUN — its
 * connection remembers the run. A process started per write remembers nothing, so it would record
 * one `channel.served` on every edit of a governed file, the thousands-of-writes shape the fact's
 * own declaration refuses (`channel.served`, `@mnema/chain`). So this door carries the gate alone,
 * and the service it records rides with each asking — askings are discrete, and each one is the
 * gate having spoken. VS Code puts a hook's text inside the tool result (measured), so the push
 * could travel this way the day a run can be remembered across processes.
 *
 * EVERY OUTCOME THAT IS NOT AN ASKING IS THE EMPTY REPLY `{}`, which the host reads as nothing to
 * say: a tool that is not a write (VS Code runs this hook for every tool), no project here, the
 * gate switched off (`mnema switch off edit-asks-a-person`), no rule asking at the path, a record
 * that would not take the fact. The notes beside it are for a person who ran the verb by hand and
 * for the host's own log; nothing reads them to decide.
 */

import { dirname } from 'node:path';
import { catalogUpcasters } from '@mnema/chain';
import { channelIsOn } from '@mnema/copilot';
import { chainRootForScope, type DiscoveryEnv, resolveScope, resolveTrees } from '@mnema/core';
import { openTreeForWriting, recordChannelAsked, recordChannelServed } from '@mnema/core/write';
import { anchorsBefore, foundingsSince, treesOf } from '../a-new-identity.js';
import { whatAWriteAsks } from '../edit-asks-a-person.js';
import { pathsOfAWrite, replyFor } from '../host-hook.js';
import type { HookHost } from '../host-names.js';
import { ASKS_A_PERSON_CHANNEL } from '../record-framing.js';
import { withScopedCaches } from '../tree-sources.js';

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
 * There is no refusal arm, and that is the contract rather than an omission: this runs inside
 * somebody else's session, on every tool call of it, and every way of not asking answers the same
 * empty reply. What went wrong, when something did, is a note.
 */
export interface BeforeAWriteDone {
  readonly ok: true;
  /** The JSON the host reads on stdout — `{}` unless the record asks. */
  readonly reply: object;
  /** Lines for the second stream: why a write that should have been read was not. */
  readonly notes: readonly string[];
}

/** The silence, with what to say about it on the second stream. */
function silent(notes: readonly string[] = []): BeforeAWriteDone {
  return { ok: true, reply: {}, notes };
}

/**
 * Answers the hook payload `input.payload` for `input.host`: `ask`, citing the rules, when a rule
 * of this project's record asks for a person at a path the write touches; `{}` otherwise.
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

  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) return silent();
  // The project root is the PARENT of its `.mnema/`, the directory every address is written
  // against; a relative path is the host's, written against where it started the hook.
  const root = dirname(trees.projectPublic);
  const gates = withScopedCaches(trees, (sources) =>
    channelIsOn(sources, ASKS_A_PERSON_CHANNEL)
      ? paths.flatMap((path) => {
          const gate = whatAWriteAsks(sources, { path, root, from: ctx.cwd });
          return gate === undefined ? [] : [gate];
        })
      : [],
  );
  if (gates.length === 0) return silent();

  // THE ORDER IS THE MCP TOOL'S: the facts are appended, and only then does the reply carry the
  // charge. What the write founded, if it was this key's first in the tree, rides in the reason —
  // the one field of the reply anybody reads; the line on the second stream would be dropped.
  const before = anchorsBefore(treesOf(trees));
  let recorded: { readonly ok: true } | { readonly ok: false; readonly why: string };
  try {
    recorded = recordAskings(trees, gates, input.host);
  } catch (error) {
    recorded = { ok: false, why: error instanceof Error ? error.message : String(error) };
  }
  if (!recorded.ok) {
    return silent([`The asking could not be recorded, so nobody was asked: ${recorded.why}`]);
  }
  const reason = [...gates.map((gate) => gate.notice), ...foundingsSince(before)].join('\n\n');
  return { ok: true, reply: replyFor(input.host, { ask: reason }), notes: [] };
}

/**
 * Appends one `channel.asked` per rule per path that asked, and the one `channel.served` of this
 * asking, under one checkpoint — the facts the MCP tool appends, in the tree they are routed to.
 * The askings decide the answer; the service fact is attempted and never un-asks.
 */
function recordAskings(
  trees: ReturnType<typeof resolveTrees>,
  gates: readonly NonNullable<ReturnType<typeof whatAWriteAsks>>[],
  host: HookHost,
): { readonly ok: true } | { readonly ok: false; readonly why: string } {
  const scope = resolveScope('channel.asked', { which: host });
  const writer = openTreeForWriting(trees, scope);
  const ctx = {
    writer,
    layout: { root: chainRootForScope(trees, scope) as string },
    upcasters: catalogUpcasters(),
  };
  for (const { asked } of gates) {
    for (const rule of asked.rules) {
      const done = recordChannelAsked(ctx, {
        channel: ASKS_A_PERSON_CHANNEL,
        rule: rule.id,
        path: asked.relative ?? asked.path,
        which: host,
      });
      if (!done.ok) {
        writer.checkpoint();
        return { ok: false, why: done.message };
      }
    }
  }
  // A SERVICE FACT THAT DID NOT LAND IS A GAP IN THE EVIDENCE, NOT AN UN-ASKING: the askings are
  // on the chain, so the charge rides — the MCP tool's rule for the same two facts.
  recordChannelServed(ctx, { channel: ASKS_A_PERSON_CHANNEL, which: host });
  writer.checkpoint();
  return { ok: true };
}
