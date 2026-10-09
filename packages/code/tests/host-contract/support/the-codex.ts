/**
 * THE REAL CODEX, against a stand-in for the Responses API, with the plugin of this tree installed
 * the way a person installs it: `codex plugin marketplace add <this repository>`, then `codex
 * plugin add mnema@mnema`. Codex reads the plugin's own manifest (`plugin/.codex-plugin/
 * plugin.json`), which names its own hooks file.
 *
 * THE MODEL IS A STAND-IN THAT SPEAKS RESPONSES. Codex is pointed at it through a model provider
 * of the config (`base_url`, `wire_api = "responses"`) with a made-up key that names no account.
 * It answers the first request that offers `apply_patch` and carries no result with ONE call to
 * it, and everything else with a closing message. The model slug is one of the bundled catalog
 * (`gpt-5.5`), because Codex offers `apply_patch` only to a model whose metadata says so; nothing
 * is asked of the vendor for it.
 *
 * WHAT ISOLATES IT is what isolates the Claude Code run: the namespace holds only loopback (and
 * this refuses to start the host otherwise), the host runs under `strace`, and every address it
 * connected or sent to must be loopback. Its analytics and its update check are switched off in
 * the config. The hooks run without the review a person gives them the first time
 * (`--dangerously-bypass-hook-trust`), and the tools without approval or sandbox
 * (`--dangerously-bypass-approvals-and-sandbox`): the namespace is the sandbox here.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'vitest';
import { decodedWhole } from '../../support/arriving.js';
import { GIT_WITHOUT_MAINTENANCE } from '../../support/git-without-maintenance.js';
import { aSandbox, REPO, type TheProjectToWrite, type TheSandbox } from './a-sandbox.js';
import { destinationsIn, isLoopback, refuseUnlessLoopbackOnly } from './the-host.js';

/** The command hook that answers the permission decision it is told. */
export const A_HOOK_THAT_ANSWERS = fileURLToPath(
  new URL('./a-hook-that-answers.mjs', import.meta.url),
);

/** The made-up key Codex is handed. It names no account and opens nothing. */
const KEY = 'sk-stand-in-0000000000000000000000000000';

/** A model of Codex's bundled catalog whose metadata offers `apply_patch`. */
const MODEL = 'gpt-5.5';

/** One request Codex sent the stand-in. */
export interface TheCodexRequest {
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: Readonly<Record<string, unknown>>;
}

/** What a case asks of one session. */
export interface TheCodexSpec {
  /** Writes the record the session opens on. */
  readonly project?: (project: TheProjectToWrite) => void;
  /** The patch the stand-in makes Codex apply, relative to the project; none: a session that only opens. */
  readonly patch?: string;
  /** A hooks file of the person's own, in Codex's home, beside the plugin's. */
  readonly ownHooks?: Readonly<Record<string, unknown>>;
  /** Which plugin of the marketplace to install: the full one unless a case says otherwise. */
  readonly plugin?: 'mnema' | 'mnema-server-only';
  /** Whether the session's PATH holds a `mnema` at all; a case that takes it away sets `false`. */
  readonly mnemaOnPath?: boolean;
}

/** What one session left behind. */
export interface TheCodexSession {
  readonly project: string;
  readonly home: string;
  /** Every request to `/v1/responses`, in arrival order. */
  readonly requests: readonly TheCodexRequest[];
  /** What Codex printed on its second stream: its hook lines and its errors. */
  readonly stderr: string;
  /** What `codex mcp get mnema --json` printed once the plugin was installed. */
  readonly server: string;
}

/** Reads the binary and its version off the environment, and refuses to go on without both. */
function theCodexUnderTest(): { readonly binary: string; readonly version: string } {
  const binary = process.env.MNEMA_HOST_CONTRACT_CODEX;
  const version = process.env.MNEMA_HOST_CONTRACT_CODEX_VERSION;
  if (binary === undefined || binary === '' || version === undefined || version === '') {
    throw new Error(
      'the Codex contract needs MNEMA_HOST_CONTRACT_CODEX (the binary) and ' +
        'MNEMA_HOST_CONTRACT_CODEX_VERSION (the version it must report)',
    );
  }
  if (!existsSync(binary)) throw new Error(`MNEMA_HOST_CONTRACT_CODEX names no file: ${binary}`);
  return { binary: realpathSync(binary), version };
}

