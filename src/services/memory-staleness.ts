import { spawnSync } from 'node:child_process';

/** A file path cited by a memory, plus whether it changed since. */
export interface CitedFile {
  readonly path: string;
  /** True when the file changed in git after the memory's timestamp. */
  readonly changedSince: boolean;
}

/** Advisory staleness verdict for one memory. */
export interface StalenessVerdict {
  /** True when at least one cited file changed since the memory was written. */
  readonly stale: boolean;
  /** The cited files and their per-file verdicts. */
  readonly cited_files: CitedFile[];
}

/** Runs a git command in `cwd`, returning stdout (empty on any failure). */
export type GitRunner = (args: readonly string[], cwd: string) => string;

const defaultGitRunner: GitRunner = (args, cwd) => {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf-8', timeout: 5_000 });
  if (result.status !== 0 || typeof result.stdout !== 'string') return '';
  return result.stdout;
};

// Matches `src/foo/bar.ts` and `src/foo/bar.ts:42` — a path with a slash
// and a known-ish source extension, optionally followed by `:line`. Kept
// deliberately conservative so prose with stray words is not misread as a
// file reference.
const FILE_REF = /\b([\w./-]+\/[\w.-]+\.[a-z]{1,5})(?::\d+)?/gi;

/**
 * Flags whether a memory is likely stale by checking the files it cites
 * against git history. A memory often pins a fact to a `file:line`; once
 * that file changes, the citation may no longer hold. This surfaces an
 * advisory signal — it never blocks recall, it just tells the reader
 * which memories are worth re-checking against the current code.
 *
 * Detection is heuristic and read-only: cited paths are extracted from
 * the body, then `git log` decides whether each changed after the
 * memory's timestamp. Outside a git repo (or for an unknown path) the
 * verdict is simply "not stale" — absence of evidence, never a false
 * alarm.
 */
export class MemoryStalenessService {
  constructor(
    private readonly projectRoot: string,
    private readonly git: GitRunner = defaultGitRunner,
  ) {}

  /**
   * Assesses one memory.
   *
   * @param content - The memory body to scan for file references
   * @param writtenAt - The memory's `updatedAt` (ISO-8601)
   * @returns An advisory {@link StalenessVerdict}.
   */
  assess(content: string, writtenAt: string): StalenessVerdict {
    const paths = extractPaths(content);
    if (paths.length === 0) return { stale: false, cited_files: [] };

    const cited: CitedFile[] = paths.map((p) => ({
      path: p,
      changedSince: this.changedSince(p, writtenAt),
    }));
    return { stale: cited.some((c) => c.changedSince), cited_files: cited };
  }

  /** True when `path` has a commit touching it strictly after `writtenAt`. */
  private changedSince(filePath: string, writtenAt: string): boolean {
    const sinceMs = Date.parse(writtenAt);
    if (Number.isNaN(sinceMs)) return false;
    // One commit subject line per commit that touched the path after the
    // timestamp; any output at all means it changed.
    const out = this.git(
      ['log', `--since=${writtenAt}`, '--format=%H', '--', filePath],
      this.projectRoot,
    );
    return out.trim().length > 0;
  }
}

/** Extract unique candidate file paths from a memory body. */
function extractPaths(content: string): string[] {
  const found = new Set<string>();
  for (const match of content.matchAll(FILE_REF)) {
    const p = match[1];
    if (p !== undefined) found.add(p);
  }
  return [...found];
}
