/**
 * THE ONE REPETITION THE CODEX CONTRACT ALLOWS. Codex freezes its list of tools about a second and
 * a half into a turn and does not wait for an MCP server beyond that, so on a loaded runner a
 * session now and then starts without the plugin's server in it (measured at about 2% of runs; the
 * server's handshake had finished or not by then, whatever the product did). A session that
 * should have the server and has not is opened again, ONCE, and the job's summary says it was.
 * Never silent, never more than once: a server that is missing on the second session is returned
 * as it is, and the case that asked for it fails.
 */

import { appendFileSync } from 'node:fs';

/** Opens a session; if the server is expected and not in it, says so and opens one more. */
export async function openWithOneRetry<S>(
  attempt: () => Promise<S>,
  listed: (session: S) => boolean,
  expected: boolean,
  say: (line: string) => void,
): Promise<S> {
  const first = await attempt();
  if (!expected || listed(first)) return first;
  say(
    'Codex started a session without the mnema server in its tool list (its own race: it freezes ' +
      'the list about 1.5 s into the turn); the session was repeated once.',
  );
  return attempt();
}

/** Writes a line to the job's summary when there is one, and to the log always. */
export function sayInTheJobSummary(line: string): void {
  console.warn(line);
  const file = process.env['GITHUB_STEP_SUMMARY'];
  if (file !== undefined && file !== '') appendFileSync(file, `${line}\n`);
}
