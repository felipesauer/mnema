/**
 * What a write MEETS before it happens: a refusal, a pause for a person, or nothing — decided
 * in one place for every host.
 *
 * Two relations of the record can stop a write. `asks-for-a-person` holds it until somebody
 * decides; `refuses-a-write` does not let it happen. A host's hook asks this function about
 * the paths one write touches and answers in its own shape; none of them decides which grade
 * applies, because a second reading of that is how one host would ask where another refuses
 * for the same file.
 *
 * THE ORDER IS THE WHOLE RULE, and it is written here and nowhere else: if any path of the
 * write is refused by a rule in force, the write is REFUSED, and only the refusals are carried
 * — no person is asked about a write that will not happen, so nothing from this answer may be
 * recorded as an asking. Only when nothing refuses does the asking apply, through
 * {@link whatAWriteAsks}, unchanged.
 *
 * THE SWITCHES ARE READ HERE, before either grade is decided, so no caller can refuse past a
 * refusal somebody switched off. Off, the refusal falls to whatever else the path meets: a rule
 * that asks for a person still asks.
 *
 * IT IS PURE OVER WHAT IT IS HANDED: the trees' caches and the paths. It records nothing; the
 * caller appends one `channel.refused` (or `channel.asked`) per rule of {@link WriteVerdict.at}
 * before it answers the host, so a record that cannot be written refuses nobody.
 */

import { TailBusyError } from '@mnema/chain';
import { channelIsOn, type RulesAtPath, type ScopedCache } from '@mnema/context';
import { whatAWriteAsks } from './edit-asks-a-person.js';
import { editRefusesNotice } from './edit-refuses-a-write.js';
import { placesOfAPath, readRefusesAWriteAt } from './governed-tree.js';
import { oneLine } from './one-line.js';
import { ASKS_A_PERSON_CHANNEL, REFUSES_A_WRITE_CHANNEL } from './record-framing.js';

/** One write, as a hook sees it: every path it touches, and where they are read from. */
export interface AWrite {
  /** The paths the write touches, as the host named them — relative or absolute. */
  readonly paths: readonly string[];
  /** The project's root directory — the parent of its `.mnema/`, absolute. */
  readonly root: string;
  /** The directory a relative path is resolved against (see `GovernedRead.from`). */
  readonly from: string;
}

/** What the write meets: the grade, the paths and rules behind it, and the reason to hand over. */
export interface WriteVerdict {
  /** `refuse` — the write does not happen; `ask` — it waits for a person. */
  readonly grade: 'refuse' | 'ask';
  /**
   * The paths that met this grade, each with the rules in force there under that grade's
   * relation, in the order the write named them. A path that met nothing is not here, and
   * under `refuse` neither is a path that only asked.
   */
  readonly at: readonly RulesAtPath[];
  /** The reason a host hands the agent: one notice per path, separated by a blank line. */
  readonly reason: string;
  /** The notices that make up {@link reason}, one per entry of {@link at}, in the same order. */
  readonly notices: readonly string[];
}

/** How many times a session hears a rule's notice whole before it is told in one line. */
export const NOTICES_SAID_WHOLE = 3;

/**
 * The reason to hand the agent for `met`, with a rule that has already spoken
 * {@link NOTICES_SAID_WHOLE} times in this session told in one numbered line instead of the
 * whole notice again. `seen` is the session's count of how often each rule has been told, per
 * grade, and this call adds to it.
 *
 * The rule is that no two refusals of one session are the same
 * text: the number is the order of the telling, and the line carries only the rule ids and the
 * path, never recorded prose. A notice is shortened only when EVERY rule behind it has spoken
 * more than the allowed times, so a rule met for the first time is always said whole.
 */
export function reasonTold(met: WriteVerdict, seen: Map<string, number>): string {
  return met.at
    .map((at, index) => {
      const orders = at.rules.map((rule) => {
        const key = `${met.grade}:${rule.id}`;
        const order = (seen.get(key) ?? 0) + 1;
        seen.set(key, order);
        return order;
      });
      const order = Math.min(...orders);
      if (orders.length === 0 || order <= NOTICES_SAID_WHOLE) return met.notices[index] as string;
      const verb = met.grade === 'refuse' ? 'refuses' : 'asks for a person';
      const ids = at.rules.map((rule) => oneLine(rule.id)).join(', ');
      return `#${order}: ${ids} ${verb} at ${oneLine(at.relative ?? at.path)} again; the notice is the one above.`;
    })
    .join('\n\n');
}

