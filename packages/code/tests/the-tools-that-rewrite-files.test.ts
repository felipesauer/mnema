/**
 * What `mnema doctor` and the session brief say of the tools, other than prettier, that would
 * rewrite the signed record: a pre-commit hook, Biome, dprint and lint-staged
 * (`src/commands/the-tools-that-rewrite-files.ts`). Each is asserted with its exclusion (silent),
 * without it (a warning with the line to add) and in a form that cannot be read (a warning that
 * says it could not be confirmed). Nothing is edited. And prettier in a subproject: its
 * `.prettierignore` is looked for where prettier is declared, from the project up to the git root.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type BriefDone, runBrief } from '../src/commands/brief.js';
import { runDoctor } from '../src/commands/doctor.js';
import { runInit } from '../src/commands/init.js';
import { whatIsMissing } from '../src/commands/the-record-page.js';
import { toolsThatRewrite } from '../src/commands/the-tools-that-rewrite-files.js';

let sandbox: string;
let repo: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-tools-reach-'));
  repo = join(sandbox, 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

const put = (name: string, text: string, dir = repo): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), text);
};
const reach = (dir = repo) => toolsThatRewrite(dir).map((r) => `${r.tool}${r.unsure ? '?' : ''}`);

describe('pre-commit', () => {
  const hooks = (extra = '') =>
    `${extra}repos:\n  - repo: https://github.com/pre-commit/pre-commit-hooks\n    rev: v4.5.0\n    hooks:\n      - id: end-of-file-fixer\n      - id: check-yaml\n`;

  it('warns of a hook that rewrites, with the exclude to add', () => {
    put('.pre-commit-config.yaml', hooks());
    expect(reach()).toEqual(['pre-commit']);
    expect(toolsThatRewrite(repo)[0]?.add).toBe('exclude: ^\\.mnema/');
  });

  it('is silent with a top-level exclude that covers .mnema, or one on the hook', () => {
    put('.pre-commit-config.yaml', hooks('exclude: ^\\.mnema/\n'));
    expect(reach()).toEqual([]);
    put(
      '.pre-commit-config.yaml',
      'repos:\n  - repo: x\n    hooks:\n      - id: trailing-whitespace\n        exclude: ^(\\.mnema/|docs/)\n',
    );
    expect(reach()).toEqual([]);
    put('.pre-commit-config.yaml', hooks('exclude: |\n  (?x)^(\n    \\.mnema/|dist/\n  )\n'));
    expect(reach()).toEqual([]);
  });

  it('is not satisfied by an exclude on ANOTHER hook, and is silent when no hook rewrites', () => {
    put(
      '.pre-commit-config.yaml',
      'repos:\n  - repo: x\n    hooks:\n      - id: check-yaml\n        exclude: ^\\.mnema/\n      - id: end-of-file-fixer\n',
    );
    expect(reach()).toEqual(['pre-commit']);
    put('.pre-commit-config.yaml', 'repos:\n  - repo: x\n    hooks:\n      - id: check-yaml\n');
    expect(reach()).toEqual([]);
  });

  it('says it could not confirm a form it does not read', () => {
    put('.pre-commit-config.yaml', 'repos: [{repo: x, hooks: [{id: end-of-file-fixer}]}]\n');
    expect(reach()).toEqual(['pre-commit?']);
  });
});

describe('Biome', () => {
  it('warns when the files section does not exclude .mnema, with the form of its version', () => {
    put('biome.json', '{"$schema":"https://biomejs.dev/schemas/1.9.4/schema.json"}');
    expect(toolsThatRewrite(repo)[0]?.add).toContain('"ignore": [".mnema"]');
    put('biome.json', '{"$schema":"https://biomejs.dev/schemas/2.5.15/schema.json"}');
    expect(toolsThatRewrite(repo)[0]?.add).toContain('"!.mnema"');
  });

  it('is silent where either form excludes it', () => {
    put('biome.json', '{"files":{"ignore":[".mnema"]}}');
    expect(reach()).toEqual([]);
    put('biome.json', '{"files":{"includes":["**","!.mnema"]}}');
    expect(reach()).toEqual([]);
    put('biome.json', '{"files":{"includes":["**","!**/.mnema"]}}');
    expect(reach()).toEqual([]);
  });

  it('reads biome.jsonc with comments and trailing commas', () => {
    put(
      'biome.jsonc',
      '{\n  // keep the record out\n  "files": { "includes": ["**", "!.mnema",], },\n}\n',
    );
    expect(reach()).toEqual([]);
    put('biome.jsonc', '{\n  /* nothing */\n  "formatter": { "enabled": true, },\n}\n');
    expect(reach()).toEqual(['biome']);
  });

  it('says it could not confirm a config that does not parse', () => {
    put('biome.json', '{ not json');
    expect(reach()).toEqual(['biome?']);
  });
});

