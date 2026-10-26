/**
 * What a write MEETS before it happens: a refusal, a pause for a person, or nothing, decided
 * in one place for every host.
 *
 * Two relations of the record can stop a write. `asks-for-a-person` holds it until somebody
 * decides; `refuses-a-write` does not let it happen. A host's hook asks this function about
 * the paths one write touches and answers in its own shape; none of them decides which grade
 * applies, because a second reading of that is how one host would ask where another refuses
 * for the same file.
 *
 * THE ORDER IS THE WHOLE RULE, and it is written here and nowhere else: if any path of the
 * write is refused by a rule in force, the write is REFUSED, and only the refusals are carried;
 * no person is asked about a write that will not happen, so nothing from this answer may be
 * recorded as an asking. Only when nothing refuses does the asking apply, through
 * {@link whatAWriteAsks}, unchanged.
 *
 * THE SWITCHES ARE READ HERE, before either grade is decided, so no caller can refuse past a
 * refusal somebody switched off. Off, the refusal falls to whatever else the path meets: a rule
 * that asks for a person still asks.
 *
 * IT IS PURE OVER WHAT IT IS HANDED: the trees' caches and the paths. It records nothing; the
 * caller appends one `channel.refused` (or `channel.asked`) per rule of {@link WriteVerdict.at}
 * before it answers the host, and answers the same whether or not they land ({@link recordTheCharge}).
 */

import { sep } from 'node:path';
import { DEFAULT_WAIT_MS, TailBusyError, UnreadableLineError } from '@mnema/chain';
import { channelIsOn, type PushedRule, type RulesAtPath, type ScopedCache } from '@mnema/context';
import {
  ASKS_FOR_A_PERSON_RELATION,
  GOVERNS_RELATION,
  REFUSES_A_WRITE_RELATION,
  type Scope,
} from '@mnema/core';
import { whatAWriteAsks } from './edit-asks-a-person.js';
import { editRefusesNotice } from './edit-refuses-a-write.js';
import {
  type GovernedRead,
  onceBySpecificity,
  placesOfAPath,
  readRefusesAWriteAt,
  readRulesInForceAt,
} from './governed-tree.js';
import { oneLine } from './one-line.js';
import { ASKS_A_PERSON_CHANNEL, REFUSES_A_WRITE_CHANNEL } from './record-framing.js';

/** A rule in force at a path and the relation it holds there: what it does to the path. */
export interface RuleInForceUnder extends PushedRule {
  readonly relation:
    | typeof GOVERNS_RELATION
    | typeof REFUSES_A_WRITE_RELATION
    | typeof ASKS_FOR_A_PERSON_RELATION;
}

/**
 * EVERY rule in force at a path, whichever relation it holds there (`governs`, `refuses-a-write`,
 * `asks-for-a-person`), each saying which: what a reader that TELLS what stands over a path
 * (`mnema why`) reads. The push reads `governs` alone, because a refusal and a request have their
 * own channels; a reader that asked what stands over a file and left those two out would say
 * "nothing" for a path the gate refuses.
 *
 * IT LIVES HERE because which rules refuse and which ask is decided in this module and nowhere
 * else (`the-gate-is-decided-once.test.ts`). It reads what the record holds and does not consult
 * the switches: a channel switched off stops the gate from applying a rule, not the rule from
 * standing in the record, and a reader that hid it would be telling a person the file is free.
 * The places are the gate's own ({@link placesOfAPath}).
 */
export function everyRuleInForceAt(
  sources: readonly ScopedCache[],
  read: GovernedRead,
): {
  readonly path: string;
  readonly relative?: string;
  readonly rules: readonly RuleInForceUnder[];
} {
  const places = placesOfAPath(read);
  const under = (
    relation: RuleInForceUnder['relation'],
    reading: (path: string) => RulesAtPath | undefined,
  ): { first: RulesAtPath | undefined; rules: RuleInForceUnder[] } => {
    const readings = places.map(reading);
    return {
      first: readings[0],
      rules: readings.flatMap((one) => (one?.rules ?? []).map((rule) => ({ ...rule, relation }))),
    };
  };
  const governs = under(GOVERNS_RELATION, (path) => readRulesInForceAt(sources, { ...read, path }));
  const refuses = under(REFUSES_A_WRITE_RELATION, (path) =>
    readRefusesAWriteAt(sources, { ...read, path }),
  );
  const asks = under(
    ASKS_FOR_A_PERSON_RELATION,
    (path) => whatAWriteAsks(sources, { ...read, path })?.asked,
  );
  const first = governs.first as RulesAtPath;
  return {
    path: first.path,
    ...(first.relative !== undefined ? { relative: first.relative } : {}),
    rules: onceBySpecificity(
      [refuses.rules, asks.rules, governs.rules],
      (rule) => `${rule.relation}\0${rule.id}`,
    ),
  };
}

