/**
 * `mnema doctor`: what a machine says about how mnema is installed — the binary on the PATH,
 * the plugin and its version, the MCP server declared twice, a namesake — one line to a finding,
 * and not one byte written. Each case builds the machine in a sandbox and reads the answer.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DoctorContext, runDoctor } from '../src/commands/doctor.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages', 'code', 'dist', 'cli.js');

let sandbox: string;
let home: string;
let project: string;

function executable(path: string, body = '#!/bin/sh\n'): string {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return path;
}

function context(over: Partial<DoctorContext> & { path?: string } = {}): DoctorContext {
  return {
    cwd: project,
    env: { home },
    processEnv: { PATH: over.path ?? '' },
    running: { file: join(sandbox, 'running', 'mnema'), version: '9.9.9' },
    ...over,
  };
}

function said(over: Partial<DoctorContext> & { path?: string } = {}): string[] {
  return runDoctor(context(over)).findings.map((one) => `${one.state} ${one.topic} ${one.line}`);
}

function installPlugin(id: string, version: string): void {
  const file = join(home, '.claude', 'plugins', 'installed_plugins.json');
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({ version: 2, plugins: { [id]: [{ scope: 'user', version }] } }),
  );
}

/** Every file under `dir` with its bytes, so "writes nothing" is a comparison. */
function digest(dir: string): string {
  const lines: string[] = [];
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    lines.push(
      `${path} ${entry.isFile() ? readFileSync(path, 'utf-8') : ''} ${statSync(path).mtimeMs}`,
    );
  }
  return lines.sort().join('\n');
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-doctor-'));
  home = join(sandbox, 'home');
  project = join(sandbox, 'project');
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  executable(join(sandbox, 'running', 'mnema'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the binary on the PATH', () => {
  it('says there is none, and what to install', () => {
    const lines = said({ path: join(sandbox, 'empty') });
    expect(lines[0]).toContain('attention binary no “mnema” on the PATH');
    expect(lines[0]).toContain('npm i -g @mnema/code');
  });

  it('knows the first one on the PATH is the one running, and when it is not', () => {
    const mine = join(sandbox, 'running');
    expect(said({ path: mine })[0]).toContain('and it is the one running now (9.9.9)');
    const other = executable(join(sandbox, 'other', 'mnema'));
    const lines = said({ path: [join(sandbox, 'other'), mine].join(delimiter) });
    expect(lines[0]).toContain(`the first “mnema” on the PATH is ${other}`);
    expect(lines[0]).toContain('put the one you mean first on the PATH');
  });
});

describe('a namesake', () => {
  it('names a second executable on the PATH, and an npm package called mnema', () => {
    executable(join(sandbox, 'other', 'mnema'), '#!/bin/sh\necho other\n');
    const path = [join(sandbox, 'running'), join(sandbox, 'other')].join(delimiter);
    mkdirSync(join(sandbox, 'lib', 'node_modules', 'mnema'), { recursive: true });
    writeFileSync(
      join(sandbox, 'lib', 'node_modules', 'mnema', 'package.json'),
      JSON.stringify({ name: 'mnema', version: '3.2.1' }),
    );
    mkdirSync(join(sandbox, 'bin'), { recursive: true });
    const lines = said({ path: [path, join(sandbox, 'bin')].join(delimiter) });
    const namesakes = lines.filter((line) => line.startsWith('attention namesake'));
    expect(namesakes.some((line) => line.includes('2 different “mnema” executables'))).toBe(true);
    expect(
      namesakes.some((line) => line.includes('an npm package named “mnema” 3.2.1 is installed')),
    ).toBe(true);
  });

  it('says when there is none, and that the registry was not asked', () => {
    const lines = said({ path: join(sandbox, 'running') });
    expect(lines.find((line) => line.includes('namesake'))).toContain('the registry was not asked');
    expect(lines.filter((line) => line.startsWith('attention namesake'))).toEqual([]);
  });
});

describe('the plugin', () => {
  it('names its version, and asks for an update when it differs from the binary', () => {
    installPlugin('mnema@mnema', '9.9.9');
    expect(said().find((line) => line.includes('plugin mnema@mnema'))).toContain(
      'fine plugin plugin mnema@mnema is installed at 9.9.9',
    );
    installPlugin('mnema@mnema', '0.0.1');
    expect(said().find((line) => line.includes('plugin mnema@mnema'))).toContain(
      'attention plugin plugin mnema@mnema is installed at 0.0.1 (user scope) and this binary is 9.9.9',
    );
  });

  it('says what to install when the list holds none, and that it is unknown when it cannot be read', () => {
    installPlugin('another@marketplace', '1.0.0');
    expect(said().find((line) => line.startsWith('fine plugin'))).toContain(
      'claude plugin install mnema-server-only@mnema',
    );
    rmSync(join(home, '.claude'), { recursive: true });
    expect(said().find((line) => line.startsWith('fine plugin'))).toContain(
      'whether the plugin is installed is unknown',
    );
  });
});

describe('the MCP server declared twice', () => {
  it('counts the plugin and a configured server as two, and one alone as one', () => {
    writeFileSync(
      join(project, '.mcp.json'),
      JSON.stringify({ mcpServers: { mnema: { command: 'mnema', args: ['mcp'] } } }),
    );
    expect(said().find((line) => line.includes(' mcp '))).toContain('declared once');
    installPlugin('mnema@mnema', '9.9.9');
    const twice = said().find((line) => line.includes(' mcp '));
    expect(twice).toContain('attention mcp the mnema MCP server is declared 2 times');
    expect(twice).toContain('the plugin mnema@mnema');
    expect(twice).toContain('keep one and remove the others');
  });

  it('finds a server under another name when it starts `mnema mcp`', () => {
    mkdirSync(join(project, '.vscode'), { recursive: true });
    writeFileSync(
      join(project, '.vscode', 'mcp.json'),
      JSON.stringify({ servers: { memory: { command: '/usr/local/bin/mnema', args: ['mcp'] } } }),
    );
    expect(said().find((line) => line.includes(' mcp '))).toContain('“memory” in');
  });

  it('says what it looked at when there is none', () => {
    expect(said().find((line) => line.includes(' mcp '))).toContain(
      `no mnema MCP server declared in ${join(project, '.mcp.json')}`,
    );
  });
});

describe('mnema doctor, as a person runs it', () => {
  it('prints one line to a finding, exits 0, and writes nothing', () => {
    installPlugin('mnema@mnema', '0.0.1');
    const before = digest(sandbox);
    const ran = spawnSync(process.execPath, [CLI, 'doctor'], {
      cwd: project,
      encoding: 'utf-8',
      env: { HOME: home, PATH: join(sandbox, 'running') },
    });
    expect(ran.status).toBe(0);
    const lines = ran.stdout.trimEnd().split('\n');
    expect(lines.map((line) => line.split(':')[0])).toEqual([
      'to do · binary',
      'to do · plugin',
      'ok · mcp',
      'ok · namesake',
    ]);
    expect(digest(sandbox)).toBe(before);
  });
});
