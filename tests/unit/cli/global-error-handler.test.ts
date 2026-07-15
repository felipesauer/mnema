import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isMnemaError, reportUncaught } from '@/cli/error-handler.js';
import { ExitCode } from '@/errors/error-codes.js';

/**
 * Guards the process-level error safety net. A thrown MnemaError renders
 * through printError with its mapped exit code; anything else prints a
 * clean one-line message + ExitCode.Internal, never a raw stack (unless
 * MNEMA_DEBUG is set). Before this, such throws escaped as Node's
 * unhandled-rejection stack with a non-standard exit code.
 */
describe('reportUncaught', () => {
  let stderr: string;
  let spy: ReturnType<typeof vi.spyOn>;
  // The generic-error cases below reach `recordError`, which resolves the
  // crash log by walking up from cwd for a `.mnema`. Run them from a bare
  // temp dir so that walk finds none and logging no-ops — otherwise the
  // suite writes real crash entries into this repo's own (git-ignored)
  // .mnema/state/errors.jsonl, corrupting the local dogfooding audit.
  let cwd: string;
  let bareDir: string;

  beforeEach(() => {
    stderr = '';
    spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderr += String(chunk);
      return true;
    });
    cwd = process.cwd();
    bareDir = mkdtempSync(path.join(tmpdir(), 'mnema-errh-'));
    process.chdir(bareDir);
  });

  afterEach(() => {
    spy.mockRestore();
    process.chdir(cwd);
    rmSync(bareDir, { recursive: true, force: true });
  });

  it('routes a MnemaError through printError with its mapped exit code', () => {
    const code = reportUncaught({ kind: 'TASK_NOT_FOUND', taskKey: 'WEBAPP-1' });
    // TaskNotFound maps to Usage (2), not the generic Internal.
    expect(code).toBe(ExitCode.Usage);
    expect(stderr).toContain('error:');
    expect(stderr).toContain('WEBAPP-1');
    expect(stderr).not.toContain('MNEMA_DEBUG'); // structured, not the fallback
  });

  it('prints a clean message + Internal for a generic Error (no stack by default)', () => {
    const code = reportUncaught(new Error('something broke'), false);
    expect(code).toBe(ExitCode.Internal);
    expect(stderr).toContain('something broke');
    expect(stderr).toContain('MNEMA_DEBUG'); // hint, not a stack
    expect(stderr).not.toMatch(/\n\s+at\s/); // no stack frames
  });

  it('includes the stack when debug is on', () => {
    const err = new Error('with stack');
    const code = reportUncaught(err, true);
    expect(code).toBe(ExitCode.Internal);
    expect(stderr).toContain('with stack');
    expect(stderr).toMatch(/\n\s+at\s/); // stack frames present
  });

  it('handles a thrown non-Error value (string)', () => {
    const code = reportUncaught('bare string failure', false);
    expect(code).toBe(ExitCode.Internal);
    expect(stderr).toContain('bare string failure');
  });
});

describe('isMnemaError', () => {
  it('recognises a value with a known ErrorCode kind', () => {
    expect(isMnemaError({ kind: 'TASK_NOT_FOUND', taskKey: 'X' })).toBe(true);
  });

  it('rejects a generic Error, a plain object, and an unknown kind', () => {
    expect(isMnemaError(new Error('x'))).toBe(false);
    expect(isMnemaError({ foo: 'bar' })).toBe(false);
    expect(isMnemaError({ kind: 'NOT_A_REAL_CODE' })).toBe(false);
    expect(isMnemaError(null)).toBe(false);
    expect(isMnemaError('string')).toBe(false);
  });
});
