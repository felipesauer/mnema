/**
 * Identifies the `ExitPromptError` thrown by `@inquirer/prompts` when
 * the user hits Ctrl-C (SIGINT) inside a prompt.
 *
 * `@inquirer/prompts` does not re-export the error class, so we match
 * by `name` rather than by `instanceof` — robust across minor version
 * bumps.
 *
 * @param error - Anything caught from a prompt call
 * @returns `true` when the throw came from the user aborting
 */
export function isPromptAbort(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const named = error as { name?: unknown };
  return named.name === 'ExitPromptError';
}
