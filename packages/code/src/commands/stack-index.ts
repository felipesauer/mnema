/**
 * Reading the index of stacks: a list of where stacks live and the digest each must have.
 *
 * The index holds no stack and no code. An entry kept in the checkout the index sits in names its
 * folder (`path`), and that folder is a SOURCE like any other: it goes through `stack add`, whose
 * plan shows everything before a byte is written. Nothing here installs, fetches or runs anything,
 * and being listed is a proposer's word and a reviewer's, never a proof that a stack is safe.
 *
 * AN INDEX IS READ WHOLE OR NOT AT ALL. One entry that is not in its form refuses the file: a
 * reader that skipped the entries it did not like would show a list that is not the list.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isStackName, isStackVersion } from '@mnema/core';
import { oneLine } from '../one-line.js';
import { refuse, type StackRefused } from './stack-install.js';

/** One entry of the index, as it is shown. */
export interface IndexEntry {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly link: string;
  readonly digest: string;
  /** The folder of a stack kept in the checkout the index sits in; absent for any other. */
  readonly source?: string;
}

export interface StackIndex {
  readonly ok: true;
  readonly folder: string;
  readonly entries: readonly IndexEntry[];
}

const MOST_BYTES = 1024 * 1024;
const FILE = 'index.json';
const DIGEST = /^[0-9a-f]{64}$/;

const no = (message: string, lines?: readonly string[]): StackRefused =>
  refuse('STACK_INDEX_REFUSED', message, lines);

/** A path kept in the repository: relative, `/`-separated, and never up or out. */
function keptPath(text: string): boolean {
  if (text === '' || text.startsWith('/') || text.includes('\\') || text.includes('\0')) {
    return false;
  }
  return text.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function isHttps(text: string): boolean {
  try {
    return new URL(text).protocol === 'https:';
  } catch {
    return false;
  }
}

function entryOf(raw: unknown, at: number, base: string): IndexEntry | string {
  const which = `entry ${at + 1}`;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return `${which} is not an object`;
  }
  const { name, version, description, link, digest, path } = raw as Record<string, unknown>;
  if (typeof name !== 'string' || !isStackName(name)) return `${which}: name is not a stack name`;
  if (typeof version !== 'string' || !isStackVersion(version)) {
    return `${which}: version is not a version`;
  }
  if (typeof description !== 'string') return `${which}: description is not text`;
  if (typeof link !== 'string' || !isHttps(link)) return `${which}: link is not an https address`;
  if (typeof digest !== 'string' || !DIGEST.test(digest)) {
    return `${which}: digest is not 64 lower-case hex digits`;
  }
  if (path !== undefined && (typeof path !== 'string' || !keptPath(path))) {
    return `${which}: path is not a folder kept inside the repository`;
  }
  return {
    name,
    version,
    description: oneLine(description),
    link: oneLine(link),
    digest,
    ...(typeof path === 'string' ? { source: resolve(base, path) } : {}),
  };
}

/**
 * The index in `folder` (relative to `cwd`), read whole. Its entries' folders are resolved
 * beside it: `path` is the repository's own, and the index sits at the repository's root.
 */
export function readStackIndex(cwd: string, folder: string): StackIndex | StackRefused {
  const dir = resolve(cwd, folder);
  const file = resolve(dir, FILE);
  const shown = JSON.stringify(oneLine(folder));
  if (!existsSync(file)) return no(`there is no ${FILE} in ${shown}.`);
  let text: string;
  try {
    if (statSync(file).size > MOST_BYTES) return no(`${FILE} in ${shown} is too large.`);
    text = readFileSync(file, 'utf8');
  } catch {
    return no(`${FILE} in ${shown} cannot be read.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return no(`${FILE} in ${shown} is not JSON.`);
  }
  const stacks = (parsed as { stacks?: unknown } | null)?.stacks;
  if (!Array.isArray(stacks)) return no(`${FILE} in ${shown} has no "stacks" list.`);
  const base = dirname(dir);
  const entries: IndexEntry[] = [];
  const bad: string[] = [];
  stacks.forEach((raw, at) => {
    const one = entryOf(raw, at, base);
    if (typeof one === 'string') bad.push(one);
    else entries.push(one);
  });
  if (bad.length > 0) return no(`${FILE} in ${shown} is not in its form.`, bad);
  return { ok: true, folder: dir, entries };
}

/** What the index says and does not say, as `stack index` prints it. */
export function indexLines(index: StackIndex): string[] {
  if (index.entries.length === 0) return ['The index lists no stack.'];
  const lines = index.entries.flatMap((e) => [
    `${e.name} ${e.version}  ${e.description}`,
    `  digest  ${e.digest}`,
    `  link    ${e.link}`,
    e.source === undefined
      ? '  folder  none in this checkout: add it from its own address, and compare the digest the plan shows'
      : `  folder  ${oneLine(e.source)}`,
  ]);
  lines.push(
    'The index lists where a stack lives and the digest it must have. Being listed does not make a stack safe: `mnema stack add <source> --dry-run` shows what one brings, and it is the stack listed only if the digest it shows is the one above.',
  );
  return lines;
}

/** The same reading for a program to take: nothing but the entries. */
export function indexJson(index: StackIndex): string {
  return JSON.stringify({ stacks: index.entries });
}
