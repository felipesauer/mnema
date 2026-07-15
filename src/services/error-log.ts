import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { VERSION } from '../utils/version.js';

/**
 * Cap on the local crash log: it is best-effort diagnostics, not a durable
 * record, so it must not grow without bound. When appending would exceed this
 * many lines, the oldest are dropped (keep the most recent) via a crash-safe
 * temp-then-rename rewrite.
 */
const MAX_ERROR_LOG_ENTRIES = 500;

/**
 * One recorded unhandled crash. These live in a LOCAL error log,
 * deliberately OUTSIDE the SHA-256 audit chain: a crash trace is diagnostic
 * exhaust, not an audit record, and must never be able to fork or bloat the
 * tamper-evident trail. It is local-only and never transmitted
 * (zero-telemetry, see MNEMA-ADR-36/40), and lossy by design — recording a
 * crash must never change the exit code or mask the original error
 * (MNEMA-ADR-46).
 *
 * Only genuinely unexpected crashes are logged. Structured `MnemaError`s
 * (gate failed, conflict, …) are expected business errors shown with a
 * friendly message and are NOT recorded here.
 */
export interface ErrorLogEntry {
  /** ISO8601 timestamp of the crash. */
  readonly at: string;
  /** The error message. */
  readonly message: string;
  /** The stack, when the thrown value was an Error. */
  readonly stack: string | null;
  /** Installed Mnema version. */
  readonly mnema_version: string;
  /** Node.js version (e.g. `v22.3.0`). */
  readonly node_version: string;
  /** Process argv (the invocation), so a report shows what was run. */
  readonly argv: readonly string[];
}

const ERROR_LOG_FILE = 'errors.jsonl';

/** Path to the local error log, given the project's state dir. */
function errorLogFile(stateDir: string): string {
  return path.join(stateDir, ERROR_LOG_FILE);
}

/**
 * Resolves the project's `.mnema/state` directory by walking up from `cwd`,
 * WITHOUT loading or validating the config — the crash being logged may BE
 * in config loading, so this must not depend on it. Returns `null` when no
 * `.mnema` is found up to the filesystem root (a crash outside any project,
 * e.g. `mnema init` in a bare dir), in which case logging is silently
 * skipped.
 *
 * @param cwd - Directory to start the walk from (defaults to `process.cwd()`)
 * @returns Absolute path to `<root>/.mnema/state`, or `null`
 */
export function resolveStateDir(cwd: string = process.cwd()): string | null {
  let dir = path.resolve(cwd);
  while (true) {
    if (existsSync(path.join(dir, '.mnema'))) {
      return path.join(dir, '.mnema', 'state');
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null; // reached filesystem root
    dir = parent;
  }
}

/**
 * Appends one crash entry to the local error log, best-effort. Any error
 * (unwritable dir, disk full, no project) is swallowed: persisting a crash
 * must never itself throw or change how the crash is reported. Not chained,
 * not transmitted — a local record only.
 *
 * @param error - The thrown value that escaped
 * @param options - Optional overrides (stateDir, argv, now) for testing
 */
export function recordError(
  error: unknown,
  options: {
    readonly stateDir?: string | null;
    readonly argv?: readonly string[];
    readonly now?: string;
  } = {},
): void {
  try {
    const stateDir = options.stateDir !== undefined ? options.stateDir : resolveStateDir();
    if (stateDir === null) return; // outside any project — nothing to write to
    const entry: ErrorLogEntry = {
      at: options.now ?? new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error && error.stack !== undefined ? error.stack : null,
      mnema_version: VERSION,
      node_version: process.version,
      argv: options.argv ?? process.argv.slice(1),
    };
    if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
    const file = errorLogFile(stateDir);
    const line = `${JSON.stringify(entry)}\n`;

    // Fast path: below the cap, a plain append. Only pay to read+rewrite when
    // the log is at/over the cap, and then keep the most recent entries.
    const existing = existsSync(file) ? readFileSync(file, 'utf-8') : '';
    const lineCount = existing.length === 0 ? 0 : existing.replace(/\n$/, '').split('\n').length;
    if (lineCount < MAX_ERROR_LOG_ENTRIES) {
      appendFileSync(file, line, 'utf-8');
      return;
    }
    // At/over the cap: keep the newest (MAX-1) existing lines + the new one.
    const kept = existing
      .replace(/\n$/, '')
      .split('\n')
      .slice(-(MAX_ERROR_LOG_ENTRIES - 1));
    // Crash-safe: write the full new content to a temp file, then rename over
    // the target (atomic on the same filesystem) so a crash mid-write never
    // truncates the log.
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, `${[...kept, line.replace(/\n$/, '')].join('\n')}\n`, 'utf-8');
    renameSync(tmp, file);
  } catch {
    // Best-effort: never let logging a crash break crash reporting.
  }
}

