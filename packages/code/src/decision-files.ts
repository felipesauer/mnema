/**
 * Whether a file just written holds decisions, and which door reads it into the record.
 *
 * TWO KINDS OF FILE, TOLD APART BY WHAT SAYS SO. A file under a directory of decision files
 * (`docs/adr/**`, `docs/decisions/**`, any `adr/*.md`) is one by its PATH: that is what those
 * directories are for, and `mnema decision import <directory>` reads them. The files where a
 * project also writes its calls down among other things (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, a
 * host's rules, a plan, a handoff, a ledger) are one only by their CONTENT: what was just written
 * holds a line that opens as a ruling or a decision does (`Ruling:`, `Decision:`, `Decisão:`) or as
 * a correction does (`user-corrections.ts`'s shapes: "never …", "do not …", "use … instead").
 *
 * NEVER ONE OF THE PRODUCT'S OWN: the record (`.mnema/`), `MNEMA.md`, the rules files
 * `mnema rules-file` prints for a host to read, and the files of standing instructions
 * `mnema instructions` writes. Nor the block it writes into a file of the person's: its lines say
 * "never" and "record", and they are the product's words, not a call of the project's, so they are
 * taken out of what was written before it is read. A file the person keeps out of git is NOT left out:
 * a plan kept beside the work and never committed is the case this is for.
 *
 * It reads a path and a text, and nothing else: whether the record already cites the file, and
 * whether the session was told once, are the caller's.
 */

import { basename, dirname } from 'node:path/posix';
import { WHERE_A_HOST_READS } from './host-rules-file.js';
import { OWN_INSTRUCTIONS_FILES, withoutTheBlock } from './instructions-block.js';
import { CORRECTION_SHAPES } from './user-corrections.js';

/** Which door reads a decision file into the record. */
export type DecisionFileReading =
  /** A directory of decision files: `mnema decision import <directory>`. */
  | { readonly door: 'adr-directory'; readonly directory: string }
  /** A file with `Ruling:` lines: `mnema decision import --format rulings <file>`. */
  | { readonly door: 'rulings' }
  /** Any other file whose lines hold a call: `record_decision`. */
  | { readonly door: 'record-decision' };

/** The names a project's agent instructions live under, wherever in the tree. */
const INSTRUCTION_FILES: ReadonlySet<string> = new Set(['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']);

/** The directories a host reads rules from, from the repository's root. */
const RULES_DIRECTORIES = ['.claude/rules/', '.cursor/rules/'];

/** The one file Copilot reads its repository instructions from. */
const COPILOT_INSTRUCTIONS = '.github/copilot-instructions.md';

/** The names of the files a plan, a handoff or a ledger is kept in. */
const WORK_FILES = /(?:handoff|plan|ledger)[^/]*\.md$/i;

/** A line that opens as a ruling or a decision does, behind an optional list marker or emphasis. */
const A_CALL =
  /^\s*(?:[-*+]\s+|\d+[.)]\s+)?(?:\*\*|__)?(?:Ruling|Decision|Decisão)(?:\*\*|__)?\s*:/im;

/** A line `mnema decision import --format rulings` reads. */
const A_RULING = /^\s*(?:[-*+]\s+)?Ruling:/m;

/** Whether `rel` is one of the product's own files, which never holds a decision to import. */
function theProductsOwn(rel: string): boolean {
  if (rel === '.mnema' || rel.startsWith('.mnema/') || rel.includes('/.mnema/')) return true;
  if (basename(rel) === 'MNEMA.md') return true;
  if (OWN_INSTRUCTIONS_FILES.includes(rel)) return true;
  return (Object.values(WHERE_A_HOST_READS) as readonly string[]).includes(rel);
}

/** Whether `rel` is a directory of decision files' by its path. */
function inADecisionDirectory(rel: string): boolean {
  if (!/\.md$/i.test(rel)) return false;
  if (rel.startsWith('docs/adr/') || rel.startsWith('docs/decisions/')) return true;
  return basename(dirname(rel)) === 'adr';
}

/** Whether `rel` is a file that holds a decision only when what is written in it says so. */
function holdsCallsAmongOtherThings(rel: string): boolean {
  if (INSTRUCTION_FILES.has(basename(rel))) return true;
  if (RULES_DIRECTORIES.some((directory) => rel.startsWith(directory))) return true;
  if (rel === COPILOT_INSTRUCTIONS) return true;
  return WORK_FILES.test(basename(rel));
}

/** Whether a line opens as a person's correction does, its list marker set aside. */
function opensAsACorrection(line: string): boolean {
  const opening = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '');
  return CORRECTION_SHAPES.some((shape) => shape.pattern.test(opening));
}

/**
 * Which door reads the file at `rel` into the record, given `written`, what the write put in it;
 * `undefined` where it is not a decision file.
 *
 * @param rel The file's path from the repository's root, with `/` between its parts.
 * @param writtenWithTheBlock What this write put in the file: a `Write`'s content, an `Edit`'s new text.
 */
export function decisionFileAt(
  rel: string,
  writtenWithTheBlock: string,
): DecisionFileReading | undefined {
  const written = withoutTheBlock(writtenWithTheBlock);
  if (rel === '' || rel.startsWith('../') || rel.startsWith('/') || theProductsOwn(rel)) {
    return undefined;
  }
  if (inADecisionDirectory(rel)) return { door: 'adr-directory', directory: dirname(rel) };
  if (!holdsCallsAmongOtherThings(rel)) return undefined;
  if (A_RULING.test(written)) return { door: 'rulings' };
  if (A_CALL.test(written)) return { door: 'record-decision' };
  return written.split('\n').some(opensAsACorrection) ? { door: 'record-decision' } : undefined;
}
