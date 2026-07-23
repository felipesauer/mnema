#!/usr/bin/env node
/**
 * The `mnema` CLI entry point. The command surface lands in following
 * changes; for now it answers `--version` so the built binary is runnable.
 */

import { PACKAGE_NAME } from './index.js';

function main(argv: readonly string[]): void {
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write('0.0.0\n');
    return;
  }
  process.stdout.write(`${PACKAGE_NAME}: no commands yet\n`);
}

main(process.argv.slice(2));
