/**
 * The only door to the record: the `mnema` command line, started directly with an argument
 * array — never through a shell, so nothing a title or a note says can become a command.
 */

import { execFile } from 'node:child_process';

/** What one run of the command line said. `code` is null when it could not be started at all. */
export interface CliResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `mnema` with these arguments, in the folder the runner was made for. */
export type Run = (args: readonly string[]) => Promise<CliResult>;

const MAX_OUTPUT = 32 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

/** A runner for one executable and one working folder. It resolves on a failure and never throws. */
export function createRun(command: string, cwd: string): Run {
  return (args) =>
    new Promise((resolve) => {
      execFile(
        command,
        [...args],
        { cwd, encoding: 'utf8', maxBuffer: MAX_OUTPUT, timeout: TIMEOUT_MS },
        (error, stdout, stderr) => {
          if (error === null) return resolve({ code: 0, stdout, stderr });
          const code = typeof error.code === 'number' ? error.code : null;
          resolve({ code, stdout, stderr: code === null ? `${error.message}\n${stderr}` : stderr });
        },
      );
    });
}
