import { Command, CommanderError } from 'commander';

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

interface CommandSpec {
  readonly load: CommandLoader;
  readonly aliases?: readonly string[];
}

/**
 * Plural aliases let users coming from the MCP tool surface (`tasks_list`)
 * type `mnema tasks list` and not get an "unknown command" error. The
 * canonical CLI form remains singular (`mnema task list`).
 */
const COMMAND_LOADERS: Readonly<Record<string, CommandSpec>> = {
  init: { load: async () => new (await import('./commands/init-command.js')).InitCommand() },
  adopt: { load: async () => new (await import('./commands/adopt-command.js')).AdoptCommand() },
  import: { load: async () => new (await import('./commands/import-command.js')).ImportCommand() },
  task: {
    load: async () => new (await import('./commands/task-command.js')).TaskCommand(),
    aliases: ['tasks'],
  },
  sprint: {
    load: async () => new (await import('./commands/sprint-command.js')).SprintCommand(),
    aliases: ['sprints'],
  },
  attach: { load: async () => new (await import('./commands/attach-command.js')).AttachCommand() },
  decision: {
    load: async () => new (await import('./commands/decision-command.js')).DecisionCommand(),
    aliases: ['decisions'],
  },
  note: {
    load: async () => new (await import('./commands/note-command.js')).NoteCommand(),
    aliases: ['notes'],
  },
  epic: {
    load: async () => new (await import('./commands/epic-command.js')).EpicCommand(),
    aliases: ['epics'],
  },
  skill: { load: async () => new (await import('./commands/skill-command.js')).SkillCommand() },
  memory: { load: async () => new (await import('./commands/memory-command.js')).MemoryCommand() },
  search: { load: async () => new (await import('./commands/search-command.js')).SearchCommand() },
  audit: { load: async () => new (await import('./commands/audit-command.js')).AuditCommand() },
  identity: {
    load: async () => new (await import('./commands/identity-command.js')).IdentityCommand(),
  },
  history: {
    load: async () => new (await import('./commands/history-command.js')).HistoryCommand(),
  },
  watch: { load: async () => new (await import('./commands/watch-command.js')).WatchCommand() },
  inbox: { load: async () => new (await import('./commands/inbox-command.js')).InboxCommand() },
  agent: { load: async () => new (await import('./commands/agent-command.js')).AgentCommand() },
  sync: { load: async () => new (await import('./commands/sync-command.js')).SyncCommand() },
  mcp: { load: async () => new (await import('./commands/mcp-command.js')).McpCommand() },
  doctor: { load: async () => new (await import('./commands/doctor-command.js')).DoctorCommand() },
  destroy: {
    load: async () => new (await import('./commands/destroy-command.js')).DestroyCommand(),
  },
  migration: {
    load: async () => new (await import('./commands/migration-command.js')).MigrationCommand(),
  },
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

  for (const [name, spec] of Object.entries(COMMAND_LOADERS)) {
    registerLazyCommand(program, name, spec);
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
function registerLazyCommand(program: Command, name: string, spec: CommandSpec): void {
  // The stub is a passthrough: any args after `mnema <name>` flow
  // straight into the eventual real command's parser via `parseAsync`.
  const stub = program
    .command(`${name} [args...]`, { hidden: true })
    .allowUnknownOption(true)
    .helpOption(false)
    .action(async () => {
      const real = await spec.load();
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
      try {
        await inner.parseAsync(subargs, { from: 'user' });
      } catch (error) {
        // exitOverride() turns expected exits (--help, --version, missing
        // args) into thrown CommanderError instances. Honour their exit
        // code without leaking the stack trace.
        if (error instanceof CommanderError) {
          process.exit(error.exitCode);
        }
        throw error;
      }
    });

  // Plural aliases: typing `mnema tasks` resolves to the same loader as
  // `mnema task`. Required because Commander matches the top-level
  // command before the lazy stub can defer to the real command tree.
  if (spec.aliases !== undefined && spec.aliases.length > 0) {
    stub.aliases([...spec.aliases]);
  }

  // Visible help: Commander hides the stub so `mnema --help` still
  // renders the alphabetical command list.
  stub.description(`(lazy) ${name} command — loaded on first use`);
}
