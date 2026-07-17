import type { CommandDefinitionService } from '@mnema/core/services/command-definition-service.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ok } from '../../mcp-tool-result.js';

/**
 * Registers the read-only slash-command tools: `commands_list` (discover
 * every versioned command under `.mnema/commands/`) and `command_show`
 * (one command by name). Commands bundle a repeatable flow — an ordered
 * list of `mnema` calls — behind a name, committed with the project.
 * These tools surface the definitions; they do not execute the steps.
 */
export class CommandTools {
  constructor(private readonly commands: CommandDefinitionService) {}

  /**
   * Attaches the command tools to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'commands_list',
      {
        description:
          'List the versioned slash commands defined under `.mnema/commands/`. Each bundles an ordered sequence of `mnema` calls behind a name (e.g. `standup`). Returns the commands and any files skipped as malformed. Read-only.',
        inputSchema: {},
      },
      () => {
        const { commands, skipped } = this.commands.list();
        return ok({ commands, skipped });
      },
    );

    server.registerTool(
      'command_show',
      {
        description:
          'Return a single versioned slash command by name (its description, ordered steps, and notes), or an empty result when no such command exists. Read-only.',
        inputSchema: {
          name: z.string().min(1).describe('Command name (the `.mnema/commands/<name>.md` stem)'),
        },
      },
      ({ name }) => {
        const command = this.commands.show(name);
        return ok({ command });
      },
    );
  }
}
