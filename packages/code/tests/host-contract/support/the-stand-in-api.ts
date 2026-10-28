/**
 * A STAND-IN FOR THE MODEL API, so the real host dispatches real hooks with no model behind it.
 *
 * It speaks the one thing the host's own gateway documentation publishes: `/v1/messages` answered
 * in server-sent events, ending in `message_stop`. It answers the first request that OFFERS a
 * tool and has no result yet with one call to that tool, and every other request with a closing
 * text, so a host that loops cannot hang a case. Every request it received is kept, because the
 * request the host sends AFTER a hook ran is the ground truth for what reached the session: that
 * is what a case asserts on, never what the product believes it sent.
 *
 * THE TURN IS CHOSEN BY WHAT A REQUEST CARRIES AND NEVER BY HOW MANY ARRIVED. The host asks
 * `/api/hello` first, and its first `/v1/messages` can be a preflight that carries no tools at
 * all; a `tool_use` answered into either is dropped without a word and the failure looks like the
 * subject of the measurement rather than like the instrument.
 *
 * IT LISTENS ON LOOPBACK ONLY, and nothing in this module reaches any other address.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { decodedWhole } from '../../support/arriving.js';

/** One call the stand-in makes in place of a model. */
export interface TheCall {
  /** The host's own name for the tool, as the request offers it: `Write`, `Bash`. */
  readonly tool: string;
  /** What the call carries. */
  readonly input: Readonly<Record<string, unknown>>;
}

/** One request the host sent, as it arrived. */
export interface TheRequest {
  readonly url: string;
  readonly body: Readonly<Record<string, unknown>>;
  /** The `User-Agent` header, which a host that names its version there is read by. */
  readonly userAgent: string;
}

/** A running stand-in. */
export interface TheStandIn {
  readonly port: number;
  readonly url: string;
  /** Every request, in arrival order. */
  readonly requests: readonly TheRequest[];
  /** The address of every connection it accepted, as the stand-in saw it. */
  readonly peers: readonly string[];
  close(): Promise<void>;
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * What the stand-in says the model read: a host that decides to compact by the `usage` the model
 * reports is told, by a turn that claims more tokens than it was sent, that the window is full.
 */
const ONE_TOKEN = 1;

function messageWith(inputTokens: number) {
  return {
    type: 'message',
    role: 'assistant',
    model: 'stand-in',
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: inputTokens, output_tokens: 1 },
  };
}

/** The turn that calls a tool. */
function aCallTurn(call: TheCall, id = 'toolu_stand_in_0001', inputTokens = ONE_TOKEN): string {
  return [
    frame('message_start', {
      type: 'message_start',
      message: { ...messageWith(inputTokens), id: 'msg_call' },
    }),
    frame('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id, name: call.tool, input: {} },
    }),
    frame('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.input) },
    }),
    frame('content_block_stop', { type: 'content_block_stop', index: 0 }),
    frame('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { input_tokens: inputTokens, output_tokens: 1 },
    }),
    frame('message_stop', { type: 'message_stop' }),
  ].join('');
}

