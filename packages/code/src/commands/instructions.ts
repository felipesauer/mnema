/**
 * `mnema instructions`: put the block of standing instructions in the files an agent host reads,
 * check it, or take it out (ADR-46). `mnema init` calls {@link writeInstructions} when it founds a
 * project; this is the door for a project founded before, or for the person who wants it gone.
 *
 * IT TOUCHES ONLY WHAT IT WROTE. In a file of the person's (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`)
 * the block goes after what the file holds, separated by one newline, and everything outside the
 * markers is left byte for byte; taking it out takes that newline with it, so the file is what it
 * was before, and a file this command created is deleted. A block is replaced only where the text
 * between its markers is byte for byte one this product wrote (`KNOWN_BODIES`) or the alpha's
 * `MNEMA:START` block, whose text named tools that no longer exist; any other text is somebody's
 * edit, and it is refused and said, never overwritten.
 *
 * THE STATE OF A FILE IS READ JUST BEFORE IT IS WRITTEN, so a `CLAUDE.md` that is a link to the
 * `AGENTS.md` written a moment earlier is found holding the block and left alone.
 */

import { existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  BEGIN_LINE,
  beginMarker,
  INSTRUCTIONS_BLOCK,
  INSTRUCTIONS_END,
  INSTRUCTIONS_TARGETS,
  INSTRUCTIONS_VERSION,
  type InstructionsTarget,
  KNOWN_BODIES,
  LEGACY_BEGIN,
  LEGACY_END,
} from '../instructions-block.js';

/** What a file holds of the block, read without writing. */
export type InstructionsState =
  /** This version's block, byte for byte. */
  | { readonly state: 'current' }
  /** An earlier version's block, byte for byte: replaced by a write. */
  | { readonly state: 'outdated' }
  /** The alpha's `MNEMA:START` block: replaced by a write. */
  | { readonly state: 'legacy' }
  /** No block, in a file that exists or one that is always written and is not there. */
  | { readonly state: 'missing'; readonly exists: boolean }
  /** Somebody's text where the block is, or a block this version cannot read: never written over. */
  | { readonly state: 'edited'; readonly why: string };

/** What a write or a removal did to one file. */
export type InstructionsChange =
  | 'created'
  | 'added'
  | 'replaced'
  | 'replaced-legacy'
  | 'unchanged'
  | 'removed'
  | 'deleted'
  | 'refused';

/** One file, as the command found it or left it. */
export interface InstructionsFile {
  /** The file's path from the project's root, with `/`. */
  readonly path: string;
  readonly found: InstructionsState;
  /** What was done; absent on a check. */
  readonly did?: InstructionsChange;
}

/** Where a block sits in a file: from its begin line to after its end line. */
interface Span {
  readonly start: number;
  readonly end: number;
}

type Located =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'block';
      readonly span: Span;
      readonly version: string;
      readonly inner: string;
    }
  | { readonly kind: 'legacy'; readonly span: Span }
  | { readonly kind: 'broken'; readonly why: string };

/** The line `line` on a line of its own at or after `from`, as the index it starts at and the one after it. */
function lineAt(text: string, line: string, from: number): Span | undefined {
  for (let at = text.indexOf(line, from); at !== -1; at = text.indexOf(line, at + 1)) {
    const opens = at === 0 || text[at - 1] === '\n';
    const after = at + line.length;
    const closes = after === text.length || text[after] === '\n';
    if (opens && closes) return { start: at, end: after };
  }
  return undefined;
}

/** Past the newline that ends the line ending at `end`, where there is one. */
function pastTheNewline(text: string, end: number): number {
  return text[end] === '\n' ? end + 1 : end;
}

function locate(text: string): Located {
  const begins = [...text.matchAll(BEGIN_LINE)];
  if (begins.length > 1) return { kind: 'broken', why: 'it holds more than one mnema block' };
  const begin = begins[0];
  if (begin !== undefined) {
    const start = begin.index;
    const close = lineAt(text, INSTRUCTIONS_END, start + begin[0].length);
    if (close === undefined) {
      return { kind: 'broken', why: 'it holds a mnema begin marker with no end marker after it' };
    }
    return {
      kind: 'block',
      span: { start, end: pastTheNewline(text, close.end) },
      version: begin[1] as string,
      inner: text.slice(pastTheNewline(text, start + begin[0].length), close.start),
    };
  }
  const legacy = lineAt(text, LEGACY_BEGIN, 0);
  if (legacy !== undefined) {
    const close = lineAt(text, LEGACY_END, legacy.end);
    if (close !== undefined) {
      return {
        kind: 'legacy',
        span: { start: legacy.start, end: pastTheNewline(text, close.end) },
      };
    }
  }
  return { kind: 'none' };
}

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
    if (text === ownText(own, INSTRUCTIONS_VERSION)) return { state: 'current' };
    if (Object.keys(KNOWN_BODIES).some((version) => text === ownText(own, version))) {
      return { state: 'outdated' };
    }
    return {
      state: 'edited',
      why: 'it is a file of mnema’s own and its text is not one mnema wrote, so it is somebody’s edit',
    };
  }
  const found = locate(text);
  switch (found.kind) {
    case 'none':
      return { state: 'missing', exists: true };
    case 'legacy':
      return { state: 'legacy' };
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
      if (found.inner !== known) return { state: 'edited', why: EDITED };
      return found.version === INSTRUCTIONS_VERSION ? { state: 'current' } : { state: 'outdated' };
    }
  }
}

