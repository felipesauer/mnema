/**
 * The only door to the record: the `mnema` command line, started directly with an argument
 * array, never through a shell, so nothing a title or a note says can become a command.
 */

import { execFile } from 'node:child_process';

/** What one run of the command line said. `code` is null when it could not be started at all. */
export interface CliResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Set only when the command was stopped for not answering within the time allowed. */
  readonly timedOut?: true;
}

/** Runs `mnema` with these arguments, in the folder the runner was made for. */
export type Run = (args: readonly string[]) => Promise<CliResult>;

const MAX_OUTPUT = 32 * 1024 * 1024;
/** How long one run may take, in seconds, before it is stopped. */
export const TIMEOUT_SECONDS = 60;

/** A runner for one executable and one working folder. It resolves on a failure and never throws. */
export function createRun(
  command: string,
  cwd: string,
  timeoutMs: number = TIMEOUT_SECONDS * 1000,
): Run {
  return (args) =>
    new Promise((resolve) => {
      execFile(
        command,
        [...args],
        { cwd, encoding: 'utf8', maxBuffer: MAX_OUTPUT, timeout: timeoutMs },
        (error, stdout, stderr) => {
          if (error === null) return resolve({ code: 0, stdout, stderr });
          if (error.killed === true && error.code == null) {
            return resolve({ code: null, stdout, stderr, timedOut: true });
          }
          const code = typeof error.code === 'number' ? error.code : null;
          resolve({ code, stdout, stderr: code === null ? `${error.message}\n${stderr}` : stderr });
        },
      );
    });
}
