import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { parseFrontmatter } from '../storage/markdown/frontmatter.js';

/**
 * A versioned slash command discovered under `.mnema/commands/`. It
 * bundles a repeatable flow — an ordered list of `mnema` invocations —
 * behind a single name (e.g. `/standup` = bootstrap + inbox + today's
 * history), committed alongside the project so the whole team shares it.
 */
export interface CommandDefinition {
  /** Command name, taken from the filename stem (e.g. `standup`). */
  readonly name: string;
  /** One-line summary shown when the commands are listed. */
  readonly description: string;
  /**
   * The flow this command runs, in order. Each entry is a `mnema`
   * invocation written *without* the leading `mnema` (e.g. `inbox`,
   * `history --since=today`).
   */
  readonly steps: readonly string[];
  /** Markdown body after the frontmatter (human notes; may be empty). */
  readonly body: string;
}

/** A command file that could not be loaded, with why — surfaced, never silently dropped. */
export interface SkippedCommand {
  readonly file: string;
  readonly reason: string;
}

/** Outcome of {@link CommandDefinitionService.list}. */
export interface CommandListResult {
  readonly commands: readonly CommandDefinition[];
  readonly skipped: readonly SkippedCommand[];
}

const CommandFrontmatterSchema = z.object({
  description: z.string().min(1),
  steps: z.array(z.string().min(1)).min(1),
});

/**
 * Discovers and parses versioned slash commands from `.mnema/commands/`.
 *
 * A command lives in `<name>.md` whose frontmatter declares a
 * `description` and an ordered `steps` list; the markdown body is free
 * text for humans. The command name is the filename stem, so it is stable
 * and unique per directory. Read-only: this service surfaces what is on
 * disk (discovery + validation); it does not execute the steps.
 */
export class CommandDefinitionService {
  constructor(private readonly commandsDir: string) {}

  /**
   * Walks `commandsDir` and returns one {@link CommandDefinition} per
   * well-formed `<name>.md`, plus a `skipped` entry (with a reason) for
   * every file that is not — a malformed command must never take the
   * whole listing down. Commands are returned sorted by name.
   *
   * @returns The discovered commands and the files that were skipped
   */
  list(): CommandListResult {
    if (!existsSync(this.commandsDir)) return { commands: [], skipped: [] };

    const commands: CommandDefinition[] = [];
    const skipped: SkippedCommand[] = [];

    const files = readdirSync(this.commandsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      // A catalogue index, if present, is documentation — not a command.
      .filter((name) => name !== 'INDEX.md')
      .sort();

    for (const fileName of files) {
      const filePath = path.join(this.commandsDir, fileName);
      const name = fileName.slice(0, -3);
      let parsed: ReturnType<typeof parseFrontmatter>;
      try {
        parsed = parseFrontmatter(readFileSync(filePath, 'utf-8'));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        skipped.push({ file: fileName, reason: `malformed frontmatter: ${message}` });
        continue;
      }

      const result = CommandFrontmatterSchema.safeParse(parsed.data);
      if (!result.success) {
        const first = result.error.issues[0];
        const where = first === undefined ? '' : `${first.path.join('.')}: ${first.message}`;
        skipped.push({ file: fileName, reason: `invalid command: ${where}` });
        continue;
      }

      commands.push({
        name,
        description: result.data.description,
        steps: result.data.steps,
        body: parsed.content.trim(),
      });
    }

    return { commands, skipped };
  }

  /**
   * Returns a single command by name, or `null` when no matching, valid
   * `<name>.md` exists.
   *
   * @param name - Command name (the filename stem)
   */
  show(name: string): CommandDefinition | null {
    return this.list().commands.find((c) => c.name === name) ?? null;
  }
}
