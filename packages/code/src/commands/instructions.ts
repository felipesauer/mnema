/**
 * `mnema instructions`: put the block of standing instructions in the files an agent host reads,
 * check it, or take it out (ADR-46). `mnema init` calls {@link writeInstructions} when it founds a
 * project; this is the door for a project founded before, or for the person who wants it gone.
 *
 * IT TOUCHES ONLY WHAT IT WROTE. In a file of the person's (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`)
 * the block goes after what the file holds, separated by one line break, and everything outside
 * the markers is left byte for byte. Taking it out takes that line break with it only when the
 * block is the last thing in the file, so the person's last line is never glued to what follows;
 * the line says the rest is as it was only when putting the block back would give the file it
 * finds. A file this command created is deleted. A block is replaced only where the text between
 * its markers is one this product wrote (`KNOWN_BODIES`, compared with the line endings
 * normalized, so a checkout that turned them into CRLF still holds the current block, and a
 * rewrite keeps the file's line endings); any other text is somebody's edit, and it is refused
 * and said, never overwritten. The markers an earlier, alpha mnema wrote (`MNEMA:START` and
 * `MNEMA:END`) are not recognized: such a block is the file's own text, kept byte for byte, and
 * the block goes beside it. Markers inside a fenced code block are an example, not a block.
 *
 * IT WRITES NOTHING OUTSIDE THE PROJECT, AND NO ONE FILE BRINGS IT DOWN. A file that is a symbolic
 * link is followed when it resolves inside the project and refused, with where it goes, when it
 * resolves outside or to nothing; a file that cannot be read or written (a directory, a read-only
 * file, a path through a file) is reported with its reason and the command to try again, and the
 * other files are still handled.
 *
 * THE STATE OF A FILE IS READ JUST BEFORE IT IS WRITTEN, so a `CLAUDE.md` that is a link to the
 * `AGENTS.md` written a moment earlier is found holding the block and left alone.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, sep } from 'node:path';
import {
  beginMarker,
  CHOOSABLE_INSTRUCTIONS,
  INSTRUCTIONS_BLOCK,
  INSTRUCTIONS_END,
  INSTRUCTIONS_TARGETS,
  INSTRUCTIONS_VERSION,
  type InstructionsTarget,
  KNOWN_BODIES,
  type Located,
  locateBlock,
  sameInstructionsText,
} from '../instructions-block.js';

/** What a file holds of the block, read without writing. */
export type InstructionsState =
  /** This version's block, byte for byte (line endings aside). */
  | { readonly state: 'current' }
  /** An earlier version's block, byte for byte: replaced by a write. */
  | { readonly state: 'outdated' }
  /** No block, in a file that exists or one that is always written and is not there. */
  | { readonly state: 'missing'; readonly exists: boolean }
  /** Somebody's text where the block is, or a block this version cannot read: never written over. */
  | { readonly state: 'edited'; readonly why: string }
  /** A file that cannot be read, or a link that leaves the project or leads nowhere: never written through. */
  | { readonly state: 'blocked'; readonly why: string };

/** What a write or a removal did to one file. */
export type InstructionsChange =
  | 'created'
  | 'added'
  | 'replaced'
  | 'unchanged'
  | 'removed'
  | 'deleted'
  | 'refused'
  | 'failed';

/** One file, as the command found it or left it. */
export interface InstructionsFile {
  /** The file's path from the project's root, with `/`. */
  readonly path: string;
  readonly found: InstructionsState;
  /** What was done; absent on a check. */
  readonly did?: InstructionsChange;
  /** For `failed`: why the file system said no, in words. */
  readonly error?: string;
  /** For a removal: whether putting the block back would give the file back as it is now. */
  readonly asItWas?: boolean;
  /** For `refused` and `failed`: the command that tries again. */
  readonly again?: string;
}

type Eol = '\n' | '\r\n';

/** The line ending the file uses: that of its first line break. */
function eolOf(text: string): Eol {
  const newline = text.indexOf('\n');
  return newline > 0 && text[newline - 1] === '\r' ? '\r\n' : '\n';
}

const lf = (text: string): string => text.replace(/\r\n/g, '\n');
const inEol = (text: string, eol: Eol): string => (eol === '\n' ? text : text.replace(/\n/g, eol));