describe('dprint', () => {
  it('warns without .mnema in excludes, and is silent with it', () => {
    put('dprint.json', '{"plugins":["https://plugins.dprint.dev/json-0.19.0.wasm"]}');
    expect(reach()).toEqual(['dprint']);
    put('dprint.json', '{"excludes":["node_modules",".mnema"]}');
    expect(reach()).toEqual([]);
    put('dprint.json', '{"excludes":["**/.mnema/**"]}');
    expect(reach()).toEqual([]);
    put('dprint.json', '{"excludes":[".mnema/**"]}');
    expect(reach()).toEqual([]);
    put('dprint.json', '{"excludes":["docs/.mnema-notes"]}');
    expect(reach()).toEqual(['dprint']);
  });

  it('reads .dprint.json, and says it could not confirm one that does not parse', () => {
    put('.dprint.json', '{"excludes":[".mnema"]}');
    expect(reach()).toEqual([]);
    put('.dprint.json', '{ nope');
    expect(reach()).toEqual(['dprint?']);
  });
});

describe('lint-staged', () => {
  it('warns of a glob that reaches the record with a command that writes, in package.json', () => {
    put('package.json', '{"lint-staged":{"*.json":"prettier --write"}}');
    expect(reach()).toEqual(['lint-staged']);
    put('package.json', '{"lint-staged":{"**/*":["eslint --fix","prettier --write"]}}');
    expect(reach()).toEqual(['lint-staged']);
    put('package.json', '{"lint-staged":{"*":"biome format --write"}}');
    expect(reach()).toEqual(['lint-staged']);
  });

  it('is silent for a glob that does not reach it, or a command that only reads', () => {
    put('package.json', '{"lint-staged":{"*.ts":"prettier --write"}}');
    expect(reach()).toEqual([]);
    put('package.json', '{"lint-staged":{"*.json":"prettier --check"}}');
    expect(reach()).toEqual([]);
    put('package.json', '{"lint-staged":{"src/**/*":"prettier --write"}}');
    expect(reach()).toEqual([]);
    put('package.json', '{"name":"x"}');
    expect(reach()).toEqual([]);
  });

  it('reads .lintstagedrc as JSON or as simple YAML, and says it could not confirm a script', () => {
    put('package.json', '{}');
    put('.lintstagedrc', '{"*.json":"prettier --write"}');
    expect(reach()).toEqual(['lint-staged']);
    rmSync(join(repo, '.lintstagedrc'));
    put('.lintstagedrc.yaml', "'*.json':\n  - prettier --write\n");
    expect(reach()).toEqual(['lint-staged']);
    put('.lintstagedrc.yaml', "'*.ts': eslint --fix\n");
    expect(reach()).toEqual([]);
    rmSync(join(repo, '.lintstagedrc.yaml'));
    put('lint-staged.config.mjs', 'export default { "*": (files) => files }\n');
    expect(reach()).toEqual(['lint-staged?']);
  });
});

describe('where it is looked for', () => {
  it('finds a configuration in the project directory and in the git root above it', () => {
    const sub = join(repo, 'packages', 'app');
    put('dprint.json', '{}');
    put('biome.json', '{}', sub);
    expect(reach(sub).sort()).toEqual(['biome', 'dprint']);
  });
});

