import { Command } from 'commander';

import { VERSION } from '@/utils/version.js';

/**
 * Creates the root Commander program with metadata.
 * Subcommands are registered separately by *-command.ts files.
 *
 * @returns Root Commander program ready for parse()
 */
export function createCli(): Command {
  const program = new Command();
  program.name('mnema').description('Cognitive persistence for AI agents').version(VERSION);
  return program;
}