/**
 * Reads all crash entries from the local error log. Missing file → no
 * entries. Malformed lines are skipped — the log is not tamper-evident and
 * a partial line must not crash the reader.
 *
 * @param stateDir - Absolute path to the project's `.mnema/state` dir
 * @returns The recorded entries, in file order
 */
export function readErrors(stateDir: string): ErrorLogEntry[] {
  const file = errorLogFile(stateDir);
  if (!existsSync(file)) return [];
  let raw: string;
  try {
    raw = readFileSync(file, 'utf-8');
  } catch {
    return [];
  }
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const entries: ErrorLogEntry[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    try {
      const parsed = JSON.parse(line) as Partial<ErrorLogEntry>;
      if (typeof parsed.at === 'string' && typeof parsed.message === 'string') {
        entries.push({
          at: parsed.at,
          message: parsed.message,
          stack: typeof parsed.stack === 'string' ? parsed.stack : null,
          mnema_version:
            typeof parsed.mnema_version === 'string' ? parsed.mnema_version : 'unknown',
          node_version: typeof parsed.node_version === 'string' ? parsed.node_version : 'unknown',
          argv: Array.isArray(parsed.argv) ? parsed.argv.filter((a) => typeof a === 'string') : [],
        });
      }
    } catch {
      // Skip a malformed/partial line.
    }
  }
  return entries;
}

/**
 * Redacts anything host- or secret-shaped from a string so a crash trace
 * can be shown in a bug report without leaking the machine's layout or
 * credentials. Applied at DISPLAY time (by the report-issue path), never at
 * write time — the raw local log stays faithful for the user's own
 * debugging. Redactions, in order:
 *
 * 1. the user's home directory → `~`
 * 2. any remaining absolute path → `<path>` (keeps the basename)
 * 3. `KEY=value` where KEY looks secret-shaped → `KEY=<redacted>`
 * 4. long hex / base64-ish tokens → `<redacted>`
 *
 * @param text - Raw text (a message or stack)
 * @returns The sanitised text
 */
export function sanitize(text: string): string {
  let out = text;

  // 1. Collapse the home directory to `~` before the generic path rule, so
  // a home-relative path reads naturally instead of losing its whole head.
  const home = os.homedir();
  if (home.length > 0) {
    out = out.split(home).join('~');
  }

  // 3. Secret-shaped assignments (TOKEN=, SECRET=, KEY=, PASSWORD=, …).
  out = out.replace(
    /\b([A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD|PASSWD|AUTH|CREDENTIAL)[A-Z0-9_]*)\s*=\s*\S+/gi,
    '$1=<redacted>',
  );

  // 4. Long opaque tokens (>=32 chars of hex/base64url) that aren't a path.
  out = out.replace(/\b[A-Za-z0-9+/_-]{32,}={0,2}\b/g, '<redacted>');

  // 2. Any remaining POSIX absolute path → keep only the basename, so a
  // stack line stays useful ("at foo (<path>/bar.js:1:2)") without exposing
  // the machine's directory layout. Runs last so ~/redactions above win.
  out = out.replace(/(?<![\w~])\/(?:[^\s:)'"]+\/)*([^\s:)'"/]+)/g, '<path>/$1');

  return out;
}
