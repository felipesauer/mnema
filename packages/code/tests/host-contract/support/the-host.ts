/**
 * THE REAL HOST, STARTED AGAINST A STAND-IN FOR ITS MODEL.
 *
 * Each case here starts the Claude Code binary the run names, unmodified, in a sandbox of its own:
 * a `HOME`, a project with a record in it, the plugin of this tree loaded from its directory, a
 * `mnema` shim on the PATH that runs this tree's build — and a model that is {@link startTheStandIn}.
 * What the case asserts on is what the host did: the file that was or was not written, and the
 * request it sent next.
 *
 * NOTHING HERE MAY LEAVE THE MACHINE, and three things say so rather than one. The run is started
 * inside a network namespace that holds only loopback (the job does it; a workstation does it with
 * `unshare -rn`), and {@link refuseUnlessLoopbackOnly} refuses to start the host in any process
 * that can see another interface. The host is started under `strace` and every address it
 * connected or sent to is read back, so a destination that is not loopback fails the case that
 * caused it. And the host's own traffic that is not the model's — updates, telemetry, the
 * marketplace — is switched off. The stand-in is told by a key that is made up and is the host's
 * own documented override.
 *
 * WHICH BINARY RAN IS ASKED OF THE DATA. The host's attribution block, in the system prompt of
 * every request, carries its version; {@link expectTheVersionRun} reads it, and a round that
 * measured another binary than the one named is red. The pinned one and the ones the weekly
 * job tries run the same cases; the version is an input, never an assumption.
 *
 * NOT HELD HERE: that the binary is the one the vendor released. The job checks the file's SHA-256
 * against the signed release manifest before any case runs, outside the namespace and before the host
 * ever starts; a case cannot, because the binary is already running when it asks.
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { type NetworkInterfaceInfo, networkInterfaces, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'vitest';
import { GIT_WITHOUT_MAINTENANCE } from '../../support/git-without-maintenance.js';
import { startTheStandIn, type TheCall, type TheRequest } from './the-stand-in-api.js';

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
const CLI = join(REPO, 'packages', 'code', 'dist', 'cli.js');
const PLUGIN = join(REPO, 'plugin');
const A_SERVER_THAT_TALKS = fileURLToPath(
  new URL('./a-server-that-talks-too-much.mjs', import.meta.url),
);

/** The command hook that hands over exactly as many units of text as it is told. */
export const A_HOOK_THAT_SAYS_EXACTLY = fileURLToPath(
  new URL('./a-hook-that-says-exactly.mjs', import.meta.url),
);

/** The made-up key the host is handed. It names no account and opens nothing. */
const KEY = 'sk-ant-api03-stand-in-0000000000000000000000000000';

/** What the run says it is measuring. */
export interface TheHostUnderTest {
  /** Absolute path of the unmodified binary. */
  readonly binary: string;
  /** The version the run was started for; a prefix of what the attribution block must carry. */
  readonly version: string;
}

/** Reads the binary and the version off the environment, and refuses to go on without both. */
export function theHostUnderTest(): TheHostUnderTest {
  const binary = process.env['MNEMA_HOST_CONTRACT_CLAUDE'];
  const version = process.env['MNEMA_HOST_CONTRACT_VERSION'];
  if (binary === undefined || binary === '' || version === undefined || version === '') {
    throw new Error(
      'the host contract needs MNEMA_HOST_CONTRACT_CLAUDE (the binary) and MNEMA_HOST_CONTRACT_VERSION ' +
        '(the version it must report); nothing here skips for want of them, because a skipped contract ' +
        'reads as a held one',
    );
  }
  if (!existsSync(binary)) throw new Error(`MNEMA_HOST_CONTRACT_CLAUDE names no file: ${binary}`);
  return { binary: realpathSync(binary), version };
}

/**
 * Refuses unless the process can see no interface but loopback.
 *
 * The check is of the namespace, not of a promise: an interface with an address that is not
 * internal is a route out, and the host is not started where there is one.
 */
