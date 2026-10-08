/**
 * `mnema report` — what mnema would say about its own last internal error, shown whole.
 *
 * It shows the report, keeps it as a draft file beside the local log, and sends NOTHING: the
 * product makes no request, so there is no path from here to anyone but the person reading the
 * screen. What it can change is what the person decides: refuse reports of this kind of error
 * (`--decline`), or switch reporting off for the machine (`--off`, and `--on` to undo it).
 * Those writes go to the state file of `diagnostic-log.ts`, outside the record.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import {
  DRAFT_FILE,
  readDiagnostics,
  readState,
  STATE_FILE,
  withheldPlaces,
  writeState,
} from '../diagnostic-log.js';
import { renderReport } from '../problem-report.js';

/** What the person asked of this run. At most one of the three. */
export interface ReportAsk {
  readonly decline?: boolean;
  readonly off?: boolean;
  readonly on?: boolean;
}

/** The lines to print, and whether the run is a no. */
export interface ReportOutcome {
  readonly lines: readonly string[];
  readonly refused: boolean;
}

/** Runs the verb against the global tree `cwd` and `env` resolve to. */
export function runReport(run: { cwd: string; env: DiscoveryEnv }, ask: ReportAsk): ReportOutcome {
  if ([ask.decline, ask.off, ask.on].filter(Boolean).length > 1) {
    return {
      lines: ['`--decline`, `--off` and `--on` are three answers: give one.'],
      refused: true,
    };
  }
  const dir = resolveTrees(run.cwd, run.env).global;
  const state = readState(dir);
  if (state.unreadable === true) {
    const file = join(dir, STATE_FILE);
    return {
      lines: [
        `The state file ${file} cannot be read, so reporting is treated as off and nothing is written over it. Delete that file to start over (your refusals in it are forgotten then).`,
      ],
      refused: true,
    };
  }

  if (ask.off === true) {
    writeState(dir, { ...state, off: true });
    return {
      lines: [
        'Reporting is off on this machine: nothing is logged and nothing is offered. `mnema report --on` turns it back on.',
      ],
      refused: false,
    };
  }
  if (ask.on === true) {
    writeState(dir, { ...state, off: false });
    return { lines: ['Reporting is on.'], refused: false };
  }

  const entries = readDiagnostics(dir);
  const latest = entries[entries.length - 1];
  if (latest === undefined) {
    return { lines: ['No internal error is on record on this machine.'], refused: false };
  }

  if (ask.decline === true) {
    if (!state.declined.includes(latest.fingerprint)) {
      writeState(dir, { ...state, declined: [...state.declined, latest.fingerprint] });
    }
    return {
      lines: [`Declined: mnema will not offer a report of fp:${latest.fingerprint} again.`],
      refused: false,
    };
  }

  const report = renderReport(latest, withheldPlaces(run.cwd, run.env));
  if (report.refused) {
    return {
      lines: [
        `Not made: the text would carry ${report.found.join(', ')}, and mnema does not put that in a report.`,
      ],
      refused: true,
    };
  }
  mkdirSync(dir, { recursive: true });
  const draft = join(dir, DRAFT_FILE);
  writeFileSync(draft, `${report.text}\n`);
  return {
    lines: [
      report.text,
      '',
      `That is the whole report, and it is saved as ${draft}. mnema sends nothing: it is yours to read, and to send or not.`,
      'To stop hearing about this kind of error: `mnema report --decline`. To stop all reports: `mnema report --off`.',
    ],
    refused: false,
  };
}
