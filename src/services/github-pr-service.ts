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
  /**
   * CI on the PR's HEAD commit (the branch tip) — the rollup GitHub attaches
   * to the pull request. For an OPEN PR this is the signal that matters. For a
   * MERGED PR it reflects the branch at merge time, NOT the merge commit's run
   * on the base — for that, use {@link ciBase}.
   */
  readonly ci: CiStatus;
  /**
   * CI on the MERGE COMMIT on the base branch, resolved only when the PR is
   * merged and its merge commit is known. This is the signal an approve gate
   * actually wants: did the code, once on the base, pass? `unknown` when not
   * merged, no merge commit, or the follow-up lookup failed.
   */
  readonly ciBase: CiStatus;
  /** The merge commit SHA on the base branch, when merged and known. */
  readonly mergeCommit?: string;
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

export const defaultRunner: CommandRunner = (command, args) => {
  const result = spawnSync(command, [...args], { encoding: 'utf-8', timeout: 10_000 });
  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    error: result.error ?? undefined,
  };
};

/**
 * One entry in `statusCheckRollup`. GitHub returns two shapes:
 * `StatusContext` (legacy commit statuses) carries `state`; `CheckRun`
 * (GitHub Actions and other Checks-API runs — the dominant case today)
 * carries `status` + `conclusion` and **no** `state`. We read both.
 */
interface RollupEntry {
  /** StatusContext: SUCCESS | FAILURE | PENDING | ERROR | EXPECTED. */
  readonly state?: string;
  /** CheckRun: QUEUED | IN_PROGRESS | COMPLETED | … */
  readonly status?: string;
  /** CheckRun (when COMPLETED): SUCCESS | FAILURE | NEUTRAL | SKIPPED | … */
  readonly conclusion?: string;
}

/** Shape of the `gh pr view --json ...` payload we consume. */
interface GhPrView {
  readonly state?: string;
  readonly mergedAt?: string | null;
  readonly statusCheckRollup?: RollupEntry[] | null;
  /** The merge commit on the base branch, present once merged. */
  readonly mergeCommit?: { readonly oid?: string } | null;
  readonly baseRefName?: string | null;
}

/** One `gh api .../commits/<sha>/check-runs` entry (Checks API, REST shape). */
interface RestCheckRun {
  readonly status?: string;
  readonly conclusion?: string | null;
}
/** `gh api .../commits/<sha>/status` combined-status payload (legacy statuses). */
interface RestCombinedStatus {
  readonly state?: string;
  readonly statuses?: Array<{ readonly state?: string }>;
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
        ciBase: 'unknown',
        reason: 'not a recognised github.com pull-request URL',
      };
    }

    let result: CommandResult;
    try {
      result = this.run('gh', [
        'pr',
        'view',
        prUrl,
        '--json',
        'state,mergedAt,statusCheckRollup,mergeCommit,baseRefName',
      ]);
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
    const mergeOid =
      typeof view.mergeCommit?.oid === 'string' && view.mergeCommit.oid.length > 0
        ? view.mergeCommit.oid
        : undefined;
    // Base-branch CI: only meaningful once merged and the merge commit is
    // known. The follow-up gh api calls degrade to 'unknown' on any failure,
    // exactly like the pr view path — a gate reading ciBase then treats
    // 'unknown' as "can't prove a problem", never a false block.
    const ciBase =
      merged && mergeOid !== undefined
        ? this.mergeCommitCi(ref.owner, ref.repo, mergeOid)
        : 'unknown';
    return {
      available: true,
      ref: ref.label,
      state: normaliseState(view.state, merged),
      merged,
      ci: normaliseCi(view.statusCheckRollup),
      ciBase,
      ...(mergeOid !== undefined ? { mergeCommit: mergeOid } : {}),
    };
  }

  /**
   * Resolves the CI status of the merge commit on the base branch, combining
   * the Checks API (`/commits/<sha>/check-runs`, GitHub Actions et al.) and the
   * legacy combined status (`/commits/<sha>/status`). Any failure — gh error,
   * non-zero exit, unparseable JSON — yields 'unknown', so a caller never reads
   * a lookup failure as a red or green base.
   */
  private mergeCommitCi(owner: string, repo: string, sha: string): CiStatus {
    const base = `repos/${owner}/${repo}/commits/${sha}`;
    const checkRuns = this.ghApiCheckRuns(`${base}/check-runs`);
    const combined = this.ghApiCombinedStatus(`${base}/status`);
    // No signal from either endpoint → 'none' only when BOTH resolved and were
    // empty; if either failed to resolve, prefer 'unknown' (do not claim clean).
    if (checkRuns === 'unknown' && combined === 'unknown') return 'unknown';
    const states: CiStatus[] = [checkRuns, combined].filter((c) => c !== 'unknown');
    if (states.some((s) => s === 'failing')) return 'failing';
    if (states.some((s) => s === 'pending')) return 'pending';
    if (states.some((s) => s === 'passing')) return 'passing';
    return 'none';
  }

  /** Runs `gh api <path>` and returns parsed JSON, or null on any failure. */
  private ghApiJson(apiPath: string): unknown {
    let result: CommandResult;
    try {
      result = this.run('gh', ['api', apiPath]);
    } catch {
      return null;
    }
    if (result.error !== undefined || result.status !== 0) return null;
    try {
      return JSON.parse(result.stdout);
    } catch {
      return null;
    }
  }

  /** Checks-API rollup for a commit → CiStatus, 'unknown' when unresolved. */
  private ghApiCheckRuns(apiPath: string): CiStatus {
    const json = this.ghApiJson(apiPath);
    if (json === null || typeof json !== 'object') return 'unknown';
    const runs = (json as { check_runs?: RestCheckRun[] }).check_runs;
    if (!Array.isArray(runs)) return 'unknown';
    if (runs.length === 0) return 'none';
    const states = runs.map((r) =>
      (r.status ?? '').toUpperCase() === 'COMPLETED'
        ? (r.conclusion ?? '').toUpperCase()
        : 'IN_PROGRESS',
    );
    // Any in-flight run makes the whole rollup pending, no matter what else
    // has landed. Check this before failing so a still-running required check
    // isn't prematurely called red.
    if (states.some((s) => s === 'IN_PROGRESS' || s === 'QUEUED' || s === 'PENDING')) {
      return 'pending';
    }
    // Everything is COMPLETED. A clean rollup is one where every conclusion is
    // a passing/neutral outcome; anything else — FAILURE/TIMED_OUT/CANCELLED,
    // the merge-blocking ACTION_REQUIRED/STALE, or an empty/unrecognized
    // conclusion — is treated as failing. A not-clean completed run must never
    // be silently dropped to 'unknown', or a green legacy status could mask it.
    if (states.every((s) => s === 'SUCCESS' || s === 'NEUTRAL' || s === 'SKIPPED')) {
      return 'passing';
    }
    return 'failing';
  }

  /** Legacy combined-status for a commit → CiStatus, 'unknown' when unresolved. */
  private ghApiCombinedStatus(apiPath: string): CiStatus {
    const json = this.ghApiJson(apiPath);
    if (json === null || typeof json !== 'object') return 'unknown';
    const combined = json as RestCombinedStatus;
    // The API returns state 'pending' when there are NO statuses at all, which
    // would masquerade as an in-flight run; treat an empty statuses list as
    // 'none' and only trust the top-level state when there is ≥1 status.
    if (!Array.isArray(combined.statuses) || combined.statuses.length === 0) return 'none';
    switch ((combined.state ?? '').toLowerCase()) {
      case 'failure':
      case 'error':
        return 'failing';
      case 'pending':
        return 'pending';
      case 'success':
        return 'passing';
      default:
        return 'unknown';
    }
  }
}

