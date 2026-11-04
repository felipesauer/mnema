/**
 * THE OWNER'S RELINK OF A TAIL (FORMAT.md section 6.11, ADR-155, ADR-157): the write that moves a
 * whole tail of one record into another, signed by the key the tail's id names, in a tail of that
 * key that names the record joined.
 *
 * WHAT IT READS BEFORE IT WRITES, AND WHY IT ASKS NO IDENTITY DOOR. A relink is written into a
 * directory whose tails name two records, which is the one directory every reading of the record
 * reads nothing of (ADR-148): the anchor this checkout recorded looks stale there, and the door
 * every other write goes through (`ensureFounded`) refuses `STALE_ANCHOR`, or, with no anchor
 * recorded, would found an identity of its own. So this operation does not go through it. It asks
 * the readers' own rule instead (`relinksWouldCount`, `@mnema/chain`), over the directory as it
 * would read with the relinks written and covered, which asks more than the door does: the key
 * must hold a membership the record joined gave it at the relink's point. What the rule refuses,
 * this refuses in the rule's words, and nothing is written.
 *
 * WHICH KEY, AND WHICH TAIL. Each relink is signed by the key the relinked tail's id names, which
 * this machine must hold: the person's, or an agent's kept here. It is written in this
 * installation's tail of that key when that tail names the record joined; else the writer opens a
 * new tail of that key, born naming it (`WriterOptions.joins`), as it opens one where its tail no
 * longer ends where it left it. A relinked tail is frozen, so when the tail relinked is this
 * installation's own, the installation goes on writing in the new tail. The relinks are
 * checkpointed at once: one above its tail's last checkpoint counts for nothing.
 */

import { existsSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  type ChainLayout,
  type ChainWriter,
  type LeftBehind,
  localKeyFingerprint,
  type PlannedRelink,
  planRelinks,
  type RelinkRefusal,
  type RelinkToWrite,
  relinksWouldCount,
  tailRelinked,
  type UpcasterRegistry,
} from '@mnema/chain';
import {
  type ScreenedWrite,
  type ScreenRefusal,
  screenContent,
  screened,
} from '../content/screen.js';
import { AGENT_NAME } from '../identity/agent-name.js';
import { resolveExecutingAgent, type SelfAuthorizedErr } from '../identity/authority.js';
import { oneLine } from '../one-line.js';
import { agentKeyRoot, type DiscoveryEnv } from '../topology/resolve.js';
import { type AppendRefusal, appendEvent, refusalOf } from './append.js';
import { systemClock } from './clock.js';

/** A key this machine holds, by which it signs: the person's, or an agent's under its name. */
export interface KeyOnThisMachine {
  readonly fingerprint: string;
  readonly keyRoot: string;
  /** The agent's name, where the key is an agent's: the `which` its facts carry. */
  readonly which?: string;
}

/** What a relink needs: where it reads, which keys this machine holds, and how a writer opens. */
export interface RelinkContext {
  /**
   * The trees read together, the one written in first: one tree for `tail relink`; for the
   * doctor, the private tree that stays and the one that moves into it.
   */
  readonly layouts: readonly ChainLayout[];
  readonly upcasters: UpcasterRegistry;
  /** The keys this machine holds, by fingerprint. */
  readonly keys: ReadonlyMap<string, KeyOnThisMachine>;
  /** Opens the writer of the tree written in, signing with `key`, its tail naming `joins`. */
  readonly openWriter: (key: KeyOnThisMachine, joins: string) => ChainWriter;
  readonly clock?: () => string;
}

/** What the caller asks to relink. */
export interface RelinkInput {
  readonly tails: readonly string[];
  /** The record they join; absent, the one other record the directory names. */
  readonly into?: string;
  readonly reason: string;
  readonly run?: string;
  /**
   * The agent that executed it, declared, as `tail prune` takes it: written as the `which` of a
   * relink the person's key signs. A relink an agent's key signs carries the name the record
   * enrolled that key under, whatever is declared, because the readers refuse any other.
   */
  readonly which?: string;
}

/** One relink written: what it says, what the tail brings, and where it is. */
export interface RelinkWritten extends PlannedRelink {
  /** The tail the relink is written in, and its seq there. */
  readonly host: string;
  readonly seq: number;
  /** The key that signed it. */
  readonly signedBy: string;
}

