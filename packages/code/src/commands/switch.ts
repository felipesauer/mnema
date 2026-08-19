/**
 * `mnema switch` — turn off, or back on, one of the places this product puts the record
 * in front of a model without being asked.
 *
 * WHAT IT IS FOR. Every charge mnema makes is switchable, and the switching is RECORDED.
 * Switching off is legitimate; switching off in silence is not — because a reader of the
 * record would have no way to tell "no rule addressed that file" from "somebody had
 * turned the push off that week", and the whole worth of the record is that it says what
 * governed the work. So the switch is a signed, attributed, dated fact of the chain, and
 * it inherits everything a fact has: a scope, a `who`, a `which`, a run, and a place in
 * the proof.
 *
 * WHICH CHANNELS, AND WHY NOT ALL OF THEM. The set is derived from the union of channels
 * this surface pushes (`record-framing.ts`) and never written out again here: what makes
 * a channel switchable is that its text arrives WITHOUT anybody asking. The `skills`
 * answer is a reply to a caller that asked for a pattern by id, and an exported skill is
 * a file somebody asked to have written — switching either off would break a tool rather
 * than stop a charge, and both say so in a table of their own.
 *
 * THE UNKNOWN CHANNEL IS THIS SURFACE'S REFUSAL and not commander's, which is the
 * doctrine `wiring/enumerated.ts` already states: the help ENUMERATES the set and the
 * value is validated where the vocabulary lives, so what a caller gets is a typed refusal
 * in the product's voice that names what there is. It is the surface's own vocabulary
 * here rather than a gate's, because the core has no idea this product injects anything.
 *
 * IT IS THE CLI'S ALONE, and that is the sharpest thing about it. The MCP server serves
 * no tool for switching a channel, so an agent cannot switch off what governs its own
 * work through the door built for agents. That is not a claim that it CANNOT be done —
 * anyone who can write to the record can append any fact, and a switch appended some
 * other way is a signed fact pointing at whoever appended it. It is a claim about which
 * doors this product opens, and it is the same one `tail prune` makes for the same shape
 * of reason: the act is authorized by a person at a shell, or not at all.
 */

import { catalogUpcasters } from '@mnema/chain';
import { type ChannelState, channelStates } from '@mnema/copilot';
import {
  chainRootForScope,
  type DiscoveryEnv,
  resolveScope,
  resolveTrees,
  type Scope,
} from '@mnema/core';
import { openTreeForWriting, switchChannel } from '@mnema/core/write';
import { type AnchorForms, anchorForms } from '../anchors.js';
import { SWITCHABLE_CHANNELS, type SwitchableChannel, WHAT_STOPS } from '../record-framing.js';
import { forwardReplacement, type Landed, type Replacement } from '../recorded-content.js';
import { withScopedCaches } from '../tree-sources.js';

