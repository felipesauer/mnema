/**
 * THE REAL QWEN CODE, against a stand-in for the model, with the Claude Code plugin of this tree
 * installed the way a person installs it: `qwen extensions install plugin`, which converts the
 * plugin into an extension of the host's own and copies it into the home.
 *
 * THE MODEL IS A STAND-IN, AND THE HOST NEEDS NO ACCOUNT FOR IT. Qwen Code is pointed at it by the
 * variables its documentation gives for an endpoint that speaks the OpenAI protocol
 * (`OPENAI_BASE_URL`, on loopback, with a made-up `OPENAI_API_KEY` and `OPENAI_MODEL`), and told in
 * its user settings to use that kind of authentication, which is what a run without a person needs.
 * The stand-in speaks the one thing the host calls to generate, `/v1/chat/completions` answered in
 * server-sent events, with a `tool_calls` delta for the first request that offers the tool and has
 * no result yet, and a closing text for every other. A tool the host defers (it lists the server's
 * tools by name and hands a schema only on request) is not one the stand-in is asked for here.
 *
 * WHAT ISOLATES IT is what isolates the other runs: the namespace holds only loopback (and this
 * refuses to start the host otherwise), the host runs under `strace`, and every address it
 * connected or sent to must be loopback. Its update check, its usage statistics and its telemetry
 * are switched off in the same settings.
 */

import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { decodedWhole } from '../../support/arriving.js';
import {
  aSandbox,
  PLUGIN,
  type TheFilesToPut,
  type TheProjectToWrite,
  type TheSandbox,
} from './a-sandbox.js';
import { destinationsOrRefuse, refuseUnlessLoopbackOnly } from './the-host.js';
import type { TheCall, TheRequest } from './the-stand-in-api.js';

/** The made-up key Qwen Code is handed. It names no account and opens nothing. */
const KEY = 'stand-in-key-0000000000000000';

/** The model it is told to use: a name, which nothing is asked of any vendor for. */
const MODEL = 'stand-in-model';

/** What opens the text of a session that had to be killed. */
const KILLED = '\u0000killed\u0000';

/** What the stand-in answers one request with, for a session of several turns. */
export type TheQwenReply =
  | {
      readonly call: TheCall;
      /** The `prompt_tokens` the turn claims, for a host that compacts by the usage it is told. */
      readonly promptTokens?: number;
    }
  | { readonly text: string; readonly promptTokens?: number };

/** The decision of a stand-in for a session of several turns. */
export type TheQwenScript = (
  body: Readonly<Record<string, unknown>>,
  before: readonly TheRequest[],
) => TheQwenReply;

/** What a case asks of one session. */
export interface TheQwenSpec {
  /** Writes the record the session opens on. */
  readonly project?: (project: TheProjectToWrite) => void;
  /** Files put in the project after its record is written; see {@link TheFilesToPut}. */
  readonly files?: TheFilesToPut;
  /**
   * What the stand-in answers each request with, in place of the one `call`: a session of several
   * turns. Made anew for each start of the host.
   */
  readonly script?: () => TheQwenScript;
  /** Extra environment for the host. */
  readonly env?: Readonly<Record<string, string>>;
  /** The call the stand-in makes, given the project; none: a session that only opens. */
  readonly call?: (project: string) => TheCall;
  /** Whether the plugin is installed: yes unless a case says otherwise. */
  readonly extension?: boolean;
  /**
   * Which program the session's PATH holds under the name `mnema`: this tree's build, none at all,
   * or another program of that name, which prints something else and writes down its calls.
   */
  readonly mnema?: 'ours' | 'absent' | 'a stranger';
  /** `--approval-mode`: `yolo` unless a case says otherwise. */
  readonly approvalMode?: 'yolo' | 'default';
  /** Variables of the person's own environment the host inherits, as a terminal of another host leaves them. */
  readonly inherited?: Readonly<Record<string, string>>;
}

/** What one session left behind. */
export interface TheQwenSession {
  readonly project: string;
  readonly home: string;
  /** Every request to the stand-in's `/chat/completions`, in arrival order. */
  readonly requests: readonly TheRequest[];
  /** What Qwen Code printed, both streams: its answer and its errors. */
  readonly text: string;
  /** Every command line the session ran `mnema` with, in order. */
  readonly calls: readonly string[];
  /** `mnema <args>` in the project, as the sandbox's own user. */
  mnema(...args: string[]): string;
}

