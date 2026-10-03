/**
 * Readers for the places decisions are already being written outside a decision file: the
 * ECC Memory Vault, the `Ruling:` lines of the superpowers ledger, and the memory files the
 * Claude Code host writes. Each yields the same {@link AdrScan} a directory of ADRs does, so
 * the import takes them down the same road: triaged by the same function, proposed, never
 * accepted, and cited to the file (and line) they were read from.
 *
 * THE FORMATS READ, and nothing else:
 *
 *   - `ecc-vault` — a directory of `*.json` files, each ONE memory object with `kind`,
 *     `state`, `title` and `body`. Only `kind: "decision"` is read; any other kind is
 *     reported as not a decision, and a `rejected` or `superseded` state is reported as
 *     retired (the vault's own state says it is no longer in force). The `trust` field is
 *     not read: everything arrives `proposed` whatever the vault calls it.
 *   - `rulings` — ONE markdown file; every line that starts with `Ruling:` (optionally behind
 *     a list marker) is one entry whose text is both its title (cut at 120 characters) and its
 *     reason. The line number is the provenance.
 *   - `claude-memory` — a directory of `*.md` files with a `---` frontmatter holding `name:`
 *     and a body, the shape the host writes under `~/.claude/projects/<project>/memory/`.
 *     `MEMORY.md`, the index, is skipped. The name is the title, the body the reason.
 *
 * A FILE THAT DOES NOT HAVE THE SHAPE IS NAMED (`MALFORMED`) AND NOTHING IS READ FROM IT.
 * These are other tools' files, written by hand or by a model: a guess at what one meant
 * would enter the record as the product's own reading of somebody's note.
 *
 * Like the ADR walk, none of this is recursive, calls no model, and reads a directory that
 * does not exist as empty.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reasonRefusal, titleRefusal } from '../a-reason-states-something.js';
import type { AdrDocument, AdrRefusalCode } from './read.js';
import { type AdrScan, type ScannedDecision, type ScanRefusal, triage } from './scan.js';

/** The sources, by the name the command line gives them. */
export type BridgeFormat = 'ecc-vault' | 'rulings' | 'claude-memory';

/** Longest title a ruling line makes out of its text. */
const TITLE_LIMIT = 120;

/** What a source's entry came to before triage. */
type Entry = { readonly document: AdrDocument } | { readonly refused: ScanRefusal['code'] };

/** The refusal an entry's title and reason earn, when either is not words. */
function shape(title: string, rationale: string): AdrRefusalCode | undefined {
  if (title.trim() === '') return 'NO_TITLE';
  if (titleRefusal('title', title) !== undefined) return 'TITLE_IS_A_MARKER';
  if (rationale.trim() === '') return 'NO_RATIONALE';
  if (reasonRefusal('reason', rationale) !== undefined) return 'RATIONALE_IS_A_MARKER';
  return undefined;
}

function names(directory: string, extension: RegExp): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && extension.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** One ECC memory object: a decision still in force, or the reason it is not read. */
function eccMemory(text: string): Entry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { refused: 'MALFORMED' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { refused: 'MALFORMED' };
  }
  const memory = parsed as Record<string, unknown>;
  if (memory.kind !== 'decision') return { refused: 'NOT_A_DECISION' };
  if (typeof memory.title !== 'string' || typeof memory.body !== 'string') {
    return { refused: 'MALFORMED' };
  }
  if (memory.state === 'rejected' || memory.state === 'superseded') return { refused: 'RETIRED' };
  const title = memory.title.trim();
  const rationale = memory.body.trim();
  const refusal = shape(title, rationale);
  if (refusal !== undefined) return { refused: refusal };
  return {
    document: {
      title,
      rationale,
      ...(typeof memory.state === 'string' ? { status: memory.state } : {}),
    },
  };
}

/** One host memory file: its `name` and its body. */
function hostMemory(text: string): Entry {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (match === null) return { refused: 'MALFORMED' };
  const name = /^name:[ \t]*(.*?)[ \t]*$/m.exec(match[1] ?? '')?.[1] ?? '';
  const title = name.replace(/^(["'])(.*)\1$/, '$2');
  const rationale = (match[2] ?? '').trim();
  if (title === '' || rationale === '') return { refused: 'MALFORMED' };
  const refusal = shape(title, rationale);
  if (refusal !== undefined) return { refused: refusal };
  return { document: { title, rationale } };
}

/** Reads each file of a directory with `one`, in file-name order. */
function fromDirectory(
  directory: string,
  extension: RegExp,
  skip: (name: string) => boolean,
  one: (text: string) => Entry,
): AdrScan {
  const read: ScannedDecision[] = [];
  const refused: ScanRefusal[] = [];
  for (const name of names(directory, extension).filter((n) => !skip(n))) {
    const path = `${directory.replace(/\/+$/, '')}/${name}`;
    let text: string;
    try {
      text = readFileSync(join(directory, name), 'utf8');
    } catch {
      refused.push({ path, code: 'UNREADABLE' });
      continue;
    }
    const entry = one(text);
    if ('refused' in entry) {
      refused.push({ path, code: entry.refused });
      continue;
    }
    const triaged = triage(path, entry.document);
    if ('code' in triaged) refused.push(triaged);
    else read.push(triaged);
  }
  return { read, refused };
}

/** Every `Ruling:` line of one file. */
function fromLedger(file: string): AdrScan {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return { read: [], refused: [{ path: file, code: 'UNREADABLE' }] };
  }
  const read: ScannedDecision[] = [];
  const refused: ScanRefusal[] = [];
  let found = false;
  text.split(/\r?\n/).forEach((content, index) => {
    const match = /^\s*(?:[-*+]\s+)?Ruling:(.*)$/.exec(content);
    if (match === null) return;
    found = true;
    const line = index + 1;
    const ruling = (match[1] ?? '').trim();
    const title = ruling.length > TITLE_LIMIT ? `${ruling.slice(0, TITLE_LIMIT - 1)}…` : ruling;
    if (ruling === '' || shape(title, ruling) !== undefined) {
      refused.push({ path: file, line, code: 'MALFORMED' });
      return;
    }
    const triaged = triage(file, { title, rationale: ruling }, line);
    if ('code' in triaged) refused.push(triaged);
    else read.push(triaged);
  });
  if (!found) refused.push({ path: file, code: 'MALFORMED' });
  return { read, refused };
}

/**
 * Reads `target` — a directory for `ecc-vault` and `claude-memory`, a file for `rulings` —
 * as the decisions it holds. Paths in the result are `target`-based, so the caller decides how
 * the origin is cited.
 */
export function scanBridge(format: BridgeFormat, target: string): AdrScan {
  switch (format) {
    case 'ecc-vault':
      return fromDirectory(target, /\.json$/i, () => false, eccMemory);
    case 'claude-memory':
      return fromDirectory(
        target,
        /\.md$/i,
        (name) => name.toLowerCase() === 'memory.md',
        hostMemory,
      );
    case 'rulings':
      return fromLedger(target);
  }
}
