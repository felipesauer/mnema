/**
 * The record's folder carries an `.editorconfig` that unsets every property an outer one could
 * impose on the signed bytes (a final newline, an end of line, a trim, a charset, an indent), so an
 * editor or a tool that reads EditorConfig does not reformat the record. It is written where the
 * README is: by the founding, by the `init` that completes a founded project, and by the first
 * signed write that grows a record with none. It is never written over, and never by a read.
 *
 * It reaches only what is signed, `tails/` and `keys/`: `workbench/` beside them is the person's
 * notes, which their own editor's settings may format as they like. A record founded before the
 * workbench carries the file that reached everything; `mnema init` replaces it where it is those
 * bytes exactly, and `mnema doctor` says so, and says it of an edited one it leaves alone.
 *
 * The resolution is read from the EditorConfig specification: the files from the file's folder up,
 * the nearest last, a `root = true` stopping the climb, a section glob with a `/` in it relative to
 * the file's own folder (one without matches at any depth), `*` matching within one path segment,
 * `**` across them, `{a,b}` either, and the value `unset` removing the property.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDoctor } from '../src/commands/doctor.js';
import { runInit } from '../src/commands/init.js';
import {
  RECORD_EDITORCONFIG,
  RECORD_EDITORCONFIG_BEFORE_THE_WORKBENCH,
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

/**
 * Whether a section glob reaches `path`, a path relative to the folder of the file that holds the
 * section, written with `/`. The specification's forms this file and its cases use: `*`, `**`, `?`
 * and `{a,b}`; a glob with a `/` in it is relative to that folder, and one without matches the name
 * at any depth.
 */
function sectionReaches(glob: string, path: string): boolean {
  const anchored = glob.includes('/');
  const body = glob.startsWith('/') ? glob.slice(1) : glob;
  const literal = (text: string): string => text.replace(/[.+^$()|[\]\\]/g, '\\$&');
  let pattern = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i] as string;
    if (c === '*' && body[i + 1] === '*') {
      pattern += '.*';
      i++;
    } else if (c === '*') pattern += '[^/]*';
    else if (c === '?') pattern += '[^/]';
    else if (c === '{') {
      const end = body.indexOf('}', i);
      pattern += `(?:${body
        .slice(i + 1, end)
        .split(',')
        .map(literal)
        .join('|')})`;
      i = end;
    } else pattern += literal(c);
  }
  return new RegExp(`^${anchored ? '' : '(?:.*/)?'}${pattern}$`).test(path);
}

