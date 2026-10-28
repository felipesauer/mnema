// A bare MCP server over stdio, started where a host asked for `mnema mcp`. It serves no tool
// and writes down three things the host handed it, as a JSON file, once the handshake is done:
//
//   client   the name the client announced in `initialize` (`clientInfo.name`);
//   protocol the protocol version the client asked for in `initialize` (`params.protocolVersion`),
//            or `withoutInitialize` set where the first thing it sent was a request and not
//            `initialize` (the way the 2026-07-28 revision of the protocol begins);
//   chain    the base names of the executables above this process, nearest first;
//   present  which of a closed list of variables exist in its environment, by NAME;
//   declared the value of two variables the plugin's own manifest or the person sets, and the
//            sandbox gives sentinel values (`MNEMA_AGENT_KEY`, `MNEMA_HOME`), so a case can say
//            whether the host passed them on and which value won.
//
// NEVER A VALUE, NEVER A PATH, EXCEPT THE TWO OF `declared`. The environment of a host holds secrets, and a path carries the
// name of whoever ran it: what is written is names of executables and names of variables, and
// nothing else read off the environment. The list is closed on purpose: a variable that is not
// in it is not looked at.
//
// usage: node a-server-that-says-what-it-was-handed.mjs <report file>
import { readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/** The marks a host or its editor is known to leave in the environment of what it starts. */
const THE_MARKS = [
  'AI_AGENT',
  'ANTIGRAVITY_AGENT',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION_ID',
  'COPILOT_AGENT_SESSION_ID',
  'COPILOT_CLI_BINARY_VERSION',
  'COPILOT_LOADER_PID',
  'CURSOR_AGENT',
  'CURSOR_TRACE_ID',
  'CURSOR_VERSION',
  'ELECTRON_RUN_AS_NODE',
  'GEMINI_CLI',
  'OPENCODE_CLIENT',
  'VSCODE_PID',
];

/** The base name of the process `pid` runs: its executable, else the name it goes by. */
function nameOf(pid) {
  try {
    return basename(readlinkSync(`/proc/${pid}/exe`));
  } catch {
    try {
      return readFileSync(`/proc/${pid}/comm`, 'utf-8').trim();
    } catch {
      return '?';
    }
  }
}

/** The parent of `pid`, or 0 where it cannot be read. The name in `stat` may hold spaces. */
function parentOf(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf-8');
    return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
  } catch {
    return 0;
  }
}

function theChain() {
  const chain = [];
  for (let pid = process.ppid; pid > 1; pid = parentOf(pid)) chain.push(nameOf(pid));
  return chain;
}

/** The two variables whose value is read: neither is a secret, and both are what a case sets. */
const THE_DECLARED = ['MNEMA_AGENT_KEY', 'MNEMA_HOME'];

const [, , report] = process.argv;
const server = new Server(
  { name: 'what-it-was-handed', version: '0.0.1' },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
let asked;
let withoutInitialize = false;
let seenFirst = false;

const reportWhatWasHanded = () => {
  writeFileSync(
    report,
    JSON.stringify({
      client: server.getClientVersion()?.name,
      protocol: asked,
      withoutInitialize,
      chain: theChain(),
      present: THE_MARKS.filter((name) => process.env[name] !== undefined),
      declared: Object.fromEntries(
        THE_DECLARED.filter((name) => process.env[name] !== undefined).map((name) => [
          name,
          process.env[name],
        ]),
      ),
    }),
  );
};
server.oninitialized = reportWhatWasHanded;
const transport = new StdioServerTransport();
await server.connect(transport);
// Read the client's first message on its way to the protocol layer: the version it asks for is in
// `initialize`, and the SDK does not keep it where the server can read it.
const handOn = transport.onmessage;
transport.onmessage = (message, extra) => {
  if (!seenFirst) {
    seenFirst = true;
    if (message.method === 'initialize') asked = message.params?.protocolVersion;
    else {
      withoutInitialize = true;
      reportWhatWasHanded();
    }
  }
  handOn?.(message, extra);
};