/**
 * What `write` meets over `sources`, or `undefined` — the ordinary case — when it meets
 * nothing: no rule in force refuses or asks at any of its paths, or the channel that would
 * have spoken is switched off.
 */
export function whatAWriteMeets(
  sources: readonly ScopedCache[],
  write: AWrite,
): WriteVerdict | undefined {
  const read = (path: string) => ({ path, root: write.root, from: write.from });
  // EVERY PATH IS MET TWICE WHEN A LINK MAKES IT TWO: as the host wrote it, and as it really is
  // inside the project (`realPathInside`). A rule about a file is a rule about its bytes, so a
  // write through a link meets the rules of what the link leads to, the refusal still before the
  // asking. Two spellings that land on one address are one meeting, never two recorded facts.
  const places = write.paths.flatMap((path) => placesOfAPath(read(path)));
  const once = <T extends { readonly at: RulesAtPath }>(met: readonly T[]): T[] => {
    const seen = new Set<string>();
    return met.filter(({ at }) => {
      const key = at.relative ?? at.path;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  if (channelIsOn(sources, REFUSES_A_WRITE_CHANNEL)) {
    const refused = places.flatMap((path) => {
      const at = readRefusesAWriteAt(sources, read(path));
      const notice = editRefusesNotice(at);
      return notice === undefined ? [] : [{ at, notice }];
    });
    if (refused.length > 0) return verdict('refuse', once(refused));
  }

  if (!channelIsOn(sources, ASKS_A_PERSON_CHANNEL)) return undefined;
  const asked = places.flatMap((path) => {
    const gate = whatAWriteAsks(sources, read(path));
    return gate === undefined ? [] : [{ at: gate.asked, notice: gate.notice }];
  });
  return asked.length > 0 ? verdict('ask', once(asked)) : undefined;
}

function verdict(
  grade: WriteVerdict['grade'],
  met: readonly { readonly at: RulesAtPath; readonly notice: string }[],
): WriteVerdict {
  return {
    grade,
    at: met.map((one) => one.at),
    reason: met.map((one) => one.notice).join('\n\n'),
    notices: met.map((one) => one.notice),
  };
}

/**
 * How many times a charge's facts may wait out the tail lock's own budget (2 s each) before the
 * reply goes to the host without them.
 *
 * THE RULE REFUSES WHETHER OR NOT ITS FACT LANDS. The refusal and the asking are decided by
 * reading the record, which takes no lock; only the fact that a write was refused or held is an
 * append. This used to fall the other way — a fact that could not be written refused nobody — and
 * that made any live process holding the tail a way around every rule of the project for as long
 * as it held it: measured, the write went through at 2.3 s with the lock held by a live pid. So
 * the fact gets more patience than an ordinary write, and its absence is said in the reason.
 *
 * THREE, so the longest wait is about 6 s and not more, because a host that times the hook out
 * lets the write through: every host this plugin wires gives the hook 15 s
 * (`plugin/hooks/hooks.json`), and a hook that waited as long as it takes would reopen the write
 * by that road.
 */
export const A_CHARGE_TRIES = 3;

/** Whether a charge's facts are on the chain, and if not, why — in words the reason can carry. */
export type ChargeRecorded = { readonly ok: true } | { readonly ok: false; readonly why: string };

/**
 * Appends a charge's facts with {@link A_CHARGE_TRIES} times the tail's patience, and never throws:
 * the reply to the host is composed whatever this answers.
 */
export function recordTheCharge(
  record: () => { readonly ok: boolean; readonly why?: string },
): ChargeRecorded {
  for (let tries = 1; ; tries += 1) {
    try {
      const done = record();
      if (done.ok) return { ok: true };
      return { ok: false, why: done.why ?? 'the record would not take the fact' };
    } catch (error) {
      if (error instanceof TailBusyError && tries < A_CHARGE_TRIES) continue;
      return { ok: false, why: whyNotRecorded(error) };
    }
  }
}

function whyNotRecorded(error: unknown): string {
  if (error instanceof TailBusyError) {
    const holder = error.heldBy === undefined ? 'another process' : `process ${error.heldBy}`;
    return `${holder} was writing the record for longer than this could wait (lock: ${oneLine(error.tailLock)})`;
  }
  return oneLine(error instanceof Error ? error.message : String(error));
}

/** The sentence a reason carries when the charge it states could not be recorded. */
export function unrecordedCharge(grade: WriteVerdict['grade'], why: string): string {
  const what = grade === 'refuse' ? 'This refusal' : 'This request for a person';
  return `${what} could not be recorded in the project's record, so the record does not show it: ${why}.`;
}