/** What the switch commands need — injected so they are testable. */
export interface SwitchContext {
  /** The working directory to resolve the trees from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/**
 * One switchable channel: where it stands, and what stops arriving when it is off.
 *
 * The sentence travels WITH the state rather than being looked up by the printer, and
 * that is what keeps a cast out of the presentation: this is the one place that walks the
 * typed set, so the pairing is total by construction and nothing downstream has to assert
 * that a channel name is one of the product's own.
 */
export interface SwitchRow {
  /** Where the channel stands, folded across the trees that were read. */
  readonly state: ChannelState;
  /** What stops arriving when it is off — the declaring table's own sentence. */
  readonly carries: string;
}

/** Where every switchable channel stands, across the trees visible from here. */
export interface SwitchListing {
  readonly ok: true;
  /** One row per switchable channel, in the order the product declares them. */
  readonly rows: readonly SwitchRow[];
  /** The trees that were read — so an answer of all-on says where it looked. */
  readonly trees: readonly Scope[];
  /**
   * How the identities of those trees are written on a line.
   *
   * The switch that turned a channel off is attributed to an ANCHOR, which is `mnid:` and 64
   * hex — a width at which nobody reads it — so it is printed in the short form the record
   * knows, resolved against every identity the trees hold rather than against the one or two
   * this listing prints. That is the surface's own rule (`anchors.ts`): a short form is only
   * honest where the same value can be typed back.
   */
  readonly anchors: AnchorForms;
}

/**
 * Where every switchable channel stands.
 *
 * It refuses nothing. Outside a project there is still a global tree, a switch can be
 * recorded in it, and a reader asking where their switches stand is asking a legitimate
 * question about whatever record they have — the same posture `search` takes. What the
 * answer carries instead is WHICH trees it read, so "everything is on" cannot be
 * mistaken for "there was nothing here to read".
 */
export function runSwitchList(ctx: SwitchContext): SwitchListing {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  return withScopedCaches(trees, (sources) => {
    const states = channelStates(sources, SWITCHABLE_CHANNELS);
    return {
      ok: true,
      rows: SWITCHABLE_CHANNELS.map((channel, at) => ({
        // The two lists are the same list read twice — `channelStates` answers in the
        // order it was asked — so the index is the pairing and no name is matched.
        state: states[at] as ChannelState,
        carries: WHAT_STOPS[channel],
      })),
      trees: sources.map((source) => source.scope),
      anchors: anchorForms(sources),
    };
  });
}

/** The switch was recorded. */
export interface SwitchRecorded extends Replacement, Landed {
  readonly ok: true;
  /** The channel that was switched. */
  readonly channel: string;
  /** Where it now stands. */
  readonly on: boolean;
  /**
   * Where the channel stands after this switch, read back across every visible tree.
   *
   * It is here because the answer can DISAGREE with the switch just made, and a caller
   * that was not told would be misled by their own command: switching a channel on in
   * the committed tree leaves it off if this machine's private tree also holds an off
   * switch, because off wins where two trees cannot be ordered. Read from the record
   * rather than composed, so what is reported is what the next push will do.
   */
  readonly effective: ChannelState;
  /** How the identity in {@link effective} is written on a line — see the listing's own. */
  readonly anchors: AnchorForms;
}

/** The switch was refused; nothing was written. */
export type SwitchRefused =
  /** There is no project here — a project-scoped switch needs one. */
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  /** No channel of this product answers to that name. */
  | { readonly ok: false; readonly reason: 'UNKNOWN_CHANNEL'; readonly channel: string }
  /** The core operation refused (the authority invariant, an oversize reason, …). */
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/**
 * Switches `channel` on or off, recording the fact in the resolved tree.
 *
 * The channel is checked against this surface's own vocabulary FIRST, before any tree is
 * resolved and any writer opened: a name no channel answers to is a caller's mistake and
 * not a fact the record should carry, and refusing it after opening a writer would leave
 * the refusal describing a tree the caller never named.
 *
 * The scope rule is every birth's: an explicit `scope` wins, else the kind decides — and
 * for this kind the kind says PUBLIC, so the ordinary switch travels with the repository
 * and the team reads it. A project scope needs a project; `--scope global` works
 * anywhere, and the guard is on the RESOLVED scope rather than on the flag.
 */
export function runSwitch(
  ctx: SwitchContext,
  input: {
    channel: string;
    on: boolean;
    reason?: string;
    scope?: Scope;
    which?: string;
    run?: string;
  },
): SwitchRecorded | SwitchRefused {
  if (!isSwitchable(input.channel)) {
    return { ok: false, reason: 'UNKNOWN_CHANNEL', channel: input.channel };
  }
  const trees = resolveTrees(ctx.cwd, ctx.env);
  const scope = resolveScope('channel.switched', { which: input.which }, input.scope);
  if (scope !== 'global' && trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }

  const writer = openTreeForWriting(trees, scope);
  const recorded = switchChannel(
    {
      writer,
      layout: { root: chainRootForScope(trees, scope) as string },
      upcasters: catalogUpcasters(),
    },
    {
      channel: input.channel,
      on: input.on,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      ...(input.which !== undefined ? { which: input.which } : {}),
      ...(input.run !== undefined ? { run: input.run } : {}),
    },
  );
  if (!recorded.ok) {
    return { ok: false, reason: 'REFUSED', code: recorded.code, message: recorded.message };
  }

  // Checkpoint so the switch is signature-covered at once, the posture every write here
  // leaves the tree in. It earns it twice over: this is the one fact that says why the
  // product went quiet, and an unsigned one would be the easiest thing in the record to
  // disown.
  writer.checkpoint();

  // Read back across every tree, AFTER the write, because the answer is not the switch:
  // off wins between trees that cannot be ordered, so switching one on may change
  // nothing that the next push will see.
  const read = withScopedCaches(trees, (sources) => ({
    effective: channelStates(sources, [recorded.channel])[0] as ChannelState,
    anchors: anchorForms(sources),
  }));

  return {
    ok: true,
    channel: recorded.channel,
    on: recorded.on,
    effective: read.effective,
    anchors: read.anchors,
    scope,
    ...forwardReplacement(recorded),
  };
}

/** Whether a name is one of the channels this surface pushes without being asked. */
function isSwitchable(channel: string): channel is SwitchableChannel {
  return (SWITCHABLE_CHANNELS as readonly string[]).includes(channel);
}
