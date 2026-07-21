import { describe, expect, it } from 'vitest';

import { ErrorCode, ExitCode } from '../../../src/errors/error-codes.js';
import { exitCodeFor } from '../../../src/errors/error-printer.js';
import type { MnemaError } from '../../../src/errors/mnema-error.js';

/**
 * Locks the CLI exit-code mapping against `docs/errors-catalog.md`.
 *
 * A wrapper script keys its retry loop off exit code 4 (Conflict), so a
 * retryable error that exits 2 (Usage) silently breaks automation. These two
 * cases regressed once because `exitCodeFor` had a `default → Usage` arm that
 * swallowed any unmapped code.
 */
describe('exitCodeFor', () => {
  it('maps optimistic-concurrency CONFLICT to exit 4 (retryable), not Usage', () => {
    const error: MnemaError = {
      kind: ErrorCode.Conflict,
      taskKey: 'WEBAPP-42',
      currentUpdatedAt: '2026-06-23T12:00:00.000Z',
      entity: 'task',
    };
    expect(exitCodeFor(error)).toBe(ExitCode.Conflict);
    expect(exitCodeFor(error)).toBe(4);
  });

  it('maps a busy/locked database (STORAGE_BUSY) to exit 4 (retryable)', () => {
    const error: MnemaError = { kind: ErrorCode.StorageBusy, detail: 'database is locked' };
    expect(exitCodeFor(error)).toBe(ExitCode.Conflict);
    expect(exitCodeFor(error)).toBe(4);
  });

  it('maps deterministic "already exists" duplicates to exit 2 (Usage), not retryable 4', () => {
    // These can never succeed on retry — re-running with the same input
    // reproduces the duplicate. They belong with TaskKeyExists at Usage(2).
    const dep: MnemaError = {
      kind: ErrorCode.DependencyDuplicate,
      taskKey: 'A-1',
      blocksTaskKey: 'A-2',
      dependencyKind: 'blocks',
    };
    const evidence: MnemaError = {
      kind: ErrorCode.EvidenceDuplicate,
      taskKey: 'A-1',
      index: 0,
      ref: 'tests/a.test.ts',
    };
    expect(exitCodeFor(dep)).toBe(ExitCode.Usage);
    expect(exitCodeFor(evidence)).toBe(ExitCode.Usage);
  });

  it('keeps genuine races (ActiveSprintExists) on retryable exit 4', () => {
    const race: MnemaError = {
      kind: ErrorCode.ActiveSprintExists,
      projectKey: 'WEBAPP',
      activeSprintKey: 'WEBAPP-SPRINT-1',
    };
    expect(exitCodeFor(race)).toBe(ExitCode.Conflict);
  });

  it('maps wrong-state errors to exit 3 (State)', () => {
    const terminal: MnemaError = { kind: ErrorCode.TerminalState, taskKey: 'X-1', state: 'DONE' };
    expect(exitCodeFor(terminal)).toBe(ExitCode.State);
    const schema: MnemaError = { kind: ErrorCode.SchemaOutOfDate, pending: ['015_x.sql'] };
    expect(exitCodeFor(schema)).toBe(ExitCode.State);
  });

  it('maps a plain not-found to exit 2 (Usage)', () => {
    const notFound: MnemaError = { kind: ErrorCode.TaskNotFound, taskKey: 'X-9' };
    expect(exitCodeFor(notFound)).toBe(ExitCode.Usage);
  });
});
