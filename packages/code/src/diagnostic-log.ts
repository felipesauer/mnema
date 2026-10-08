/**
 * The LOCAL LOG of internal errors, and the file of what has been offered and refused.
 *
 * OUTSIDE THE PROOF. Both files live in the global tree's directory, beside the chain and not
 * in it: no event is written, nothing here is signed, and `verify` never reads them (the chain
 * reads `tails/` and `keys/` and nothing else of its root). A fault of the product is not a
 * decision about the work, and the chain is permanent and cloned; a line of diagnosis written
 * into it could never be taken back. That is why this is a separate, labelled sink.
 *
 *   - `diagnostics.jsonl` — one {@link Diagnostic} per line, only what `problem-report.ts`
 *     allowlists. It is capped: at {@link LOG_LIMIT_BYTES} it is renamed to
 *     `diagnostics.1.jsonl` (replacing the one before) and a new one is begun, so two files
 *     are all there ever is.
 *   - `report-state.json` — the global switch, the fingerprints the person refused, and the
 *     offers made, which is what the limits count: one offer per fingerprint, and
 *     {@link DAILY_LIMIT} a day.
 *   - `report-draft.md` — the last report shown, the same text as the screen.
 *
 * It writes only on an internal error, never on a refusal and never on a `verify` that fails,
 * and a failure to write is swallowed here: it must never replace the error being reported.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { asDiagnostic, type Diagnostic, diagnose, renderReport } from './problem-report.js';

export const LOG_FILE = 'diagnostics.jsonl';
export const LOG_ROTATED_FILE = 'diagnostics.1.jsonl';
export const STATE_FILE = 'report-state.json';
export const DRAFT_FILE = 'report-draft.md';
export const LOG_LIMIT_BYTES = 256 * 1024;
export const DAILY_LIMIT = 3;
/** How many fingerprints each list remembers; the oldest fall off. */
const REMEMBERED = 200;

/** What the person has decided and what has been offered. */
export interface ReportState {
  /** The global switch: when set, nothing is logged and nothing is offered. */
  readonly off: boolean;
  /** Fingerprints whose kind of error the person refused to hear about again. */
  readonly declined: readonly string[];
  /** One entry per offer made: the fingerprint and the UTC day. */
  readonly offered: readonly { readonly fingerprint: string; readonly day: string }[];
  /**
   * The file is there and cannot be read. The state then FAILS CLOSED: it reads as off, and
   * nothing writes over the file, so a person's refusals are not forgotten by a bad byte.
   */
  readonly unreadable?: true;
}

export const EMPTY_STATE: ReportState = { off: false, declined: [], offered: [] };
const UNREADABLE: ReportState = { off: true, declined: [], offered: [], unreadable: true };

const FINGERPRINT = /^[0-9a-f]{8}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The state the file holds, tolerant: whatever does not have its shape is not read. */
export function readState(dir: string): ReportState {
  try {
    const file = join(dir, STATE_FILE);
    if (!existsSync(file)) return EMPTY_STATE;
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    const wellFormed =
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      (parsed.off === undefined || typeof parsed.off === 'boolean') &&
      (parsed.declined === undefined || Array.isArray(parsed.declined)) &&
      (parsed.offered === undefined || Array.isArray(parsed.offered));
    if (!wellFormed) return UNREADABLE;
    const declined = Array.isArray(parsed.declined)
      ? parsed.declined.filter((f): f is string => typeof f === 'string' && FINGERPRINT.test(f))
      : [];
    const offered = Array.isArray(parsed.offered)
      ? parsed.offered.flatMap((o: unknown) => {
          const { fingerprint, day } = (o ?? {}) as Record<string, unknown>;
          return typeof fingerprint === 'string' &&
            FINGERPRINT.test(fingerprint) &&
            typeof day === 'string' &&
            DAY.test(day)
            ? [{ fingerprint, day }]
            : [];
        })
      : [];
    return { off: parsed.off === true, declined, offered };
  } catch {
    return UNREADABLE;
  }
}

