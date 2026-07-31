/**
 * The `mnema mcp` wiring: what it declares, and what it prints.
 *
 * The one verb that does not do a piece of work and exit — it serves an agent host
 * for the life of a connection. Its output is not for a person at all: stdout
 * carries the JSON-RPC protocol, so everything this surface would say goes to
 * stderr instead.
 */

import type { Command } from 'commander';
import { discoveryEnv } from '../env.js';
import type { Wiring } from './verb.js';

/** Registers `mnema mcp` on the program. */
export function registerMcp(program: Command, wiring: Wiring): void {
  const { io } = wiring;
  program
    .command('mcp')
    .description('run the mnema MCP server over stdio (for an agent host)')
    .action(async () => {
      // Loaded HERE, not at module scope: the MCP SDK is the heaviest import in
      // the product and only this one verb uses it, so importing it at the top
      // made every other command pay for a server it never starts.
      const { buildMcpServer } = await import('../mcp/server.js');
      // stdout carries the JSON-RPC protocol, so the server writes every
      // diagnostic to stderr. This action does not return until the transport
      // closes — the process serves for the life of the connection.
      const { connect } = buildMcpServer({ env: discoveryEnv(), log: (line) => io.err(line) });
      await connect();
    });
}
