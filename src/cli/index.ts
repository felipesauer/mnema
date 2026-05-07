import { Command } from 'commander';

import { VERSION } from '@/utils/version.js';

/**
 * Each entry maps a top-level command name to a dynamic import factory.
 *
 * We intentionally avoid eager-loading every command module: a Mnema
 * CLI invocation only ever exercises one command, and the others
 * collectively pull in `@modelcontextprotocol/sdk`, `better-sqlite3`,
 * `@inquirer/prompts`, `gray-matter`, etc. — easily 100ms+ of startup
 * cost the user pays even for `mnema --version`.
 *
 * The lazy stub registers a placeholder Commander subcommand that
 * forwards every argument to the real command's `register` method on
 * first use.
 */
type CommandLoader = () => Promise<{ register: (program: Command) => void }>;

const COMMAND_LOADERS: Readonly<Record<string, CommandLoader>> = {
  init: async () => new (await import('./commands/init-command.js')).InitCommand(),
  adopt: async () => new (await import('./commands/adopt-command.js')).AdoptCommand(),
  import: async () => new (await import('./commands/import-command.js')).ImportCommand(),
  task: async () => new (await import('./commands/task-command.js')).TaskCommand(),
  sprint: async () => new (await import('./commands/sprint-command.js')).SprintCommand(),
  attach: async () => new (await import('./commands/attach-command.js')).AttachCommand(),
  decision: async () => new (await import('./commands/decision-command.js')).DecisionCommand(),
  note: async () => new (await import('./commands/note-command.js')).NoteCommand(),
  epic: async () => new (await import('./commands/epic-command.js')).EpicCommand(),
  skill: async () => new (await import('./commands/skill-command.js')).SkillCommand(),
  memory: async () => new (await import('./commands/memory-command.js')).MemoryCommand(),
  search: async () => new (await import('./commands/search-command.js')).SearchCommand(),
  audit: async () => new (await import('./commands/audit-command.js')).AuditCommand(),
  history: async () => new (await import('./commands/history-command.js')).HistoryCommand(),
  watch: async () => new (await import('./commands/watch-command.js')).WatchCommand(),
  inbox: async () => new (await import('./commands/inbox-command.js')).InboxCommand(),
  agent: async () => new (await import('./commands/agent-command.js')).AgentCommand(),
  sync: async () => new (await import('./commands/sync-command.js')).SyncCommand(),
  mcp: async () => new (await import('./commands/mcp-command.js')).McpCommand(),
  doctor: async () => new (await import('./commands/doctor-command.js')).DoctorCommand(),
  destroy: async () => new (await import('./commands/destroy-command.js')).DestroyCommand(),
};

/**
 * Creates the root Commander program with metadata and lazy stubs for
 * every subcommand.
 *
 * @returns Root Commander program ready for parse()
 */
export function createCli(): Command {
  const program = new Command();
  program.name('mnema').description('Cognitive persistence for AI agents').version(VERSION);

  // Allow any subcommand name through (`mnema foo`); the dispatcher
  // below validates and forwards.
  program.allowUnknownOption(false).enablePositionalOptions();

  for (const [name, loader] of Object.entries(COMMAND_LOADERS)) {
    registerLazyCommand(program, name, loader);
  }

  return program;
}

/**
 * Registers a Commander stub that, on first invocation, dynamically
 * imports the real command, lets it attach its full subcommand tree
 * to a fresh hidden program, and then re-parses the original argv
 * against that program.
 *
 * The trick: Commander has no first-class lazy-subcommand hook. We
 * therefore intercept the `command:<name>` event, which Commander
 * raises *before* dispatching unknown subcommands, replace the stub,
 * and re-parse. The user sees no difference.
 */
function registerLazyCommand(program: Command, name: string, loader: CommandLoader): void {
  // The stub is a passthrough: any args after `mnema <name>` flow
  // straight into the eventual real command's parser via `parseAsync`.
  const stub = program
    .command(`${name} [args...]`, { hidden: true })
    .allowUnknownOption(true)
    .helpOption(false)
    .action(async () => {
      const real = await loader();
      // Build a throwaway program that the real command attaches its
      // full subcommand tree to. The real `register()` calls
      // `program.command(name)` internally, so `inner` becomes the
      // *parent* — same shape as the eager-loaded path.
      const inner = new Command();
      inner.name('mnema').exitOverride();
      real.register(inner);
      // argv layout when we get here: ['node', 'mnema', <name>, ...rest].
      // Commander needs everything from `<name>` onward so it can
      // dispatch into the matching subcommand we just registered.
      const subargs = process.argv.slice(2);
      await inner.parseAsync(subargs, { from: 'user' });
    });

  // Visible help: Commander hides the stub so `mnema --help` still
  // renders the alphabetical command list.
  stub.description(`(lazy) ${name} command — loaded on first use`);
}
