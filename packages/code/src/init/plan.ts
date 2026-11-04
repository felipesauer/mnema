/**
 * EVERYTHING A FOUNDING WILL DO, as rows, before it does any of it.
 *
 * ONE FUNCTION FEEDS THREE READERS: the screen that asks for the one confirmation, `--dry-run`, and the
 * line a person is shown under the hosts once they have picked. A plan written three times would be
 * three promises that can disagree, and the writing that follows is the one that has to keep them:
 * `the-init-says-what-it-found-and-writes-nothing.test.ts` founds with every combination of answers it can
 * and requires the files that exist afterwards to be exactly the files the rows name.
 *
 * A ROW SAYS ONE THING, WITH A VERB: `create`, `add to` (after the person's own text, between two
 * markers), `replace` (an earlier block of ours), `keep` (the block is already there), `leave` (a block
 * somebody edited, or a file that cannot be written through) and `record` (a fact the founding writes in
 * the record). The files are read by the function a write is decided by (`peekInstructions`), so a file
 * the write would refuse is a `leave` here and not a `create` that then does not happen.
 */

import { PROJECT_DIR } from '@mnema/core';
import type { InstructionsPeek } from '../commands/instructions.js';
import { type Around, fromTheFolder } from './detect.js';
import { HOST_ROWS, ownFilesOf, yoursOf } from './hosts.js';

/** What a person answered about who may accept, or nothing where nobody was asked. */
export type Accepts = 'yes' | 'no';

/** The answers a plan is made from. */
export interface Answers {
  /** The marks that are on (`init/hosts.ts`). */
  readonly marks: ReadonlySet<string>;
  /** The answer to the question about agents accepting, when there is one to record. */
  readonly accepts?: Accepts;
  /** The agent that gave the answer through `--which`: the answer is then its proposal, and not the person's. */
  readonly agent?: string;
  /**
   * Whether the clone's own git configuration is set so a plain `git pull` carries the record
   * (`doctor-merge-driver.ts`): `yes` writes the three settings, anything else writes none.
   */
  readonly pull?: Accepts;
}

/** What the plan says about this machine. */
export interface Machine {
  /** Whether this machine holds no identity yet: the founding makes one. */
  readonly newIdentity: boolean;
  /** Where the identity lives, as it is said ("~/.mnema/identity/"). */
  readonly where: string;
}

/** The verbs a row can have. */
export type Verb = 'create' | 'add to' | 'replace' | 'keep' | 'leave' | 'record' | 'use' | 'set';

/** One thing the founding will do. */
export interface PlanRow {
  /** Where it happens: in the repository, or on this machine alone. */
  readonly section: 'repository' | 'machine';
  readonly verb: Verb;
  /** What it is done to: a path, or a few words for a fact. */
  readonly what: string;
  /** What the person should know about it, in a few words. */
  readonly note?: string;
  /** More lines of the note, when it needs them. */
  readonly more?: readonly string[];
}

/** The order the verbs are listed in: what is made first, then what is added to, then what is left. */
const ORDER: readonly Verb[] = [
  'create',
  'add to',
  'replace',
  'keep',
  'leave',
  'record',
  'use',
  'set',
];

/** What a file of the instructions gets, said as a row. */
function rowForAFile(peek: InstructionsPeek): PlanRow {
  const state = peek.found;
  const what = peek.path;
  // A FILE THE WRITE WOULD REFUSE IS LEFT, with the reason: the plan never promises a write that then fails.
  if (peek.unwritable !== undefined) {
    return { section: 'repository', verb: 'leave', what, note: `(${peek.unwritable})` };
  }
  switch (state.state) {
    case 'missing':
      return peek.exists
        ? {
            section: 'repository',
            verb: 'add to',
            what,
            note: 'after your text, between two markers',
          }
        : { section: 'repository', verb: 'create', what };
    case 'outdated':
      return {
        section: 'repository',
        verb: 'replace',
        what,
        note: 'an earlier version of the mnema block',
      };
    case 'current':
      return { section: 'repository', verb: 'keep', what, note: 'it already holds the block' };
    case 'edited':
    case 'blocked':
      return {
        section: 'repository',
        verb: 'leave',
        what,
        note: state.state === 'edited' ? 'its mnema block was edited' : state.why,
      };
  }
}

