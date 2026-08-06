/**
 * The `mnema search` wiring: what it declares, and what it prints.
 *
 * `mnema search [term] [--kind --scope --state --from --to --limit] [--json]`.
 * The term is OPTIONAL: with one it is a search, without one the most recent
 * records. `--json` emits the faithful object (one flat list, as the agent's
 * surface serves it); the human summary GROUPS by kind, which is presentation
 * and nothing else — the read returns one ordered list either way.
 */

import { SEARCH_DEFAULT_LIMIT, SEARCH_KINDS, SEARCH_MAX_LIMIT, type SearchKind } from '@mnema/core';
import type { Command } from 'commander';
import { here } from './context.js';
import { writeLines } from './io.js';
import { INVALID, INVALID_LIMIT, parseLimit, parseScope, SCOPES } from './options.js';
import { reportUsage } from './report.js';
import type { Wiring } from './verb.js';

/** Registers `mnema search` on the program. */
export function registerSearch(program: Command, wiring: Wiring): void {
  const { io, render } = wiring;
  program
    .command('search')
    .description('find what has been recorded, or list the most recent (no term)')
    .argument('[term]', 'words to look for; omit to list the most recent records')
    .option('--kind <kind>', `only this kind of record: ${SEARCH_KINDS.join(', ')}`)
    .option('--scope <scope>', `only this tree: ${SCOPES.join(', ')}`)
    .option('--state <state>', 'only records in this state (excludes kinds that have none)')
    .option('--from <iso>', 'only records at or after this ISO-8601 instant')
    .option('--to <iso>', 'only records at or before this ISO-8601 instant')
    .option(
      '--limit <n>',
      `how many to return (default ${SEARCH_DEFAULT_LIMIT}, max ${SEARCH_MAX_LIMIT})`,
    )
    .option('--json', 'emit the faithful index as JSON (one ordered list)')
    .action(
      async (
        term: string | undefined,
        opts: {
          kind?: string;
          scope?: string;
          state?: string;
          from?: string;
          to?: string;
          limit?: string;
          json?: boolean;
        },
      ) => {
        const { runSearch } = await import('../commands/search.js');
        const { searchReport } = await import('../presentation/search.js');
        const scope = parseScope(opts.scope, wiring);
        if (scope === INVALID) return;
        const limit = parseLimit(opts.limit, wiring);
        if (limit === INVALID_LIMIT) return;
        const result = runSearch(here(), {
          ...(term !== undefined ? { term } : {}),
          ...(opts.kind !== undefined ? { kind: opts.kind as SearchKind } : {}),
          ...(scope !== undefined ? { scope } : {}),
          ...(opts.state !== undefined ? { state: opts.state } : {}),
          ...(opts.from !== undefined ? { from: opts.from } : {}),
          ...(opts.to !== undefined ? { to: opts.to } : {}),
          ...(limit !== undefined ? { limit } : {}),
        });
        if (!result.ok) {
          // Both refusals are about the QUERY rather than the record, and each
          // carries the value it is about — so neither goes through the shared
          // refusal: a bad `--kind` names the kinds there are, and a tree that is
          // not here names the one that was asked for.
          reportUsage(
            wiring,
            result.reason === 'UNKNOWN_KIND'
              ? `Invalid --kind "${result.kind}". Use one of: ${SEARCH_KINDS.join(', ')}.`
              : `No ${result.scope} tree here. Run \`mnema init\` in a project first.`,
          );
          return;
        }
        if (opts.json === true) {
          io.out(JSON.stringify(result.result, null, 2));
          return;
        }
        writeLines(io, searchReport(render, result.result, term));
      },
    );
}
