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
        'Override the agent handle (also taken from MCP client metadata)',
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
        if (options.agentHandle !== undefined) {
          clientMetadata.agent_handle = options.agentHandle;
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
        process.stdout.write(buildInstructions(client as SupportedClient, binary, handle));
      });
  }
}

function buildInstructions(client: SupportedClient, binary: string, handle: string): string {
  const config = {
    command: binary,
    args: ['mcp', 'serve'],
    metadata: { agent_handle: handle },
  };

  // Placeholders like ${workspaceFolder} are MCP-client templating, not JS interpolation.
  const claudeCodeCwd = ['$', '{workspaceFolder}'].join('');
  const cursorCwd = ['$', '{workspaceRoot}'].join('');

  switch (client) {
    case 'claude-code':
      return [
        'Add to ~/.config/claude-code/mcp.json (or your platform-specific path):',
        '',
        JSON.stringify({ mcpServers: { mnema: { ...config, cwd: claudeCodeCwd } } }, null, 2),
        '',
        'Tip: keep `cwd` set to the workspace folder so Mnema can locate mnema.config.json.',
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
        'Aider expects the MCP server to be started manually:',
        '',
        `  ${binary} mcp serve --agent-handle ${handle}`,
        '',
        'Then point Aider at the spawned process via its MCP integration docs.',
        '',
      ].join('\n');
    case 'generic':
      return [
        'Generic MCP client configuration:',
        '',
        JSON.stringify(config, null, 2),
        '',
        'Set the working directory to the project root before launching.',
        '',
      ].join('\n');
  }
}
