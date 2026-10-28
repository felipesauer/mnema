/**
 * THE TABLE OF WHERE A RULE ARRIVES: for each host, each place a rule is kept and each moment of a
 * session, whether the rule reached the model, as it was measured on the version the contract pins.
 *
 * It is two things at once. The case of each host (`the-rule-arrives.*.test.ts`) starts the host,
 * measures every cell this table calls measured, and requires the measurement to equal the cell,
 * so a host that changes what it does turns that host's job red; and `docs/rule-arrival.md` shows
 * the table, so the page says what the cases hold and nothing else. A cell that is not measured
 * says why, and no cell is filled by supposing.
 *
 * Four words, and only these:
 *  - `arrived`: the sentinel was in a request the host sent the model at that moment;
 *  - `not-arrived`: it was not (a reading made, and it found nothing);
 *  - `not-applicable`: the place has no way to reach the model at that moment, said with the reason;
 *  - `not-measured`: the reading was not made, said with the reason.
 */

import {
  ARMS,
  ARRIVAL_HOSTS,
  type Arm,
  type ArrivalHost,
  MOMENTS,
  type Moment,
} from './the-arms-of-a-rule.js';

export type Outcome =
  | {
      readonly is: 'arrived';
      /** A reading made under a condition the page says: the table marks it with a note. */
      readonly note?: string;
    }
  | {
      readonly is: 'not-arrived';
      /** For the arm that only mentions the file: whether the mention itself reached the model. */
      readonly mentioned?: boolean;
      /** A reading made under a condition the page says: the table marks it with a note. */
      readonly note?: string;
    }
  | { readonly is: 'not-applicable'; readonly why: string }
  | { readonly is: 'not-measured'; readonly why: string };

const arrived: Outcome = { is: 'arrived' };
const absent: Outcome = { is: 'not-arrived' };
const notApplicable = (why: string): Outcome => ({ is: 'not-applicable', why });
const notMeasured = (why: string): Outcome => ({ is: 'not-measured', why });

/** A row of four moments. */
const row = (
  start: Outcome,
  late: Outcome,
  compaction: Outcome,
  edit: Outcome,
): Record<Moment, Outcome> => ({ start, late, compaction, edit });

/** What a place kept in a file says about the moment of an edit: the file is read when a session opens, and has no channel at a write. */
const NO_CHANNEL_AT_AN_EDIT = notApplicable(
  'a file is read when the session opens and has no channel at a write; the late column says whether it is still in front of the model',
);

const THE_ARMS_IN_A_FILE_ARE_READ_AGAIN = row(arrived, arrived, arrived, NO_CHANNEL_AT_AN_EDIT);

/** The cells of a place that has none for a host, by the reason. */
const noSuchPlace = (why: string): Record<Moment, Outcome> =>
  row(notApplicable(why), notApplicable(why), notApplicable(why), notApplicable(why));

/** The condition of a reading after a compaction where the host only compacts a session that was resumed. */
const IN_A_RESUMED_SESSION =
  'read in a second run that resumes the session (`--resume`), which starts the session again: it says nothing about a compaction in a session that was never resumed';

/** The same reading, marked as made in a resumed session. */
const resumed = (cell: Outcome): Outcome =>
  cell.is === 'arrived' || cell.is === 'not-arrived'
    ? { ...cell, note: IN_A_RESUMED_SESSION }
    : cell;

const COPILOT_ENDS_AT_ITS_SUMMARY = notMeasured(
  'with `copilot -p` the host asks for its summary at the end of the run and the run ends; a second run that resumed the session sent the whole conversation again, the results and not the summary, so no request of a compacted conversation was seen',
);

type TheTable = Record<ArrivalHost, Record<Arm, Record<Moment, Outcome>>>;

