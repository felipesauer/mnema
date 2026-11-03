// A minimal MCP client over stdio (newline-delimited JSON-RPC), enough to list a server's tools and call them. Used
// only to capture the tool definitions and the results the direct check hands a model; it talks to no model.
import { spawn } from 'node:child_process';

export function startMcp(command, args, { cwd, env }) {
  const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'ignore'] });
  let buffer = '';
  let nextId = 1;
  const waiting = new Map();
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let at;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (line === '') continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && waiting.has(msg.id)) {
        waiting.get(msg.id)(msg);
        waiting.delete(msg.id);
      }
    }
  });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 30_000);
      waiting.set(id, (msg) => {
        clearTimeout(timer);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  return {
    async initialize() {
      const result = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'kit', version: '0' } });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
      return result;
    },
    listTools: () => request('tools/list', {}),
    callTool: (name, args) => request('tools/call', { name, arguments: args }),
    close: () => child.kill(),
  };
}