describe('mnema doctor and mnema brief', () => {
  const doctor = (): string[] =>
    runDoctor({
      cwd: repo,
      env: { home: join(sandbox, 'home') },
      processEnv: { PATH: '' },
      running: { file: join(sandbox, 'mnema'), version: '9.9.9' },
    })
      .findings.filter((one) => one.topic === 'record-page')
      .map((one) => one.line);

  it('say each one, with its file and the line to add, and edit nothing', () => {
    expect('refused' in runInit({ cwd: repo, env: { home: join(sandbox, 'home') } })).toBe(false);
    expect(doctor()).toEqual([]);
    put('dprint.json', '{"plugins":[]}');
    put(
      '.pre-commit-config.yaml',
      'repos:\n  - repo: x\n    hooks:\n      - id: mixed-line-ending\n',
    );
    const before = readFileSync(join(repo, 'dprint.json'), 'utf-8');
    const lines = doctor();
    expect(lines).toHaveLength(2);
    expect(
      lines.some((l) => l.includes('dprint.json') && l.includes('"excludes": [".mnema"]')),
    ).toBe(true);
    expect(
      lines.some((l) => l.includes('.pre-commit-config.yaml') && l.includes('exclude: ^\\.mnema/')),
    ).toBe(true);
    expect(readFileSync(join(repo, 'dprint.json'), 'utf-8')).toBe(before);
    expect(whatIsMissing(repo).prettierIgnore).toBeUndefined();
  });

  it('say it could not confirm, and the brief carries the same lines when asked', () => {
    runInit({ cwd: repo, env: { home: join(sandbox, 'home') } });
    put('biome.json', '{ not json');
    const lines = doctor();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('could not be confirmed');
    const brief = runBrief({ cwd: repo, env: { home: join(sandbox, 'home') } }, { outside: true });
    expect((brief as BriefDone).formatter).toEqual(lines);
    const without = runBrief({ cwd: repo, env: { home: join(sandbox, 'home') } }, {});
    expect((without as BriefDone).formatter).toBeUndefined();
  });
});

describe('prettier in a subproject of a monorepo', () => {
  it("is declared in the subproject's own package.json: the .prettierignore is that directory's", () => {
    const sub = join(repo, 'packages', 'app');
    put('package.json', '{"devDependencies":{"prettier":"3"}}');
    put('package.json', '{"devDependencies":{"prettier":"3"}}', sub);
    runInit({ cwd: sub, env: { home: join(sandbox, 'home') } });
    expect(whatIsMissing(sub).prettierIgnore).toBeUndefined();
    expect(readFileSync(join(sub, '.prettierignore'), 'utf-8')).toBe('.mnema/\n');
    expect(() => readFileSync(join(repo, '.prettierignore'))).toThrow();
  });

  it("is declared only at the root: the root's .prettierignore, as before", () => {
    const sub = join(repo, 'packages', 'app');
    put('package.json', '{"devDependencies":{"prettier":"3"}}');
    mkdirSync(sub, { recursive: true });
    runInit({ cwd: sub, env: { home: join(sandbox, 'home') } });
    expect(readFileSync(join(repo, '.prettierignore'), 'utf-8')).toBe('.mnema/\n');
  });

  it('is declared in a .prettierrc of the subproject with no package.json there', () => {
    const sub = join(repo, 'packages', 'app');
    put('.prettierrc', '{}', sub);
    expect(whatIsMissing(sub).prettierIgnore).toEqual({
      path: join(sub, '.prettierignore'),
      did: 'created',
    });
  });

  it('is not declared anywhere: nothing is created, and a root file that exists still gets the line', () => {
    const sub = join(repo, 'packages', 'app');
    mkdirSync(sub, { recursive: true });
    expect(whatIsMissing(sub).prettierIgnore).toBeUndefined();
    put('.prettierignore', 'dist\n');
    expect(whatIsMissing(sub).prettierIgnore).toEqual({
      path: join(repo, '.prettierignore'),
      did: 'added',
    });
  });
});
