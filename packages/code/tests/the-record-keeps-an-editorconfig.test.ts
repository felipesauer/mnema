/**
 * The record's folder carries an `.editorconfig` that unsets every property an outer one could
 * impose on the signed bytes (a final newline, an end of line, a trim, a charset, an indent), so an
 * editor or a tool that reads EditorConfig does not reformat the record. It is written where the
 * README is: by the founding, by the `init` that completes a founded project, and by the first
 * signed write that grows a record with none. It is never written over, and never by a read.
 *
 * The resolution is read from the EditorConfig specification: the files from the file's folder up,
 * the nearest last, a `root = true` stopping the climb, `[*]` matching every file, and the value
 * `unset` removing the property.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from '../src/commands/init.js';
import {
  RECORD_EDITORCONFIG,
  RecordPageWatch,
  THE_EDITORCONFIG_WAS_LEFT,
  whatIsMissing,
} from '../src/commands/the-record-page.js';

let sandbox: string;
let repo: string;
const env = () => ({ home: join(sandbox, 'home') });
const editorconfig = () => join(repo, '.mnema', '.editorconfig');

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-editorconfig-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

const AGGRESSIVE = [
  'root = true',
  '[*]',
  'insert_final_newline = true',
  'end_of_line = crlf',
  'trim_trailing_whitespace = true',
  'charset = utf-8',
  'indent_style = tab',
  'indent_size = 8',
  '',
].join('\n');

/** What EditorConfig says of `file`, by the rules of its specification, climbing to `stop`. */
function resolved(file: string, stop: string): Record<string, string> {
  const files: string[] = [];
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    let text: string | undefined;
    try {
      text = readFileSync(join(dir, '.editorconfig'), 'utf-8');
    } catch {
      text = undefined;
    }
    if (text !== undefined) {
      files.push(text);
      if (/^\s*root\s*=\s*true\s*$/im.test(text.split(/^\s*\[/m)[0] as string)) break;
    }
    if (dir === stop) break;
  }
  const properties: Record<string, string> = {};
  for (const text of files.reverse()) {
    let applies = false;
    for (const line of text.split(/\r?\n/)) {
      const section = /^\s*\[(.*)\]\s*$/.exec(line);
      if (section !== null) applies = section[1] === '*';
      const pair = /^\s*([a-z_]+)\s*=\s*(.+?)\s*$/i.exec(line);
      if (applies && pair !== null)
        properties[(pair[1] as string).toLowerCase()] = pair[2] as string;
    }
  }
  for (const [key, value] of Object.entries(properties)) {
    if (value.toLowerCase() === 'unset') delete properties[key];
  }
  return properties;
}

function founded(): void {
  writeFileSync(join(repo, '.editorconfig'), AGGRESSIVE);
  expect('refused' in runInit({ cwd: repo, env: env() })).toBe(false);
}

describe('the .editorconfig in the record', () => {
  it('is written by the founding and unsets every property an aggressive parent sets', () => {
    founded();
    expect(readFileSync(editorconfig(), 'utf-8')).toBe(RECORD_EDITORCONFIG);
    const tail = join(repo, '.mnema', 'tails', 'x', '000001.jsonl');
    expect(resolved(tail, repo)).toEqual({});
    // The control: without it the same file is held to every one of the parent's properties.
    rmSync(editorconfig());
    expect(resolved(tail, repo)).toEqual({
      insert_final_newline: 'true',
      end_of_line: 'crlf',
      trim_trailing_whitespace: 'true',
      charset: 'utf-8',
      indent_style: 'tab',
      indent_size: '8',
    });
  });

  it('does not cut the inheritance of what it does not name: no root, one section', () => {
    expect(RECORD_EDITORCONFIG).not.toMatch(/^\s*root\s*=/im);
    expect(RECORD_EDITORCONFIG.split('\n').filter((l) => l.startsWith('['))).toEqual(['[*]']);
    for (const key of [
      'insert_final_newline',
      'trim_trailing_whitespace',
      'end_of_line',
      'charset',
      'indent_style',
      'indent_size',
    ]) {
      expect(RECORD_EDITORCONFIG).toContain(`${key} = unset\n`);
    }
  });

  it('is added by an init run again where it is missing, and never written over where it is there', () => {
    founded();
    rmSync(editorconfig());
    expect(whatIsMissing(repo).editorconfig).toBe(true);
    expect(() => readFileSync(editorconfig())).toThrow();
    expect(runInit({ cwd: repo, env: env() })).toMatchObject({
      created: false,
      completed: { editorconfig: true },
    });
    expect(readFileSync(editorconfig(), 'utf-8')).toBe(RECORD_EDITORCONFIG);
    writeFileSync(editorconfig(), 'mine\n');
    const again = runInit({ cwd: repo, env: env() });
    expect('completed' in again).toBe(false);
    expect(readFileSync(editorconfig(), 'utf-8')).toBe('mine\n');
  });

  it('is not made by asking what is missing', () => {
    founded();
    rmSync(editorconfig());
    expect(whatIsMissing(repo).editorconfig).toBe(true);
    expect(() => readFileSync(editorconfig())).toThrow();
  });
});

describe('the first signed write', () => {
  function arranged(): { root: string; keyRoot: string; grow: () => void } {
    const root = join(sandbox, 'record');
    const keyRoot = join(sandbox, 'keys');
    mkdirSync(join(keyRoot, 'keys'), { recursive: true });
    writeFileSync(join(keyRoot, 'keys', 'aaaa.key'), 'k');
    mkdirSync(join(root, 'tails', 'aaaa-one'), { recursive: true });
    writeFileSync(join(root, 'README.md'), 'mine\n');
    const grow = () =>
      writeFileSync(join(root, 'tails', 'aaaa-one', '000001.jsonl'), `${'x'.repeat(40)}\n`, {
        flag: 'a',
      });
    return { root, keyRoot, grow };
  }

  it('leaves it, and says so, when the record has a README and no .editorconfig', () => {
    const { root, keyRoot, grow } = arranged();
    const watch = new RecordPageWatch();
    watch.opened(root, [keyRoot]);
    grow();
    expect(watch.settled(true)).toEqual([THE_EDITORCONFIG_WAS_LEFT]);
    expect(readFileSync(join(root, '.editorconfig'), 'utf-8')).toBe(RECORD_EDITORCONFIG);
    expect(readFileSync(join(root, 'README.md'), 'utf-8')).toBe('mine\n');
  });

  it('leaves nothing for a read or for a write that did not land', () => {
    const { root, keyRoot, grow } = arranged();
    const watch = new RecordPageWatch();
    watch.opened(root, [keyRoot]);
    expect(watch.settled(true)).toEqual([]);
    watch.opened(root, [keyRoot]);
    grow();
    expect(watch.settled(false)).toEqual([]);
    expect(() => readFileSync(join(root, '.editorconfig'))).toThrow();
  });

  it('never replaces one that is there', () => {
    const { root, keyRoot, grow } = arranged();
    writeFileSync(join(root, '.editorconfig'), 'mine\n');
    const watch = new RecordPageWatch();
    watch.opened(root, [keyRoot]);
    grow();
    expect(watch.settled(true)).toEqual([]);
    expect(readFileSync(join(root, '.editorconfig'), 'utf-8')).toBe('mine\n');
  });
});