/** What EditorConfig says of `file`, by the rules of its specification, climbing to `stop`. */
function resolved(file: string, stop: string): Record<string, string> {
  const files: { readonly text: string; readonly dir: string }[] = [];
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    let text: string | undefined;
    try {
      text = readFileSync(join(dir, '.editorconfig'), 'utf-8');
    } catch {
      text = undefined;
    }
    if (text !== undefined) {
      files.push({ text, dir });
      if (/^\s*root\s*=\s*true\s*$/im.test(text.split(/^\s*\[/m)[0] as string)) break;
    }
    if (dir === stop) break;
  }
  const properties: Record<string, string> = {};
  for (const { text, dir } of files.reverse()) {
    const path = relative(dir, file).split(sep).join('/');
    let applies = false;
    for (const line of text.split(/\r?\n/)) {
      const section = /^\s*\[(.*)\]\s*$/.exec(line);
      if (section !== null) applies = sectionReaches(section[1] as string, path);
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

/** What the aggressive parent imposes where nothing below it unsets a property. */
const THE_PARENTS = {
  insert_final_newline: 'true',
  end_of_line: 'crlf',
  trim_trailing_whitespace: 'true',
  charset: 'utf-8',
  indent_style: 'tab',
  indent_size: '8',
};

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
    expect(resolved(tail, repo)).toEqual(THE_PARENTS);
  });

  /**
   * THE SIGNED BYTES ARE `tails/` AND `keys/`, and nothing else under the folder: `workbench/` is
   * the person's notes, not proof (`FORMAT.md` section 4), and their editor formats them as it
   * formats the rest of the repository. A notes folder that happens to be called `tails` is not
   * the record's: the section is relative to the record's folder.
   */
  it("reaches the tails and the keys, and leaves the person's notes to their own editor", () => {
    founded();
    for (const signed of [
      ['tails', 'x', '000001.jsonl'],
      ['tails', 'x', 'checkpoints.jsonl'],
      ['tails', 'x', 'tailproof.json'],
      ['keys', 'abc.pub'],
    ]) {
      expect(resolved(join(repo, '.mnema', ...signed), repo), signed.join('/')).toEqual({});
    }
    for (const notes of [
      ['workbench', 'README.md'],
      ['workbench', 'shared', 'changes', 'one', 'change.md'],
      ['workbench', 'shared', 'tails', 'x', '000001.jsonl'],
      ['workbench', 'local', 'keys', 'mine.md'],
    ]) {
      expect(resolved(join(repo, '.mnema', ...notes), repo), notes.join('/')).toEqual(THE_PARENTS);
    }
  });

  it('does not cut the inheritance of what it does not name: no root, one section', () => {
    expect(RECORD_EDITORCONFIG).not.toMatch(/^\s*root\s*=/im);
    expect(RECORD_EDITORCONFIG.split('\n').filter((l) => l.startsWith('['))).toEqual([
      '[{tails,keys}/**]',
    ]);
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

/**
 * A RECORD FOUNDED BEFORE THE WORKBENCH carries the file whose `[*]` reached every file under the
 * folder, the notes included. The bytes an earlier `init` wrote are known exactly, so those, and
 * only those, are replaced; a file a person edited is theirs, and is named, not touched.
 */
describe('a record whose .editorconfig an earlier init wrote', () => {
  function doctor(): string[] {
    return runDoctor({
      cwd: repo,
      env: env(),
      processEnv: { PATH: '' },
      running: { file: join(sandbox, 'mnema'), version: '9.9.9' },
    })
      .findings.filter((one) => one.topic === 'record-page')
      .map((one) => one.line);
  }

  const notes = () => join(repo, '.mnema', 'workbench', 'shared', 'notes.md');

  it('is those bytes exactly: what reached the notes too', () => {
    founded();
    writeFileSync(editorconfig(), RECORD_EDITORCONFIG_BEFORE_THE_WORKBENCH);
    expect(resolved(notes(), repo)).toEqual({});
    expect(RECORD_EDITORCONFIG_BEFORE_THE_WORKBENCH).toBe(
      [
        '# The record is signed bytes: do not let an outer .editorconfig reformat them.',
        '[*]',
        'insert_final_newline = unset',
        'trim_trailing_whitespace = unset',
        'end_of_line = unset',
        'charset = unset',
        'indent_style = unset',
        'indent_size = unset',
        '',
      ].join('\n'),
    );
  });

  it('is named by doctor with the fix, which writes nothing', () => {
    founded();
    writeFileSync(editorconfig(), RECORD_EDITORCONFIG_BEFORE_THE_WORKBENCH);
    expect(whatIsMissing(repo)).toMatchObject({
      editorconfig: false,
      editorconfigReachesTheNotes: 'earlier',
    });
    const lines = doctor();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('.mnema/.editorconfig an earlier mnema init wrote');
    expect(lines[0]).toContain('.mnema/workbench/');
    expect(lines[0]).toContain('run `mnema init` to replace it');
    expect(readFileSync(editorconfig(), 'utf-8')).toBe(RECORD_EDITORCONFIG_BEFORE_THE_WORKBENCH);
  });

  it('is replaced by init, which says so, and the next init writes nothing', () => {
    founded();
    writeFileSync(editorconfig(), RECORD_EDITORCONFIG_BEFORE_THE_WORKBENCH);
    expect(runInit({ cwd: repo, env: env() })).toMatchObject({
      created: false,
      completed: { editorconfig: false, editorconfigReachesTheNotes: 'earlier' },
    });
    expect(readFileSync(editorconfig(), 'utf-8')).toBe(RECORD_EDITORCONFIG);
    expect(resolved(notes(), repo)).toEqual(THE_PARENTS);
    expect('completed' in runInit({ cwd: repo, env: env() })).toBe(false);
    expect(doctor()).toEqual([]);
  });

  it('is left as it is where a person edited it, and doctor names the section to change', () => {
    founded();
    const edited = RECORD_EDITORCONFIG_BEFORE_THE_WORKBENCH.replace(
      'indent_size = unset\n',
      'indent_size = unset\nmax_line_length = off\n',
    );
    writeFileSync(editorconfig(), edited);
    expect(whatIsMissing(repo).editorconfigReachesTheNotes).toBe('edited');
    expect('completed' in runInit({ cwd: repo, env: env() })).toBe(false);
    expect(readFileSync(editorconfig(), 'utf-8')).toBe(edited);
    const lines = doctor();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[*]');
    expect(lines[0]).toContain('[{tails,keys}/**]');
    expect(lines[0]).toContain('mnema leaves it');
  });

  it('says nothing of a file of the person that reaches no notes', () => {
    founded();
    writeFileSync(editorconfig(), '[tails/**]\nindent_style = unset\n');
    expect(whatIsMissing(repo).editorconfigReachesTheNotes).toBeUndefined();
    expect(doctor()).toEqual([]);
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
