/**
 * THE HOSTS `mnema init` OFFERS, as rows: which files each one reads the mnema instructions from, and
 * what in a project says it is in use.
 *
 * IT DRAWS NO TABLE OF ITS OWN. The files are the ones `INSTRUCTIONS_TARGETS` names and the ids are
 * the keys of the product's one table of hosts (`host-names.ts`, so a rename there does not compile
 * here); what is added is only which row a file belongs to and what shows a host in use, and
 * `the-init-offers-the-files-of-yours-as-marks.test.ts` holds that every file of the table has exactly
 * one row, so a file added there that no row claims is a red and not a file `init` forgot to offer.
 *
 * A ROW'S OWN FILES ARE WRITTEN WHETHER OR NOT THE PROJECT HAD THEM (`when: 'always'`), and the
 * person's files under it are written where they exist (`when: 'exists'`): `CLAUDE.md` under Claude
 * Code, `GEMINI.md` under the last row, where Gemini CLI is one of the hosts that name is for. A
 * person's file is a mark of its own and not a part of its row (ADR-174): one the person unchecks gets
 * nothing, and a row unchecked leaves the person's file under it as it was found.
 */

import type { HostName } from '../host-names.js';
import { INSTRUCTIONS_TARGETS } from '../instructions-block.js';

/** The hosts the rows are named by: the ones of `host-names.ts` that have a file of their own here. */
export type RowId = Extract<HostName, 'claude' | 'cursor' | 'vscode' | 'codex'>;

/** One row of the question. */
export interface HostRow {
  readonly id: RowId;
  /** What a person reads on the row. */
  readonly label: string;
  /** The files of its own, written whether or not the project had them. */
  readonly files: readonly string[];
  /** The person's files that belong under it, written where they exist. */
  readonly yours: readonly string[];
  /** What in a project says the host is in use: a path, from the project's root. */
  readonly detectedBy: readonly string[];
  /** What the picked row says about itself, in a sentence. */
  readonly hint: string;
}

export const HOST_ROWS: readonly HostRow[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    files: ['.claude/rules/mnema-instructions.md'],
    yours: ['CLAUDE.md', '.claude/CLAUDE.md'],
    detectedBy: ['CLAUDE.md', '.claude'],
    hint: 'Claude Code reads the rules file at launch.',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    files: ['.cursor/rules/mnema-instructions.mdc'],
    yours: [],
    detectedBy: ['.cursor'],
    hint: 'Cursor and VS Code read AGENTS.md too.',
  },
  {
    id: 'vscode',
    label: 'VS Code and Copilot CLI',
    files: ['.github/instructions/mnema-instructions.instructions.md'],
    yours: [],
    detectedBy: ['.github/instructions'],
    hint: 'VS Code and Copilot CLI read AGENTS.md too.',
  },
  {
    id: 'codex',
    label: 'Codex, OpenCode, Qwen Code and others',
    files: ['AGENTS.md'],
    yours: ['GEMINI.md'],
    detectedBy: ['AGENTS.md'],
    hint: 'AGENTS.md is read by Codex, OpenCode, Qwen Code, Cursor and VS Code.',
  },
];

/** The names `--hosts` takes for a row, which are the keys of the product's table of hosts. */
export const HOST_NAMES_OFFERED: readonly RowId[] = HOST_ROWS.map((row) => row.id);

/** Every path a row or a mark of it can write: its own files and the person's. */
export const PATHS_OFFERED: readonly string[] = HOST_ROWS.flatMap((row) => [
  ...row.files,
  ...row.yours,
]);

/** The files of INSTRUCTIONS_TARGETS no row claims: empty when the table and the rows agree. */
export function pathsNoRowClaims(): readonly string[] {
  return INSTRUCTIONS_TARGETS.map((target) => target.path).filter(
    (path) => !PATHS_OFFERED.includes(path),
  );
}

/** The mark of a host row. */
export const hostMark = (id: RowId): string => `host:${id}`;

/** The mark of a file of the person's. */
export const yoursMark = (path: string): string => `yours:${path}`;

/** The files of its own a set of marks asks for, in the order the table lists them. */
export function ownFilesOf(marks: ReadonlySet<string>): readonly string[] {
  return HOST_ROWS.filter((row) => marks.has(hostMark(row.id))).flatMap((row) => row.files);
}

/** The person's files a set of marks asks for, in the order the table lists them. */
export function yoursOf(marks: ReadonlySet<string>): readonly string[] {
  return HOST_ROWS.flatMap((row) => row.yours).filter((path) => marks.has(yoursMark(path)));
}

/** What `--hosts` asked for, or why it could not be read. */
export type HostsAsked =
  | { readonly ok: true; readonly hosts: readonly RowId[]; readonly detected: boolean }
  | { readonly ok: false; readonly unknown: string };

/** What a `--hosts` list may say besides the names of the rows. */
export const HOSTS_WORDS = ['all', 'detected', 'none'] as const;

/**
 * Reads the value of `--hosts`: names of rows separated by commas, or one of `all`, `detected` and
 * `none` alone. A name that is not one is refused whole, with what it was, and nothing is guessed.
 */
export function readHostsFlag(value: string): HostsAsked {
  const words = value
    .split(',')
    .map((word) => word.trim())
    .filter((word) => word !== '');
  if (words.length === 0) return { ok: false, unknown: value };
  if (words.length === 1 && words[0] === 'all') {
    return { ok: true, hosts: HOST_NAMES_OFFERED, detected: false };
  }
  if (words.length === 1 && words[0] === 'none') return { ok: true, hosts: [], detected: false };
  if (words.length === 1 && words[0] === 'detected') {
    return { ok: true, hosts: [], detected: true };
  }
  const picked: RowId[] = [];
  for (const word of words) {
    const row = HOST_NAMES_OFFERED.find((name) => name === word);
    if (row === undefined) return { ok: false, unknown: word };
    if (!picked.includes(row)) picked.push(row);
  }
  return {
    ok: true,
    hosts: HOST_NAMES_OFFERED.filter((name) => picked.includes(name)),
    detected: false,
  };
}
