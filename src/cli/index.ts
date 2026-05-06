import { Command } from 'commander';

import { VERSION } from '@/utils/version.js';
import { AdoptCommand } from './commands/adopt-command.js';
import { AgentCommand } from './commands/agent-command.js';
import { AttachCommand } from './commands/attach-command.js';
import { AuditCommand } from './commands/audit-command.js';
import { DecisionCommand } from './commands/decision-command.js';
import { DoctorCommand } from './commands/doctor-command.js';
import { EpicCommand } from './commands/epic-command.js';
import { HistoryCommand } from './commands/history-command.js';
import { ImportCommand } from './commands/import-command.js';
import { InboxCommand } from './commands/inbox-command.js';
import { InitCommand } from './commands/init-command.js';
import { McpCommand } from './commands/mcp-command.js';
import { MemoryCommand } from './commands/memory-command.js';
import { NoteCommand } from './commands/note-command.js';
import { SearchCommand } from './commands/search-command.js';
import { SkillCommand } from './commands/skill-command.js';
import { SprintCommand } from './commands/sprint-command.js';
import { SyncCommand } from './commands/sync-command.js';
import { TaskCommand } from './commands/task-command.js';
import { WatchCommand } from './commands/watch-command.js';

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
  new AdoptCommand().register(program);
  new ImportCommand().register(program);
  new TaskCommand().register(program);
  new SprintCommand().register(program);
  new AttachCommand().register(program);
  new DecisionCommand().register(program);
  new NoteCommand().register(program);
  new EpicCommand().register(program);
  new SkillCommand().register(program);
  new MemoryCommand().register(program);
  new SearchCommand().register(program);
  new AuditCommand().register(program);
  new HistoryCommand().register(program);
  new WatchCommand().register(program);
  new InboxCommand().register(program);
  new AgentCommand().register(program);
  new SyncCommand().register(program);
  new McpCommand().register(program);
  new DoctorCommand().register(program);

  return program;
}