/** The relinks were written and covered. */
export interface RelinkOk extends ScreenedWrite {
  readonly ok: true;
  readonly relinks: readonly RelinkWritten[];
  /** The records the directory still names beside the one joined, and whose keys must act. */
  readonly leftBehind: readonly LeftBehind[];
}

/** Why nothing was written. */
export type RelinkError =
  | RelinkRefusal
  | { readonly ok: false; readonly code: 'NOT_THE_OWNER'; readonly message: string }
  | ScreenRefusal
  | SelfAuthorizedErr
  | AppendRefusal;

/** A tail id no writer holds, standing for the tail a writer opens where its own cannot host. */
function aNewTailOf(fingerprint: string): string {
  return `${fingerprint}-${'0'.repeat(32)}`;
}

/**
 * Relinks `input.tails`, each by its own key, or writes nothing: every refusal of
 * `planRelinks`, a key this machine does not hold, and every relink the readers would not count
 * are asked before the first append.
 */
export function relinkTails(ctx: RelinkContext, input: RelinkInput): RelinkOk | RelinkError {
  return relinkOrAsk(ctx, input, false) as RelinkOk | RelinkError;
}

/** What {@link wouldRelinkTails} says when the relinks would be written and counted. */
export interface RelinkWouldCount {
  readonly ok: true;
  readonly relinks: readonly PlannedRelink[];
}

/**
 * Asks everything {@link relinkTails} asks before its first append (the same function, run to
 * that point), and writes nothing: no writer is opened, so not even an installation id moves. The
 * doctor says what its fix would do from this answer, and the fix does it by `relinkTails`, so
 * what is said and what is done are one rule. Every relink is asked as written in a new tail of
 * its key, which is where a writer whose own tail does not name the record joined writes it; the
 * rule that counts it is the key's membership, which the host does not change.
 */
export function wouldRelinkTails(
  ctx: Omit<RelinkContext, 'openWriter'>,
  input: RelinkInput,
): RelinkWouldCount | RelinkError {
  const opensNone = (): ChainWriter => {
    throw new Error('asking whether a relink would count opens no writer');
  };
  return relinkOrAsk({ ...ctx, openWriter: opensNone }, input, true) as
    | RelinkWouldCount
    | RelinkError;
}

