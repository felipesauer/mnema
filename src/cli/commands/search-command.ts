import type { Command } from 'commander';
import pc from 'picocolors';

import { ExitCode } from '../../errors/error-codes.js';
import type { SearchEntity, SearchHit } from '../../services/search-service.js';
import { withCliContext } from '../cli-context.js';

interface SearchOptions {
  readonly limit?: string;
  readonly entity?: string[];
  readonly json?: boolean;
}

const VALID_ENTITIES: readonly SearchEntity[] = [
  'task',
  'decision',
  'note',
  'skill',
  'memory',
  'observation',
];

function isSearchEntity(value: string): value is SearchEntity {
  return (VALID_ENTITIES as readonly string[]).includes(value);
}

/**
 * Registers `mnema search`, the unified FTS5 query.
 */
export class SearchCommand {
  /**
   * Attaches the `search` subcommand to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    program
      .command('search <query...>')
      .description(
        'Full-text search across tasks, decisions, notes, skills, memories and observations',
      )
      .option('--entity <kind...>', `Restrict to entity kinds (${VALID_ENTITIES.join(', ')})`)
      .option('--limit <n>', 'Max hits per entity (default 25)')
      .option('--json', 'Print raw hits as JSON', false)
      .action(async (queryParts: string[], options: SearchOptions) => {
        const query = queryParts.join(' ');
        let entities: readonly SearchEntity[] | undefined;
        if (options.entity !== undefined) {
          const unknown = options.entity.filter((e) => !isSearchEntity(e));
          if (unknown.length > 0) {
            process.stderr.write(
              `error: unknown --entity value(s): ${unknown.join(', ')}. Valid: ${VALID_ENTITIES.join(', ')}\n`,
            );
            process.exit(ExitCode.Usage);
          }
          entities = options.entity.filter(isSearchEntity);
        }
        await withCliContext(({ container }) => {
          const hits = container.search.search(query, {
            entities,
            perEntityLimit: options.limit !== undefined ? Number(options.limit) : undefined,
          });

          if (options.json === true) {
            process.stdout.write(`${JSON.stringify(hits, null, 2)}\n`);
            return;
          }

          if (hits.length === 0) {
            process.stdout.write(`${pc.dim(`(no matches for "${query}")`)}\n`);
            return;
          }

          for (const hit of hits) {
            process.stdout.write(`${formatHit(hit)}\n`);
          }
        });
      });
  }
}

function formatHit(hit: SearchHit): string {
  const head =
    hit.entity === 'note'
      ? `${pc.cyan('note')} (on ${pc.bold(hit.parentKey ?? '?')})`
      : `${pc.cyan(hit.entity)} ${pc.bold(hit.key ?? '')}`;
  const title = hit.title !== null ? ` ${hit.title}` : '';
  const snippet = stripFtsMarks(hit.snippet);
  return `${head}${title}\n  ${pc.dim(snippet)}`;
}

function stripFtsMarks(snippet: string): string {
  return snippet.replace(/<\/?mark>/g, '');
}
