import { Command } from 'commander';

import { VERSION } from '@/utils/version.js';
import { AuditCommand } from './commands/audit-command.js';
import { DoctorCommand } from './commands/doctor-command.js';
import { InitCommand } from './commands/init-command.js';
import { McpCommand } from './commands/mcp-command.js';
import { SyncCommand } from './commands/sync-command.js';
import { TaskCommand } from './commands/task-command.js';

/**
 * Creates the root Commander program with metadata and all top-level
 * subcommands attached.
 *
 * @returns Root Commander program ready for parse()
 */
export function createCli(): Command {
  const program = new Command();
  program.name('mnema').description('Cognitive persistence for AI agents').version(VERSION);

  new InitCommand().register(program);
  new TaskCommand().register(program);
  new AuditCommand().register(program);
  new SyncCommand().register(program);
  new McpCommand().register(program);
  new DoctorCommand().register(program);

  return program;
}
