/**
 * WHAT `mnema init` SHOWS A PERSON, as lines: the first screen, the question of the hosts, the question
 * of who may accept, and the plan.
 *
 * NOTHING HERE DRAWS, READS A KEY OR ASKS THE DEVICE ANYTHING. Each function takes the facts and the width
 * the renderer folds to (`layout.ts` says how that is learned) and returns `Line`s, which the renderer
 * turns into the bytes (the colour is that renderer's, and so is the fold: `presentation/`,
 * `wiring/color.ts`), so a frame is a case with no terminal in it and the same lines are drawn on the
 * screen, printed to the page, and asked of in a golden.
 *
 * THE LINES RUN DOWN A GUIDE, as a trail does: a `◆` marks the step being asked, a `◇` one that is
 * answered, and a `│` runs between them. Every row ends in text, so no sentence depends on the colour: the
 * picked row has the product's own pointer (`repl/palette.ts`), a box says `[x]` or `[ ]`, and a step is
 * named in words. The one accent is the product's (`pick`), the bold is the question, and the dim is
 * what a reader scans past (a path's state, a hint): `the-init-draws-its-frames.test.ts` counts
 * the sequences for every way a caller can ask for none.
 *
 * A ROW IS THE PRODUCT'S COLUMNS AND NOTHING LAID OVER THEM: parts one separator apart
 * (`presentation/plain.ts`), a part's own leading spaces where a column starts further in, and a width
 * measured by the authority (`presentation/width.ts`). A note that does not fit beside what it is about
 * goes under it (`layout.ts`), so at sixty columns a row is still a row of the trail.
 */

import type { InstructionsPeek } from '../commands/instructions.js';
import type { CompletionWord } from '../completion/tree.js';
import type { Line, Part } from '../presentation/line.js';
import { renderPlain } from '../presentation/plain.js';
import { widestOf, widthOfText } from '../presentation/width.js';
import { PICK } from '../repl/palette.js';
import type { Around } from './detect.js';
import { HOST_ROWS, type HostRow, hostMark, yoursMark } from './hosts.js';
import { noted, paragraph } from './layout.js';
import type { PlanRow } from './plan.js';

/** The marks of the trail, spelled by their code points. */
export const GUIDE = '│';
export const ASKED = '◆';
export const DONE = '◇';
export const LEFT = '■';
export const END = '└';

/** The two arrows of a hint, and the middle dot between its clauses. */
const UP_DOWN = '↑↓';
const LEFT_RIGHT = '←→';
const BETWEEN_CLAUSES = ' · ';

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

export const plain = (text: string): Part => ({ role: 'field', text });
export const dim = (text: string): Part => ({ role: 'id', text });
export const accent = (text: string): Part => ({ role: 'pick', text });
export const bold = (text: string): Part => ({ role: 'label', text });

/** A line of the trail: the guide, then the parts, one separator apart. */
export const trail = (...parts: readonly Part[]): Line => ({
  indent: 0,
  parts: [plain(GUIDE), ...parts],
});

/** The guide alone: the breath between two parts of the trail. */
export const theGuide: Line = { indent: 0, parts: [plain(GUIDE)] };

/** A step being asked: its mark in the accent, and the question in bold. */
export const step = (mark: string, words: string): Line => ({
  indent: 0,
  parts: [accent(mark), bold(`  ${words}`)],
});

/** A step that is answered, or a heading of what was found: the mark, and plain words. */
export const heading = (mark: string, words: string): Line => ({
  indent: 0,
  parts: [accent(mark), plain(words)],
});

/** A paragraph of plain words under the guide, wrapped to the width. */
export const sentences = (words: string, width: number): readonly Line[] =>
  paragraph(trail, words, width);

/** A paragraph of hint under the guide, dim, wrapped to the width. */
export const hints = (words: string, width: number): readonly Line[] =>
  paragraph(trail, words, width, '', 'id');

const keysOf = (...clauses: readonly string[]): string => clauses.join(BETWEEN_CLAUSES);

