import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanBridge } from './bridges.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-bridges-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function put(name: string, text: string): string {
  const path = join(sandbox, name);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text, 'utf8');
  return path;
}

describe('the Memory Vault of the ECC', () => {
  const memory = (extra: Record<string, unknown>) =>
    JSON.stringify({
      id: 'mem-1',
      kind: 'decision',
      state: 'active',
      trust: 'unreviewed',
      scope: 'team',
      title: 'Use sqlite for the local cache',
      body: 'One file, no server, and the cache is disposable.',
      ...extra,
    });

  it('reads a memory of kind decision, citing its file', () => {
    put('vault/a.json', memory({}));
    const scan = scanBridge('ecc-vault', join(sandbox, 'vault'));
    expect(scan.refused).toEqual([]);
    expect(scan.read).toEqual([
      {
        title: 'Use sqlite for the local cache',
        rationale: 'One file, no server, and the cache is disposable.',
        status: 'active',
        path: join(sandbox, 'vault', 'a.json'),
      },
    ]);
  });

  it('leaves out what is not a decision, and what the vault itself retired', () => {
    put('vault/a.json', memory({ kind: 'lesson' }));
    put('vault/b.json', memory({ state: 'superseded' }));
    put('vault/c.json', memory({ state: 'rejected' }));
    const scan = scanBridge('ecc-vault', join(sandbox, 'vault'));
    expect(scan.read).toEqual([]);
    expect(scan.refused.map((r) => r.code)).toEqual(['NOT_A_DECISION', 'RETIRED', 'RETIRED']);
  });

  it('names a file that is not a memory and reads the rest', () => {
    put('vault/a.json', '{ not json');
    put('vault/b.json', JSON.stringify({ kind: 'decision', title: 'No body' }));
    put('vault/c.json', memory({}));
    const scan = scanBridge('ecc-vault', join(sandbox, 'vault'));
    expect(scan.refused.map((r) => r.code)).toEqual(['MALFORMED', 'MALFORMED']);
    expect(scan.read.map((d) => d.title)).toEqual(['Use sqlite for the local cache']);
  });

  it('refuses a body that holds a credential, by the door the ADRs go through', () => {
    put('vault/a.json', memory({ body: 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789' }));
    const scan = scanBridge('ecc-vault', join(sandbox, 'vault'));
    expect(scan.read).toEqual([]);
    expect(scan.refused.map((r) => r.code)).toEqual(['HOLDS_A_SECRET']);
  });
});

describe('the Ruling lines of the superpowers ledger', () => {
  it('reads each Ruling line as one entry, with the line it came from', () => {
    const file = put(
      'docs/ledger.md',
      [
        '# Ledger',
        '',
        '- Ruling: keep the parser strict because loose parsing hid two bugs',
        'some prose',
        'Ruling: ship without the cache',
      ].join('\n'),
    );
    const scan = scanBridge('rulings', file);
    expect(scan.refused).toEqual([]);
    expect(scan.read).toEqual([
      {
        title: 'keep the parser strict because loose parsing hid two bugs',
        rationale: 'keep the parser strict because loose parsing hid two bugs',
        path: file,
        line: 3,
      },
      { title: 'ship without the cache', rationale: 'ship without the cache', path: file, line: 5 },
    ]);
  });

  it('names an empty Ruling line, and a file with no Ruling line at all', () => {
    const empty = put('a.md', '# x\nRuling:   \nRuling: kept\n');
    const none = put('b.md', '# nothing decided here\n');
    expect(scanBridge('rulings', empty).refused).toEqual([
      { path: empty, line: 2, code: 'MALFORMED' },
    ]);
    expect(scanBridge('rulings', empty).read.map((d) => d.line)).toEqual([3]);
    expect(scanBridge('rulings', none).refused).toEqual([{ path: none, code: 'MALFORMED' }]);
  });
});

describe('the memory files of the host', () => {
  const memory = (name: string, body: string) =>
    `---\nname: ${name}\ndescription: one line\nmetadata:\n  type: feedback\n---\n\n${body}\n`;

  it('reads a memory file by its name and body, and skips the index', () => {
    put('memory/MEMORY.md', '- [x](x.md) — an index line\n');
    put('memory/feedback_x.md', memory('No publish', 'Do not suggest publishing.'));
    const scan = scanBridge('claude-memory', join(sandbox, 'memory'));
    expect(scan.refused).toEqual([]);
    expect(scan.read).toEqual([
      {
        title: 'No publish',
        rationale: 'Do not suggest publishing.',
        path: join(sandbox, 'memory', 'feedback_x.md'),
      },
    ]);
  });

  it('names a file with no frontmatter or no body', () => {
    put('memory/a.md', 'just prose, no frontmatter\n');
    put('memory/b.md', '---\nname: Only a name\n---\n');
    const scan = scanBridge('claude-memory', join(sandbox, 'memory'));
    expect(scan.read).toEqual([]);
    expect(scan.refused.map((r) => r.code)).toEqual(['MALFORMED', 'MALFORMED']);
  });
});
