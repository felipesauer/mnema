/**
 * WHAT `mnema init` SAYS ONCE IT HAS FOUNDED: the list of what was done, and the summary with what comes next.
 *
 * BOTH ARE PRINTED, never drawn: they are the lines a person scrolls back to, and a page of rows the layout
 * library owned would be gone with the screen. They are the same `Line`s the questions are, so the colour is
 * the one renderer's and the fold is its own.
 *
 * THE BACKUP KEY COMES FIRST AMONG THE NEXT STEPS, because it is the only one that can lose something: a key
 * that is not moved off this machine is lost with it, and mnema has no central recovery (an entity able to
 * restore an identity is an entity able to forge one). It is said only on the run that made the key, as the
 * warning always was: said on every run it is a sentence a person learns to scroll past. The identity is
 * shown short and, beneath it, whole on a line of its own, because the whole of it is what a person pastes
 * into a command and what a line that folds mid-value cannot give them. The backup key's file is said as
 * its folder and its name on two rows for the same reason: each stays whole.
 *
 * WHAT IS SAID ABOUT THE HOSTS IS THE TABLE'S (`host-names.ts`): the commands of a host are the ones the
 * install page's table carries for it, so a command is never a second copy that can fall behind the page
 * (`the-install-line-of-a-host-is-what-its-section-says.test.ts` holds the table to `docs/hosts.md`).
 */

import { basename, dirname } from 'node:path';
import type { MergeDriverFixed } from '../commands/doctor-merge-driver.js';
import type { InitResult } from '../commands/init.js';
import { changeLine, type InstructionsFile } from '../commands/instructions.js';
import { HOSTS } from '../host-names.js';
import type { Line } from '../presentation/line.js';
import { widthOfText } from '../presentation/width.js';
import { STARTS_OFF } from '../record-framing.js';
import { onOneLine } from '../wiring/on-one-line.js';
import type { WhoMayAcceptRecorded } from './accepts.js';
import { fromTheFolder } from './detect.js';
import { HOST_ROWS, hostMark } from './hosts.js';
import { noted, paragraph } from './layout.js';
import type { Answers } from './plan.js';
import { bold, DONE, dim, END, heading, plain, theGuide, trail } from './screens.js';

/** Everything the two pages are made from. */
export interface Founded {
  readonly cwd: string;
  /** The result of a founding (`created` is true). */
  readonly result: InitResult;
  readonly answers: Answers;
  /** What recording the answer about agents accepting came to, when it was recorded. */
  readonly recorded?: WhoMayAcceptRecorded;
  /** What setting up a plain `git pull` came to, when it was asked for (`doctor-merge-driver.ts`). */
  readonly pulled?: MergeDriverFixed;
  /** A path as a person is told it: the home as `~`. */
  readonly shown: (path: string) => string;
}

/** What the founding did to one file, as a row: the word, the path, and a few words more. */
function didToAFile(file: InstructionsFile, width: number): readonly Line[] {
  const said = (word: string, note?: string): readonly Line[] =>
    noted(
      trail,
      [plain(`  ${word}   ${file.path}`)],
      note === undefined ? undefined : dim(note),
      width,
      9,
    );
  switch (file.did) {
    case 'created':
      return said('done');
    case 'added':
      return said('done', 'block added');
    case 'replaced':
      return said('done', 'block replaced');
    case 'unchanged':
      return said('kept', 'already holds the block');
    default:
      return paragraph(trail, changeLine(file), width, '  left   ');
  }
}

/** The order the rows of the files are said in: what was made, then what was added to, then the rest. */
const DID_ORDER: readonly (InstructionsFile['did'] | undefined)[] = [
  'created',
  'replaced',
  'added',
  'unchanged',
  'refused',
  'failed',
];