/**
 * The cell the pointer sits in, `gap` columns in from the previous one: the pointer on the picked row and
 * blank on every other, and the SAME width on both, which is the whole of what makes a column of boxes line
 * up. The picked one says what it is and the others do not (`choice/doors.ts` has the argument), so a
 * renderer that paints does not wrap blank space in the escapes that paint a pointer.
 */
export function pointerCell(here: boolean, gap: number): Part {
  return here ? accent(`${' '.repeat(gap + 2)}${PICK}`) : plain(' '.repeat(gap + 1));
}

// ---------------------------------------------------------------------------
// The first screen
// ---------------------------------------------------------------------------

/** Where the folder is, in a sentence: its name and what kind of place it is. */
function whereWords(around: Around): string {
  const here = `Here: ${around.folder}/`;
  const git = around.git;
  if (git === undefined) return `${here}  (not in a git repository)`;
  const branch = git.branch === undefined ? '' : `, branch ${git.branch}`;
  return git.atRoot
    ? `${here}  (root of a git repository${branch})`
    : `${here}  (inside a git repository${branch}; its root is above this folder)`;
}

/**
 * The first screen: the name and version, where the folder is, and what was found around it.
 * Nothing to answer and nothing written, and it says so.
 */
export function theFirstScreen(
  around: Around,
  name: string,
  version: string,
  width: number,
): readonly Line[] {
  const lines: Line[] = [
    {
      indent: 0,
      parts: [
        { role: 'subject', text: name },
        { role: 'subject', text: version },
      ],
    },
    theGuide,
    heading(DONE, whereWords(around)),
    ...sentences(
      'No record yet: this folder becomes a mnema project. Nothing is written until you have seen the plan.',
      width,
    ),
    theGuide,
    heading(DONE, 'Found around it'),
  ];
  if (around.found.length === 0) {
    lines.push(trail(dim('  nothing of an agent host and no decision file')));
  } else {
    const pad = widestOf(around.found.map((found) => found.path)) + 2;
    for (const found of around.found) {
      lines.push(
        ...noted(
          trail,
          [plain(`  ${found.path.padEnd(pad)}`)],
          dim(found.what),
          width,
          2,
          [],
          [plain(`  ${found.path}`)],
        ),
      );
    }
  }
  lines.push(theGuide);
  return lines;
}

// ---------------------------------------------------------------------------
// The hosts
// ---------------------------------------------------------------------------

/** One row the pick can be on: a host, or one of the person's files under it. */
export interface HostItem extends CompletionWord {
  readonly kind: 'host' | 'yours';
  readonly row: HostRow;
  /** For `yours`: the file. */
  readonly path?: string;
}

/** The rows of the question for this folder, top first: a host, then the person's files under it. */
export function hostItems(files: ReadonlyMap<string, InstructionsPeek>): readonly HostItem[] {
  return HOST_ROWS.flatMap((row) => [
    { word: hostMark(row.id), description: '', kind: 'host' as const, row },
    ...row.yours
      .filter((path) => files.get(path)?.exists === true)
      .map((path) => ({
        word: yoursMark(path),
        description: '',
        kind: 'yours' as const,
        row,
        path,
      })),
  ]);
}

/** What a file of the instructions is, in the few words a row carries. */
export function stateOfAFile(peek: InstructionsPeek): string {
  const state = peek.found;
  if (peek.unwritable !== undefined) return `${peek.unwritable}: left as it is`;
  switch (state.state) {
    case 'missing':
      return peek.exists ? 'yours: block added' : 'new';
    case 'current':
      return 'already holds the block';
    case 'outdated':
      return 'earlier block replaced';
    case 'edited':
      return 'its block was edited: left as it is';
    case 'blocked':
      return `left as it is: ${state.why}`;
  }
}

/** The question the hosts are asked under. */
export const HOSTS_QUESTION = 'Which agent hosts should read the mnema instructions?';

