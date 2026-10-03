/**
 * The entry point `action.yml` runs: reads the workflow's environment and the pull request's
 * event, connects to GitHub, and exits non-zero when the check fails.
 *
 * It answers only a `pull_request` event. Any other event is refused by name rather than
 * guessed at, because there is no base to compare the record against.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connect, type Fetch } from './github.js';
import { judge } from './judge.js';
import { worldAt } from './world.js';

type Env = Readonly<Record<string, string | undefined>>;

/** What the workflow handed in, checked. */
interface Request {
  readonly cwd: string;
  readonly token: string;
  readonly apiUrl: string;
  readonly repository: string;
  readonly number: number;
  readonly baseSha: string;
  readonly author: string;
  readonly requireApprovalForAsks: boolean;
}

/** Reads the environment the runner sets for an Action, or says what is missing. */
export function requestFrom(env: Env, readEvent: (path: string) => string): Request {
  const need = (name: string): string => {
    const value = env[name];
    if (value === undefined || value === '') throw new Error(`${name} is not set`);
    return value;
  };
  if (need('GITHUB_EVENT_NAME') !== 'pull_request') {
    throw new Error(
      `this Action answers a pull_request event, and this run is a ${env.GITHUB_EVENT_NAME}`,
    );
  }
  const token = need('INPUT_GITHUB-TOKEN');
  const repository = need('GITHUB_REPOSITORY');
  const event = JSON.parse(readEvent(need('GITHUB_EVENT_PATH'))) as {
    pull_request?: { number?: unknown; base?: { sha?: unknown }; user?: { login?: unknown } };
  };
  const pr = event.pull_request;
  const { number } = pr ?? {};
  const baseSha = pr?.base?.sha;
  const author = pr?.user?.login;
  if (typeof number !== 'number' || typeof baseSha !== 'string' || typeof author !== 'string') {
    throw new Error('the event holds no pull request number, base commit and author');
  }
  const approval = (env['INPUT_REQUIRE-APPROVAL-FOR-ASKS'] ?? 'false').trim().toLowerCase();
  if (approval !== 'true' && approval !== 'false') {
    throw new Error(`require-approval-for-asks is "${approval}"; it takes true or false`);
  }
  return {
    cwd: env.GITHUB_WORKSPACE ?? process.cwd(),
    token,
    apiUrl: env.GITHUB_API_URL ?? 'https://api.github.com',
    repository,
    number,
    baseSha,
    author,
    requireApprovalForAsks: approval === 'true',
  };
}

/** Runs the Action; the number is the process's exit code. */
export async function main(env: Env, fetchIt: Fetch, say: (line: string) => void): Promise<number> {
  try {
    const request = requestFrom(env, (path) => readFileSync(path, 'utf-8'));
    const github = connect(
      {
        apiUrl: request.apiUrl,
        repository: request.repository,
        number: request.number,
        token: request.token,
      },
      fetchIt,
    );
    const verdict = await judge(
      worldAt(request.cwd, github, {
        info: say,
        warning: (line) => say(`::warning::${line}`),
      }),
      request,
    );
    for (const reason of verdict.reasons) say(`::error::${reason}`);
    return verdict.failed ? 1 : 0;
  } catch (error) {
    say(`::error::${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.env, fetch as unknown as Fetch, (line) =>
    console.log(line),
  );
}