/** The closing turn: plain text, so the host stops. */
function aClosingTurn(text: string, inputTokens = ONE_TOKEN): string {
  return [
    frame('message_start', {
      type: 'message_start',
      message: { ...messageWith(inputTokens), id: 'msg_end' },
    }),
    frame('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    }),
    frame('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    }),
    frame('content_block_stop', { type: 'content_block_stop', index: 0 }),
    frame('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { input_tokens: inputTokens, output_tokens: 1 },
    }),
    frame('message_stop', { type: 'message_stop' }),
  ].join('');
}

/** The names of the tools a request offers. */
export function toolsOffered(body: Readonly<Record<string, unknown>>): string[] {
  const tools = body['tools'];
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((tool: unknown) =>
    typeof tool === 'object' &&
    tool !== null &&
    typeof (tool as { name?: unknown }).name === 'string'
      ? [(tool as { name: string }).name]
      : [],
  );
}

/** Whether a request already carries the result of a call. */
export function carriesAResult(body: Readonly<Record<string, unknown>>): boolean {
  return JSON.stringify(body['messages'] ?? []).includes('"tool_result"');
}

/**
 * Starts the stand-in on a free loopback port.
 *
 * @param call - the one call to make, or none: a session that only opens.
 * @param closing - the text every other turn closes with, `done` unless a case needs its own: it is
 *   what a subagent's final reply is, since the stand-in answers the subagent's requests too.
 * @param once - make the call once, however many requests offer the tool: a subagent is offered the
 *   same tools, and a stand-in that called again would have it dispatch subagents of its own.
 */
export async function startTheStandIn(
  call?: TheCall,
  closing = 'done',
  once = false,
): Promise<TheStandIn> {
  let called = false;
  return startAScriptedStandIn((body) => {
    const wanted =
      call !== undefined &&
      !(once && called) &&
      toolsOffered(body).includes(call.tool) &&
      !carriesAResult(body);
    if (wanted) called = true;
    return wanted ? { call } : { text: closing };
  });
}

/** What the stand-in answers one request with: a call to a tool, or a text that ends the turn. */
export type TheReply =
  | {
      readonly call: TheCall;
      /** The id the call carries, so the request that returns its result can be told from another. */
      readonly id?: string;
      /** The `input_tokens` the turn claims, for a host that decides on the usage it is told. */
      readonly inputTokens?: number;
    }
  | { readonly text: string; readonly inputTokens?: number };

/**
 * Starts a stand-in that answers each `/v1/messages` request with what `decide` says, given the
 * request and the ones before it. {@link startTheStandIn} is the case where that is one call.
 */
export async function startAScriptedStandIn(
  decide: (body: Readonly<Record<string, unknown>>, before: readonly TheRequest[]) => TheReply,
): Promise<TheStandIn> {
  const requests: TheRequest[] = [];
  const peers: string[] = [];
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
      if (!url.includes('/v1/messages')) {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const reply = decide(body, before);
      res.end(
        'call' in reply
          ? aCallTurn(reply.call, reply.id, reply.inputTokens)
          : aClosingTurn(reply.text, reply.inputTokens),
      );
    });
  });
  server.on('connection', (socket) => {
    peers.push(`${socket.remoteAddress ?? '?'} -> ${socket.localAddress ?? '?'}`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    requests,
    peers,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** The call a model would make to write `relative` in the project: the host's own `Write`. */
export function writeTo(relative: string, content = 'written by the stand-in\n') {
  return (project: string): TheCall => ({
    tool: 'Write',
    input: { file_path: `${project}/${relative}`, content },
  });
}

/** The call a model would make to run a command in the project's shell: the host's own `Bash`. */
export function runInTheShell(command: (project: string) => string) {
  return (project: string): TheCall => ({
    tool: 'Bash',
    input: { command: command(project), description: 'run a command' },
  });
}

/** The call a model would make to dispatch a subagent: the host's own `Agent`. */
export function dispatchASubagent(prompt = 'Look into it and report.') {
  return (_project: string): TheCall => ({
    tool: 'Agent',
    input: { description: 'look into it', prompt, subagent_type: 'general-purpose' },
  });
}

/** How a session of several turns goes, for {@link aScriptOfCalls}. */
export interface TheScript {
  /** The calls the model makes, one to a turn, each when the result of the one before came back. */
  readonly calls: readonly TheCall[];
  /**
   * The call after whose answer the stand-in claims a window full of tokens, counted from 1, so
   * that a host that compacts by the usage it is told compacts then; none: it never claims one.
   */
  readonly fillsTheWindowAfter?: number;
  /** How a request is told to be the one that asks for the summary of a compaction. */
  readonly isTheSummaryRequest?: (body: Readonly<Record<string, unknown>>) => boolean;
  /** What the stand-in answers that request with: a text the case chose, and chose without the rule. */
  readonly summary?: string;
}

/** The tokens a turn claims when it says the window is full. */
const A_FULL_WINDOW = 190_000;

/**
 * The decision of a stand-in that makes `calls` in order and then closes, and that answers the
 * request for a summary with the text it was given.
 *
 * A call is made when the request carries the result of the one before it, by its id, and not by
 * how many requests came: a conversation that was compacted no longer carries those results, and
 * the stand-in closes instead of starting its calls over.
 */
export function aScriptOfCalls(
  script: TheScript,
): (body: Readonly<Record<string, unknown>>) => TheReply {
  let made = 0;
  let lastId = '';
  return (body) => {
    const sent = JSON.stringify(body['messages'] ?? []);
    if (script.isTheSummaryRequest?.(body) === true) {
      return { text: script.summary ?? 'Nothing is known about the work.' };
    }
    const call = script.calls[made];
    if (
      call !== undefined &&
      toolsOffered(body).includes(call.tool) &&
      (lastId === '' || sent.includes(`"tool_use_id":"${lastId}"`))
    ) {
      made += 1;
      lastId = `toolu_stand_in_${String(made).padStart(4, '0')}`;
      return {
        call,
        id: lastId,
        ...(script.fillsTheWindowAfter === made ? { inputTokens: A_FULL_WINDOW } : {}),
      };
    }
    return { text: 'done' };
  };
}
