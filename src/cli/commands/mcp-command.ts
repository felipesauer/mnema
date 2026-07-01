import type { Command } from 'commander';

import { openCliContext } from '../cli-context.js';

// `@modelcontextprotocol/sdk` is the heaviest import in the project
// (~40-60ms cold). It is only needed by `mnema mcp serve`, so we
// lazy-load both `MnemaMcpServer` and the logger inside the action —
// every other CLI path now skips that cost entirely.

const SUPPORTED_CLIENTS = ['claude-code', 'cursor', 'aider', 'generic'] as const;
type SupportedClient = (typeof SUPPORTED_CLIENTS)[number];

interface ServeOptions {
  readonly agentHandle?: string;
}

interface InstallOptions {
  readonly handle?: string;
}

/**
 * Registers the `mnema mcp` command group: starts the MCP server and
 * prints client-specific configuration snippets.
 */
export class McpCommand {
  /**
   * Attaches `mcp serve` and `mcp install-instructions` to the program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    const group = program.command('mcp').description('MCP server commands');

    group
      .command('serve')
      .description('Start the Mnema MCP server on stdio')
      .option(
        '--agent-handle <handle>',
        'Identify the agent calling Mnema (overrides MNEMA_AGENT_HANDLE env)',
      )
      .action(async (options: ServeOptions) => {
        // Lazy: pull in the MCP SDK + logger only when the user
        // actually wants to start the server.
        const [{ MnemaMcpServer }, { logger }] = await Promise.all([
          import('../../mcp/mcp-server.js'),
          import('../../utils/logger.js'),
        ]);

        const context = openCliContext();
        const clientMetadata: Record<string, unknown> = {
          pid: process.pid,
          hostname: process.env.HOSTNAME ?? '',
        };
        // Resolution order for the agent handle, mirroring how
        // MNEMA_ACTOR is resolved:
        //   1. --agent-handle CLI flag (explicit override)
        //   2. MNEMA_AGENT_HANDLE env var (set by the MCP client
        //      registration — Claude Code, Cursor, etc. all support
        //      passing env vars to spawned servers)
        // Anything below is left unset; tools that need a handle
        // (e.g. agent_run_start) report AgentHandleMissing with a
        // hint pointing at both knobs.
        const handle = options.agentHandle ?? process.env.MNEMA_AGENT_HANDLE;
        if (handle !== undefined && handle.length > 0) {
          clientMetadata.agent_handle = handle;
        }
        const server = new MnemaMcpServer(
          context.config,
          context.projectRoot,
          context.container,
          clientMetadata,
        );
        try {
          await server.start();
        } catch (error) {
          logger.error({ err: error }, 'MCP server failed to start');
          process.exit(1);
        }
      });

    group
      .command('install-instructions <client>')
      .description('Print MCP configuration for the given client')
      .option(
        '--handle <handle>',
        'Override the suggested agent handle (defaults to the client name)',
      )
      .action((client: string, options: InstallOptions) => {
        if (!SUPPORTED_CLIENTS.includes(client as SupportedClient)) {
          process.stderr.write(
            `error: unknown client "${client}". Supported: ${SUPPORTED_CLIENTS.join(', ')}\n`,
          );
          process.exit(2);
        }

        const handle = options.handle ?? client;
        const binary = process.execPath.endsWith('node') ? 'mnema' : process.execPath;
        process.stdout.write(
          buildInstructions(client as SupportedClient, binary, handle) + COMMANDS_NOTE,
        );
      });
  }
}

/**
 * Appended to every client's instructions: points the user at the
 * versioned slash commands so they discover the `commands_list` tool and
 * the `.mnema/commands/` directory without having to read the docs.
 */
const COMMANDS_NOTE = [
  'Versioned slash commands:',
  '',
  '  Define reusable flows in `.mnema/commands/<name>.md` (frontmatter:',
  '  `description` + an ordered `steps` list of `mnema` calls). They are',
  '  committed with the project and shared by the team; discover them with',
  '  the `commands_list` MCP tool or `mnema commands list`.',
  '',
].join('\n');

function buildInstructions(client: SupportedClient, binary: string, handle: string): string {
  // The agent handle travels through the spawned process's environment.
  // `metadata` was emitted by an earlier version of this function, but
  // no real MCP client honoured it: Claude Code reads `command/args/env`
  // verbatim and ignores the rest, so users who pasted the old snippet
  // ended up with a server that worked for read-only tools and broke on
  // every mutation. `env: { MNEMA_AGENT_HANDLE }` is the supported
  // transport — it works in every client that lets the user define an
  // MCP server (claude-code, cursor, aider, …).
  const env = { MNEMA_AGENT_HANDLE: handle };
  const config = {
    command: binary,
    args: ['mcp', 'serve'],
    env,
  };

  // Placeholders like ${workspaceFolder} are MCP-client templating, not JS interpolation.
  const claudeCodeCwd = ['$', '{workspaceFolder}'].join('');
  const cursorCwd = ['$', '{workspaceRoot}'].join('');

  switch (client) {
    case 'claude-code':
      return [
        'Register with `claude mcp add` (preferred), or paste the JSON',
        'below into ~/.claude.json under `mcpServers`:',
        '',
        `  claude mcp add mnema -s user -e MNEMA_AGENT_HANDLE=${handle} -- ${binary} mcp serve`,
        '',
        JSON.stringify({ mcpServers: { mnema: { ...config, cwd: claudeCodeCwd } } }, null, 2),
        '',
        'Tip: keep `cwd` pointed at the workspace folder so Mnema can',
        'locate `.mnema/mnema.config.json`. Add MNEMA_ACTOR to the env',
        'block when an identity file is not in place on the host.',
        '',
      ].join('\n');
    case 'cursor':
      return [
        'Add to ~/.cursor/mcp.json:',
        '',
        JSON.stringify({ mcpServers: { mnema: { ...config, cwd: cursorCwd } } }, null, 2),
        '',
      ].join('\n');
    case 'aider':
      return [
        'Aider expects the MCP server to be started manually. Either',
        'export the env var or pass the flag:',
        '',
        `  MNEMA_AGENT_HANDLE=${handle} ${binary} mcp serve`,
        `  ${binary} mcp serve --agent-handle ${handle}`,
        '',
        'Then point Aider at the spawned process via its MCP integration docs.',
        '',
      ].join('\n');
    case 'generic':
      return [
        'Generic MCP client configuration. Pass `env` to the spawned',
        'server, or invoke `mnema mcp serve --agent-handle <name>`',
        'directly from your launcher:',
        '',
        JSON.stringify(config, null, 2),
        '',
        'Set the working directory to the project root before launching.',
        '',
      ].join('\n');
  }
}