export function refuseUnlessLoopbackOnly(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): void {
  const outward = Object.entries(interfaces).flatMap(([name, addresses]) =>
    (addresses ?? [])
      .filter((address) => !address.internal)
      .map((address) => `${name} ${address.address}`),
  );
  if (outward.length > 0) {
    throw new Error(
      `this process can reach beyond loopback (${outward.join(', ')}); run the contract in a network ` +
        'namespace that holds only loopback (`unshare -rn`), never beside the network',
    );
  }
}

/** One event the host printed in `stream-json`. */
export type TheStreamEvent = Readonly<Record<string, unknown>>;

/** What a session of the host left behind. */
export interface TheSession {
  /** The project directory the host ran in. */
  readonly project: string;
  /** The sandbox `HOME`. */
  readonly home: string;
  /** What the host asked the stand-in, in order. */
  readonly requests: readonly TheRequest[];
  /** The `/v1/messages` requests alone. */
  readonly messages: readonly TheRequest[];
  /** What the host printed. */
  readonly stream: readonly TheStreamEvent[];
  /** The host's exit code. */
  readonly exit: number | null;
  /** The host's own debug log. */
  readonly debug: string;
  /** Every distinct address the host connected or sent to. */
  readonly destinations: readonly string[];
  /** `mnema <args>` in this project, as the sandbox's own user. */
  mnema(...args: string[]): string;
  /** The first request that carried the result of the call, or `undefined` where none did. */
  readonly theRequestAfterTheCall: TheRequest | undefined;
  /** Removes the sandbox. */
  remove(): void;
}

/** How to start a session. */
export interface TheSpec {
  /** Writes the record and the files the case stands on; `mnema` runs in the project. */
  readonly project?: (it: { dir: string; mnema: (...args: string[]) => string }) => void;
  /** The call the stand-in makes, given the project directory. None: a session that only opens. */
  readonly call?: (project: string) => TheCall;
  /** Hooks to declare beside the plugin's, in the project's settings. */
  readonly hooks?: Readonly<Record<string, unknown>>;
  /** The permission rules that let the call run. */
  readonly allow?: readonly string[];
  /** Whether the plugin of this tree is loaded. Default: yes. */
  readonly plugin?: boolean;
  /** Whether `mnema` is on the PATH of the host. Default: yes. */
  readonly mnemaOnThePath?: boolean;
  /** MCP servers to add beside the plugin's, by name, each with the instructions it sends. */
  readonly servers?: Readonly<Record<string, string>>;
  /** Extra environment for the host. */
  readonly env?: Readonly<Record<string, string>>;
}

/** The environment a `mnema` of the sandbox runs in: its own home, nothing of the machine's. */
function sandboxEnv(home: string, path: string): NodeJS.ProcessEnv {
  return {
    HOME: home,
    PATH: path,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
    GIT_AUTHOR_NAME: 'Contract',
    GIT_AUTHOR_EMAIL: 'contract@example.invalid',
    GIT_COMMITTER_NAME: 'Contract',
    GIT_COMMITTER_EMAIL: 'contract@example.invalid',
    LANG: 'C.UTF-8',
  };
}

/** Whether a `strace` is installed: without it the destinations cannot be read, so nothing starts. */
function needStrace(): void {
  const found = spawnSync('strace', ['-V'], { encoding: 'utf-8' });
  if (found.error !== undefined || found.status !== 0) {
    throw new Error('strace is needed to read where the host connects, and it is not on the PATH');
  }
}