/** The whole text of a file wholly mnema's, at a known version. */
function ownText(own: string, version: string): string | undefined {
  const body = KNOWN_BODIES[version];
  return body === undefined
    ? undefined
    : `${own}${beginMarker(version)}\n${body}${INSTRUCTIONS_END}\n`;
}

const EDITED =
  'the text between its mnema markers is not one mnema wrote, so it is somebody’s edit';

function stateOf(target: InstructionsTarget, text: string | undefined): InstructionsState {
  if (text === undefined) return { state: 'missing', exists: false };
  if (target.own !== undefined) {
    const own = target.own;
    const held = lf(text);
    if (sameInstructionsText(held, ownText(own, INSTRUCTIONS_VERSION) as string)) {
      return { state: 'current' };
    }
    if (
      Object.keys(KNOWN_BODIES).some((version) =>
        sameInstructionsText(held, ownText(own, version) as string),
      )
    ) {
      return { state: 'outdated' };
    }
    return {
      state: 'edited',
      why: 'it is a file of mnema’s own and its text is not one mnema wrote, so it is somebody’s edit',
    };
  }
  const found = locateBlock(text);
  switch (found.kind) {
    case 'none':
      return { state: 'missing', exists: true };
    case 'broken':
      return { state: 'edited', why: found.why };
    case 'block': {
      const known = KNOWN_BODIES[found.version];
      if (known === undefined) {
        return {
          state: 'edited',
          why: `its block is version ${found.version}, which this version of mnema does not know`,
        };
      }
      if (!sameInstructionsText(found.inner, known)) return { state: 'edited', why: EDITED };
      return found.version === INSTRUCTIONS_VERSION ? { state: 'current' } : { state: 'outdated' };
    }
  }
}

/** What the file system said, in words a person can act on. */
function reasonOf(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code;
  switch (code) {
    case 'EISDIR':
      return 'it is a directory, not a file';
    case 'EACCES':
    case 'EPERM':
      return 'permission denied';
    case 'ENOTDIR':
    case 'EEXIST':
      return 'a part of its path is a file, not a directory';
    case 'EROFS':
      return 'the file system is read-only';
    case 'ELOOP':
      return 'its path loops through symbolic links';
    case 'ENOSPC':
      return 'there is no space left on the device';
    default:
      return `the file system refused it (${code ?? 'unknown error'})`;
  }
}