export const THE_TABLE: TheTable = {
  'claude-code': {
    control: row(absent, absent, absent, NO_CHANNEL_AT_AN_EDIT),
    'agents-md': THE_ARMS_IN_A_FILE_ARE_READ_AGAIN,
    'host-file': THE_ARMS_IN_A_FILE_ARE_READ_AGAIN,
    'at-reference': THE_ARMS_IN_A_FILE_ARE_READ_AGAIN,
    'prose-reference': row(
      { is: 'not-arrived', mentioned: true },
      absent,
      absent,
      NO_CHANNEL_AT_AN_EDIT,
    ),
    mnema: row(arrived, arrived, arrived, arrived),
  },
  codex: {
    control: row(absent, absent, absent, NO_CHANNEL_AT_AN_EDIT),
    'agents-md': THE_ARMS_IN_A_FILE_ARE_READ_AGAIN,
    'host-file': noSuchPlace('the instructions file Codex reads is `AGENTS.md`, the place above'),
    'at-reference': row(absent, absent, absent, NO_CHANNEL_AT_AN_EDIT),
    'prose-reference': row(
      { is: 'not-arrived', mentioned: true },
      absent,
      absent,
      NO_CHANNEL_AT_AN_EDIT,
    ),
    mnema: row(arrived, arrived, arrived, absent),
  },
  opencode: {
    control: row(absent, absent, absent, NO_CHANNEL_AT_AN_EDIT),
    'agents-md': THE_ARMS_IN_A_FILE_ARE_READ_AGAIN,
    'host-file': noSuchPlace(
      'the instructions file OpenCode reads is `AGENTS.md`, the place above',
    ),
    'at-reference': row(absent, absent, absent, NO_CHANNEL_AT_AN_EDIT),
    'prose-reference': row(
      { is: 'not-arrived', mentioned: true },
      absent,
      absent,
      NO_CHANNEL_AT_AN_EDIT,
    ),
    mnema: row(arrived, arrived, arrived, absent),
  },
  copilot: {
    control: row(absent, absent, COPILOT_ENDS_AT_ITS_SUMMARY, NO_CHANNEL_AT_AN_EDIT),
    'agents-md': row(arrived, arrived, COPILOT_ENDS_AT_ITS_SUMMARY, NO_CHANNEL_AT_AN_EDIT),
    'host-file': row(arrived, arrived, COPILOT_ENDS_AT_ITS_SUMMARY, NO_CHANNEL_AT_AN_EDIT),
    'at-reference': row(arrived, arrived, COPILOT_ENDS_AT_ITS_SUMMARY, NO_CHANNEL_AT_AN_EDIT),
    'prose-reference': row(
      { is: 'not-arrived', mentioned: true },
      absent,
      COPILOT_ENDS_AT_ITS_SUMMARY,
      NO_CHANNEL_AT_AN_EDIT,
    ),
    mnema: row(arrived, arrived, COPILOT_ENDS_AT_ITS_SUMMARY, absent),
  },
  gemini: {
    control: row(absent, absent, resumed(absent), NO_CHANNEL_AT_AN_EDIT),
    'agents-md': row(absent, absent, resumed(absent), NO_CHANNEL_AT_AN_EDIT),
    'host-file': row(arrived, arrived, resumed(arrived), NO_CHANNEL_AT_AN_EDIT),
    'at-reference': row(arrived, arrived, resumed(arrived), NO_CHANNEL_AT_AN_EDIT),
    'prose-reference': row(
      { is: 'not-arrived', mentioned: true },
      absent,
      resumed(absent),
      NO_CHANNEL_AT_AN_EDIT,
    ),
    mnema: row(arrived, arrived, resumed(arrived), absent),
  },
  qwen: {
    control: row(absent, absent, absent, NO_CHANNEL_AT_AN_EDIT),
    'agents-md': row(arrived, arrived, arrived, NO_CHANNEL_AT_AN_EDIT),
    'host-file': row(arrived, arrived, arrived, NO_CHANNEL_AT_AN_EDIT),
    'at-reference': row(arrived, arrived, arrived, NO_CHANNEL_AT_AN_EDIT),
    'prose-reference': row(
      { is: 'not-arrived', mentioned: true },
      absent,
      absent,
      NO_CHANNEL_AT_AN_EDIT,
    ),
    mnema: row(arrived, arrived, arrived, absent),
  },
};