/**
 * The one line a gate, a push or an asked reading owes when a rule it names was moved out of one
 * state more than once by machines that had not seen each other (`movedApartSentence` says the
 * same of one record to `show`, `read_record` and the brief, from the same `divergentMoves`).
 * `undefined` for every other rule, which is every rule one machine moved.
 *
 * IT CHANGES NO VERDICT: the state a rule is in force under is the last move in the record's
 * order, and the gate applies it as it stands. The line says that the state was disputed, so a
 * person refused by it can read the moves before deciding the refusal is right.
 */
export function movedApartLine(
  sources: readonly ScopedCache[],
  rules: readonly { readonly id: string }[],
): string | undefined {
  const named = new Set(rules.map((rule) => rule.id));
  if (named.size === 0) return undefined;
  const apart = new Set<string>();
  for (const source of sources) {
    for (const move of source.cache.divergentMoves()) {
      if (named.has(move.entityId)) apart.add(move.entityId);
    }
  }
  if (apart.size === 0) return undefined;
  const ids = [...apart].map((id) => `\`${oneLine(id)}\``).join(', ');
  return (
    `Moved apart: ${ids} left one state more than once, by moves on machines that had not seen each other; ` +
    'the rule stands as the last of them in the record leaves it, and `mnema show <id>` names the moves.'
  );
}

/** One write, as a hook sees it: every path it touches, and where they are read from. */
export interface AWrite {
  /** The paths the write touches, as the host named them: relative or absolute. */
  readonly paths: readonly string[];
  /** The project's root directory: the parent of its `.mnema/`, absolute. */
  readonly root: string;
  /** The directory a relative path is resolved against (see `GovernedRead.from`). */
  readonly from: string;
}

/** What the write meets: the grade, the paths and rules behind it, and the reason to hand over. */
export interface WriteVerdict {
  /** `refuse`: the write does not happen; `ask`: it waits for a person. */
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
 * What `write` meets over `sources`, or `undefined`, the ordinary case, when it meets
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

  // THE SWITCHES ARE THE PROJECT'S OWN: a record the project inherits is read for its rules and
  // never for its switches, so the origin cannot turn this project's gate off.
  const own = sources.filter((source) => source.inherited === undefined);
  if (channelIsOn(own, REFUSES_A_WRITE_CHANNEL)) {
    const refused = places.flatMap((path) => {
      const at = readRefusesAWriteAt(sources, read(path));
      const notice = editRefusesNotice(at);
      return notice === undefined ? [] : [{ at, notice }];
    });
    if (refused.length > 0) return verdict(sources, 'refuse', once(refused));
  }

  if (!channelIsOn(own, ASKS_A_PERSON_CHANNEL)) return undefined;
  const asked = places.flatMap((path) => {
    const gate = whatAWriteAsks(sources, read(path));
    return gate === undefined ? [] : [{ at: gate.asked, notice: gate.notice }];
  });
  return asked.length > 0 ? verdict(sources, 'ask', once(asked)) : undefined;
}

/**
 * The reason a write is refused when reading the record met a stored line the reader refuses,
 * or `undefined` for anything else that was thrown, which the caller throws on. `trees` are the
 * trees the caller read, and the one whose chain holds the line's file is the tree it names.
 *
 * WHAT THE WRITE MEETS IS READ FROM THE RECORD, so a record that cannot be read cannot say the
 * write meets nothing: the gate refuses rather than answering a silence the host would read as
 * leave to write. The reason says which tree and which line, in the reader's own words
 * (`FORMAT.md` §7.1: never guessed at, never skipped), how far the refusal reaches (the
 * project, or for the machine-global tree every project on the machine) and the ways out, which
 * differ because only the public tree is kept by the repository. Switching the refusal off is
 * not one of them: the switch reads the same record.
 *
 * ONLY THAT LINE. A busy tail is the charge's to wait out ({@link recordTheCharge}), and a fault of
 * the product is a fault, never a refusal: neither is turned into one here.
 */
export function refusalOfAnUnreadableRecord(
  error: unknown,
  trees: readonly Pick<ScopedCache, 'scope' | 'chainRoot'>[],
): string | undefined {
  if (!(error instanceof UnreadableLineError)) return undefined;
  const words = UNREADABLE_IN[treeOfTheLine(error.locus, trees) ?? 'unknown'];
  return [
    `The write is refused: a line of ${words.tree} cannot be read by this mnema, so which rules apply to this path cannot be known.`,
    error.message,
    words.out,
  ].join('\n\n');
}

/**
 * The tree whose chain holds the file a locus names, among the trees the door resolved: the
 * DEEPEST chain root it lies under, because outside a repository the private tree's chain sits
 * inside the public one's.
 */