/** What a state of the question is, for the page. */
export interface HostsState {
  readonly marks: ReadonlySet<string>;
  readonly picked: string;
}

const HOSTS_KEYS = keysOf(
  `${UP_DOWN} move`,
  'space toggles',
  'a all',
  'Enter confirms',
  'Esc leaves',
);

/** The hint of the row the pick is on. */
function hintOf(item: HostItem | undefined): string {
  if (item === undefined) return '';
  return item.kind === 'host'
    ? item.row.hint
    : 'Yours: the block goes after your text. Unchecked, it is left as it is.';
}

/** How far in from the text of a row the label of a host starts, and the name of a file of the person's. */
const UNDER_THE_LABEL = 8;
const UNDER_THE_NAME = 13;

/**
 * The question of the hosts as rows: a box and a name for each host with what it is found by, the files it
 * gets under it with what each is (new, or yours and given the block), the person's own files as boxes of
 * their own, and under them the hint of the row the pick is on and the keys.
 */
export function hostsPage(
  around: Pick<Around, 'detected' | 'files'>,
  state: HostsState,
  width: number,
  question: string = HOSTS_QUESTION,
): readonly Line[] {
  const items = hostItems(around.files);
  const widest = widestOf(HOST_ROWS.map((row) => row.label)) + 2;
  const lines: Line[] = [step(ASKED, question), theGuide];
  for (const item of items) {
    const here = item.word === state.picked;
    const checked = state.marks.has(item.word);
    if (item.kind === 'host') {
      const why = around.detected.get(item.row.id);
      const box = checked ? accent('  [x]') : plain('[ ]');
      const note = why === undefined ? undefined : dim(`detected: ${why}`);
      lines.push(
        ...noted(
          trail,
          [pointerCell(here, 0), box, plain(item.row.label.padEnd(widest))],
          note,
          width,
          UNDER_THE_LABEL,
          [],
          [pointerCell(here, 0), box, plain(item.row.label)],
        ),
      );
      for (const path of item.row.files) {
        const peek = around.files.get(path);
        lines.push(
          ...noted(
            trail,
            [plain(`        ${path}`)],
            peek === undefined ? undefined : dim(stateOfAFile(peek)),
            width,
            UNDER_THE_LABEL,
          ),
        );
      }
    } else {
      const peek = around.files.get(item.path as string);
      lines.push(
        ...noted(
          trail,
          [
            pointerCell(here, 0),
            checked ? accent('       [x]') : plain('     [ ]'),
            plain(item.path as string),
          ],
          peek === undefined ? undefined : dim(stateOfAFile(peek)),
          width,
          UNDER_THE_NAME,
        ),
      );
    }
  }
  lines.push(
    theGuide,
    ...hints(hintOf(items.find((item) => item.word === state.picked)), width),
    ...hints(HOSTS_KEYS, width),
  );
  return lines;
}

/** What each row is called in the line that stays. */
const HOST_SHORT: { readonly [id in HostRow['id']]: string } = {
  claude: 'Claude Code',
  cursor: 'Cursor',
  vscode: 'VS Code and Copilot CLI',
  codex: 'Codex and others',
};

/**
 * The answer to the hosts, collapsed to the lines that stay on the page: which hosts, and what that
 * means for the files. `rows` are the plan's own rows for the instructions (`instructionRows`), so the
 * sentence counts what the plan then lists.
 */
export function hostsAnswered(
  marks: ReadonlySet<string>,
  rows: readonly PlanRow[],
  width: number,
): readonly Line[] {
  const hosts = HOST_ROWS.filter((row) => marks.has(hostMark(row.id))).map(
    (row) => HOST_SHORT[row.id],
  );
  const created = rows.filter((row) => row.verb === 'create').length;
  const added = rows.filter((row) => row.verb === 'add to').map((row) => row.what);
  const parts = [
    ...(created > 0 ? [`${created} new file${created === 1 ? '' : 's'}`] : []),
    ...(added.length > 0
      ? [
          `${added.length === 1 ? '1 of yours gets' : `${added.length} of yours get`} the block (${added.join(', ')})`,
        ]
      : []),
  ];
  return [
    heading(DONE, `Hosts: ${hosts.length === 0 ? 'none' : hosts.join(', ')}`),
    ...paragraph(
      trail,
      parts.length === 0 ? 'no instruction file is written' : parts.join(', '),
      width,
      '  ',
    ),
    theGuide,
  ];
}