/** The cell of a host, an arm and a moment. */
export function theCell(host: ArrivalHost, arm: Arm, moment: Moment): Outcome {
  return THE_TABLE[host][arm][moment];
}

/** Whether a cell is one a case measures: the sentinel was looked for in the host's requests. */
export function isMeasured(
  cell: Outcome,
): cell is Extract<Outcome, { is: 'arrived' | 'not-arrived' }> {
  return cell.is === 'arrived' || cell.is === 'not-arrived';
}

/** The moments of a host's arm that the table says were measured. */
export function theMomentsMeasured(host: ArrivalHost, arm: Arm): Moment[] {
  return MOMENTS.filter((moment) => isMeasured(theCell(host, arm, moment)));
}

const HOST_NAMES: Record<ArrivalHost, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  copilot: 'GitHub Copilot CLI',
  gemini: 'Gemini CLI',
  qwen: 'Qwen Code',
};

const ARM_NAMES: Record<Arm, string> = {
  control: 'no rule anywhere (the control)',
  'agents-md': 'the rule in `AGENTS.md`',
  'host-file': "the rule in the host's own instructions file",
  'at-reference': 'the rule in a file the instructions file imports with `@`',
  'prose-reference': 'the rule in a file the instructions file only mentions',
  mnema: 'the rule in the mnema record, addressed at a path',
};

const MOMENT_NAMES: Record<Moment, string> = {
  start: 'start',
  late: 'late',
  compaction: 'after a compaction',
  edit: 'at an edit',
};

/** The words in a cell, and the letter of the note that gives the reason. */
function wordsOf(cell: Outcome, note: string | undefined): string {
  switch (cell.is) {
    case 'arrived':
      return note === undefined ? 'arrived' : `arrived (note ${note})`;
    case 'not-arrived': {
      const mention = cell.mentioned === true ? ' (the mention did)' : '';
      return `not arrived${mention}${note === undefined ? '' : ` (note ${note})`}`;
    }
    case 'not-applicable':
      return `not applicable (note ${note})`;
    case 'not-measured':
      return `not measured (note ${note})`;
  }
}

/** The table, one section per host, with a note under it for every reason a cell gives. */
export function renderTheTable(): string {
  const sections: string[] = [];
  for (const host of ARRIVAL_HOSTS) {
    const notes: string[] = [];
    const noteOf = (cell: Outcome): string | undefined => {
      let text: string;
      if (cell.is === 'not-applicable') text = `Not applicable: ${cell.why}`;
      else if (cell.is === 'not-measured') text = `Not measured: ${cell.why}`;
      else if (cell.note !== undefined) text = `Resumed: ${cell.note}`;
      else return undefined;
      let at = notes.indexOf(text);
      if (at < 0) at = notes.push(text) - 1;
      return String(at + 1);
    };
    const lines = [
      `### ${HOST_NAMES[host]}`,
      '',
      `| Where the rule is kept | ${MOMENTS.map((moment) => MOMENT_NAMES[moment]).join(' | ')} |`,
      `|---|${MOMENTS.map(() => '---').join('|')}|`,
    ];
    for (const arm of ARMS) {
      const cells = MOMENTS.map((moment) => {
        const cell = theCell(host, arm, moment);
        return wordsOf(cell, noteOf(cell));
      });
      lines.push(`| ${ARM_NAMES[arm]} | ${cells.join(' | ')} |`);
    }
    if (notes.length > 0) {
      lines.push('', ...notes.map((note, at) => `${at + 1}. ${note}`));
    }
    sections.push(lines.join('\n'));
  }
  return sections.join('\n\n');
}

