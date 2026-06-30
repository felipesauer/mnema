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

// File extensions a *bare* (slash-less) filename must end in to count
// as a citation — keeps `package.json` / `README.md` while rejecting
// prose abbreviations like `e.g.` / `i.e.` (g, e are not real exts).
// Longer extensions first so the alternation prefers `json` over `js`,
// `tsx` over `ts`, etc. A trailing `(?!\w)` (below) also prevents a
// short ext from matching when more word chars follow.
const KNOWN_EXTS =
  'tsx|ts|jsx|js|mjs|cjs|json|mdx|md|yaml|yml|toml|css|scss|html|sql|sh|py|rs|go|java|rb|txt|lock';

// Two shapes, each optionally followed by `:line`:
//   - PATH WITH A SEPARATOR: `src/foo/bar.ts`, `./README.md` — permissive
//     extension (1–6 letters), since the slash already signals a path.
//   - BARE FILENAME: `package.json`, `tsconfig.json` — must end in a
//     KNOWN_EXTS extension so prose like `e.g.` is not mistaken for one.
// A leading `./` is captured separately and dropped by `extractPaths`
// so the spelling matches the repo-relative path git tracks. `words/
// then.end` can still match the with-separator arm (`end` looks like an
// ext) — accepted as a rare false positive; this is advisory-only.
const FILE_REF = new RegExp(
  '(?:^|[\\s([`\'"])(\\./)?(' +
    '(?:[\\w.-]+\\/)+[\\w-]+\\.[a-z]{1,6}' + // with separator
    '|[\\w-]+\\.(?:' +
    KNOWN_EXTS +
    ')(?![\\w])' + // bare filename, known ext, not followed by more word chars
    ')(?::\\d+)?',
  'gi',
);

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

    const changed = this.changedPathsSince(paths, writtenAt);
    const cited: CitedFile[] = paths.map((p) => ({
      path: p,
      changedSince: changed.has(p),
    }));
    return { stale: cited.some((c) => c.changedSince), cited_files: cited };
  }

  /**
   * Returns the subset of `paths` that a commit touched after
   * `writtenAt`. A single `git log --name-only` over all cited paths
   * replaces the previous one-fork-per-path, so a bootstrap with many
   * memories no longer pays O(memories × files) git invocations. Outside
   * a git repo (empty output) nothing is reported changed — advisory,
   * never a false alarm.
   */
  private changedPathsSince(paths: readonly string[], writtenAt: string): Set<string> {
    const changed = new Set<string>();
    if (Number.isNaN(Date.parse(writtenAt))) return changed;

    // `--name-only` lists every changed path (one per line) across the
    // commits since the timestamp, limited to the cited pathspecs.
    const out = this.git(
      ['log', `--since=${writtenAt}`, '--name-only', '--format=', '--', ...paths],
      this.projectRoot,
    );
    if (out.trim().length === 0) return changed;

    const touched = new Set(
      out
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    );
    // git reports repo-relative paths for the pathspecs we passed, so an
    // exact match is the reliable signal. (A bare filename citation that
    // git can't resolve to a tracked path simply never appears here —
    // advisory, so a miss is silent rather than a false alarm.)
    for (const p of paths) {
      if (touched.has(p)) changed.add(p);
    }
    return changed;
  }
}

/**
 * Extract unique candidate file paths from a memory body, normalising a
 * leading `./` away so the spelling matches what git tracks.
 */
function extractPaths(content: string): string[] {
  const found = new Set<string>();
  for (const match of content.matchAll(FILE_REF)) {
    const p = match[2];
    if (p !== undefined) found.add(p);
  }
  return [...found];
}
