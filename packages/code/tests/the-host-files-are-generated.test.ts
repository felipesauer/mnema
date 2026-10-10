/**
 * THE HOST FILES ARE GENERATED, AND ONE EDITED BY HAND IS RED.
 *
 * The plugin's hooks file, the two manifests and the rung table on the README and on
 * `docs/evidence.md` are what `support/the-host-files.ts` makes of the host table in
 * `src/host-names.ts`. Each committed file is compared here with what the table generates, byte
 * for byte; for a page, with the page as it stands and its table regenerated, so the prose
 * around the table stays the page's own. A file somebody edited by hand differs, and this is red.
 *
 * To change one of them, change the table (or the generator) and run this file with `-u`: the
 * house's way of writing a golden, and the only one these files have.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOSTS } from '../src/host-names.js';
import { GENERATED, generated, rungTable } from './support/the-host-files.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');

describe('the files the host table generates', () => {
  it.each(GENERATED)('%s is what the table generates', async (path) => {
    const committed = readFileSync(join(ROOT, path), 'utf-8');
    await expect(generated(path, committed)).toMatchFileSnapshot(join(ROOT, path));
  });

  it('accuses a hooks file edited by hand', () => {
    const committed = readFileSync(join(ROOT, 'plugin/hooks/hooks.json'), 'utf-8');
    const edited = committed.replace('"timeout": 15', '"timeout": 16');
    expect(edited).not.toBe(committed);
    expect(generated('plugin/hooks/hooks.json', edited)).not.toBe(edited);
  });

  it('accuses a rung table edited by hand, and keeps the prose around it', () => {
    const committed = readFileSync(join(ROOT, 'README.md'), 'utf-8');
    const edited = committed.replace('| Goose |', '| Goose, fully supported |');
    expect(edited).not.toBe(committed);
    expect(generated('README.md', edited)).toBe(committed);
    const prose = committed.replace('## Features', '## Features!');
    expect(generated('README.md', prose)).toBe(prose);
  });
});

describe('the rung table', () => {
  const table = rungTable('');

  it('says how every cell is known, and promises nothing the table does not hold', () => {
    const rows = table
      .split('\n')
      .filter((line) => line.startsWith('| ') && !/^\| (Host|---) /.test(line));
    const hosts = Object.values(HOSTS).map((host) => host.title);
    expect(rows.map((row) => row.split(' | ')[0]?.slice(2))).toEqual(hosts);
    // A host only read in its documentation is never answered "yes".
    const goose = rows.find((row) => row.startsWith('| Goose |')) ?? '';
    expect(goose).not.toContain('yes');
    expect(goose).toContain('documented, not measured');
    expect(goose).toContain('not ported');
  });

  it('puts each host in the rung its cells reach, in order, and no further', () => {
    const rung = (title: string) =>
      table
        .split('\n')
        .find((line) => line.startsWith(`| ${title} |`))
        ?.split(' | ')
        .at(-1)
        ?.replace(/ \|$/, '');
    expect(rung('Claude Code')).toBe('(d)');
    expect(rung("VS Code's agent")).toBe('(d)');
    // Cursor refuses and does not pause a write for a person.
    expect(rung("Cursor's command-line agent")).toBe('(c)');
    // Codex refuses and does not pause a write; the rules file it reads is only documented.
    expect(rung('Codex')).toBe('(c), with (a) documented, not measured');
    expect(rung('Qwen Code')).toBe('(a), documented, not measured');
    // The editor was only read in Cursor's documentation; the plugin was not read running in it.
    expect(rung("Cursor's editor")).toBe('(a), documented, not measured');
  });
});