/**
 * What a person writes about how each host puts the rules in front of its model: the block, the
 * hook, the setting. It is held to say nothing about whether a rule arrived (see
 * {@link THE_WORDS_OF_ARRIVAL} and `the-arrival-page-is-the-table.test.ts`): that is what the
 * cells say, and the sentence of the page that says it is generated from them.
 */
export const THE_MECHANISM: Record<ArrivalHost, string> = {
  'claude-code':
    "The files are read into the block the host opens its first message with; the record is put there by the plugin's `SessionStart` hook, which runs again after a compaction, and by a hook that runs beside the result of a write.",
  codex: 'An `@` import is not expanded by the host.',
  opencode: 'An `@` import is not expanded by the host.',
  copilot: '',
  gemini:
    '`AGENTS.md` is not among the files it reads with the default settings (its `context.fileName` can list it). The cells after a compaction are read in a second run that resumes the session (`--resume`), which starts the session again.',
  qwen: '',
};

/** What a hand-written mechanism may not say: a word that claims a rule did or did not arrive. */
export const THE_WORDS_OF_ARRIVAL =
  /\b(arriv\w*|reach\w*|came|comes|deliver\w*|carr(?:y|ies|ied)|present|absent|missing|lost|dropped)\b/i;

const MOMENT_PHRASES: Record<Moment, string> = {
  start: 'at the start',
  late: 'late',
  compaction: 'after a compaction',
  edit: 'at an edit',
};

const ARM_PHRASES: Record<Arm, string> = {
  control: 'with no rule anywhere',
  'agents-md': 'in `AGENTS.md`',
  'host-file': "in the host's own instructions file",
  'at-reference': 'behind an `@` import',
  'prose-reference': 'in a file that is only mentioned',
  mnema: 'in the mnema record',
};

/** "a, b and c". */
function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** What one place did, from its cells alone: at which moments it arrived, did not, was not measured. */
function whatAPlaceDid(host: ArrivalHost, arm: Arm): string | undefined {
  const at = (is: Outcome['is']): string[] =>
    MOMENTS.filter((moment) => theCell(host, arm, moment).is === is).map(
      (moment) => MOMENT_PHRASES[moment],
    );
  const parts: string[] = [];
  const arrivedAt = at('arrived');
  if (arrivedAt.length > 0) parts.push(`arrived ${listed(arrivedAt)}`);
  const missedAt = at('not-arrived');
  if (missedAt.length > 0) {
    const start = theCell(host, arm, 'start');
    const mentioned = start.is === 'not-arrived' && start.mentioned === true;
    parts.push(
      `did not arrive ${listed(missedAt)}${mentioned ? ' (the sentence that mentions the file did, at the start)' : ''}`,
    );
  }
  const unmeasured = at('not-measured');
  if (unmeasured.length > 0) parts.push(`was not measured ${listed(unmeasured)}`);
  return parts.length === 0 ? undefined : parts.join('; ');
}

/** The sentence of one host: places that did the same are said together, in the order of the table. */
function theSentenceOf(host: ArrivalHost): string {
  const groups = new Map<string, string[]>();
  for (const arm of ARMS) {
    if (arm === 'control') continue;
    const did = whatAPlaceDid(host, arm);
    if (did === undefined) continue;
    groups.set(did, [...(groups.get(did) ?? []), ARM_PHRASES[arm]]);
  }
  const sentences = [...groups.entries()].map(([did, arms]) => `The rule ${listed(arms)} ${did}.`);
  const mechanism = THE_MECHANISM[host];
  return [...sentences, ...(mechanism === '' ? [] : [mechanism])].join(' ');
}

/** The prose of the page, one item per host, every claim of arrival drawn from the cells. */
export function renderTheProse(): string {
  return ARRIVAL_HOSTS.map((host) => `- **${HOST_NAMES[host]}.** ${theSentenceOf(host)}`).join(
    '\n',
  );
}