function existsAsALink(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Why a path may not be written through: it goes outside the project, or to nothing. */
function linkRefusal(project: string, relative: string): string | undefined {
  const path = join(project, relative);
  const root = existsSync(project) ? realpathSync(project) : project;
  const within = (real: string): boolean => real === root || real.startsWith(`${root}${sep}`);
  try {
    const real = realpathSync(path);
    return within(real) ? undefined : `it resolves to ${real}, outside this project`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return undefined;
  }
  if (existsAsALink(path)) {
    return `it is a symbolic link to ${readlinkSync(path)}, which does not exist`;
  }
  let dir = dirname(path);
  while (!existsAsALink(dir) && dir !== dirname(dir)) dir = dirname(dir);
  try {
    const real = realpathSync(dir);
    return within(real) ? undefined : `its directory resolves to ${real}, outside this project`;
  } catch {
    return `${dir} is a symbolic link to nothing`;
  }
}

/** Reads the file at `path`; absent text is a file that is not there. */
function read(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** What a file holds of the block, and its text: a refusal to read it is a state, not an error. */
function inspect(
  project: string,
  target: InstructionsTarget,
): { readonly found: InstructionsState; readonly text?: string } {
  const why = linkRefusal(project, target.path);
  if (why !== undefined) return { found: { state: 'blocked', why } };
  try {
    const text = read(join(project, target.path));
    return { found: stateOf(target, text), ...(text !== undefined ? { text } : {}) };
  } catch (error) {
    return { found: { state: 'blocked', why: `it could not be read: ${reasonOf(error)}` } };
  }
}

/**
 * Whether the person has CHOSEN this file: it holds the mnema instructions, or is a file of mnema's own
 * that is there. A person's file that exists with no block (an `AGENTS.md` they wrote) was not chosen:
 * it is theirs, and nothing of ours is in it.
 */
function isChosen(project: string, target: InstructionsTarget): boolean {
  if (!existsAsALink(join(project, target.path))) return false;
  return target.own !== undefined || inspect(project, target).found.state !== 'missing';
}

/** The offered files this project holds: what the files on disk say was chosen. */
export function chosenOnDisk(project: string): readonly string[] {
  return CHOOSABLE_INSTRUCTIONS.filter((target) => isChosen(project, target)).map(
    (target) => target.path,
  );
}

/** The paths of every file `init` offers, in the order it offers them: the choice made without a person to ask. */
export const EVERY_HOST_FILE: readonly string[] = CHOOSABLE_INSTRUCTIONS.map(
  (target) => target.path,
);

/**
 * The targets this project has: the offered files that were chosen (`choice`, or else the ones the files
 * on disk show chosen, or else every one when nothing shows it), and the person's own files
 * (`CLAUDE.md` and its kin) where the file or a link is there.
 */
function targetsOf(project: string, choice?: readonly string[]): readonly InstructionsTarget[] {
  const onDisk = chosenOnDisk(project);
  const chosen = choice ?? (onDisk.length > 0 ? onDisk : EVERY_HOST_FILE);
  return INSTRUCTIONS_TARGETS.filter((target) =>
    target.when === 'always'
      ? chosen.includes(target.path)
      : existsAsALink(join(project, target.path)),
  );
}

/** What each instructions file of the project at `project` holds of the block. Reads only. */
export function checkInstructions(project: string): readonly InstructionsFile[] {
  return targetsOf(project).map((target) => ({
    path: target.path,
    found: inspect(project, target).found,
  }));
}

/** Whether every instructions file of the project holds this version's block. */
export function instructionsAreCurrent(files: readonly InstructionsFile[]): boolean {
  return files.every((file) => file.found.state === 'current');
}

/** `left` with the block after it, as `mnema instructions` adds it to a file of the person's. */
function withTheBlock(left: string, eol: Eol): string {
  return `${left}${eol}${inEol(INSTRUCTIONS_BLOCK, eol)}`;
}

const WRITE_AGAIN = 'mnema instructions';
const REMOVE_AGAIN = 'mnema instructions --remove';

type Done = (did: InstructionsChange, extra?: Partial<InstructionsFile>) => InstructionsFile;

/** Runs `act` on one file; a file system error is that file's `failed`, not the command's. */
function attempt(
  project: string,
  target: InstructionsTarget,
  again: string,
  act: (done: Done, text: string | undefined, path: string) => InstructionsFile,
): InstructionsFile {
  const { found, text } = inspect(project, target);
  const done: Done = (did, extra = {}) => ({ path: target.path, found, did, ...extra });
  if (found.state === 'edited' || found.state === 'blocked') return done('refused', { again });
  try {
    return act(done, text, join(project, target.path));
  } catch (error) {
    return done('failed', { error: reasonOf(error), again });
  }
}

function writeOne(project: string, target: InstructionsTarget): InstructionsFile {
  return attempt(project, target, WRITE_AGAIN, (done, text, path) => {
    if (stateOf(target, text).state === 'current') return done('unchanged');
    const whole =
      target.own !== undefined ? (ownText(target.own, INSTRUCTIONS_VERSION) as string) : undefined;
    if (text === undefined) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, whole ?? INSTRUCTIONS_BLOCK, 'utf-8');
      return done('created');
    }
    const eol = eolOf(text);
    if (whole !== undefined) {
      writeFileSync(path, inEol(whole, eol), 'utf-8');
      return done('replaced');
    }
    const located = locateBlock(text);
    if (located.kind === 'block') {
      const { start, end } = located.span;
      writeFileSync(
        path,
        `${text.slice(0, start)}${inEol(INSTRUCTIONS_BLOCK, eol)}${text.slice(end)}`,
        'utf-8',
      );
      return done('replaced');
    }
    // One line break before the block, always, so that taking it out can give the file back.
    writeFileSync(path, withTheBlock(text, eol), 'utf-8');
    return done('added');
  });
}

/**
 * Writes this version's block into every instructions file of the project at `project`: creates
 * the ones always written that are not there, adds the block to a file of the person's that has
 * none, replaces a block this product wrote, and refuses a block somebody edited. A file that
 * cannot be written is that file's `failed`, and the others are still written.
 */
export function writeInstructions(
  project: string,
  choice?: readonly string[],
): readonly InstructionsFile[] {
  return targetsOf(project, choice).map((target) => writeOne(project, target));
}

/** Removes the directories `from` and above it, up to `project`, while each is empty. */
function removeEmptyDirectories(from: string, project: string): void {
  for (let dir = from; dir !== project && dir.startsWith(project); dir = dirname(dir)) {
    try {
      rmdirSync(dir);
    } catch {
      return;
    }
  }
}