/** The list of what the founding did, once it has done it. */
export function foundingPage(founded: Founded, width: number): readonly Line[] {
  const { result, recorded, pulled } = founded;
  const around = result.around;
  const rows: Line[] = [
    heading(DONE, 'Founding'),
    trail(plain('  done   .mnema/ and the identity')),
  ];
  if (around?.prettierIgnore !== undefined) {
    rows.push(
      ...noted(
        trail,
        [plain(`  done   ${fromTheFolder(founded.cwd, around.prettierIgnore.path)}`)],
        dim(around.prettierIgnore.did === 'created' ? 'created' : 'the line added'),
        width,
        9,
      ),
    );
  }
  const files = [...(around?.instructions ?? [])]
    .filter((file) => file.did !== undefined)
    .sort((a, b) => DID_ORDER.indexOf(a.did) - DID_ORDER.indexOf(b.did));
  for (const file of files) rows.push(...didToAFile(file, width));
  if (recorded !== undefined) {
    rows.push(
      ...paragraph(
        trail,
        recorded.as === 'accepted'
          ? `${recorded.adr}, recorded and accepted as yours`
          : `${recorded.adr}, recorded as the agent’s proposal: it waits for you`,
        width,
        '  done   ',
      ),
    );
    if (recorded.switchedOff) rows.push(trail(plain('  done   the switch agent-accepts, off')));
  }
  if (pulled !== undefined) {
    rows.push(
      ...paragraph(
        trail,
        pulled.refused
          ? `git’s configuration was left as it is: ${pulled.lines.join(' ')}`
          : 'the merge driver, merge.autoStash and rebase.autoStash are in .git/config: a plain `git pull` carries the record',
        width,
        pulled.refused ? '  ' : '  done   ',
      ),
    );
  }
  if (files.some((file) => ['created', 'added', 'replaced'].includes(file.did as string))) {
    rows.push(
      ...paragraph(
        trail,
        '`mnema instructions --remove` takes the block out of each file again.',
        width,
        '  ',
        'id',
      ),
    );
  }
  rows.push(theGuide);
  return rows;
}

/** What each row is called where a host has a command to run. */
const NAMED: { readonly [id in (typeof HOST_ROWS)[number]['id']]: string } = {
  claude: 'Claude Code',
  cursor: 'Cursor',
  vscode: 'VS Code',
  codex: 'Codex',
};

/** One next step: what it says, and the commands under it, each to be typed back whole. */
interface NextStep {
  readonly says: string;
  readonly commands: readonly string[];
}

/**
 * What a host needs, as `docs/hosts.md` says it for that host. Cursor's command-line agent and VS Code's agent
 * read the plugin Claude Code installs (the server is the same `mnema mcp`), so each says that, with the
 * Claude Code commands under it where Claude Code was not among the hosts chosen, and VS Code the one more
 * command its settings need. The Claude Code and Codex steps are the table's own commands.
 */
function hostStep(id: (typeof HOST_ROWS)[number]['id'], claudeIsChosen: boolean): NextStep {
  const install = HOSTS[id].install;
  if ('commands' in install) return { says: `${NAMED[id]}:`, commands: install.commands };
  const claude = HOSTS.claude.install;
  const plugin = 'commands' in claude && !claudeIsChosen ? claude.commands : [];
  if (id === 'vscode') {
    return {
      says: 'VS Code: its agent reads the Claude Code plugin, whose server is `mnema mcp`; install it, then:',
      commands: [...plugin, 'mnema doctor --fix vscode'],
    };
  }
  return {
    says: 'Cursor: its command-line agent picks up the Claude Code plugin installed on this machine, whose server is `mnema mcp`.',
    commands: plugin,
  };
}

/** The next steps, in the order they are numbered. */
function nextSteps(founded: Founded): readonly NextStep[] {
  const { result, answers } = founded;
  const around = result.around;
  const steps: NextStep[] = [];
  if (around?.gitRoot !== undefined) {
    steps.push({
      says: 'Commit `.mnema/` with the repository; every clone reads the record.',
      commands: [],
    });
    if (around.foundedBelowTheRoot) {
      steps.push({
        says: onOneLine`This is not the root of the git repository (${around.gitRoot}). A session opened at that root climbs from there and will not find a project founded below it: run \`mnema init\` there instead, unless the project is meant to live here.`,
        commands: [],
      });
    }
  }
  if (around?.biomeLine !== undefined) steps.push({ says: around.biomeLine, commands: [] });
  for (const row of HOST_ROWS) {
    if (!answers.marks.has(hostMark(row.id))) continue;
    steps.push(hostStep(row.id, answers.marks.has(hostMark('claude'))));
  }
  for (const base of around?.neverImported ?? []) {
    steps.push({
      says: onOneLine`${String(base.documents)} decision file${base.documents === 1 ? '' : 's'} in ${base.directory} ${base.documents === 1 ? 'is' : 'are'} not in the record yet:`,
      commands: [`mnema decision import ${base.directory}`],
    });
  }
  if (answers.accepts === undefined) {
    steps.push({
      says: 'Whether an agent may accept what you choose was not asked: it may, and `mnema switch off agent-accepts` says it may not.',
      commands: [],
    });
  }
  steps.push({ says: '`mnema status` shows where things stand.', commands: [] });
  return steps;
}

