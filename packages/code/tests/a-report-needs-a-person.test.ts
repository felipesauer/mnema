/**
 * A REPORT OF AN INTERNAL ERROR REACHES NOBODY BUT A PERSON, AND ONLY THROUGH THEIR OWN CLICK.
 *
 * mnema prints a link and makes no request; the link opens GitHub's form with the report in it
 * and the person presses Submit there. This file holds the three halves of that promise:
 *   - the LINK is fixed, carries only the text the person was shown, fits what GitHub takes, and
 *     opens a form (`.github/ISSUE_TEMPLATE/internal_error.yml`) whose field ids it fills;
 *   - the PERSON is a terminal: without one `mnema report` prints no link and a failing verb
 *     offers nothing, and both are proved on the built binary, once with a pipe and once under a
 *     real pseudo-terminal;
 *   - the AGENT is told, in the handshake, to tell the person — and no tool of the server
 *     reports, sends, accepts or declines.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureTree } from '@mnema/chain';
import { PROJECT_DIR } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { whereToSend } from '../src/commands/report.js';
import { appendDiagnostic } from '../src/diagnostic-log.js';
import { HOST_NAMES, HOSTS } from '../src/host-names.js';
import { SERVER_INSTRUCTIONS } from '../src/mcp/instructions.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { diagnose, renderReport } from '../src/problem-report.js';
import {
  emptyForm,
  ISSUE_REPO,
  ISSUE_TEMPLATE,
  issueLink,
  LINK_LIMIT,
  REPORT_FIELD,
} from '../src/report-link.js';
import { VERSION } from '../src/version.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const PROGRAM = pathToFileURL(fileURLToPath(new URL('../dist/program.js', import.meta.url))).href;
const WIRING_IO = pathToFileURL(
  fileURLToPath(new URL('../dist/wiring/io.js', import.meta.url)),
).href;
const TEMPLATES = fileURLToPath(new URL('../../../.github/ISSUE_TEMPLATE/', import.meta.url));

/** The handshake ceiling the host was measured to keep, in characters (`a-servers-instructions-are-cut-at-2048`). */
const INSTRUCTIONS_CEILING = 2048;

let sandbox: string;
let home: string;
let dataDir: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-report-person-'));
  home = join(sandbox, 'home');
  dataDir = join(sandbox, 'data');
  mkdirSync(home, { recursive: true });
});
afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A real report, made the way the product makes one. */
function aReport() {
  const error = new TypeError('boom');
  error.stack = [
    'TypeError: boom',
    '    at readIt (/somewhere/packages/code/src/commands/show.ts:41:9)',
  ].join('\n');
  const diagnostic = diagnose(error, {
    now: new Date('2026-10-08T12:00:00.000Z'),
    version: VERSION,
    node: 'v24.15.0',
    platform: 'linux',
    arch: 'x64',
    argv: ['show'],
    verbs: ['show', 'report'],
  });
  expect(diagnostic).toBeDefined();
  if (diagnostic === undefined) throw new Error('unreachable');
  const rendered = renderReport(diagnostic);
  if (rendered.refused) throw new Error('the example report was refused');
  return { diagnostic, rendered };
}

/** The sandbox environment of a binary: nothing of the real machine. */
function sandboxEnv(): NodeJS.ProcessEnv {
  return {
    HOME: home,
    MNEMA_HOME: dataDir,
    PATH: process.env.PATH,
    GIT_CONFIG_NOSYSTEM: '1',
    TERM: 'xterm',
  };
}

