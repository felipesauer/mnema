/**
 * A project founded before `init` left a `README.md` in `.mnema/` and kept prettier off the record
 * lacks both. `mnema init` run again adds exactly those, says so, and touches nothing else of the
 * record; `mnema doctor` points at them and writes nothing.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDoctor } from '../src/commands/doctor.js';
import { runInit } from '../src/commands/init.js';
import { whatIsMissing } from '../src/commands/the-record-page.js';

let sandbox: string;
let repo: string;
const env = () => ({ home: join(sandbox, 'home') });

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-init-completes-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** Every file under a directory with a digest of its bytes. */
function digests(directory: string, prefix = ''): Record<string, string> {
  const found: Record<string, string> = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(found, digests(join(directory, entry.name), name));
    else {
      found[name] = createHash('sha256')
        .update(readFileSync(join(directory, entry.name)))
        .digest('hex');
    }
  }
  return found;
}

const readme = () => join(repo, '.mnema', 'README.md');
const ignore = () => join(repo, '.prettierignore');

function founded(): void {
  const result = runInit({ cwd: repo, env: env() });
  expect('refused' in result).toBe(false);
}

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

describe('mnema init in a project that is already founded', () => {
  it('creates a missing README and says it did, touching nothing else of the record', () => {
    founded();
    rmSync(readme());
    const before = digests(join(repo, '.mnema'));
    const again = runInit({ cwd: repo, env: env() });
    expect(again).toMatchObject({ created: false, completed: { readme: true } });
    expect(existsSync(readme())).toBe(true);
    const after = digests(join(repo, '.mnema'));
    delete after['README.md'];
    expect(after).toEqual(before);
  });

  it('leaves a project with its README and no prettier exactly as it was, and says nothing new', () => {
    founded();
    const before = digests(repo);
    const again = runInit({ cwd: repo, env: env() });
    expect(again).toMatchObject({ created: false });
    expect('completed' in again).toBe(false);
    expect(digests(repo)).toEqual(before);
  });

  it('adds the line where prettier is declared and the file lacks it, and says it did', () => {
    founded();
    writeFileSync(join(repo, 'package.json'), '{"devDependencies":{"prettier":"3"}}');
    const first = runInit({ cwd: repo, env: env() });
    expect(first).toMatchObject({
      created: false,
      completed: { readme: false, prettierIgnore: { path: ignore(), did: 'created' } },
    });
    expect(readFileSync(ignore(), 'utf-8')).toBe('.mnema/\n');
    writeFileSync(ignore(), 'dist');
    const second = runInit({ cwd: repo, env: env() });
    expect(second).toMatchObject({ completed: { prettierIgnore: { did: 'added' } } });
    expect(readFileSync(ignore(), 'utf-8')).toBe('dist\n.mnema/\n');
  });

  it('is idempotent: the second run after a completion writes nothing', () => {
    founded();
    rmSync(readme());
    writeFileSync(join(repo, '.prettierrc'), '{}');
    runInit({ cwd: repo, env: env() });
    const before = digests(repo);
    const again = runInit({ cwd: repo, env: env() });
    expect('completed' in again).toBe(false);
    expect(digests(repo)).toEqual(before);
  });
});

describe('mnema doctor, about what init leaves beside the record', () => {
  it('says nothing of a whole project, and nothing where there is no project', () => {
    expect(doctor()).toEqual([]);
    founded();
    expect(doctor()).toEqual([]);
  });

  it('points at a missing README and at a prettier that is not told, each with the fix, and writes nothing', () => {
    founded();
    rmSync(readme());
    writeFileSync(join(repo, 'package.json'), '{"prettier":{}}');
    const before = digests(repo);
    const lines = doctor();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('has no .mnema/README.md');
    expect(lines[0]).toContain('run `mnema init` to add it');
    expect(lines[1]).toContain('.prettierignore does not exist');
    expect(lines[1]).toContain('run `mnema init` to add the line');
    expect(digests(repo)).toEqual(before);
    runInit({ cwd: repo, env: env() });
    expect(doctor()).toEqual([]);
  });
});

describe('what the-record-page reads', () => {
  it('only reads: asking what is missing changes nothing on disk', () => {
    founded();
    rmSync(readme());
    writeFileSync(join(repo, '.prettierrc'), '{}');
    const before = digests(repo);
    expect(whatIsMissing(repo)).toEqual({
      readme: true,
      editorconfig: false,
      prettierIgnore: { path: ignore(), did: 'created' },
    });
    expect(digests(repo)).toEqual(before);
  });
});

describe('mnema doctor over a macOS metadata file under keys/', () => {
  const findings = () =>
    runDoctor({
      cwd: repo,
      env: env(),
      processEnv: { PATH: '' },
      running: { file: join(sandbox, 'mnema'), version: '9.9.9' },
    })
      .findings.filter((one) => one.topic === 'key-metadata')
      .map((one) => one.line);

  it('names the file so it can be deleted, and says nothing where there is none', () => {
    founded();
    expect(findings()).toEqual([]);
    mkdirSync(join(repo, '.mnema', 'keys'), { recursive: true });
    writeFileSync(join(repo, '.mnema', 'keys', `._${'a'.repeat(64)}.pub`), 'junk');
    const named = findings();
    expect(named).toHaveLength(1);
    expect(named[0]).toContain(`._${'a'.repeat(64)}.pub`);
    expect(named[0]).toContain('you can delete it');
  });
});