/** Reads the binary and its version off the environment, and refuses to go on without both. */
function theQwenUnderTest(): { readonly binary: string; readonly version: string } {
  const binary = process.env.MNEMA_HOST_CONTRACT_QWEN;
  const version = process.env.MNEMA_HOST_CONTRACT_QWEN_VERSION;
  if (binary === undefined || binary === '' || version === undefined || version === '') {
    throw new Error(
      'the Qwen Code contract needs MNEMA_HOST_CONTRACT_QWEN (the binary) and ' +
        'MNEMA_HOST_CONTRACT_QWEN_VERSION (the version it must report)',
    );
  }
  if (!existsSync(binary)) throw new Error(`MNEMA_HOST_CONTRACT_QWEN names no file: ${binary}`);
  return { binary: realpathSync(binary), version };
}

/** The messages of a request's conversation, in order. */
function messagesOf(
  request: TheRequest,
): { readonly role: string; readonly message: Record<string, unknown> }[] {
  const messages = Array.isArray(request.body['messages'])
    ? (request.body['messages'] as unknown[])
    : [];
  return messages.map((one) => {
    const message = (one ?? {}) as Record<string, unknown>;
    return { role: String(message['role']), message };
  });
}

/** The text of a message's content, whether the host sent a string or a list of parts. */
function textOf(message: Record<string, unknown>): string {
  const content = message['content'];
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      const text = (part as { text?: unknown } | null)?.text;
      return typeof text === 'string' ? text : '';
    })
    .join('');
}

/** The text of every message the user's turns carry in a request, one string per message. */
export function theUserTextsOf(request: TheRequest): string[] {
  return messagesOf(request).flatMap(({ role, message }) =>
    role === 'user' ? [textOf(message)] : [],
  );
}

/**
 * The text of every system message in a request, one string per message: where Qwen Code puts what
 * a `SessionStart` hook handed it, in a block of its own at the end of the system instruction.
 */
export function theSystemTextsOf(request: TheRequest): string[] {
  return messagesOf(request).flatMap(({ role, message }) =>
    role === 'system' ? [textOf(message)] : [],
  );
}

/** The names of the tools a request offers. */
export function theToolsOf(request: TheRequest): string[] {
  const tools = Array.isArray(request.body['tools']) ? (request.body['tools'] as unknown[]) : [];
  return tools.flatMap((tool) => {
    const name = (tool as { function?: { name?: unknown } } | null)?.function?.name;
    return typeof name === 'string' ? [name] : [];
  });
}

/** What the call's result handed the model, in the request after the call. */
export function theResultOfTheCall(session: TheQwenSession): string | undefined {
  for (const request of session.requests) {
    for (const { role, message } of messagesOf(request)) {
      if (role === 'tool') return textOf(message);
    }
  }
  return undefined;
}

/** The stand-in, started on a free loopback port. */
interface TheStandIn {
  readonly url: string;
  readonly requests: TheRequest[];
  close(): Promise<void>;
}

/** Whether a request already carries the result of a call. */
function carriesAResult(body: Readonly<Record<string, unknown>>): boolean {
  return messagesOf({ url: '', body, userAgent: '' }).some(({ role }) => role === 'tool');
}

/** One server-sent event, in the shape the host reads a streamed response in. */
function chunk(
  delta: Record<string, unknown>,
  finish: string | null,
  usage = false,
  promptTokens = 1,
): string {
  const event = {
    id: 'stand-in',
    object: 'chat.completion.chunk',
    created: 1,
    model: MODEL,
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(usage
      ? {
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: 1,
            total_tokens: promptTokens + 1,
          },
        }
      : {}),
  };
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Starts the stand-in. It answers a request with the call when the request OFFERS the call's tool
 * and carries no result yet, and never by how many have arrived: a request that offers no such
 * tool (one the host makes for itself) is answered with the closing text.
 */
