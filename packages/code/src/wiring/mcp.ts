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
    // The one verb that takes a project instead of reading it off `cwd`, and the
    // only one that needs to: every other verb is typed by a person standing in a
    // directory, where the cwd IS the answer. This server's cwd is whatever the host
    // spawned it with, so without this flag the project is decided entirely by the
    // workspace folders the host announces — and a session that lands on a stray
    // project among them answers about that project's record with nothing in the
    // answer to say so. The operator says which one, in the same file that says how
    // to start the server.
    //
    // A FLAG and not an environment variable, for the reason there is one way to say
    // anything here: a flag is in `--help`, and a second, invisible channel for the
    // same effect is a channel nobody looks at when the answer is surprising.
    .option(
      '--project <dir>',
      'the project to serve — an ABSOLUTE path; omitted, the project comes from the host workspace roots',
    )
    .action(async (opts: { project?: string }) => {
      // Loaded HERE, not at module scope: the MCP SDK is the heaviest import in
      // the product and only this one verb uses it, so importing it at the top
      // made every other command pay for a server it never starts.
      const { buildMcpServer } = await import('../mcp/server.js');
      // Passed through as typed — the rules about it (absolute, and a real project)
      // are the resolver's, at the one place the value is consumed. Checking here
      // too would be a second reading of one rule, and a server built any other way
      // would get whichever of the two this file forgot.
      const { connect } = buildMcpServer({
        env: discoveryEnv(),
        log: (line) => io.err(line),
        ...(opts.project !== undefined ? { configProject: opts.project } : {}),
      });
      // stdout carries the JSON-RPC protocol, so the server writes every
      // diagnostic to stderr. This action does not return until the transport
      // closes — the process serves for the life of the connection.
      await connect();
    });
}
