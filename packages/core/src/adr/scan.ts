/**
 * Reading a DIRECTORY of decision documents — the walk, the triage, and the two
 * refusals that are about this product rather than about the document's shape.
 *
 * IT IS NOT RECURSIVE, and that is a decision rather than a shortcut. An ADR base
 * is a flat directory by every convention that publishes one (`docs/adr/`,
 * `doc/adr/`, `docs/decisions/`), and a recursive walk pointed at a repository
 * root would read every markdown file in it — a README, a changelog, an issue
 * template — and propose whatever happened to have a heading and a paragraph. The
 * caller names the directory holding the decisions; nothing here guesses which one
 * that is.
 *
 * THE ORDER IS THE FILE NAME, so two runs over the same directory report the same
 * list in the same order. ADR file names carry their own sequence number, so this
 * is also the order their authors intended.
 *
 * TWO REFUSALS ARE THIS PRODUCT'S AND NOT THE DOCUMENT'S, and they are applied here
 * rather than in the reader because they are about what may enter the record:
 *
 *   - `HOLDS_A_SECRET` — a field carries something shaped like a credential. Text
 *     from somebody else's file is exactly the untrusted input the content door
 *     exists for, and the door SCRUBS and reports. That is right for a person
 *     typing one fact and wrong for a bulk read of forty files: a placeholder
 *     recorded on a person's behalf, in a document they did not write, is a
 *     permanent entry nobody chose. So this refuses the FILE, by name, with the
 *     class named — and the door still runs on everything that does get written,
 *     because the screen lives inside the write and this triage cannot skip it.
 *     Detection here is the SAME function the door uses (`detectSecrets`), so
 *     there is one idea of what a credential looks like and not two.
 *
 *   - `FIELD_TOO_LARGE` — a field is over {@link FIELD_BYTE_LIMIT}. The door would
 *     refuse this append anyway; refusing it here means the caller learns it while
 *     nothing has been written, instead of halfway through a directory.
 *
 * And one skip that is a POLICY and says so: `RETIRED`, a document whose own status
 * says it is no longer in force. See {@link adrIsInForce}.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIELD_BYTE_LIMIT } from '../content/screen.js';
import type { SecretClass } from '../content/secrets.js';
import { detectSecrets } from '../content/secrets.js';
import { type AdrDocument, type AdrRefusalCode, adrIsInForce, readAdr } from './read.js';

/** Why a file in the directory produced no proposal. */
export type ScanRefusalCode =
  | AdrRefusalCode
  /** The document's own status says this decision is no longer in force. */
  | 'RETIRED'
  /** A field carries something shaped like a credential; nothing is proposed from it. */
  | 'HOLDS_A_SECRET'
  /** A field is over the limit a recorded field may weigh. */
  | 'FIELD_TOO_LARGE'
  /** The file could not be read from disk (permission, a broken link, a race). */
  | 'UNREADABLE';

/** One document that WOULD become a decision, and the file it came from. */
export interface ScannedDecision extends AdrDocument {
  /** The file's path as the caller will record it — the provenance of the proposal. */
  readonly path: string;
}

/** One file that produced no proposal, and why. */
export interface ScanRefusal {
  /** The file's path, so the refusal names something the caller can open. */
  readonly path: string;
  readonly code: ScanRefusalCode;
  /**
   * The credential classes found, on `HOLDS_A_SECRET` and nothing else. The CLASS
   * travels and the value never does — the same posture the record's own exposure
   * reading takes.
   */
  readonly classes?: readonly SecretClass[];
}

/** What a directory of decision documents holds. */
export interface AdrScan {
  /** The documents read as decisions, in file-name order. */
  readonly read: readonly ScannedDecision[];
  /** The files that produced nothing, each with its reason, in file-name order. */
  readonly refused: readonly ScanRefusal[];
}

/** The extensions a decision document may have. */
const MARKDOWN = /\.(?:md|markdown)$/i;

/**
 * File names that are a decision base's own furniture rather than a decision —
 * the index page and the template every ADR tool drops beside the records.
 *
 * They are excluded by NAME and not by shape, because both usually parse: a
 * template has a title and a `## Context` full of instructions, and reading one
 * would propose "Short title of solved problem and solution" as a decision of the
 * project. Comparing on the stem (case-folded, without extension) covers
 * `README.md`, `readme.markdown` and `TEMPLATE.md` alike.
 */
const NOT_A_DECISION: readonly string[] = [
  'readme',
  'index',
  'template',
  'formato',
  'format',
  '_index',
];

/** The path, POSIX-style, of a file inside the scanned directory. */
function relative(directory: string, file: string): string {
  return `${directory.replace(/\/+$/, '')}/${file}`;
}

/** The bytes a field would weigh in the record — UTF-8, the form the chain stores. */
function weight(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/** Every free-text field the proposal would carry, for one pass of triage. */
function fieldsOf(document: AdrDocument): readonly string[] {
  return [
    document.title,
    document.rationale,
    ...(document.alternatives !== undefined ? [document.alternatives] : []),
  ];
}

/**
 * Reads every markdown file in `directory` as a decision document, and returns
 * what it read beside what it refused and why.
 *
 * A directory that does not exist, or that cannot be listed, comes back EMPTY
 * rather than throwing: the caller reports "nothing here" and the person points it
 * somewhere else. Throwing would make a typo in a path look like a failure of the
 * product.
 */
export function scanAdrDirectory(directory: string): AdrScan {
  let names: string[];
  try {
    names = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && MARKDOWN.test(entry.name))
      .map((entry) => entry.name)
      .filter((name) => !NOT_A_DECISION.includes(name.replace(MARKDOWN, '').toLowerCase()))
      .sort();
  } catch {
    return { read: [], refused: [] };
  }

  const read: ScannedDecision[] = [];
  const refused: ScanRefusal[] = [];
  for (const name of names) {
    const path = relative(directory, name);
    let text: string;
    try {
      text = readFileSync(join(directory, name), 'utf8');
    } catch {
      refused.push({ path, code: 'UNREADABLE' });
      continue;
    }
    const document = readAdr(text);
    if (!document.ok) {
      refused.push({ path, code: document.code });
      continue;
    }
    if (!adrIsInForce(document.status)) {
      refused.push({ path, code: 'RETIRED' });
      continue;
    }
    const fields = fieldsOf(document);
    if (fields.some((field) => weight(field) > FIELD_BYTE_LIMIT)) {
      refused.push({ path, code: 'FIELD_TOO_LARGE' });
      continue;
    }
    const classes = [...new Set(fields.flatMap((field) => detectSecrets(field)))].sort();
    if (classes.length > 0) {
      refused.push({ path, code: 'HOLDS_A_SECRET', classes });
      continue;
    }
    const { ok: _ok, ...fieldsOfDocument } = document;
    read.push({ ...fieldsOfDocument, path });
  }
  return { read, refused };
}