async function startTheStandIn(
  call: TheCall | undefined,
  script?: TheQwenScript,
): Promise<TheStandIn> {
  const requests: TheRequest[] = [];
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
      const before = [...requests];
      requests.push({ url, body, userAgent: String(req.headers['user-agent'] ?? '') });
      if (!url.includes('/chat/completions')) {
        res.writeHead(404, { 'content-type': 'application/json' }).end('{}');
        return;
      }
      const offered = theToolsOf({ url, body, userAgent: '' });
      const wanted = call !== undefined && offered.includes(call.tool) && !carriesAResult(body);
      const reply: TheQwenReply =
        script !== undefined ? script(body, before) : wanted ? { call } : { text: 'done' };
      const delta: Record<string, unknown> =
        'call' in reply
          ? {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: script === undefined ? 'call_1' : `call_${before.length + 1}`,
                  type: 'function',
                  function: { name: reply.call.tool, arguments: JSON.stringify(reply.call.input) },
                },
              ],
            }
          : { role: 'assistant', content: reply.text };
      const finish = 'call' in reply ? 'tool_calls' : 'stop';
      if (body['stream'] === true) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write(chunk(delta, null));
        res.write(chunk({}, finish, true, reply.promptTokens));
        res.end('data: [DONE]\n\n');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'stand-in',
          object: 'chat.completion',
          created: 1,
          model: MODEL,
          choices: [{ index: 0, message: delta, finish_reason: finish }],
          usage: {
            prompt_tokens: reply.promptTokens ?? 1,
            completion_tokens: 1,
            total_tokens: (reply.promptTokens ?? 1) + 1,
          },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Starts one Qwen Code session in a fresh sandbox and waits for it to end. */
async function aQwenSession(
  spec: TheQwenSpec,
  keep: (box: TheSandbox) => void,
): Promise<TheQwenSession> {
  refuseUnlessLoopbackOnly();
  const found = spawnSync('strace', ['-V'], { encoding: 'utf-8' });
  if (found.error !== undefined || found.status !== 0) {
    throw new Error('strace is needed to read where the host connects, and it is not on the PATH');
  }
  const qwen = theQwenUnderTest();
  const box = aSandbox('mnema-qwen-', spec.project, spec.files);
  keep(box);
  const standIn = await startTheStandIn(spec.call?.(box.project), spec.script?.());

  // The user's settings, as a person writes them: the OpenAI kind of authentication, which a run
  // without a person needs, and the host's own network chatter off.
  mkdirSync(join(box.home, '.qwen'), { recursive: true });
  writeFileSync(
    join(box.home, '.qwen', 'settings.json'),
    `${JSON.stringify(
      {
        security: { auth: { selectedType: 'openai' } },
        general: { enableAutoUpdate: false },
        privacy: { usageStatisticsEnabled: false },
        telemetry: { enabled: false },
      },
      null,
      2,
    )}\n`,
  );

  const strangerLog = join(box.root, 'stranger.log');
  if (spec.mnema === 'a stranger') {
    writeFileSync(
      join(box.bin, 'mnema'),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${strangerLog}"\necho "mnema 9.9 (not the record)"\n`,
    );
    chmodSync(join(box.bin, 'mnema'), 0o755);
  }
  const path = spec.mnema === 'absent' ? box.base : `${box.bin}:${box.base}`;
  const env = {
    HOME: box.home,
    PATH: path,
    LANG: 'C.UTF-8',
    OPENAI_BASE_URL: `${standIn.url}/v1`,
    OPENAI_API_KEY: KEY,
    OPENAI_MODEL: MODEL,
    GIT_CONFIG_NOSYSTEM: '1',
    ...spec.inherited,
    ...spec.env,
  };

  const reported = spawnSync(qwen.binary, ['--version'], {
    cwd: box.project,
    env,
    encoding: 'utf-8',
  }).stdout.trim();
  if (reported !== qwen.version) {
    throw new Error(`the binary reports ${reported}, not ${qwen.version}`);
  }

  if (spec.extension !== false) {
    // As a person installs it: the host converts the plugin and copies it into the home. The
    // consent flag answers the prompt a person answers by reading, which has nobody to answer it.
    const installed = spawnSync(qwen.binary, ['extensions', 'install', PLUGIN, '--consent'], {
      cwd: box.project,
      env,
      encoding: 'utf-8',
    });
    const said = `${installed.stdout}${installed.stderr}`;
    if (installed.status !== 0 || !said.includes('installed successfully')) {
      throw new Error(`the plugin was not installed (exit ${installed.status}): ${said}`);
    }
  }

  const out = join(box.root, 'out');
  mkdirSync(out, { recursive: true });
  const strace = join(out, 'connect.strace');
  const text = await new Promise<string>((resolve) => {
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
        qwen.binary,
        '-p',
        'Write the file.',
        '--approval-mode',
        spec.approvalMode ?? 'yolo',
        '-m',
        MODEL,
      ],
      { cwd: box.project, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const said = decodedWhole();
    said.from(child.stdout);
    const errs = decodedWhole();
    errs.from(child.stderr);
    let timedOut = false;
    const killer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, 100_000);
    child.on('close', () => {
      clearTimeout(killer);
      const printed = `${said.text()}${errs.text()}`;
      resolve(timedOut ? `${KILLED}${printed}` : printed);
    });
  });
  if (text.startsWith(KILLED)) {
    throw new Error(`Qwen Code did not end in 100 s: ${text.slice(KILLED.length).slice(-2_000)}`);
  }
  await standIn.close();

  const destinations = destinationsOrRefuse(strace);
  if (destinations.length === 0) {
    throw new Error(
      'strace saw the host connect nowhere, so it read nothing: the instrument is blind',
    );
  }
  // The run measured the binary it was started for: Qwen Code names its version in every request.
  const generated = standIn.requests.filter((request) => request.url.includes('/chat/completions'));
  if (generated.length === 0) throw new Error('the host never asked the model to generate');
  for (const request of generated) {
    if (!request.userAgent.startsWith(`QwenCode/${qwen.version} `)) {
      throw new Error(`a request does not name the version ${qwen.version}: ${request.userAgent}`);
    }
  }
  return {
    project: box.project,
    home: box.home,
    requests: generated,
    text,
    calls: spec.mnema === 'a stranger' ? lines(strangerLog) : box.calls(),
    mnema: box.mnema,
  };
}

