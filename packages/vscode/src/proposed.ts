/**
 * The decisions waiting for a person, read from `mnema search --state proposed --json` and
 * `mnema show <id> --json`, and the command that judges one.
 *
 * A judgment is the CLI's own verb, `mnema decision move accept|reject <id> --note <text>`, and
 * the note is the CLI's own requirement; this module only refuses to ask for a verdict it
 * already knows the CLI would refuse.
 */

/** How many the panel asks for — the most `mnema search` returns. */
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

/** The proposed decisions in an answer of `mnema search --json`, and how many exist in all. */
export function readProposed(stdout: string): { items: Proposed[]; total: number } {
  const answer = parse(stdout);
  const hits = answer?.hits;
  if (!Array.isArray(hits)) return { items: [], total: 0 };
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

/** What a person reads before judging: the title, why it was proposed, what was turned down. */
export function detailText(item: Proposed, detail: ProposedDetail | undefined): string {
  const lines = [`${detail?.adr ?? item.id}: ${item.title}`, `scope: ${item.scope}`];
  if (detail?.rationale !== undefined) lines.push('', 'Why:', detail.rationale);
  if (detail?.alternatives !== undefined) lines.push('', 'Alternatives:', detail.alternatives);
  return lines.join('\n');
}

/** The ids that are on the panel now and were not the last time. The first reading announces none. */
export function newlyProposed(
  before: ReadonlySet<string> | undefined,
  now: readonly Proposed[],
): Proposed[] {
  if (before === undefined) return [];
  return now.filter((item) => !before.has(item.id));
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