function relinkOrAsk(
  ctx: RelinkContext,
  input: RelinkInput,
  dry: boolean,
): RelinkOk | RelinkWouldCount | RelinkError {
  const text = screenContent({ reason: input.reason, run: input.run });
  if (!text.ok) return text;
  const planned = planRelinks(ctx.layouts, ctx.upcasters, {
    tails: input.tails,
    ...(input.into !== undefined ? { into: input.into } : {}),
  });
  if (!planned.ok) return planned;

  for (const relink of planned.relinks) {
    const fingerprint = relink.tail.slice(0, relink.tail.indexOf('-'));
    if (!ctx.keys.has(fingerprint)) {
      return {
        ok: false,
        code: 'NOT_THE_OWNER',
        message:
          `Only the key that signed tail ${oneLine(relink.tail)} may relink it: it is ` +
          `${oneLine(fingerprint)}, and this machine holds no key with that fingerprint (neither ` +
          "the person's key nor an agent's kept here). Run the relink on the machine that holds " +
          'it. Nothing was written.',
      };
    }
  }

  // One writer per key and record joined: its tail hosts every relink of that key into it.
  const groups = new Map<
    string,
    { key: KeyOnThisMachine; into: string; relinks: PlannedRelink[] }
  >();
  for (const relink of planned.relinks) {
    const fingerprint = relink.tail.slice(0, relink.tail.indexOf('-'));
    const id = `${fingerprint} ${relink.into}`;
    const group = groups.get(id);
    if (group === undefined) {
      groups.set(id, {
        key: ctx.keys.get(fingerprint) as KeyOnThisMachine,
        into: relink.into,
        relinks: [relink],
      });
    } else group.relinks.push(relink);
  }
  // The declared agent, held to what `tail prune` holds it to, against each identity it would
  // stand beside: only on the relinks the person's key signs.
  const declared = new Map<string, string>();
  const replaced = [...text.replaced];
  for (const relink of planned.relinks) {
    const key = ctx.keys.get(relink.tail.slice(0, relink.tail.indexOf('-'))) as KeyOnThisMachine;
    if (key.which !== undefined || input.which === undefined) continue;
    const agent = resolveExecutingAgent(relink.subject, input.which);
    if (!agent.ok) return agent;
    if (agent.which !== undefined) declared.set(relink.tail, agent.which);
    replaced.push(...agent.replaced);
  }
  const relinked = new Set(planned.relinks.map((relink) => relink.tail));
  const at = (ctx.clock ?? systemClock)();
  const build = (key: KeyOnThisMachine, relink: PlannedRelink, when: string) =>
    tailRelinked(
      {
        at: when,
        who: relink.subject,
        signerFp: key.fingerprint,
        subject: relink.subject,
        ...(key.which !== undefined
          ? { which: key.which }
          : declared.has(relink.tail)
            ? { which: declared.get(relink.tail) as string }
            : {}),
        ...(text.fields.run !== undefined ? { run: text.fields.run } : {}),
      },
      {
        tail: relink.tail,
        from: relink.from,
        into: relink.into,
        throughHash: relink.throughHash,
        eventCount: relink.eventCount,
        reason: text.fields.reason,
      },
    );

  if (dry) {
    const asked: RelinkToWrite[] = planned.relinks.map((relink) => {
      const key = ctx.keys.get(relink.tail.slice(0, relink.tail.indexOf('-'))) as KeyOnThisMachine;
      return {
        host: aNewTailOf(key.fingerprint),
        hostNames: relink.into,
        event: build(key, relink, at),
      };
    });
    const would = relinksWouldCount(ctx.layouts, ctx.upcasters, asked, aNewTailOf);
    if (!would.ok) return { ok: false, code: would.code, message: would.message };
    for (const one of asked) {
      const refused = refusalOf(one.event);
      if (refused !== undefined) return refused;
    }
    return { ok: true, relinks: planned.relinks };
  }

  // The writers, opened (which reads, and keeps only an installation id) and asked which tail
  // they hold: that one hosts the relinks where it names the record joined; else a new one does.
  const writers = [...groups.values()].map((group) => ({
    ...group,
    writer: ctx.openWriter(group.key, group.into),
  }));
  const toWrite: RelinkToWrite[] = writers.flatMap(({ key, into, relinks, writer }) =>
    relinks.map((relink) => ({
      host: relinked.has(writer.tail) ? aNewTailOf(key.fingerprint) : writer.tail,
      hostNames: into,
      event: build(key, relink, at),
    })),
  );
  const would = relinksWouldCount(ctx.layouts, ctx.upcasters, toWrite, aNewTailOf);
  if (!would.ok) return { ok: false, code: would.code, message: would.message };
  for (const one of toWrite) {
    const refused = refusalOf(one.event);
    if (refused !== undefined) return refused;
  }

  const written: RelinkWritten[] = [];
  for (const { key, relinks, writer } of writers) {
    const appended = writer.exclusively(() => {
      const entries: { relink: PlannedRelink; host: string; seq: number }[] = [];
      for (const relink of relinks) {
        const one = appendEvent(writer, build(key, relink, (ctx.clock ?? systemClock)()));
        if (!one.ok) return one;
        entries.push({ relink, host: one.entry.link.tail, seq: one.entry.link.seq });
      }
      // Covered at once: a relink above its tail's last checkpoint counts for nothing.
      writer.checkpoint();
      return { ok: true as const, entries };
    });
    if (!appended.ok) return appended;
    for (const { relink, host, seq } of appended.entries) {
      written.push({ ...relink, host, seq, signedBy: key.fingerprint });
    }
  }
  return { ok: true, relinks: written, leftBehind: would.leftBehind, ...screened(replaced) };
}

/**
 * The keys this machine holds that a relink may sign with: the person's, at `keyRoot`, and every
 * agent's kept under the data directory `env` names, each with its name. A key root that holds no
 * key is not one: nothing is made here.
 */
export function keysOnThisMachine(
  keyRoot: string,
  env: DiscoveryEnv,
): ReadonlyMap<string, KeyOnThisMachine> {
  const keys = new Map<string, KeyOnThisMachine>();
  const person = localKeyFingerprint({ root: keyRoot });
  if (person !== null) keys.set(person, { fingerprint: person, keyRoot });
  const agents = dirname(agentKeyRoot(env, 'x'));
  if (!existsSync(agents)) return keys;
  for (const name of readdirSync(agents).sort()) {
    if (!AGENT_NAME.test(name)) continue;
    const root = agentKeyRoot(env, name);
    const fingerprint = localKeyFingerprint({ root });
    if (fingerprint !== null && !keys.has(fingerprint)) {
      keys.set(fingerprint, { fingerprint, keyRoot: root, which: name });
    }
  }
  return keys;
}