/** Writes the state whole, beside its final name first so a reader never sees half of it. */
export function writeState(dir: string, state: ReportState): void {
  if (state.unreadable === true) return;
  mkdirSync(dir, { recursive: true });
  const bounded: ReportState = {
    off: state.off,
    declined: state.declined.slice(-REMEMBERED),
    offered: state.offered.slice(-REMEMBERED),
  };
  const staging = join(dir, `${STATE_FILE}.${process.pid}.tmp`);
  writeFileSync(staging, `${JSON.stringify(bounded, null, 2)}\n`);
  renameSync(staging, join(dir, STATE_FILE));
}

/** The UTC day of `now`, the unit of the daily limit. */
export function dayOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Whether a fingerprint may be offered now: not off, not refused, not offered, under the day's limit. */
export function mayOffer(state: ReportState, fingerprint: string, now: Date): boolean {
  if (state.off) return false;
  if (state.declined.includes(fingerprint)) return false;
  if (state.offered.some((o) => o.fingerprint === fingerprint)) return false;
  const today = dayOf(now);
  return state.offered.filter((o) => o.day === today).length < DAILY_LIMIT;
}

/** Appends one line, rotating first when it would take the file over its cap. */
export function appendDiagnostic(dir: string, diagnostic: Diagnostic): void {
  mkdirSync(dir, { recursive: true });
  const line = `${JSON.stringify(diagnostic)}\n`;
  const file = join(dir, LOG_FILE);
  if (existsSync(file) && statSync(file).size + Buffer.byteLength(line) > LOG_LIMIT_BYTES) {
    renameSync(file, join(dir, LOG_ROTATED_FILE));
  }
  appendFileSync(file, line);
}

/** Every line of the log that has its shape, oldest first. */
export function readDiagnostics(dir: string): Diagnostic[] {
  return [LOG_ROTATED_FILE, LOG_FILE].flatMap((name) => {
    let text: string;
    try {
      text = readFileSync(join(dir, name), 'utf8');
    } catch {
      return [];
    }
    return text.split('\n').flatMap((line) => {
      try {
        const found = asDiagnostic(JSON.parse(line));
        return found === undefined ? [] : [found];
      } catch {
        return [];
      }
    });
  });
}

/** The places this machine is known to live in, which no report may carry. */
export function withheldPlaces(cwd: string, env: DiscoveryEnv): string[] {
  return [cwd, env.home, env.mnemaHome, env.accountHome].filter(
    (place): place is string => place !== undefined && place.length > 0,
  );
}

/** What one internal error asks of the surface. */
export interface Noted {
  /** True when the person should be told a report can be read: first of its kind, under the day's limit. */
  readonly offer: boolean;
}

/**
 * Notes an internal error: logs it and decides whether to offer a report of it.
 *
 * It answers `offer: false` — and writes nothing — when the switch is off, when the error
 * cannot be rendered by the gate (a report that could not be shown is not logged), and
 * when anything at all fails.
 */
export function noteInternalError(
  error: unknown,
  run: {
    readonly cwd: string;
    readonly env: DiscoveryEnv;
    readonly now: Date;
    readonly version: string;
    readonly argv: readonly string[];
    readonly verbs: readonly string[];
    /** A person is at this invocation. Without one the error is logged and no offer is spent. */
    readonly aPersonIsHere: boolean;
  },
): Noted {
  try {
    const dir = resolveTrees(run.cwd, run.env).global;
    const state = readState(dir);
    if (state.off) return { offer: false };
    const diagnostic = diagnose(error, {
      now: run.now,
      version: run.version,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      argv: run.argv,
      verbs: run.verbs,
    });
    if (diagnostic === undefined) return { offer: false };
    if (renderReport(diagnostic, withheldPlaces(run.cwd, run.env)).refused) {
      return { offer: false };
    }
    appendDiagnostic(dir, diagnostic);
    if (!run.aPersonIsHere || !mayOffer(state, diagnostic.fingerprint, run.now))
      return { offer: false };
    writeState(dir, {
      ...state,
      offered: [...state.offered, { fingerprint: diagnostic.fingerprint, day: dayOf(run.now) }],
    });
    return { offer: true };
  } catch {
    return { offer: false };
  }
}
