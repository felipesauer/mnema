import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateStack } from '../src/validate.js';
import { PACKAGE_ROOT } from './support.js';

/**
 * THE INDEX NAMES THE STACKS IT LISTS. `stack-index/index.json` is a list of where a stack lives
 * and the digest it must have, never the stack. For a stack kept in this repository the list is
 * held to the folder: the digest the package computes over the folder is the digest written, the
 * name and version are the manifest's, and every example the repository ships is listed, first.
 *
 * It does not check a stack kept elsewhere: for those the digest is what the proposer wrote.
 */
const ROOT = join(PACKAGE_ROOT, '..', '..');
const INDEX = join(ROOT, 'stack-index');
const EXAMPLES = join(PACKAGE_ROOT, 'examples');

interface Entry {
  name: string;
  version: string;
  description: string;
  link: string;
  digest: string;
  path?: string;
}

const text = readFileSync(join(INDEX, 'index.json'), 'utf8');
const index = JSON.parse(text) as { stacks: Entry[] };
const FIELDS = ['description', 'digest', 'link', 'name', 'path', 'version'];

describe('the stack index', () => {
  it('holds a list of entries, each with only the fields of an entry', () => {
    expect(Object.keys(index)).toEqual(['stacks']);
    for (const entry of index.stacks) {
      expect(Object.keys(entry).filter((k) => !FIELDS.includes(k))).toEqual([]);
      expect(entry.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.link).toMatch(/^https:\/\//);
    }
    expect(new Set(index.stacks.map((e) => e.name)).size).toBe(index.stacks.length);
  });

  it('holds no stack, only the index and its page', () => {
    expect(readdirSync(INDEX).sort()).toEqual(['README.md', 'index.json']);
  });

  it('lists the example stacks of this repository first', () => {
    const examples = readdirSync(EXAMPLES).sort();
    expect(
      index.stacks
        .slice(0, examples.length)
        .map((e) => e.name)
        .sort(),
    ).toEqual(examples);
  });

  it.each(index.stacks.filter((e) => e.path !== undefined).map((e) => [e.name, e] as const))(
    '%s: the digest, the name and the version are those of the folder it points to',
    (_, entry) => {
      const report = validateStack(join(ROOT, entry.path as string));
      expect(report.problems).toEqual([]);
      expect(entry.digest).toBe(report.digest);
      expect(entry.name).toBe(report.manifest?.name);
      expect(entry.version).toBe(report.manifest?.version);
      expect(entry.description).toBe(report.manifest?.description);
      expect(entry.link.endsWith(`/${entry.path}`)).toBe(true);
    },
  );
});
