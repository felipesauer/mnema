import type { Command } from 'commander';
import { ExitCode } from '../../errors/error-codes.js';
import { printError } from '../../errors/error-printer.js';
import type { SearchEntity, SearchHit } from '../../services/search-service.js';
import { pc } from '../../utils/colors.js';
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
          const result = container.search.search(query, {
            entities,
            perEntityLimit: options.limit !== undefined ? Number(options.limit) : undefined,
          });
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          const hits = result.value;

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
      : `${pc.cyan(hit.entity)} ${pc.bold(hitIdentifier(hit))}`;
  const title = hit.title !== null ? ` ${hit.title}` : '';
  const snippet = stripFtsMarks(hit.snippet);
  return `${head}${title}\n  ${pc.dim(snippet)}`;
}

function hitIdentifier(hit: SearchHit): string {
  // Observations have no first-class key — surface a UUID prefix so the
  // human reader can still act on the hit (e.g. grep the audit log)
  // instead of seeing an abandoned-looking `observation '\n  snippet`.
  if (hit.key !== null) return hit.key;
  return `${hit.id.slice(0, 8)}…`;
}

function stripFtsMarks(snippet: string): string {
  return snippet.replace(/<\/?mark>/g, '');
}
