/**
 * `mnema doctor` and VS Code's agent, and the machine's leftovers: whether `settings.json` lists
 * the plugin, at which path, and what `mnema doctor --fix vscode` does to the file; the projects
 * of `~/.claude.json` that still declare the server; a script that shadows the real `mnema`.
 * Every case builds the machine under a sandbox HOME; the doctor is handed that HOME and never
 * reads the real one.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixVscode, runDoctor } from '../src/commands/doctor.js';

const CLI = join(fileURLToPath(new URL('../../../', import.meta.url)), 'packages/code/dist/cli.js');
const VERSION = '9.9.9';

let sandbox: string;
let home: string;
let project: string;
let settings: string;
let stable: string;

function plugin(dir: string, version: string): void {
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
  writeFileSync(
    join(dir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'mnema', version }),
  );
}

function write(path: string, text: string): string {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
  return path;
}

function said(topic: string): string[] {
  return runDoctor({
    cwd: project,
    env: { home },
    processEnv: { PATH: '' },
    running: { file: join(sandbox, 'x', 'mnema'), version: VERSION },
    platform: 'linux',
  })
    .findings.filter((one) => one.topic === topic)
    .map((one) => `${one.state} ${one.line}`);
}

function cli(...args: string[]): { status: number | null; out: string; err: string } {
  const ran = spawnSync(process.execPath, [CLI, 'doctor', ...args], {
    cwd: project,
    encoding: 'utf-8',
    env: { HOME: home, PATH: join(sandbox, 'x') },
  });
  return { status: ran.status, out: ran.stdout, err: ran.stderr };
}

function backups(): string[] {
  return readdirSync(join(settings, '..')).filter((name) => name.includes('mnema-backup'));
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-doctor-vscode-'));
  home = join(sandbox, 'home');
  project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  settings = join(home, '.config', 'Code', 'User', 'settings.json');
  stable = join(home, '.claude', 'plugins', 'marketplaces', 'mnema', 'plugin');
});

afterEach(() => rmSync(sandbox, { recursive: true, force: true }));

describe('what the doctor says about VS Code’s settings.json', () => {
  it('says there is none to read, and that this is fine', () => {
    const lines = said('vscode');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^fine no VS Code user settings\.json found/);
  });

  it('says the setting is missing, and the one command that fixes it', () => {
    plugin(stable, VERSION);
    write(settings, '{ // mine\n  "editor.fontSize": 14,\n}\n');
    const [line] = said('vscode');
    expect(line).toMatch(/^attention /);
    expect(line).toContain('does not set chat.pluginLocations');
    expect(line).toContain('`mnema doctor --fix vscode`');
    expect(line).not.toContain('install the plugin first');
  });

  it('says to install the plugin first when the marketplace copy is not there', () => {
    write(settings, '{}');
    expect(said('vscode')[0]).toContain('install the plugin first');
  });

  it('says a versioned path stops working at the next update, and a stale one is not the binary’s', () => {
    plugin(stable, VERSION);
    const current = join(home, '.claude', 'plugins', 'cache', 'mnema', 'mnema', VERSION);
    plugin(current, VERSION);
    write(settings, JSON.stringify({ 'chat.pluginLocations': { [current]: true } }));
    expect(said('vscode')[0]).toMatch(/^attention .*versioned path that stops working/);

    const old = join(home, '.claude', 'plugins', 'cache', 'mnema', 'mnema', '0.0.1');
    plugin(old, '0.0.1');
    write(settings, JSON.stringify({ 'chat.pluginLocations': { [old]: true } }));
    expect(said('vscode')[0]).toContain('not the 9.9.9 of this binary');
  });

  it('says nothing is to be done when the stable path is listed and holds this version', () => {
    plugin(stable, VERSION);
    write(settings, JSON.stringify({ 'chat.pluginLocations': { [stable]: true } }));
    expect(said('vscode')[0]).toMatch(/^fine .*does not change when it updates/);
  });

  it('reads the snap’s older place, and says when it cannot read a file', () => {
    const snap = join(home, 'snap', 'code', 'current', '.config', 'Code', 'User', 'settings.json');
    write(snap, '{ /* never closed ');
    const [line] = said('vscode');
    expect(line).toContain('snap/code/current');
    expect(line).toMatch(/^attention .*could not be read safely/);
  });
});

describe('mnema doctor --fix vscode, as a person runs it', () => {
  const COMMENTED = [
    '{',
    '    // the editor',
    '    "editor.fontSize": 14, // big',
    '    "files.autoSave": "off",',
    '}',
    '',
  ].join('\n');

  it('shows what it will change, keeps a copy, keeps the comments, and a second run changes nothing', () => {
    plugin(stable, VERSION);
    write(settings, COMMENTED);

    const dry = cli('--fix', 'vscode', '--dry-run');
    expect(dry.status).toBe(0);
    expect(dry.out).toContain('would add chat.pluginLocations');
    expect(readFileSync(settings, 'utf-8')).toBe(COMMENTED);
    expect(backups()).toEqual([]);

    const ran = cli('--fix', 'vscode');
    expect(ran.status).toBe(0);
    const after = readFileSync(settings, 'utf-8');
    expect(after).toContain('// the editor');
    expect(after).toContain('"editor.fontSize": 14, // big');
    expect(after).toContain(`"${stable}": true`);
    expect(backups()).toHaveLength(1);
    const [copy] = backups();
    expect(readFileSync(join(settings, '..', copy ?? ''), 'utf-8')).toBe(COMMENTED);

    const again = cli('--fix', 'vscode');
    expect(again.out).toContain('nothing to change');
    expect(readFileSync(settings, 'utf-8')).toBe(after);
    expect(backups()).toHaveLength(1);

    // and what the doctor says afterwards is that nothing is left to do
    expect(said('vscode')[0]).toMatch(/^fine /);
  });

  it('refuses a file it cannot edit safely, says why, exits 1 and leaves it as it was', () => {
    plugin(stable, VERSION);
    write(settings, '{ "a": 1 } // fine\n{ "b": 2 }');
    const ran = cli('--fix', 'vscode');
    expect(ran.status).toBe(1);
    expect(ran.out).toContain('refused, nothing changed');
    expect(readFileSync(settings, 'utf-8')).toBe('{ "a": 1 } // fine\n{ "b": 2 }');
    expect(backups()).toEqual([]);
  });

  it('refuses when the plugin is not installed, and when there is no settings file', () => {
    write(settings, '{}');
    expect(cli('--fix', 'vscode').out).toContain('the plugin is not at');
    expect(readFileSync(settings, 'utf-8')).toBe('{}');
    rmSync(settings);
    plugin(stable, VERSION);
    const ran = fixVscode(
      {
        cwd: project,
        env: { home },
        processEnv: {},
        running: { file: '', version: VERSION },
        platform: 'linux',
      },
      { dryRun: false },
    );
    expect(ran.refused).toBe(true);
    expect(ran.lines[0]).toContain('does not create one');
  });

  it('replaces the entry at a versioned path with the stable one', () => {
    plugin(stable, VERSION);
    const old = join(home, '.claude', 'plugins', 'cache', 'mnema', 'mnema', '0.0.1');
    plugin(old, '0.0.1');
    write(
      settings,
      `{\n  "chat.pluginLocations": {\n    // kept\n    "${home}/mine": true,\n    "${old}": true\n  }\n}\n`,
    );
    expect(cli('--fix', 'vscode').status).toBe(0);
    const after = readFileSync(settings, 'utf-8');
    expect(after).not.toContain(old);
    expect(after).toContain('// kept');
    expect(after).toContain(`"${stable}": true`);
  });

  it('is never run by the plain verb: asked alone it writes not a byte', () => {
    plugin(stable, VERSION);
    write(settings, COMMENTED);
    cli();
    expect(readFileSync(settings, 'utf-8')).toBe(COMMENTED);
    expect(backups()).toEqual([]);
    expect(cli('--dry-run').status).toBe(1);
    expect(cli('--fix', 'everything').status).toBe(1);
  });
});

describe('the leftovers of an earlier install', () => {
  it('sees the server declared for a project whose directory is gone, and says how to remove it', () => {
    const live = join(sandbox, 'alive');
    mkdirSync(live);
    write(
      join(home, '.claude.json'),
      JSON.stringify({
        projects: {
          [join(sandbox, 'gone')]: { mcpServers: { mnema: { command: 'mnema', args: ['mcp'] } } },
          [live]: { mcpServers: { mnema: { command: 'mnema', args: ['mcp'] } } },
          [join(sandbox, 'other')]: { mcpServers: { unrelated: { command: 'x' } } },
        },
      }),
    );
    const lines = said('mcp');
    const orphan = lines.find((line) => line.startsWith('attention '));
    expect(orphan).toContain(join(sandbox, 'gone'));
    expect(orphan).toContain('no longer exist');
    expect(orphan).toContain('`claude mcp remove` cannot reach those');
    expect(orphan).not.toContain(live);
    expect(lines.find((line) => line.includes('also declared'))).toContain(live);
  });

  it('names the script that shadows the real mnema, and says it is a wrapper', () => {
    const wrapper = join(sandbox, 'local', 'mnema');
    write(wrapper, '#!/bin/sh\nexec node /old/mnema.js "$@"\n');
    chmodSync(wrapper, 0o755);
    const real = write(join(sandbox, 'lib', 'cli.js'), '#!/usr/bin/env node\n');
    chmodSync(real, 0o755);
    mkdirSync(join(sandbox, 'bin'));
    symlinkSync(real, join(sandbox, 'bin', 'mnema'));
    const lines = runDoctor({
      cwd: project,
      env: { home },
      processEnv: { PATH: [join(sandbox, 'local'), join(sandbox, 'bin')].join(delimiter) },
      running: { file: real, version: VERSION },
      platform: 'linux',
    }).findings.filter((one) => one.topic === 'namesake');
    const line = lines[0]?.line ?? '';
    expect(line).toContain(`${wrapper} comes first and shadows ${join(sandbox, 'bin', 'mnema')}`);
    expect(line).toContain('probably a wrapper an earlier install left');
  });
});