// ---------------------------------------------------------------------------
// Who may accept
// ---------------------------------------------------------------------------

/** The two answers, in the order they are listed. */
export const ACCEPTS_OPTIONS: readonly CompletionWord[] = [
  { word: 'yes', description: 'Yes, accept at once what I choose' },
  { word: 'no', description: 'No, every decision stays proposed until I accept it' },
];

/** What the question says to a person, in the words that say what each answer is. */
const ACCEPTS_BODY =
  'When you pick an option an agent offered, or dictate a choice, the agent records it and accepts it at once, quoting your words. What it proposes on its own still waits for you: `mnema decision review`. Your answer is recorded as your own decision, and `mnema switch` changes it later.';

/** The question about agents accepting, as rows. */
export function acceptsPage(picked: string, width: number): readonly Line[] {
  const lines: Line[] = [
    step(ASKED, 'May an agent accept the decisions you choose?'),
    theGuide,
    ...sentences(ACCEPTS_BODY, width),
    theGuide,
  ];
  for (const option of ACCEPTS_OPTIONS) {
    lines.push(
      ...noted(
        trail,
        [pointerCell(option.word === picked, 0), plain(option.description)],
        option.word === 'yes' ? dim('(the default)') : undefined,
        width,
        4,
      ),
    );
  }
  lines.push(
    theGuide,
    ...hints(keysOf(`${UP_DOWN} move`, 'Enter confirms', 'Esc leaves, nothing founded'), width),
  );
  return lines;
}

/** The answer, collapsed. */
export function acceptsAnswered(answer: 'yes' | 'no', width: number): readonly Line[] {
  return [
    heading(
      DONE,
      answer === 'yes'
        ? 'Agents may accept what you choose: yes'
        : 'Agents may accept what you choose: no',
    ),
    ...paragraph(
      trail,
      answer === 'yes'
        ? 'recorded as your own decision'
        : 'every decision waits for you; recorded as your own decision',
      width,
      '  ',
    ),
    theGuide,
  ];
}

// ---------------------------------------------------------------------------
// A plain git pull
// ---------------------------------------------------------------------------

/** The two answers, in the order they are listed. */
export const PULL_OPTIONS: readonly CompletionWord[] = [
  { word: 'yes', description: 'Yes, set up this clone so a plain `git pull` carries the record' },
  { word: 'no', description: 'No, leave git’s configuration alone' },
];

/** What the question says: what is written, where, and what it reaches beyond the record. */
const PULL_BODY =
  'Events of the record that are not committed yet make `git pull` stop. This writes three settings into this clone’s .git/config so a plain `git pull` carries them: the mnema merge driver, merge.autoStash and rebase.autoStash. The two autoStash settings apply to every file of this clone, not only the record. `mnema doctor --fix merge-driver` writes them later, and `mnema record pull` pulls without any of it.';

/** The question about a plain `git pull`, as rows. */
export function pullPage(picked: string, width: number): readonly Line[] {
  const lines: Line[] = [
    step(ASKED, 'Make a plain `git pull` carry the record in this clone?'),
    theGuide,
    ...sentences(PULL_BODY, width),
    theGuide,
  ];
  for (const option of PULL_OPTIONS) {
    lines.push(
      ...noted(
        trail,
        [pointerCell(option.word === picked, 0), plain(option.description)],
        option.word === 'yes' ? dim('(the default)') : undefined,
        width,
        4,
      ),
    );
  }
  lines.push(
    theGuide,
    ...hints(keysOf(`${UP_DOWN} move`, 'Enter confirms', 'Esc leaves, nothing founded'), width),
  );
  return lines;
}