function read(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** The targets this project has: every `always` one, and an `exists` one where the file is there. */
function targetsOf(project: string): readonly InstructionsTarget[] {
  return INSTRUCTIONS_TARGETS.filter(
    (target) => target.when === 'always' || existsSync(join(project, target.path)),
  );
}

/** What each instructions file of the project at `project` holds of the block. Reads only. */
export function checkInstructions(project: string): readonly InstructionsFile[] {
  return targetsOf(project).map((target) => ({
    path: target.path,
    found: stateOf(target, read(join(project, target.path))),
  }));
}

/** Whether every instructions file of the project holds this version's block. */
export function instructionsAreCurrent(files: readonly InstructionsFile[]): boolean {
  return files.every((file) => file.found.state === 'current');
}

function writeOne(project: string, target: InstructionsTarget): InstructionsFile {
  const path = join(project, target.path);
  const text = read(path);
  const found = stateOf(target, text);
  const done = (did: InstructionsChange): InstructionsFile => ({ path: target.path, found, did });
  if (found.state === 'current') return done('unchanged');
  if (found.state === 'edited') return done('refused');
  const whole =
    target.own !== undefined ? (ownText(target.own, INSTRUCTIONS_VERSION) as string) : undefined;
  if (text === undefined) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, whole ?? INSTRUCTIONS_BLOCK, 'utf-8');
    return done('created');
  }
  if (whole !== undefined) {
    writeFileSync(path, whole, 'utf-8');
    return done('replaced');
  }
  const located = locate(text);
  if (located.kind === 'block' || located.kind === 'legacy') {
    const { start, end } = located.span;
    writeFileSync(path, `${text.slice(0, start)}${INSTRUCTIONS_BLOCK}${text.slice(end)}`, 'utf-8');
    return done(located.kind === 'legacy' ? 'replaced-legacy' : 'replaced');
  }
  // One newline before the block, always, so taking it out restores the file byte for byte.
  writeFileSync(path, `${text}\n${INSTRUCTIONS_BLOCK}`, 'utf-8');
  return done('added');
}

/**
 * Writes this version's block into every instructions file of the project at `project`: creates
 * the ones always written that are not there, adds the block to a file of the person's that has
 * none, replaces a block this product wrote, and refuses a block somebody edited.
 */
export function writeInstructions(project: string): readonly InstructionsFile[] {
  return targetsOf(project).map((target) => writeOne(project, target));
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

function removeOne(project: string, target: InstructionsTarget): InstructionsFile {
  const path = join(project, target.path);
  const text = read(path);
  const found = stateOf(target, text);
  const done = (did: InstructionsChange): InstructionsFile => ({ path: target.path, found, did });
  if (text === undefined || found.state === 'missing') return done('unchanged');
  if (found.state === 'edited') return done('refused');
  if (target.own !== undefined) {
    unlinkSync(path);
    removeEmptyDirectories(dirname(path), project);
    return done('deleted');
  }
  const located = locate(text);
  if (located.kind !== 'block' && located.kind !== 'legacy') return done('unchanged');
  const { end } = located.span;
  const start =
    located.span.start > 0 && text[located.span.start - 1] === '\n'
      ? located.span.start - 1
      : located.span.start;
  const left = `${text.slice(0, start)}${text.slice(end)}`;
  if (left === '' && located.span.start === 0) {
    unlinkSync(path);
    return done('deleted');
  }
  writeFileSync(path, left, 'utf-8');
  return done('removed');
}

/**
 * Takes the block out of every instructions file of the project at `project`: the file is left as
 * it was before the block went in, and one the block was all of is deleted. A block somebody
 * edited is refused: taking it out would take their words with it.
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
    case 'legacy':
      return `${file.path} holds the block an earlier mnema wrote (MNEMA:START), which names tools that no longer exist: \`mnema instructions\` replaces it.`;
    case 'missing':
      return found.exists
        ? `${file.path} holds no mnema instructions: \`mnema instructions\` adds them after what it holds.`
        : `${file.path} does not exist: \`mnema instructions\` creates it with the mnema instructions.`;
    case 'edited':
      return `${file.path}: ${found.why}, and \`mnema instructions\` leaves it as it is.`;
  }
}

/** The sentence a write or a removal says about one file. */
export function changeLine(file: InstructionsFile): string {
  switch (file.did) {
    case 'created':
      return `Created ${file.path}, with the mnema instructions.`;
    case 'added':
      return `Added the mnema instructions to ${file.path}, after what it holds.`;
    case 'replaced':
      return `Replaced the mnema instructions in ${file.path} with this version’s.`;
    case 'replaced-legacy':
      return `Replaced the block an earlier mnema wrote in ${file.path} (MNEMA:START) with this version’s instructions.`;
    case 'removed':
      return `Took the mnema instructions out of ${file.path}: the rest of it is as it was.`;
    case 'deleted':
      return `Deleted ${file.path}: it held the mnema instructions and nothing else.`;
    case 'refused':
      return `Left ${file.path} as it is: ${file.found.state === 'edited' ? file.found.why : 'it was not read'}. Put back the text mnema wrote, or take the block out by hand.`;
    default:
      if (file.found.state === 'missing') {
        return file.found.exists
          ? `${file.path} holds no mnema instructions.`
          : `${file.path} does not exist.`;
      }
      return stateLine(file);
  }
}