/**
 * Parse `https://github.com/<owner>/<repo>/pull/<n>` into its parts plus a
 * display label `owner/repo#n`. The parts feed the `gh api repos/<o>/<r>/…`
 * follow-up that resolves the merge commit's CI on the base branch.
 */
function parsePrUrl(
  url: string,
): { label: string; owner: string; repo: string; number: string } | null {
  // Anchor the host so `mygithub.com` / `notgithub.com` don't slip
  // through: require the scheme + exactly `github.com` (or a `www.`)
  // as the host, not just a substring match.
  const match = url.match(
    /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#]|$)/,
  );
  if (match === null) return null;
  const [, owner, repo, number] = match as unknown as [string, string, string, string];
  return { label: `${owner}/${repo}#${number}`, owner, repo, number };
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
  const states = rollup.map(rollupEntryState);
  if (states.some((s) => s === 'FAILURE' || s === 'ERROR')) return 'failing';
  if (states.some((s) => s === 'PENDING' || s === 'EXPECTED' || s === 'IN_PROGRESS'))
    return 'pending';
  if (states.every((s) => s === 'SUCCESS' || s === 'NEUTRAL' || s === 'SKIPPED')) return 'passing';
  return 'unknown';
}

/**
 * Reduces one rollup entry to a single uppercased state token, reading
 * whichever shape GitHub returned. A `CheckRun` (no `state`) reports
 * `conclusion` once COMPLETED, else its in-flight `status` (QUEUED /
 * IN_PROGRESS → treated as PENDING); a `StatusContext` reports `state`.
 */
function rollupEntryState(entry: RollupEntry): string {
  if (typeof entry.state === 'string' && entry.state.length > 0) {
    return entry.state.toUpperCase();
  }
  const status = (entry.status ?? '').toUpperCase();
  if (status === 'COMPLETED') {
    return (entry.conclusion ?? '').toUpperCase();
  }
  // QUEUED / IN_PROGRESS / WAITING / PENDING → not yet conclusive.
  if (status.length > 0) return 'IN_PROGRESS';
  return '';
}

function unavailable(ref: string, reason: string): PrStatus {
  return {
    available: false,
    ref,
    state: 'unknown',
    merged: false,
    ci: 'unknown',
    ciBase: 'unknown',
    reason,
  };
}
