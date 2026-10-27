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
  | { readonly is: 'arrived' }
  | {
      readonly is: 'not-arrived';
      /** For the arm that only mentions the file: whether the mention itself reached the model. */
      readonly mentioned?: boolean;
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

const COPILOT_ENDS_AT_ITS_SUMMARY = notMeasured(
  'with `copilot -p` the host asks for its summary at the end of the run and the run ends; a second run that resumed the session sent the whole conversation again, the results and not the summary, so no request of a compacted conversation was seen',
);

const GEMINI_NEEDS_A_SECOND_TURN = notMeasured(
  'in one `gemini -p` run the host asked for no summary although the usage it was told was a full window: its compression splits the history at a turn of the person after the first, and a run has one; no request of a compacted conversation was seen',
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
    ...placeholder(),
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
    ...placeholder(),
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
    ...placeholder(),
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
    ...placeholder(),
    control: row(absent, absent, GEMINI_NEEDS_A_SECOND_TURN, NO_CHANNEL_AT_AN_EDIT),
    'agents-md': row(absent, absent, GEMINI_NEEDS_A_SECOND_TURN, NO_CHANNEL_AT_AN_EDIT),
    'host-file': row(arrived, arrived, GEMINI_NEEDS_A_SECOND_TURN, NO_CHANNEL_AT_AN_EDIT),
    'at-reference': row(arrived, arrived, GEMINI_NEEDS_A_SECOND_TURN, NO_CHANNEL_AT_AN_EDIT),
    'prose-reference': row(
      { is: 'not-arrived', mentioned: true },
      absent,
      GEMINI_NEEDS_A_SECOND_TURN,
      NO_CHANNEL_AT_AN_EDIT,
    ),
    mnema: row(arrived, arrived, GEMINI_NEEDS_A_SECOND_TURN, absent),
  },
  qwen: placeholder(),
};

function placeholder(): Record<Arm, Record<Moment, Outcome>> {
  const none = noSuchPlace('placeholder');
  return {
    control: none,
    'agents-md': none,
    'host-file': none,
    'at-reference': none,
    'prose-reference': none,
    mnema: none,
  };
}

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
      return 'arrived';
    case 'not-arrived':
      return cell.mentioned === true ? 'not arrived (the mention did)' : 'not arrived';
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
      if (cell.is !== 'not-applicable' && cell.is !== 'not-measured') return undefined;
      const text = `${cell.is === 'not-applicable' ? 'Not applicable' : 'Not measured'}: ${cell.why}`;
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