/** The answer, collapsed. */
export function pullAnswered(answer: 'yes' | 'no', width: number): readonly Line[] {
  return [
    heading(
      DONE,
      answer === 'yes'
        ? 'A plain git pull carries the record: yes'
        : 'A plain git pull carries the record: no',
    ),
    ...paragraph(
      trail,
      answer === 'yes'
        ? 'three settings in .git/config, shown in the plan'
        : 'git’s configuration is left alone',
      width,
      '  ',
    ),
    theGuide,
  ];
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/** The width of the column a verb sits in: `replace`, the longest, and what a reader reads first. */
const VERB_COLUMN = 8;

/** The column the paths of a row with a note are padded to, so the notes line up. */
const PATH_COLUMN = 24;

/** How far in from the text of a row a note hangs when it goes under: under the path. */
const UNDER_THE_PATH = 2 + VERB_COLUMN + 2;

/** The sections of the plan, in order, with the words that head them. */
const SECTIONS: readonly { readonly section: PlanRow['section']; readonly title: string }[] = [
  { section: 'repository', title: 'In this repository' },
  { section: 'machine', title: 'On this machine only, outside the repository' },
];

/** The plan, as rows: printed to the page and kept, because it is the proof of what was agreed to. */
export function planPage(
  rows: readonly PlanRow[],
  width: number,
  title = 'This is everything init will do',
): readonly Line[] {
  const lines: Line[] = [heading(DONE, title), theGuide];
  for (const { section, title: head } of SECTIONS) {
    const here = rows.filter((row) => row.section === section);
    if (here.length === 0) continue;
    lines.push(...sentences(head, width));
    for (const row of here) {
      const verb = plain(`  ${row.verb.padEnd(VERB_COLUMN)}`);
      const note = row.note === undefined ? undefined : dim(row.note);
      lines.push(
        ...noted(
          trail,
          [verb, plain(row.what.padEnd(PATH_COLUMN))],
          note,
          width,
          UNDER_THE_PATH,
          row.more,
          [verb, plain(row.what)],
        ),
      );
    }
    lines.push(theGuide);
  }
  return lines;
}

/** The three answers to the plan, in the order they are listed. */
export const PLAN_OPTIONS: readonly CompletionWord[] = [
  { word: 'found', description: 'Found the project' },
  { word: 'change', description: 'Change the answers' },
  { word: 'leave', description: 'Leave' },
];

/**
 * The one confirmation, drawn under the plan: the three answers along one row where they fit, and one
 * under another where they do not (the arrows of both directions move the pick either way).
 */
export function confirmPage(picked: string, width: number): readonly Line[] {
  const along: Part[] = [];
  for (const [at, option] of PLAN_OPTIONS.entries()) {
    along.push(pointerCell(option.word === picked, at === 0 ? 0 : 6), plain(option.description));
  }
  const fits = widthOfText(renderPlain(trail(...along))) <= width;
  const options: Line[] = fits
    ? [trail(...along)]
    : PLAN_OPTIONS.map((option) =>
        trail(pointerCell(option.word === picked, 0), plain(option.description)),
      );
  return [
    step(ASKED, 'Found the project with this plan?'),
    theGuide,
    ...options,
    theGuide,
    ...hints(
      keysOf(
        `${fits ? LEFT_RIGHT : UP_DOWN} move`,
        'Enter confirms',
        'Esc leaves, nothing founded',
      ),
      width,
    ),
  ];
}

/** What stays where the confirmation was, once the person has said to go ahead. */
export const agreedLines: readonly Line[] = [heading(DONE, 'Plan agreed'), theGuide];

// ---------------------------------------------------------------------------
// Leaving
// ---------------------------------------------------------------------------

/** What is said when the person leaves a question: nothing was written. */
export const LEFT_WORDS = 'Left. Nothing was founded and nothing was written.';

/** The line that says so. */
export const leftLine = (what = LEFT_WORDS): Line => heading(LEFT, what);
