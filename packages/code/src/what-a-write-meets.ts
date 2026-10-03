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

import { channelIsOn, type RulesAtPath, type ScopedCache } from '@mnema/context';
import { whatAWriteAsks } from './edit-asks-a-person.js';
import { editRefusesNotice } from './edit-refuses-a-write.js';
import { readRefusesAWriteAt } from './governed-tree.js';
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

  if (channelIsOn(sources, REFUSES_A_WRITE_CHANNEL)) {
    const refused = write.paths.flatMap((path) => {
      const at = readRefusesAWriteAt(sources, read(path));
      const notice = editRefusesNotice(at);
      return notice === undefined ? [] : [{ at, notice }];
    });
    if (refused.length > 0) return verdict('refuse', refused);
  }

  if (!channelIsOn(sources, ASKS_A_PERSON_CHANNEL)) return undefined;
  const asked = write.paths.flatMap((path) => {
    const gate = whatAWriteAsks(sources, read(path));
    return gate === undefined ? [] : [{ at: gate.asked, notice: gate.notice }];
  });
  return asked.length > 0 ? verdict('ask', asked) : undefined;
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
