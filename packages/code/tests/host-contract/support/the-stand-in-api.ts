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

const MESSAGE = {
  type: 'message',
  role: 'assistant',
  model: 'stand-in',
  content: [],
  stop_reason: null,
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
};

/** The turn that calls a tool. */
function aCallTurn(call: TheCall): string {
  const id = 'toolu_stand_in_0001';
  return [
    frame('message_start', { type: 'message_start', message: { ...MESSAGE, id: 'msg_call' } }),
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
      usage: { output_tokens: 1 },
    }),
    frame('message_stop', { type: 'message_stop' }),
  ].join('');
}

/** The closing turn: plain text, so the host stops. */
function aClosingTurn(): string {
  return [
    frame('message_start', { type: 'message_start', message: { ...MESSAGE, id: 'msg_end' } }),
    frame('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    }),
    frame('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'done' },
    }),
    frame('content_block_stop', { type: 'content_block_stop', index: 0 }),
    frame('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 1 },
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
 */
export async function startTheStandIn(call?: TheCall): Promise<TheStandIn> {
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
      requests.push({ url, body });
      if (!url.includes('/v1/messages')) {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const wanted =
        call !== undefined && toolsOffered(body).includes(call.tool) && !carriesAResult(body);
      res.end(wanted ? aCallTurn(call) : aClosingTurn());
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
