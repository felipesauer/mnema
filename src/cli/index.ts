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
  /**
   * Short one-line description shown in `mnema --help`. Without it the
   * command would be effectively invisible to first-time users — only
   * the full, lazily-loaded help (`mnema <name> --help`) would reveal
   * the subcommand tree.
   */
  readonly description: string;
}

/**
 * Plural aliases let users coming from the MCP tool surface (`tasks_list`)
 * type `mnema tasks list` and not get an "unknown command" error. The
 * canonical CLI form remains singular (`mnema task list`).
 */
const COMMAND_LOADERS: Readonly<Record<string, CommandSpec>> = {
  init: {
    load: async () => new (await import('./commands/init-command.js')).InitCommand(),
    description: 'Initialise a new Mnema project in the current directory',
  },
  adopt: {
    load: async () => new (await import('./commands/adopt-command.js')).AdoptCommand(),
    description: 'Add an optional component (skills, memory, roadmap) to an existing project',
  },
  import: {
    load: async () => new (await import('./commands/import-command.js')).ImportCommand(),
    description: 'One-shot import from external sources (markdown, github-issues)',
  },
  task: {
    load: async () => new (await import('./commands/task-command.js')).TaskCommand(),
    aliases: ['tasks'],
    description: 'Manage tasks (create / list / show / move / history / delete)',
  },
  sprint: {
    load: async () => new (await import('./commands/sprint-command.js')).SprintCommand(),
    aliases: ['sprints'],
    description: 'Manage sprints (plan / start / close / show / add / remove)',
  },
  attach: {
    load: async () => new (await import('./commands/attach-command.js')).AttachCommand(),
    description: 'Manage task attachments (add / list)',
  },
  decision: {
    load: async () => new (await import('./commands/decision-command.js')).DecisionCommand(),
    aliases: ['decisions'],
    description: 'Manage Architecture Decision Records (record / accept / reject / supersede)',
  },
  note: {
    load: async () => new (await import('./commands/note-command.js')).NoteCommand(),
    aliases: ['notes'],
    description: 'Manage typed notes attached to tasks (add / list)',
  },
  epic: {
    load: async () => new (await import('./commands/epic-command.js')).EpicCommand(),
    aliases: ['epics'],
    description: 'Manage epics (create / show / list / close / add / remove)',
  },
  lint: {
    load: async () => new (await import('./commands/lint-command.js')).LintCommand(),
    description: 'Integrity checks over the work graph (lint sprint / lint epic)',
  },
  hooks: {
    load: async () => new (await import('./commands/hooks-command.js')).HooksCommand(),
    description: 'Review and approve domain-event hooks (approve / show)',
  },
  commit: {
    load: async () => new (await import('./commands/commit-command.js')).CommitCommand(),
    description: 'Commit the .mnema/ trail separately from code (trail first, then code)',
  },
  skill: {
    load: async () => new (await import('./commands/skill-command.js')).SkillCommand(),
    description: 'Manage skills (lint / list / show)',
  },
  commands: {
    load: async () => new (await import('./commands/commands-command.js')).CommandsCommand(),
    description: 'Versioned slash commands (list / show)',
  },
  memory: {
    load: async () => new (await import('./commands/memory-command.js')).MemoryCommand(),
    description: 'Curate memory (consolidate / lint / list / show)',
  },
  observation: {
    load: async () => new (await import('./commands/observation-command.js')).ObservationCommand(),
    aliases: ['observations'],
    description: 'Read agent-recorded observations (list)',
  },
  search: {
    load: async () => new (await import('./commands/search-command.js')).SearchCommand(),
    description: 'Full-text search across tasks, decisions and notes (FTS5)',
  },
  audit: {
    load: async () => new (await import('./commands/audit-command.js')).AuditCommand(),
    description: 'Inspect the raw audit log (query with filters)',
  },
  update: {
    load: async () => new (await import('./commands/update-command.js')).UpdateCommand(),
    description: 'Check npm for a newer mnema version (explicit, opt-in network)',
  },
  identity: {
    load: async () => new (await import('./commands/identity-command.js')).IdentityCommand(),
    description: 'Manage your default actor handle (set / whoami / unset / add / list)',
  },
  project: {
    load: async () => new (await import('./commands/project-command.js')).ProjectCommand(),
    description: 'Manage project-scoped credentials (secret export / import)',
  },
  history: {
    load: async () => new (await import('./commands/history-command.js')).HistoryCommand(),
    description: 'Show past activity from the audit log (formatted for humans)',
  },
  stats: {
    load: async () => new (await import('./commands/stats-command.js')).StatsCommand(),
    description: 'Show derived flow metrics (throughput, lead/cycle time, reopen rate)',
  },
  metrics: {
    load: async () => new (await import('./commands/metrics-command.js')).MetricsCommand(),
    description:
      'Local adoption report (quickstart time, feature activation, doctor use) — no telemetry',
  },
  query: {
    load: async () => new (await import('./commands/query-command.js')).QueryCommand(),
    description: 'Query the backlog by state, epic, sprint, creation window or free text',
  },
  graph: {
    load: async () => new (await import('./commands/graph-command.js')).GraphCommand(),
    description: 'Show the dependency graph: cycles, ready/blocked frontier, critical path',
  },
  snapshot: {
    load: async () => new (await import('./commands/snapshot-command.js')).SnapshotCommand(),
    description: 'Executive snapshot of an epic or sprint (coverage, deps, SLA) — markdown or HTML',
  },
  serve: {
    load: async () => new (await import('./commands/serve-command.js')).ServeCommand(),
    description: 'Live local dashboard on localhost (real-time, read-only) — Ctrl+C to stop',
  },
  watch: {
    load: async () => new (await import('./commands/watch-command.js')).WatchCommand(),
    description: 'Live tail of the audit log (Ctrl+C to stop)',
  },
  inbox: {
    load: async () => new (await import('./commands/inbox-command.js')).InboxCommand(),
    description: 'Show tasks that need human attention (review, blocked)',
  },
  focus: {
    load: async () => new (await import('./commands/focus-command.js')).FocusCommand(),
    description: 'Print a one-line focus: the task to resume, or the next to start',
  },
  drift: {
    load: async () => new (await import('./commands/drift-command.js')).DriftCommand(),
    description: 'List commits on this branch not tied to any task',
  },
  agent: {
    load: async () => new (await import('./commands/agent-command.js')).AgentCommand(),
    description: 'Inspect agent activity (run inspect)',
  },
  agents: {
    load: async () => new (await import('./commands/agents-command.js')).AgentsCommand(),
    description: 'Manage the generated AGENTS.md manual (sync)',
  },
  sync: {
    load: async () => new (await import('./commands/sync-command.js')).SyncCommand(),
    description: 'Rebuild the SQLite cache from markdown files (idempotent)',
  },
  upgrade: {
    load: async () => new (await import('./commands/upgrade-command.js')).UpgradeCommand(),
    description: 'Bring the project in line with the installed Mnema version',
  },
  mcp: {
    load: async () => new (await import('./commands/mcp-command.js')).McpCommand(),
    description: 'MCP server commands (serve / install-instructions)',
  },
  doctor: {
    load: async () => new (await import('./commands/doctor-command.js')).DoctorCommand(),
    description: 'Run a read-only diagnostic check on the current project',
  },
  destroy: {
    load: async () => new (await import('./commands/destroy-command.js')).DestroyCommand(),
    description: 'Remove every Mnema artefact from the current directory (destructive)',
  },
  migration: {
    load: async () => new (await import('./commands/migration-command.js')).MigrationCommand(),
    description: 'Manage SQLite migrations (generate / apply)',
  },
  migrate: {
    load: async () => new (await import('./commands/migration-command.js')).MigrateCommand(),
    description: 'Apply every pending migration (alias of `migration apply`)',
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
  // The stub is *visible* in `mnema --help` so first-time users
  // discover what is available; the real subcommand tree only loads
  // when the user actually invokes `mnema <name>`.
  const stub = program
    .command(`${name} [args...]`)
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

  stub.description(spec.description);
}