/** The lines of a file, or none where it was never written. */
function lines(file: string): string[] {
  return existsSync(file) ? readFileSync(file, 'utf-8').split('\n').filter(Boolean) : [];
}

/** A session per case, each in a sandbox of its own that is removed after the case. */
export function aQwenForEachCase(): (spec?: TheQwenSpec) => Promise<TheQwenSession> {
  const boxes: TheSandbox[] = [];
  afterEach(() => {
    for (const box of boxes.splice(0)) box.remove();
  });
  return (spec = {}) => aQwenSession(spec, (box) => boxes.push(box));
}

/** The call a model makes to write `relative` in the project: Qwen Code's own `write_file`. */
export function writing(relative: string) {
  return (project: string): TheCall => ({
    tool: 'write_file',
    input: { file_path: `${project}/${relative}`, content: 'export const probe = 1;\n' },
  });
}

/** The call a model makes to change `relative`, which the case wrote with `before`: `edit`. */
export function replacing(relative: string, oldString: string, newString: string) {
  return (project: string): TheCall => ({
    tool: 'edit',
    input: {
      file_path: `${project}/${relative}`,
      old_string: oldString,
      new_string: newString,
    },
  });
}

/** How a session of several turns goes, for {@link aScriptOfCalls}. */
export interface TheQwenTurns {
  /** The calls the model makes, one to a turn, each when the result of the one before came back. */
  readonly calls: readonly TheCall[];
  /** The call after whose answer the stand-in claims a full window, counted from 1; none: never. */
  readonly fillsTheWindowAfter?: number;
  /** How a request is told to be the one that asks for the summary of a compaction. */
  readonly isTheSummaryRequest?: (body: Readonly<Record<string, unknown>>) => boolean;
  /** What that request is answered with: a text the case chose, without the rule. */
  readonly summary?: string;
}

/** The tokens a turn claims when it says the window is full. */
const A_FULL_WINDOW = 170_000;

/**
 * The decision of a stand-in that makes `calls` in order and then closes, and that answers the
 * request for a summary with the text it was given. A call is made when the request carries as
 * many results as calls were made, and not by how many requests came: a conversation that was
 * compacted carries fewer, and the stand-in closes instead of starting its calls over.
 */
export function aScriptOfCalls(turns: TheQwenTurns): TheQwenScript {
  let made = 0;
  return (body) => {
    if (turns.isTheSummaryRequest?.(body) === true) {
      return { text: turns.summary ?? 'Nothing is known about the work.' };
    }
    const call = turns.calls[made];
    const results = messagesOf({ url: '', body, userAgent: '' }).filter(
      ({ role }) => role === 'tool',
    ).length;
    if (
      call !== undefined &&
      theToolsOf({ url: '', body, userAgent: '' }).includes(call.tool) &&
      results === made
    ) {
      made += 1;
      return {
        call,
        ...(turns.fillsTheWindowAfter === made ? { promptTokens: A_FULL_WINDOW } : {}),
      };
    }
    return { text: 'done' };
  };
}
