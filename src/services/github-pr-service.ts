import { spawnSync } from 'node:child_process';

/** Normalised PR state. `unknown` when GitHub could not be reached. */
export type PrState = 'open' | 'merged' | 'closed' | 'unknown';

/** Normalised CI rollup. `unknown` when unavailable or no checks ran. */
export type CiStatus = 'passing' | 'failing' | 'pending' | 'none' | 'unknown';

/** The result of inspecting a pull request. */
export interface PrStatus {
  /** Whether GitHub could be reached and the PR resolved. */
  readonly available: boolean;
  /** Parsed `owner/repo#number`, or null when the URL didn't parse. */
  readonly ref: string | null;
  readonly state: PrState;
  readonly merged: boolean;
  readonly ci: CiStatus;
  /** Human-readable reason when `available` is false. */
  readonly reason?: string;
}

/** Minimal subset of {@link spawnSync}'s result the service needs. */
export interface CommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly error?: Error;
}

/** Runs a command and returns its captured result. Injectable for tests. */
export type CommandRunner = (command: string, args: readonly string[]) => CommandResult;

const defaultRunner: CommandRunner = (command, args) => {
  const result = spawnSync(command, [...args], { encoding: 'utf-8', timeout: 10_000 });
  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    error: result.error ?? undefined,
  };
};

/** Shape of the `gh pr view --json ...` payload we consume. */
interface GhPrView {
  readonly state?: string;
  readonly mergedAt?: string | null;
  readonly statusCheckRollup?: { readonly state?: string }[] | null;
}

/**
 * Resolves a pull request's state and CI status from a `pr_url`, closing
 * the loop the tracker otherwise leaves open: `submit_review` accepts a
 * URL but never checks it, so the move to DONE was an act of faith.
 *
 * Uses the GitHub CLI (`gh`) so it inherits the user's existing auth and
 * needs no token wiring. Every failure mode — `gh` absent, unauthenticated,
 * offline, an unparseable URL — degrades to `available: false` with a
 * reason rather than throwing, so a tracker mutation never fails because
 * GitHub was unreachable.
 */
export class GitHubPrService {
  constructor(private readonly run: CommandRunner = defaultRunner) {}

  /**
   * Inspects a pull request URL.
   *
   * @param prUrl - A github.com pull-request URL
   * @returns Normalised {@link PrStatus}; never throws.
   */
  status(prUrl: string): PrStatus {
    const ref = parsePrUrl(prUrl);
    if (ref === null) {
      return {
        available: false,
        ref: null,
        state: 'unknown',
        merged: false,
        ci: 'unknown',
        reason: 'not a recognised github.com pull-request URL',
      };
    }

    let result: CommandResult;
    try {
      result = this.run('gh', ['pr', 'view', prUrl, '--json', 'state,mergedAt,statusCheckRollup']);
    } catch (error) {
      return unavailable(
        ref.label,
        error instanceof Error ? error.message : 'gh invocation failed',
      );
    }

    if (result.error !== undefined) {
      // ENOENT etc. — gh not installed.
      return unavailable(ref.label, `gh not available: ${result.error.message}`);
    }
    if (result.status !== 0) {
      return unavailable(
        ref.label,
        'gh could not resolve the PR (unauthenticated, offline, or no access)',
      );
    }

    let view: GhPrView;
    try {
      view = JSON.parse(result.stdout) as GhPrView;
    } catch {
      return unavailable(ref.label, 'could not parse gh output');
    }

    const merged = typeof view.mergedAt === 'string' && view.mergedAt.length > 0;
    return {
      available: true,
      ref: ref.label,
      state: normaliseState(view.state, merged),
      merged,
      ci: normaliseCi(view.statusCheckRollup),
    };
  }
}

/** Parse `https://github.com/<owner>/<repo>/pull/<n>` → label `owner/repo#n`. */
function parsePrUrl(url: string): { label: string } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (match === null) return null;
  return { label: `${match[1]}/${match[2]}#${match[3]}` };
}

function normaliseState(raw: string | undefined, merged: boolean): PrState {
  if (merged) return 'merged';
  switch ((raw ?? '').toUpperCase()) {
    case 'OPEN':
      return 'open';
    case 'MERGED':
      return 'merged';
    case 'CLOSED':
      return 'closed';
    default:
      return 'unknown';
  }
}

function normaliseCi(rollup: GhPrView['statusCheckRollup']): CiStatus {
  if (rollup === null || rollup === undefined || rollup.length === 0) return 'none';
  const states = rollup.map((c) => (c.state ?? '').toUpperCase());
  if (states.some((s) => s === 'FAILURE' || s === 'ERROR')) return 'failing';
  if (states.some((s) => s === 'PENDING' || s === 'EXPECTED' || s === 'IN_PROGRESS'))
    return 'pending';
  if (states.every((s) => s === 'SUCCESS' || s === 'NEUTRAL' || s === 'SKIPPED')) return 'passing';
  return 'unknown';
}

function unavailable(ref: string, reason: string): PrStatus {
  return { available: false, ref, state: 'unknown', merged: false, ci: 'unknown', reason };
}