/** Runs `argv` (a shell line) with a pipe on every stream, and then under a pseudo-terminal. */
function bothWays(line: string): { piped: string; terminal: string } {
  const piped = execFileSync('sh', ['-c', `(${line}) 2>&1; true`], {
    env: sandboxEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const terminal = execFileSync('script', ['-qec', `(${line}) 2>&1; true`, '/dev/null'], {
    env: sandboxEnv(),
    encoding: 'utf8',
  });
  return { piped, terminal };
}

describe('the link', () => {
  it('opens the fixed repository and form, and carries the report the person was shown, decoded', () => {
    const { rendered } = aReport();
    const link = issueLink(rendered);
    expect(link).toBeDefined();
    const url = new URL(link as string);
    expect(`${url.origin}${url.pathname}`).toBe(`https://github.com/${ISSUE_REPO}/issues/new`);
    expect(ISSUE_REPO).toBe('felipesauer/mnema');
    expect([...url.searchParams.keys()]).toEqual(['template', 'title', REPORT_FIELD]);
    expect(url.searchParams.get('template')).toBe(ISSUE_TEMPLATE);
    expect(url.searchParams.get('title')).toBe(rendered.title);
    expect(url.searchParams.get(REPORT_FIELD)).toBe(rendered.body);
    // The title and the body are the shown text and nothing else.
    expect(`${rendered.title}\n\n${url.searchParams.get(REPORT_FIELD)}`).toBe(rendered.text);
  });

  it('carries no path, address or place of this machine', () => {
    const { rendered } = aReport();
    const link = decodeURIComponent(issueLink(rendered) as string);
    expect(link).not.toMatch(/\/somewhere|\/home\/|@[\w-]+\.\w+|file:\/\//);
  });

  it('holds the ceiling to the character: at it a link, one past it none', () => {
    const base = { title: 't' };
    const empty = issueLink({ ...base, body: '' }) as string;
    const room = LINK_LIMIT - empty.length;
    expect(issueLink({ ...base, body: 'a'.repeat(room) })?.length).toBe(LINK_LIMIT);
    expect(issueLink({ ...base, body: 'a'.repeat(room + 1) })).toBeUndefined();
  });

  it('is far under the ceiling for a real report, and the ceiling is under what GitHub took', () => {
    const { rendered } = aReport();
    const length = (issueLink(rendered) as string).length;
    expect(length).toBeGreaterThan(200);
    expect(length).toBeLessThan(1500);
    // Measured on the public form, 8 October 2026: a link of 7,021 characters was answered, 7,041
    // failed, 8,211 came back 414. The ceiling keeps a margin under the first.
    expect(LINK_LIMIT).toBeLessThan(7021);
  });
});

describe('the form the link opens', () => {
  const form = readFileSync(join(TEMPLATES, 'internal_error.yml'), 'utf8');
  const ids = (text: string) => [...text.matchAll(/^\s+id:\s*(\S+)\s*$/gm)].map((m) => m[1]);

  it('has a field for the id the link fills, and is the template the link names', () => {
    expect(ids(form)).toContain(REPORT_FIELD);
    expect(readdirSync(TEMPLATES)).toContain(ISSUE_TEMPLATE);
    expect(form).toContain('title: "[internal] "');
  });

  it('leaves the person a field the link does not fill', () => {
    expect(ids(form).filter((id) => id !== REPORT_FIELD)).toEqual(['what-you-were-doing']);
  });

  it('keeps no template that asks for the audit trail, and the bug report is a form', () => {
    const files = readdirSync(TEMPLATES);
    expect(files).toContain('bug_report.yml');
    expect(files).not.toContain('bug_report.md');
    for (const file of files) {
      const text = readFileSync(join(TEMPLATES, file), 'utf8');
      expect(text, file).not.toMatch(/current\.jsonl|audit trail|\.mnema\/audit/i);
    }
  });
});

describe('the person is a terminal', () => {
  const report = () => aReport().rendered;

  it('prints the link to a person and none to anything else', () => {
    const { title, body } = report();
    const toAPerson = whereToSend({ title, body }, '/draft.md', true);
    const toAScript = whereToSend({ title, body }, '/draft.md', false);
    expect(toAPerson.some((line) => line.startsWith('https://github.com/'))).toBe(true);
    expect(toAScript.join('\n')).not.toContain('https://');
    expect(toAScript.join('\n')).not.toContain(title);
  });

  it('sends a report too long for a link to the saved file, with the empty form', () => {
    const { title, body } = report();
    const lines = whereToSend({ title, body }, '/draft.md', true, 10);
    expect(lines.join('\n')).toContain(emptyForm());
    expect(lines.join('\n')).toContain('/draft.md');
    expect(lines.some((line) => line.includes('&title='))).toBe(false);
  });

  it('on the built binary: `mnema report` shows a link under a terminal and none through a pipe', () => {
    appendDiagnostic(join(dataDir, 'global'), aReport().diagnostic);
    const { piped, terminal } = bothWays(`node ${CLI} report`);
    expect(terminal).toContain(`https://github.com/${ISSUE_REPO}/issues/new?template=`);
    expect(piped).not.toContain('https://');
    // Both showed the whole report.
    expect(piped).toContain(aReport().rendered.title);
    expect(terminal).toContain(aReport().rendered.title);
  }, 60_000);

  it('on the built binary: a failing verb offers a report under a terminal, and never through a pipe', () => {
    // A verb that throws an engine error, run through the real program on the real streams.
    const script = [
      `import { buildProgram, parseWith } from '${PROGRAM}';`,
      `import { processIo } from '${WIRING_IO}';`,
      'const built = buildProgram(processIo, []);',
      "built.program.command('boom').action(() => { throw new TypeError('x'); });",
      "await parseWith(built, ['boom']);",
    ].join('\n');
    const line = `node --input-type=module -e "${script.replaceAll('"', '\\"').replaceAll('\n', ' ')}"`;
    const { piped, terminal } = bothWays(line);
    expect(terminal).toContain('mnema report');
    expect(piped).toContain('internal error');
    expect(piped).not.toContain('mnema report');
  }, 60_000);
});

describe('the agent is told, and can do nothing about it', () => {
  async function connected(): Promise<Client> {
    const project = join(sandbox, 'proj');
    mkdirSync(project, { recursive: true });
    ensureTree({ root: join(project, PROJECT_DIR) });
    const { server } = buildMcpServer({ cwd: sandbox, env: { home }, log: () => {} });
    const client = new Client(
      { name: 'claude-code', version: '1.0.0' },
      { capabilities: { roots: {} } },
    );
    client.setRequestHandler(ListRootsRequestSchema, () => ({
      roots: [{ uri: pathToFileURL(project).href }],
    }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return client;
  }

  it('serves no tool that reports, sends, accepts, declines or switches reporting', async () => {
    const client = await connected();
    const { tools } = await client.listTools();
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    await client.close();
    expect(tools.length).toBeGreaterThan(10);
    const names = tools.map((tool) => tool.name);
    expect(
      names.filter((name) => /report|send|accept|decline|submit|issue|telemetry/i.test(name)),
    ).toEqual([]);
    for (const tool of tools) {
      const fields = Object.keys(tool.inputSchema.properties ?? {});
      expect(
        fields.filter((field) => /report|decline|accept/i.test(field)),
        tool.name,
      ).toEqual([]);
    }
  });

  it('says in the handshake that the person runs it and that no tool does', () => {
    expect(SERVER_INSTRUCTIONS).toContain('tell the person they can run `mnema report`');
    expect(SERVER_INSTRUCTIONS).toContain('no tool here reports, sends or accepts one');
  });

  it('fits the ceiling of every host that carries the server’s words', () => {
    const carrying = HOST_NAMES.filter((name) => HOSTS[name].cells.server.does);
    expect(carrying.length).toBeGreaterThan(0);
    for (const name of carrying) {
      expect(SERVER_INSTRUCTIONS.length, name).toBeLessThanOrEqual(INSTRUCTIONS_CEILING);
    }
  });

  it('puts the product’s words nowhere that makes a request', () => {
    for (const file of ['report-link.ts', 'commands/report.ts']) {
      const source = readFileSync(
        fileURLToPath(new URL(`../src/${file}`, import.meta.url)),
        'utf8',
      );
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, file).not.toMatch(
        /fetch\(|node:https?|node:net|child_process|xdg-open|\bopen\(|spawn/,
      );
    }
  });
});
