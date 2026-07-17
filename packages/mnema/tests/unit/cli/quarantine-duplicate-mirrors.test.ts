import * as fs from 'node:fs';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  QUARANTINE_DIRNAME,
  quarantineDuplicateTaskMirrors,
} from '@/cli/commands/doctor-command.js';

describe('quarantineDuplicateTaskMirrors', () => {
  let backlog: string;

  beforeEach(() => {
    backlog = mkdtempSync(path.join(tmpdir(), 'mnema-quarantine-'));
  });
  afterEach(() => {
    rmSync(backlog, { recursive: true, force: true });
  });

  function write(state: string, key: string): void {
    const dir = path.join(backlog, state);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, `${key}.md`),
      `---\nkey: ${key}\nstate: ${state}\n---\n# ${key}`,
      'utf-8',
    );
  }

  it('moves the non-canonical copy to quarantine, keeps the canonical DB-state copy (the acceptance case)', () => {
    // DB says NOTA-1 is DONE; a stale READY copy lingers alongside the DONE one.
    write('DONE', 'NOTA-1');
    write('READY', 'NOTA-1');
    const stateByKey = new Map([['NOTA-1', 'DONE']]);

    const moved = quarantineDuplicateTaskMirrors(backlog, stateByKey, fs);

    // The canonical DONE copy stays; the READY copy is quarantined.
    expect(existsSync(path.join(backlog, 'DONE', 'NOTA-1.md'))).toBe(true);
    expect(existsSync(path.join(backlog, 'READY', 'NOTA-1.md'))).toBe(false);
    expect(existsSync(path.join(backlog, QUARANTINE_DIRNAME, 'READY', 'NOTA-1.md'))).toBe(true);

    expect(moved).toHaveLength(1);
    expect(moved[0]?.key).toBe('NOTA-1');
    expect(moved[0]?.fromState).toBe('READY');
    expect(moved[0]?.to).toBe(path.join(QUARANTINE_DIRNAME, 'READY', 'NOTA-1.md'));
  });

  it('quarantines a lone mirror sitting in the wrong state dir (canonical path empty)', () => {
    // DB says DONE, but the only copy is under READY. It is moved out; a later
    // rebuild writes the canonical DONE file fresh from the row.
    write('READY', 'NOTA-2');
    const moved = quarantineDuplicateTaskMirrors(backlog, new Map([['NOTA-2', 'DONE']]), fs);

    expect(existsSync(path.join(backlog, 'READY', 'NOTA-2.md'))).toBe(false);
    expect(existsSync(path.join(backlog, QUARANTINE_DIRNAME, 'READY', 'NOTA-2.md'))).toBe(true);
    expect(moved.map((m) => m.key)).toEqual(['NOTA-2']);
  });

  it('is a no-op when every task has exactly one mirror at its canonical dir', () => {
    write('DONE', 'NOTA-1');
    write('DRAFT', 'NOTA-3');
    const moved = quarantineDuplicateTaskMirrors(
      backlog,
      new Map([
        ['NOTA-1', 'DONE'],
        ['NOTA-3', 'DRAFT'],
      ]),
      fs,
    );
    expect(moved).toEqual([]);
    expect(existsSync(path.join(backlog, 'DONE', 'NOTA-1.md'))).toBe(true);
    expect(existsSync(path.join(backlog, 'DRAFT', 'NOTA-3.md'))).toBe(true);
    expect(existsSync(path.join(backlog, QUARANTINE_DIRNAME))).toBe(false);
  });

  it('never touches a key with no live row (that is an orphan, handled elsewhere)', () => {
    write('DONE', 'NOTA-99'); // no row for NOTA-99
    const moved = quarantineDuplicateTaskMirrors(backlog, new Map([['NOTA-1', 'DONE']]), fs);
    expect(moved).toEqual([]);
    expect(existsSync(path.join(backlog, 'DONE', 'NOTA-99.md'))).toBe(true);
  });

  it('does not re-quarantine files already under .quarantine, and disambiguates a repeat', () => {
    // A prior sweep left NOTA-1 in quarantine; a new stale READY copy appears.
    write('DONE', 'NOTA-1');
    write('READY', 'NOTA-1');
    mkdirSync(path.join(backlog, QUARANTINE_DIRNAME, 'READY'), { recursive: true });
    writeFileSync(path.join(backlog, QUARANTINE_DIRNAME, 'READY', 'NOTA-1.md'), 'old', 'utf-8');

    const moved = quarantineDuplicateTaskMirrors(backlog, new Map([['NOTA-1', 'DONE']]), fs);

    // The .quarantine dir is not walked as a state dir (no re-quarantine loop),
    // and the new copy lands under a disambiguated name.
    expect(moved).toHaveLength(1);
    expect(existsSync(path.join(backlog, 'READY', 'NOTA-1.md'))).toBe(false);
    expect(existsSync(path.join(backlog, QUARANTINE_DIRNAME, 'READY', 'NOTA-1.1.md'))).toBe(true);
    // The original quarantined file is preserved.
    expect(existsSync(path.join(backlog, QUARANTINE_DIRNAME, 'READY', 'NOTA-1.md'))).toBe(true);
  });

  it('is idempotent — a second sweep after the first moves nothing more', () => {
    write('DONE', 'NOTA-1');
    write('READY', 'NOTA-1');
    const stateByKey = new Map([['NOTA-1', 'DONE']]);
    quarantineDuplicateTaskMirrors(backlog, stateByKey, fs);
    const second = quarantineDuplicateTaskMirrors(backlog, stateByKey, fs);
    expect(second).toEqual([]);
  });
});