function treeOfTheLine(
  locus: string,
  trees: readonly Pick<ScopedCache, 'scope' | 'chainRoot'>[],
): Scope | undefined {
  const holding = trees
    .filter(({ chainRoot }) => locus.startsWith(`${chainRoot}${sep}`))
    .sort((a, b) => b.chainRoot.length - a.chainRoot.length);
  return holding[0]?.scope;
}

const NOT_VERSIONED =
  'This record is not versioned: update mnema if a newer one wrote the line, restore the file from a copy, or repair or remove the line named above.';

/** What the refusal says of each tree: which it is, how far the refusal reaches, and the way out. */
const UNREADABLE_IN: Readonly<Record<Scope | 'unknown', { tree: string; out: string }>> = {
  public: {
    tree: 'the project’s public record',
    out: 'Every write in the project is refused until the line reads: update mnema if a newer one wrote the line, or restore the line from the repository’s history.',
  },
  private: {
    tree: 'the project’s private record on this machine',
    out: `Every write in the project is refused until the line reads. ${NOT_VERSIONED}`,
  },
  global: {
    tree: 'this machine’s global record',
    out: `This closes every project on this machine: every write in each is refused until the line reads. ${NOT_VERSIONED}`,
  },
  // Not reached by a door, which hands the trees it read; said rather than guessed if it is.
  unknown: {
    tree: 'the record',
    out: 'Every write that reads this record is refused until the line reads: update mnema if a newer one wrote the line, restore the line from the repository’s history or the file from a copy, or repair or remove the line named above.',
  },
};

/** The note on the second stream beside that refusal. */
export const UNREADABLE_RECORD_NOTE =
  'The record could not be read, so the write was refused and nothing was recorded.';

function verdict(
  sources: readonly ScopedCache[],
  grade: WriteVerdict['grade'],
  met: readonly { readonly at: RulesAtPath; readonly notice: string }[],
): WriteVerdict {
  const notices = met.map((one) => {
    const apart = movedApartLine(sources, one.at.rules);
    return apart === undefined ? one.notice : `${one.notice}\n${apart}`;
  });
  return {
    grade,
    at: met.map((one) => one.at),
    reason: notices.join('\n\n'),
    notices,
  };
}

/**
 * How long a charge's facts may take, in all, before the reply goes to the host without them: a
 * new try starts only if one more of the tail lock's own waits ({@link DEFAULT_WAIT_MS}, 2 s) would
 * end inside it. So the command hook tries three times, at about 0, 2 and 4 s, and gives up at 6.
 *
 * THE RULE REFUSES WHETHER OR NOT ITS FACT LANDS. The refusal and the asking are decided by
 * reading the record, which takes no lock; only the fact that a write was refused or held is an
 * append. This used to fall the other way (a fact that could not be written refused nobody) and
 * that made any live process holding the tail a way around every rule of the project for as long
 * as it held it: measured, the write went through at 2.3 s with the lock held by a live pid. So
 * the fact gets more patience than an ordinary write, and its absence is said in the reason.
 *
 * A BUDGET IN TIME, NOT A COUNT OF TRIES. The first try in the server can take two waits (it
 * opens the session's run, then appends the facts, each under a hold of its own), so a count of
 * three let one call wait 8 s and more. No later try opens the run again, so no try can end past
 * this budget: 7 s is the worst, however the waits fall. Measured on the binary with the tail held
 * by a live pid: the command hook answered `deny` in 6.3 s, the server's refusal and asking in
 * 6.0 s each (they were 8.1 s for the asking before the service fact stopped being tried after a
 * charge that did not land).
 *
 * It stays well under the hook's timeout because a host that times the hook out lets the write
 * through: every host this plugin wires gives the hook 15 s (`plugin/hooks/hooks.json`), and a
 * hook that waited as long as it takes would reopen the write by that road.
 */
export const A_CHARGE_WAITS_MS = 7_000;

/** Whether a charge's facts are on the chain, and if not, why: in words the reason can carry. */
export type ChargeRecorded = { readonly ok: true } | { readonly ok: false; readonly why: string };

/**
 * Appends a charge's facts with up to {@link A_CHARGE_WAITS_MS} of patience, and never throws: the
 * reply to the host is composed whatever this answers.
 */
export function recordTheCharge(
  record: () => { readonly ok: boolean; readonly why?: string },
): ChargeRecorded {
  const started = Date.now();
  for (;;) {
    try {
      const done = record();
      if (done.ok) return { ok: true };
      return { ok: false, why: done.why ?? 'the record would not take the fact' };
    } catch (error) {
      const endsInside = Date.now() - started + DEFAULT_WAIT_MS <= A_CHARGE_WAITS_MS;
      if (error instanceof TailBusyError && endsInside) continue;
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
  return `${what} could not be recorded in the project's record, so the record does not show it: ${why.replace(/\.+$/, '')}.`;
}