/** Whether `path` is a symbolic link to nothing: there is no block in it to take out. */
function leadsNowhere(path: string): boolean {
  if (!existsAsALink(path)) return false;
  try {
    realpathSync(path);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

function removeOne(project: string, target: InstructionsTarget): InstructionsFile {
  // A link whose target was taken out a moment ago (CLAUDE.md pointing at an AGENTS.md the block
  // founded) holds nothing of ours: it is left as it is, and that is not a refusal.
  if (leadsNowhere(join(project, target.path))) {
    return { path: target.path, found: { state: 'missing', exists: true }, did: 'unchanged' };
  }
  return attempt(project, target, REMOVE_AGAIN, (done, text, path) => {
    if (text === undefined || stateOf(target, text).state === 'missing') return done('unchanged');
    if (target.own !== undefined) {
      unlinkSync(path);
      removeEmptyDirectories(dirname(path), project);
      return done('deleted');
    }
    const located: Located = locateBlock(text);
    if (located.kind !== 'block') return done('unchanged');
    const { start, end } = located.span;
    const before = text.slice(0, start);
    const after = text.slice(end);
    // The line break that went in with the block comes out with it only where nothing follows the
    // block: a line the person wrote after it must not be glued to the one above.
    let cut = start;
    if (after === '') {
      if (before.endsWith('\r\n')) cut -= 2;
      else if (before.endsWith('\n')) cut -= 1;
    }
    const left = `${text.slice(0, cut)}${after}`;
    if (left === '' && start === 0) {
      unlinkSync(path);
      return done('deleted');
    }
    writeFileSync(path, left, 'utf-8');
    return done('removed', { asItWas: withTheBlock(left, eolOf(text)) === text });
  });
}

/**
 * Takes the block out of every instructions file of the project at `project`; one the block was
 * all of is deleted. A block somebody edited is refused: taking it out would take their words
 * with it.
 */
export function removeInstructions(project: string): readonly InstructionsFile[] {
  return targetsOf(project).map((target) => removeOne(project, target));
}

/** The sentence `mnema instructions --check` and `mnema doctor` say about one file. */
export function stateLine(file: InstructionsFile): string {
  const found = file.found;
  switch (found.state) {
    case 'current':
      return `${file.path} holds this version’s mnema instructions.`;
    case 'outdated':
      return `${file.path} holds an earlier version’s mnema instructions: \`mnema instructions\` replaces them.`;
    case 'missing':
      return found.exists
        ? `${file.path} holds no mnema instructions: \`mnema instructions\` adds them after what it holds.`
        : `${file.path} does not exist: \`mnema instructions\` creates it with the mnema instructions.`;
    case 'edited':
    case 'blocked':
      return `${file.path}: ${found.why}, and \`mnema instructions\` leaves it as it is.`;
  }
}

/** The sentence a write or a removal says about one file. */
export function changeLine(file: InstructionsFile): string {
  const again = file.again ?? WRITE_AGAIN;
  switch (file.did) {
    case 'created':
      return `Created ${file.path}, with the mnema instructions.`;
    case 'added':
      return `Added the mnema instructions to ${file.path}, after what it holds.`;
    case 'replaced':
      return `Replaced the mnema instructions in ${file.path} with this version’s.`;
    case 'removed':
      return file.asItWas === true
        ? `Took the mnema instructions out of ${file.path}: the rest of it is as it was before them.`
        : `Took the mnema instructions out of ${file.path}: the lines around them are left as they were.`;
    case 'deleted':
      return `Deleted ${file.path}: it held the mnema instructions and nothing else.`;
    case 'failed':
      return `Did not change ${file.path}: ${file.error ?? 'the file system refused it'}. Once that is fixed, \`${again}\` tries again.`;
    case 'refused':
      return file.found.state === 'blocked'
        ? `Left ${file.path} as it is: ${file.found.why}. Once that is fixed, \`${again}\` tries again.`
        : `Left ${file.path} as it is: ${file.found.state === 'edited' ? file.found.why : 'it was not read'}. Put back the text mnema wrote, or take the block out by hand.`;
    default:
      if (file.found.state === 'missing') {
        return file.found.exists
          ? `${file.path} holds no mnema instructions.`
          : `${file.path} does not exist.`;
      }
      return stateLine(file);
  }
}
