#!/usr/bin/env node
/**
 * Starts the mnema MCP server: the `mnema` the person named in the plugin's `mnema_path`
 * option, or the first one on the PATH when they named none.
 *
 * The host hands the option over as `MNEMA_PLUGIN_BINARY` (the manifest substitutes
 * `${user_config.mnema_path}` into this server's `env`). A host that does not know that
 * substitution leaves the placeholder as it was, and that is taken as no choice made: starting
 * a program named by the placeholder would be a server that never comes up, with nothing said.
 *
 * Everything else is passed through: the arguments, the standard streams (the server speaks
 * over them) and the exit code. The signals a host stops a server with are forwarded, so the
 * server does not outlive this process.
 */

import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { pathToFileURL } from 'node:url';

/**
 * The command line to run when nothing was named.
 *
 * The `.cmd` on Windows is npm's own shim name, and it is INTENTION rather than an assertion:
 * nothing here has been run on Windows.
 */
const BINARY = process.platform === 'win32' ? 'mnema.cmd' : 'mnema';

/**
 * What to run, given the option as the host handed it over.
 *
 * @param {string | undefined} configured
 * @returns {string}
 */
export function theBinaryToRun(configured) {
  if (typeof configured !== 'string') return BINARY;
  const named = configured.trim();
  return named === '' || named.includes('${') ? BINARY : named;
}

function main() {
  const binary = theBinaryToRun(process.env.MNEMA_PLUGIN_BINARY);
  const child = spawn(binary, process.argv.slice(2), {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => child.kill(/** @type {NodeJS.Signals} */ (signal)));
  }
  child.on('error', (error) => {
    process.stderr.write(
      `mnema plugin: could not start ${JSON.stringify(binary)}: ${error.message}\n`,
    );
    process.exit(127);
  });
  child.on('exit', (code, signal) => {
    process.exit(code ?? 128 + (signal === null ? 1 : (constants.signals[signal] ?? 1)));
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
