/**
 * The decisions waiting for a person, read from `mnema status --json`, and the command that judges one.
 *
 * `status --json` serves the first 20 of everything that awaits a judgment, with the `ADR-n` of each
 * decision and a count of all of them. When there are more than it served, the panel also asks
 * `mnema search`, which lists up to 200 decisions, so no decision that was listed before is dropped.
 *
 * A judgment is the CLI's own verb, `mnema decision move accept|reject <id> --note <text>`, and
 * the note is the CLI's own requirement; this module only refuses to ask for a verdict it
 * already knows the CLI would refuse.
 */

/** How many the panel asks for when `status` cut its list: the most `mnema search` returns. */
export const PROPOSED_LIMIT = 200;

/** The command that says what awaits a judgment, and how many there are in all. */
export const STATUS_ARGS: readonly string[] = ['status', '--json'];

/** The command that lists the decisions awaiting a judgment, up to the most it returns. */
export const LIST_ARGS: readonly string[] = [
  'search',
  '--kind',
  'decision',
  '--state',
  'proposed',
  '--limit',
  String(PROPOSED_LIMIT),
  '--json',
];

/** One decision waiting for a judgment. */
export interface Proposed {
  readonly id: string;
  readonly title: string;
  /** Set only when the answer that listed it said it: `status` does not, so it is not made up. */
  readonly scope?: string;
  readonly at: string;
  /** Set only when the answer that listed it carried it: `status` does, `search` does not. */
  readonly adr?: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parse(stdout: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(stdout);
    return isObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The proposed decisions in an answer of `mnema search --json`, and how many exist in all.
 * Undefined when the text is not that answer: an answer nobody understood is not an empty list.
 */
export function readProposed(stdout: string): { items: Proposed[]; total: number } | undefined {
  const answer = parse(stdout);
  const hits = answer?.hits;
  if (!Array.isArray(hits)) return undefined;
  const items: Proposed[] = [];
  for (const hit of hits as unknown[]) {
    if (!isObject(hit)) continue;
    const { id, title, scope, at, kind } = hit;
    if (typeof id !== 'string' || typeof title !== 'string' || kind !== 'decision') continue;
    items.push({
      id,
      title,
      ...(typeof scope === 'string' ? { scope } : {}),
      at: typeof at === 'string' ? at : '',
    });
  }
  const total = typeof answer?.total === 'number' ? answer.total : items.length;
  return { items, total };
}

/** What `mnema status --json` said awaits a judgment. */
export interface AwaitingRead {
  /** The decisions among what it served, in its order, each with its `ADR-n` when it said one. */
  readonly items: Proposed[];
  /** How many things `status` served in all (decisions, skills and tasks): its list is cut at 20. */
  readonly served: number;
  /** How many await a judgment in all, of any kind, as `status` counted them. */
  readonly total: number;
}

/**
 * The reading of `mnema status --json`. Undefined when the text is not that answer: one that
 * carries no `awaitingJudgement` list is not an empty one.
 */
export function readStatus(stdout: string): AwaitingRead | undefined {
  const answer = parse(stdout);
  const awaiting = answer?.awaitingJudgement;
  if (!Array.isArray(awaiting)) return undefined;
  const items: Proposed[] = [];
  for (const item of awaiting as unknown[]) {
    if (!isObject(item)) continue;
    const { id, title, adr, updatedAt, kind } = item;
    if (kind !== 'decision' || typeof id !== 'string' || typeof title !== 'string') continue;
    items.push({
      id,
      title,
      at: typeof updatedAt === 'string' ? updatedAt : '',
      ...(typeof adr === 'string' && adr !== '' ? { adr } : {}),
    });
  }
  const total = answer?.awaitingJudgementTotal;
  return {
    items,
    served: awaiting.length,
    total: typeof total === 'number' && total >= awaiting.length ? total : awaiting.length,
  };
}

/** Whether `status` cut its list: there are more waiting than it served, so `search` is asked too. */
export const wasCut = (read: AwaitingRead): boolean => read.total > read.served;

/**
 * The decisions `search` listed, each with the `ADR-n` `status` gave for the ones it served: the
 * rest are listed by their id, as before. The count is `search`'s own, of decisions only.
 */
export function withAdrs(
  listed: { items: Proposed[]; total: number },
  served: readonly Proposed[],
): { items: Proposed[]; total: number } {
  const adrs = new Map(served.map((item) => [item.id, item.adr]));
  return {
    total: listed.total,
    items: listed.items.map((item) => {
      const adr = adrs.get(item.id);
      return adr === undefined ? item : { ...item, adr };
    }),
  };
}

/** What the tooltip of an item says: the ADR and the title. The whole text opens on a click. */
export const proposedTooltip = (item: Proposed): string => `${item.adr ?? item.id}: ${item.title}`;

/** The two verbs a person has. */
export type Judgment = 'accept' | 'reject';

/** The command line that records a verdict. */
export const judgeArgs = (verdict: Judgment, id: string, note: string): string[] => [
  'decision',
  'move',
  verdict,
  id,
  '--note',
  note,
];

/** Why a note cannot be sent, or undefined when it can. The note is required; an empty one is not. */
export const noteProblem = (note: string): string | undefined =>
  note.trim() === '' ? 'A note is required: say why.' : undefined;

const two = (n: number): string => String(n).padStart(2, '0');

/**
 * The note an accept can carry when the person types nothing: the day, in their own calendar, and
 * what is true of the act, that it was done in this extension and that no reason was typed. It
 * says nothing about the decision, and it is only an offer: the box holds it as text to keep or
 * to replace by a reason. A rejection has no such offer.
 */
export const acceptStamp = (day: Date): string =>
  `${day.getFullYear()}-${two(day.getMonth() + 1)}-${two(day.getDate())}, accepted in the VS Code extension, no reason typed`;

/** What a judgment box is titled: the verb and the decision, by its ADR or the start of its id. */
export const judgeLabel = (verdict: Judgment, adr: string | undefined, id: string): string =>
  `${verdict === 'accept' ? 'Accept' : 'Reject'} ${adr ?? id.slice(0, 8)}`;

/**
 * What is shown once the command line recorded a verdict: its line `Decision ADR-2 (<id>) -> accepted`
 * shortened to `ADR-2 accepted.`. The verdict is the one in the line; a line of another shape is
 * shown as it came.
 */
export function judgedText(stdout: string): string {
  const line = stdout.trim().split('\n')[0] ?? '';
  if (line === '') return 'Recorded.';
  const match = /^Decision (\S+) \([^)]*\) \u2192 (accepted|rejected)$/.exec(line);
  return match === null ? line : `${match[1]} ${match[2]}.`;
}