/** A step as rows: its words wrapped, and its commands whole, beside the words where they fit and under them where not. */
function stepRows(step: NextStep, at: number, width: number): readonly Line[] {
  const lead = `  ${at + 1}  `;
  const [first, ...rest] = step.commands;
  if (first !== undefined && widthOfText(`${lead}${step.says} ${first}`) + 3 <= width) {
    return [
      trail(plain(`${lead}${step.says} ${first}`)),
      ...rest.map((each) =>
        trail(plain(`${' '.repeat(lead.length)}${' '.repeat(step.says.length + 1)}${each}`)),
      ),
    ];
  }
  return [
    ...paragraph(trail, step.says, width, lead),
    ...step.commands.map((each) => trail(plain(`${' '.repeat(lead.length)}${each}`))),
  ];
}

/** The summary: who this is, the backup key, and what to do next. */
export function summaryPage(founded: Founded, width: number): readonly Line[] {
  const { result } = founded;
  const identity = result.identity;
  const short = (value: string, keep: number): string => value.slice(0, keep);
  const lines: Line[] = [
    heading(DONE, `Founded ${basename(founded.cwd)}/.mnema`),
    theGuide,
    ...noted(
      trail,
      [plain(`identity  ${short(result.anchor, 'mnid:'.length + 8)}`)],
      dim(
        identity?.backup?.created === true
          ? 'this machine’s, new; shown short'
          : 'this machine’s; shown short',
      ),
      width,
      2,
    ),
    // The whole of it, on a row of its own and never wrapped: it is what a person pastes into a command.
    trail(plain(`  ${result.anchor}`)),
  ];
  const backup = identity?.backup;
  if (backup !== undefined && backup !== null) {
    lines.push(
      trail(
        plain(`backup key  ${short(backup.fingerprint, 8)}`),
        dim(
          identity?.enrolled.includes(backup.fingerprint) === true
            ? 'enrolled in this project'
            : 'not enrolled in this project',
        ),
      ),
    );
  }
  for (const key of identity?.enrolled ?? []) {
    if (key === backup?.fingerprint) continue;
    lines.push(trail(plain(`key ${short(key, 8)}`), dim('enrolled in this project')));
  }
  for (const declined of identity?.declined ?? []) {
    lines.push(
      trail(plain(`key ${short(declined.fingerprint, 8)} was NOT enrolled: ${declined.reason}`)),
    );
  }
  lines.push(theGuide);
  if (backup?.created === true) {
    lines.push(
      trail(bold('  Move the backup key off this machine')),
      trail(plain(`  ${founded.shown(dirname(backup.privateKeyPath))}/`)),
      trail(plain(`  ${basename(backup.privateKeyPath)}`)),
      ...paragraph(
        trail,
        'mnema has no central recovery: a backup left on this disk is lost with it.',
        width,
        '  ',
      ),
      theGuide,
    );
  }
  lines.push(trail(bold('  Then')));
  for (const [at, step] of nextSteps(founded).entries()) {
    // A command is never wrapped: what is typed back is the whole of it, on a row of its own.
    lines.push(...stepRows(step, at, width));
  }
  lines.push(
    theGuide,
    { indent: 0, parts: [plain(END), plain(`Off until switched on: ${STARTS_OFF.join(', ')}.`)] },
    { indent: 0, parts: [plain('   `mnema switch` lists every channel and turns one on.')] },
  );
  return lines;
}