/** One server-sent event of the Responses API. */
function event(data: Readonly<Record<string, unknown>>): string {
  return `event: ${String(data['type'])}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** A whole response: created, one output item, completed. */
function aResponse(id: string, item: Readonly<Record<string, unknown>>): string {
  const usage = {
    input_tokens: 0,
    input_tokens_details: null,
    output_tokens: 0,
    output_tokens_details: null,
    total_tokens: 0,
  };
  return [
    event({ type: 'response.created', response: { id } }),
    event({ type: 'response.output_item.done', item }),
    event({ type: 'response.completed', response: { id, usage } }),
  ].join('');
}

/** The names of the tools a request offers. */
function toolsOffered(body: Readonly<Record<string, unknown>>): string[] {
  const tools = Array.isArray(body['tools']) ? (body['tools'] as unknown[]) : [];
  return tools.flatMap((tool) => {
    const name = (tool as { name?: unknown } | null)?.name;
    return typeof name === 'string' ? [name] : [];
  });
}

/** Starts the stand-in on a free loopback port. */
async function startTheStandIn(patch: string | undefined): Promise<{
  readonly url: string;
  readonly requests: TheCodexRequest[];
  close(): Promise<void>;
}> {
  const requests: TheCodexRequest[] = [];
  const server: Server = createServer((req, res) => {
    const received = decodedWhole();
    received.from(req);
    req.on('end', () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(received.text() || '{}') as Record<string, unknown>;
      } catch {
        body = {};
      }
      const url = req.url ?? '';
      if (!url.endsWith('/responses')) {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[],"models":[]}');
        return;
      }
      requests.push({ url, headers: req.headers, body });
      const answered = JSON.stringify(body['input'] ?? []).includes('custom_tool_call_output');
      const call = patch !== undefined && toolsOffered(body).includes('apply_patch') && !answered;
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.end(
        call
          ? aResponse('resp_call', {
              type: 'custom_tool_call',
              name: 'apply_patch',
              input: patch,
              call_id: 'call_stand_in_1',
            })
          : aResponse('resp_end', {
              type: 'message',
              role: 'assistant',
              id: 'msg_end',
              content: [{ type: 'output_text', text: 'done' }],
            }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A patch that adds `relative` with one line, as the model writes it. */
export function aPatchAdding(relative: string): string {
  return [
    '*** Begin Patch',
    `*** Add File: ${relative}`,
    '+export const probe = 1;',
    '*** End Patch',
    '',
  ].join('\n');
}

/** Starts one Codex session in a fresh sandbox and waits for it to end. */
async function aCodexSession(
  spec: TheCodexSpec,
  keep: (box: TheSandbox) => void,
): Promise<TheCodexSession> {
  refuseUnlessLoopbackOnly();
  const found = spawnSync('strace', ['-V'], { encoding: 'utf-8' });
  if (found.error !== undefined || found.status !== 0) {
    throw new Error('strace is needed to read where the host connects, and it is not on the PATH');
  }
  const codex = theCodexUnderTest();
  const box = aSandbox('mnema-codex-', spec.project);
  keep(box);
  const codexHome = join(box.root, 'codex');
  mkdirSync(codexHome, { recursive: true });
  const standIn = await startTheStandIn(spec.patch);
  writeFileSync(
    join(codexHome, 'config.toml'),
    [
      `model = "${MODEL}"`,
      'model_provider = "stand-in"',
      'check_for_update_on_startup = false',
      '',
      '[model_providers.stand-in]',
      'name = "stand-in"',
      `base_url = "${standIn.url}"`,
      'wire_api = "responses"',
      'env_key = "STAND_IN_KEY"',
      '',
      '[analytics]',
      'enabled = false',
      '',
      '[otel]',
      'exporter = "none"',
      '',
    ].join('\n'),
  );
  if (spec.ownHooks !== undefined) {
    writeFileSync(join(codexHome, 'hooks.json'), JSON.stringify({ hooks: spec.ownHooks }));
  }
  const env = {
    HOME: box.home,
    CODEX_HOME: codexHome,
    PATH: spec.mnemaOnPath === false ? box.base : `${box.bin}:${box.base}`,
    LANG: 'C.UTF-8',
    TERM: 'dumb',
    STAND_IN_KEY: KEY,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
  };
  const codexSays = (...args: string[]): string => {
    const ran = spawnSync(codex.binary, args, { cwd: box.project, env, encoding: 'utf-8' });
    if (ran.status !== 0) {
      throw new Error(`codex ${args.join(' ')} failed: ${ran.stderr}${ran.stdout}`);
    }
    return ran.stdout;
  };
  const reported = spawnSync(codex.binary, ['--version'], { env, encoding: 'utf-8' }).stdout;
  if (!reported.includes(codex.version)) {
    throw new Error(`the binary reports ${reported.trim()}, not ${codex.version}`);
  }
  codexSays('plugin', 'marketplace', 'add', REPO);
  codexSays('plugin', 'add', `${spec.plugin ?? 'mnema'}@mnema`);
  const server = codexSays('mcp', 'get', 'mnema', '--json');

  const out = join(box.root, 'out');
  mkdirSync(out, { recursive: true });
  const strace = join(out, 'connect.strace');
  const stderr = await new Promise<string>((resolve) => {
    const child = spawn(
      'strace',
      [
        '-f',
        '-qq',
        '-e',
        'trace=connect,sendto,sendmsg,sendmmsg',
        '-s',
        '120',
        '-o',
        strace,
        codex.binary,
        'exec',
        '--dangerously-bypass-approvals-and-sandbox',
        '--dangerously-bypass-hook-trust',
        '--skip-git-repo-check',
        'Write the file.',
      ],
      { cwd: box.project, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const said = decodedWhole();
    said.from(child.stderr);
    child.stdout.resume();
    const killer = setTimeout(() => child.kill('SIGKILL'), 100_000);
    child.on('close', () => {
      clearTimeout(killer);
      resolve(said.text());
    });
  });
  await standIn.close();

  const destinations = destinationsIn(existsSync(strace) ? readFileSync(strace, 'utf-8') : '');
  const outward = destinations.filter((address) => !isLoopback(address));
  if (outward.length > 0)
    throw new Error(`the host reached beyond loopback: ${JSON.stringify(outward)}`);
  if (destinations.length === 0) {
    throw new Error(
      'strace saw the host connect nowhere, so it read nothing: the instrument is blind',
    );
  }
  // The run measured the binary it was started for: Codex names its version on every request.
  for (const request of standIn.requests) {
    if (!String(request.headers['user-agent'] ?? '').includes(codex.version)) {
      throw new Error(
        `a request names ${String(request.headers['user-agent'])}, not ${codex.version}`,
      );
    }
  }
  return { project: box.project, home: box.home, requests: standIn.requests, stderr, server };
}

/** A session per case, each in a sandbox of its own that is removed after the case. */
export function aCodexForEachCase(): (spec?: TheCodexSpec) => Promise<TheCodexSession> {
  const boxes: TheSandbox[] = [];
  afterEach(() => {
    for (const box of boxes.splice(0)) box.remove();
  });
  return (spec = {}) => aCodexSession(spec, (box) => boxes.push(box));
}

/** The text of every message of a request's input, one string per message. */
export function theMessagesOf(request: TheCodexRequest): string[] {
  const input = Array.isArray(request.body['input']) ? (request.body['input'] as unknown[]) : [];
  return input.flatMap((item) => {
    const content = (item as { content?: unknown } | null)?.content;
    if (!Array.isArray(content)) return [];
    return [content.map((part) => String((part as { text?: unknown }).text ?? '')).join('')];
  });
}

/** What the call's result handed the model, in the request after the call. */
export function theResultOfTheCall(session: TheCodexSession): string | undefined {
  for (const request of session.requests) {
    const input = Array.isArray(request.body['input']) ? (request.body['input'] as unknown[]) : [];
    for (const item of input) {
      const one = item as { type?: unknown; output?: unknown } | null;
      if (one?.type === 'custom_tool_call_output') return String(one.output ?? '');
    }
  }
  return undefined;
}

/**
 * What the first request's tool search says it can reach — where Codex lists the MCP servers it
 * connected, each with the instructions its handshake gave, and defers their tools behind the
 * search for a model of the catalog.
 */
export function theToolSearchSays(session: TheCodexSession): string {
  const tools = session.requests[0]?.body['tools'];
  const search = (Array.isArray(tools) ? (tools as unknown[]) : []).find(
    (tool) => (tool as { type?: unknown } | null)?.type === 'tool_search',
  );
  return String((search as { description?: unknown } | undefined)?.description ?? '');
}
