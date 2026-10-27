/**
 * The decisions waiting for a person, read from `mnema search --state proposed --json` and
 * `mnema show <id> --json`, and the command that judges one.
 *
 * A judgment is the CLI's own verb, `mnema decision move accept|reject <id> --note <text>`, and
 * the note is the CLI's own requirement; this module only refuses to ask for a verdict it
 * already knows the CLI would refuse.
 */

/** How many the panel asks for: the most `mnema search` returns. */
export const PROPOSED_LIMIT = 200;

/** The command that lists what waits for a judgment. */
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
  readonly scope: string;
  readonly at: string;
}

/** What the record holds about one of them, when it was asked. */
export interface ProposedDetail {
  readonly adr: string | undefined;
  readonly rationale: string | undefined;
  readonly alternatives: string | undefined;
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
      scope: typeof scope === 'string' ? scope : 'public',
      at: typeof at === 'string' ? at : '',
    });
  }
  const total = typeof answer?.total === 'number' ? answer.total : items.length;
  return { items, total };
}

/** The justification and the alternatives in an answer of `mnema show --json`. */
export function readDetail(stdout: string): ProposedDetail {
  const record = parse(stdout)?.record;
  const body = isObject(record) ? record : {};
  const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined);
  return {
    adr: text(body.adr),
    rationale: text(body.rationale),
    alternatives: text(body.alternatives),
  };
}

/** How much of the justification a tooltip carries: the rest is in the document of the decision. */
const TOOLTIP_CHARS = 160;

/** What the tooltip of an item says: the title, the ADR and the start of why. The whole text opens on a click. */
export function proposedTooltip(item: Proposed, detail: ProposedDetail | undefined): string {
  const head = `${detail?.adr ?? item.id}: ${item.title}`;
  const why = detail?.rationale;
  if (why === undefined) return head;
  const start = why.length > TOOLTIP_CHARS ? `${why.slice(0, TOOLTIP_CHARS - 1)}\u2026` : why;
  return `${head}\n\n${start}`;
}

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