/** Every address the host's `connect`, `sendto` and `sendmsg` named, read off an strace log. */
export function destinationsIn(strace: string): string[] {
  const found = new Set<string>();
  for (const line of strace.split('\n')) {
    if (!/(connect|sendto|sendmsg)\(/.test(line) || !/AF_INET6?/.test(line)) continue;
    const address = line.match(/inet_addr\("([^"]+)"\)|inet_pton\(AF_INET6, "([^"]+)"/);
    found.add(address === null ? line.trim().slice(0, 160) : (address[1] ?? address[2] ?? ''));
  }
  return [...found];
}

/** Whether an address is the machine talking to itself. */
export function isLoopback(address: string): boolean {
  return /^127\./.test(address) || address === '::1';
}

/**
 * Starts one session of the host and waits for it to end.
 *
 * Throws, rather than returns, when the host is not run under the conditions above or when it
 * reached an address that is not loopback: those are not outcomes a case may assert on.
 */
export async function aSession(spec: TheSpec = {}): Promise<TheSession> {
  const host = theHostUnderTest();
  refuseUnlessLoopbackOnly();
  needStrace();

  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'mnema-host-')));
  const home = join(sandbox, 'home');
  const project = join(sandbox, 'project');
  const config = join(sandbox, 'claude-config');
  const bin = join(sandbox, 'bin');
  const out = join(sandbox, 'out');
  for (const dir of [home, project, config, bin, out, join(project, '.claude')]) {
    mkdirSync(dir, { recursive: true });
  }

  const nodeDir = dirname(process.execPath);
  const base = `${nodeDir}:/usr/bin:/bin`;
  const pathOfTheHost = spec.mnemaOnThePath === false ? base : `${bin}:${base}`;
  if (spec.mnemaOnThePath === false) {
    // A machine that has a `mnema` of its own in the node directory would make this a case about
    // that machine: say so rather than measure it.
    const found = spawnSync('sh', ['-c', 'command -v mnema'], {
      env: { PATH: pathOfTheHost, HOME: home },
      encoding: 'utf-8',
    });
    if (found.status === 0) {
      rmSync(sandbox, { recursive: true, force: true });
      throw new Error(
        `a mnema is on the path the case means to be without one: ${found.stdout.trim()}`,
      );
    }
  }
  // The shim runs this tree's build, so the host starts the product the suite just built.
  writeFileSync(join(bin, 'mnema'), `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`, {
    mode: 0o755,
  });
  const mnema = (...args: string[]): string =>
    execFileSync(process.execPath, [CLI, ...args], {
      cwd: project,
      env: sandboxEnv(home, `${bin}:${base}`),
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project, env: sandboxEnv(home, base) });
  mnema('init');
  spec.project?.({ dir: project, mnema });

  const standIn = await startTheStandIn(spec.call?.(project));
  writeFileSync(
    join(config, '.claude.json'),
    JSON.stringify({
      hasCompletedOnboarding: true,
      bypassPermissionsModeAccepted: true,
      customApiKeyResponses: { approved: [KEY.slice(-20)], rejected: [] },
      projects: {
        [project]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true },
      },
    }),
  );
  writeFileSync(
    join(project, '.claude', 'settings.json'),
    JSON.stringify({
      permissions: { allow: spec.allow ?? ['Write'] },
      ...(spec.hooks === undefined ? {} : { hooks: spec.hooks }),
    }),
  );
  const args = [
    '-p',
    'Say hi.',
    '--model',
    'claude-sonnet-4-5',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-hook-events',
    '--debug-file',
    join(out, 'debug.txt'),
  ];
  if (spec.plugin !== false) args.push('--plugin-dir', PLUGIN);
  if (spec.servers !== undefined) {
    const file = join(sandbox, 'servers.mcp.json');
    writeFileSync(
      file,
      JSON.stringify({
        mcpServers: Object.fromEntries(
          Object.entries(spec.servers).map(([name, instructions]) => [
            name,
            { command: process.execPath, args: [A_SERVER_THAT_TALKS, name, instructions] },
          ]),
        ),
      }),
    );
    args.push('--mcp-config', file);
  }

  const strace = join(out, 'connect.strace');
  const done = await new Promise<number | null>((resolve) => {
    const child = spawn(
      'strace',
      [
        '-f',
        '-qq',
        '-e',
        'trace=connect,sendto,sendmsg',
        '-s',
        '120',
        '-o',
        strace,
        host.binary,
        ...args,
      ],
      {
        cwd: project,
        env: {
          HOME: home,
          PATH: pathOfTheHost,
          TERM: 'dumb',
          LANG: 'C.UTF-8',
          USER: 'contract',
          CLAUDE_CONFIG_DIR: config,
          ANTHROPIC_BASE_URL: standIn.url,
          ANTHROPIC_API_KEY: KEY,
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          DISABLE_UPDATES: '1',
          DISABLE_AUTOUPDATER: '1',
          CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
          CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT: '1',
          DISABLE_TELEMETRY: '1',
          DISABLE_ERROR_REPORTING: '1',
          DISABLE_BUG_COMMAND: '1',
          GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
          ...spec.env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const stdout: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', () => undefined);
    const killer = setTimeout(() => child.kill('SIGKILL'), 100_000);
    child.on('close', (code) => {
      clearTimeout(killer);
      writeFileSync(join(out, 'stream.jsonl'), Buffer.concat(stdout));
      resolve(code);
    });
  });
  await standIn.close();

  const read = (name: string): string =>
    existsSync(join(out, name)) ? readFileSync(join(out, name), 'utf-8') : '';
  const destinations = destinationsIn(read('connect.strace'));
  const outward = destinations.filter((address) => !isLoopback(address));
  if (outward.length > 0) {
    rmSync(sandbox, { recursive: true, force: true });
    throw new Error(`the host reached beyond loopback: ${JSON.stringify(outward)}`);
  }
  if (destinations.length === 0) {
    rmSync(sandbox, { recursive: true, force: true });
    throw new Error(
      'strace saw the host connect nowhere, so it read nothing: the instrument is blind',
    );
  }
  const messages = standIn.requests.filter((request) => request.url.includes('/v1/messages'));
  const stream = read('stream.jsonl')
    .split('\n')
    .flatMap((line): TheStreamEvent[] => {
      try {
        return [JSON.parse(line) as TheStreamEvent];
      } catch {
        return [];
      }
    });
  const callIndex = messages.findIndex((request) =>
    JSON.stringify(request.body['messages'] ?? []).includes('"tool_use"'),
  );
  const session: TheSession = {
    project,
    home,
    requests: standIn.requests,
    messages,
    stream,
    exit: done,
    debug: read('debug.txt'),
    destinations,
    mnema,
    theRequestAfterTheCall: callIndex >= 0 ? messages[callIndex] : undefined,
    remove: () => rmSync(sandbox, { recursive: true, force: true }),
  };
  try {
    expectTheVersionRun(session, host.version);
  } catch (error) {
    session.remove();
    throw error;
  }
  return session;
}

/** The version the host's attribution block names, or `undefined` where there is none. */
export function theVersionTheRequestNames(request: TheRequest): string | undefined {
  return JSON.stringify(request.body['system'] ?? '').match(/cc_version=([^;\\"]+)/)?.[1];
}

/**
 * Fails when the session measured another binary than the one the run was started for.
 *
 * The attribution block reads `cc_version=<version>.<build>`; the version of the run must be its
 * prefix up to the dot that begins the build. Every session is asked this before it is returned,
 * so a round that ran another binary is red in every case and not only in the one that asks.
 */
export function expectTheVersionRun(session: TheSession, version: string): void {
  const named = session.messages
    .map(theVersionTheRequestNames)
    .find((value) => value !== undefined);
  if (named === undefined || !named.startsWith(`${version}.`)) {
    throw new Error(
      `this round measured ${named ?? '(no attribution block)'}, and the run names ${version}`,
    );
  }
}

/**
 * Starts sessions for one file's cases and removes each when its case ends.
 *
 * Whoever makes a sandbox removes it, in the same place that asked for it: a case that throws
 * leaves no directory behind.
 */
export function aHostForEachCase(): (spec?: TheSpec) => Promise<TheSession> {
  const open: TheSession[] = [];
  afterEach(() => {
    for (const session of open.splice(0)) session.remove();
  });
  return async (spec) => {
    const session = await aSession(spec);
    open.push(session);
    return session;
  };
}

/** The text blocks of a message, whether the host sent a string or a list of parts. */
function blocksOf(content: unknown): string[] {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content.flatMap((part: unknown) =>
    typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'text'
      ? [String((part as { text?: unknown }).text ?? '')]
      : [],
  );
}

/** The messages of a request, as `{role, content}`. */
function messagesOf(request: TheRequest): { role: string; content: unknown }[] {
  const messages = request.body['messages'];
  return Array.isArray(messages) ? (messages as { role: string; content: unknown }[]) : [];
}

/** Every text block of every message of a request, in order. */
export function everyBlockOf(request: TheRequest): string[] {
  return messagesOf(request).flatMap((message) => blocksOf(message.content));
}

/** What the `SessionStart` hooks handed the first request, one entry per hook that said anything. */
export function whatTheSessionOpenedWith(session: TheSession): string[] {
  const first = session.messages[0];
  if (first === undefined) return [];
  return everyBlockOf(first).filter((block) =>
    block.startsWith('<system-reminder>\nSessionStart hook additional context:'),
  );
}

/** The result of the call the stand-in made, as the host sent it back. */
export function theResultOfTheCall(
  session: TheSession,
): { readonly text: string; readonly isError: boolean } | undefined {
  const request = session.theRequestAfterTheCall;
  if (request === undefined) return undefined;
  for (const message of messagesOf(request)) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content as {
      type?: string;
      content?: unknown;
      is_error?: boolean;
    }[]) {
      if (part.type !== 'tool_result') continue;
      const text =
        typeof part.content === 'string' ? part.content : blocksOf(part.content).join('\n');
      return { text, isError: part.is_error === true };
    }
  }
  return undefined;
}

/** What a hook added beside the result of the call: the blocks that follow it, named by the host. */
export function whatWasAddedBesideTheResult(session: TheSession, event: string): string[] {
  const request = session.theRequestAfterTheCall;
  if (request === undefined) return [];
  return everyBlockOf(request).filter((block) =>
    block.startsWith(`<system-reminder>\n${event} hook additional context:`),
  );
}

/**
 * What each MCP server's instructions looked like when they reached the model, by server name.
 *
 * The host puts them in one block, a heading per server. The names the case expects are given,
 * because the text of one server may itself be anything.
 */
export function theInstructionsThatArrived(
  session: TheSession,
  names: readonly string[],
): Record<string, string | undefined> {
  const first = session.messages[0];
  const block =
    first === undefined
      ? undefined
      : everyBlockOf(first).find((text) => text.includes('# MCP Server Instructions'));
  const found: Record<string, string | undefined> = {};
  if (block === undefined) return Object.fromEntries(names.map((name) => [name, undefined]));
  const at = names
    .map((name) => ({ name, at: block.indexOf(`\n## ${name}\n`) }))
    .filter((entry) => entry.at >= 0);
  at.sort((a, b) => a.at - b.at);
  for (const name of names) found[name] = undefined;
  at.forEach((entry, index) => {
    const start = entry.at + `\n## ${entry.name}\n`.length;
    const end = at[index + 1]?.at ?? block.length;
    found[entry.name] = block
      .slice(start, end)
      .replace(/\n<\/system-reminder>$/, '')
      .trimEnd();
  });
  return found;
}

/**
 * The permission decisions the hooks of an event handed the host, as the host reported them in
 * its own stream: the reply of the plugin read where it was received, not where it was made.
 */
export function thePermissionDecisionsOf(session: TheSession, event: string): string[] {
  return session.stream
    .filter((entry) => entry['subtype'] === 'hook_response' && entry['hook_event'] === event)
    .flatMap((entry) => {
      const output = String(entry['output'] ?? '').trim();
      if (!output.startsWith('{')) return [];
      try {
        const reply = JSON.parse(output) as {
          hookSpecificOutput?: { permissionDecision?: string };
        };
        const decision = reply.hookSpecificOutput?.permissionDecision;
        return decision === undefined ? [] : [decision];
      } catch {
        return [];
      }
    });
}
