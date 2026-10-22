/**
 * What `mnema workspace init` leaves in `.mnema/workbench/`: the notes of the people working on
 * the project, beside the record and not part of it (`FORMAT.md` section 4). Every file here is a
 * shape for a person or an agent to copy; none is read by a verifier, and none is overwritten once
 * somebody has edited it.
 */

/** A file of the workbench: its path under `.mnema/workbench/`, and the bytes it starts with. */
export interface WorkbenchFile {
  readonly path: string;
  readonly text: string;
}

const README = [
  '# workbench',
  '',
  'Notes of the people working on this project, kept beside the record and not part of it.',
  'Nothing here is proof: `mnema verify` does not read this folder, a note is not a decision,',
  'and a line written here is not signed by anybody.',
  '',
  '## The two roots',
  '',
  '- `shared/` is committed: what the team reads. Put in it only what you mean to share.',
  "- `local` is a link to a folder in this repository's git directory: this machine only, never",
  '  committed, the same folder from every worktree of the clone, and kept when a worktree is',
  '  removed. `git clean -x` removes the link and nothing it points to; to make the link again',
  '  run `mnema doctor --fix workbench`.',
  '',
  'Under either root:',
  '',
  '- `changes/<yyyy-mm-dd>-<slug>/` is one change, and the folder never moves. Its `change.md`',
  '  carries the status in its front matter; `log.md` is append-only; `briefs/` holds the',
  '  instructions handed to others, and `evidence/` what a claim rests on.',
  '- `studies/<slug>.md` is a question and what was found, with what would overturn it.',
  '- `templates/` has the shape of each of these. Copy one; edit the copy.',
  '',
  '## Opening a session',
  '',
  '1. Read every `change.md` whose status is `open`.',
  '2. Read the last line of the `log.md` beside each: it says what was done and what is next.',
  '3. Work. Add a line to the `log.md` when something happens that the next session needs.',
  '',
  '## Decisions',
  '',
  'A decision goes to the record the moment it is made (the `record_decision` tool of mnema).',
  'A note here cites its id and never restates it: the record is the one place a decision can be',
  'checked, and a second copy can only drift from it.',
  '',
].join('\n');

const CHANGE = [
  '---',
  'status: proposed # proposed | open | paused | done | dropped',
  'opened: YYYY-MM-DD',
  'closed:',
  'claimed_by:',
  'part_of:',
  'base:',
  'decisions: [] # mnema ids',
  'delivered:',
  '---',
  '',
  '# <what changes>',
  '',
  '## Why',
  '',
  '## Scope',
  '',
  '## Out of scope / Stop',
  '',
  '## Plan',
  '',
  '## Tasks',
  '',
  '- [ ] ',
  '',
  '## Done when',
  '',
].join('\n');

const BRIEF = [
  '---',
  'change: <folder of the change>',
  'n: 1',
  'to:',
  'sent:',
  '---',
  '',
  '# <what is handed over>',
  '',
  '## Read first',
  '',
  '## Settled (mnema ids; do not reopen)',
  '',
  '## Build',
  '',
  '## Stop',
  '',
  '## Report',
  '',
].join('\n');

const STUDY = [
  '---',
  'status: open # open | settled | dropped',
  'base:',
  'question:',
  '---',
  '',
  '# <the question>',
  '',
  '## Conclusion',
  '',
  '## Evidence',
  '',
  '## What would overturn it',
  '',
  '## Not examined',
  '',
  '## Decisions it produced (ids)',
  '',
].join('\n');

const LOG = [
  '# One line per entry, appended and never edited. Format:',
  '# YYYY-MM-DD HH:MM · who · what · next',
  '',
].join('\n');

/** The files a workbench starts with, in the order they are made. */
export const WORKBENCH_FILES: readonly WorkbenchFile[] = [
  { path: 'README.md', text: README },
  { path: 'templates/change.md', text: CHANGE },
  { path: 'templates/brief.md', text: BRIEF },
  { path: 'templates/study.md', text: STUDY },
  { path: 'templates/log.md', text: LOG },
  { path: 'shared/.gitkeep', text: '' },
];

/** The folders the private half starts with, under the folder `local` links to. */
export const LOCAL_FOLDERS: readonly string[] = ['changes', 'studies'];