/** The text a decision row carries: who answered, and what. */
function decisionRows(answers: Answers): readonly PlanRow[] {
  if (answers.accepts === undefined) return [];
  if (answers.agent !== undefined) {
    return [
      {
        section: 'repository',
        verb: 'record',
        what: '1 decision, proposed by the agent',
        note:
          answers.accepts === 'yes'
            ? 'agents may accept what you choose: it waits for you'
            : 'agents may not accept: it waits for you',
      },
    ];
  }
  return answers.accepts === 'yes'
    ? [
        {
          section: 'repository',
          verb: 'record',
          what: '1 decision, yours',
          note: 'agents may accept what you choose',
        },
      ]
    : [
        {
          section: 'repository',
          verb: 'record',
          what: '1 decision, yours',
          note: 'every decision waits for you',
        },
        {
          section: 'repository',
          verb: 'record',
          what: 'agent-accepts, off',
          note: 'an agent’s accept is refused here',
        },
      ];
}

/**
 * The three settings of the clone's own git configuration, as rows, when the answer is yes. They go in the
 * machine's section: `.git/config` is not committed, so it is on this clone alone, and the autoStash line says
 * what it reaches beyond the record.
 */
function pullRows(answers: Answers): readonly PlanRow[] {
  if (answers.pull !== 'yes') return [];
  return [
    {
      section: 'machine',
      verb: 'set',
      what: 'merge.mnema-tail.driver',
      note: 'in .git/config: mnema, by its full path here',
    },
    {
      section: 'machine',
      verb: 'set',
      what: 'merge.autoStash',
      note: 'in .git/config: true',
    },
    {
      section: 'machine',
      verb: 'set',
      what: 'rebase.autoStash',
      note: 'in .git/config: true',
      more: ['(a pull then stashes any file with uncommitted changes, not only the record)'],
    },
  ];
}

/**
 * The rows for the files of the instructions the marks ask for: what is made first, then what is added to,
 * then what is left. Read by the plan, and by the line that stays under the hosts once they are answered, so
 * the two cannot count different files.
 */
export function instructionRows(
  around: Pick<Around, 'files'>,
  marks: ReadonlySet<string>,
): readonly PlanRow[] {
  // A file that is there and cannot be written is said whether or not a mark asks for it: it is what the founding leaves.
  const refused = [...around.files.values()]
    .filter((peek) => peek.exists && peek.unwritable !== undefined)
    .map((peek) => peek.path);
  const wanted = [...ownFilesOf(marks), ...yoursOf(marks), ...refused];
  const rows = HOST_ROWS.flatMap((row) => [...row.files, ...row.yours])
    .filter((path) => wanted.includes(path))
    .flatMap((path) => {
      const peek = around.files.get(path);
      return peek === undefined ? [] : [rowForAFile(peek)];
    });
  return [...rows].sort((a, b) => ORDER.indexOf(a.verb) - ORDER.indexOf(b.verb));
}

/**
 * The rows of the plan, in the order they are read: the record, the formatter's ignore file, the files
 * of the instructions (what is made before what is added to), the facts recorded, and then what this
 * machine does outside the repository.
 */
export function planOf(
  cwd: string,
  around: Around,
  answers: Answers,
  machine: Machine,
): readonly PlanRow[] {
  const rows: PlanRow[] = [
    {
      section: 'repository',
      verb: 'create',
      what: `${PROJECT_DIR}/`,
      note: 'the record, signed; with README.md,',
      more: ['.gitattributes, .gitignore and more'],
    },
  ];
  if (around.prettierIgnore !== undefined) {
    rows.push({
      section: 'repository',
      verb: around.prettierIgnore.did === 'created' ? 'create' : 'add to',
      what: fromTheFolder(cwd, around.prettierIgnore.path),
      note: 'keeps a formatter off .mnema/',
    });
  }
  rows.push(...instructionRows(around, answers.marks), ...decisionRows(answers));
  const identity: PlanRow = machine.newIdentity
    ? {
        section: 'machine',
        verb: 'create',
        what: machine.where,
        note: 'your signing key and a backup key',
        more: ['(new: first project on this machine)'],
      }
    : {
        section: 'machine',
        verb: 'use',
        what: machine.where,
        note: 'the key this machine already has signs this record',
      };
  rows.push(identity, ...pullRows(answers));
  return rows;
}
