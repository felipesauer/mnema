import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { memoryCaptured } from '@mnema/chain';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { openTreeForWriting } from '@mnema/core/write';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runExposure } from './exposure.js';
import { runInit } from './init.js';
import { runMemory } from './memory.js';
import { runTask } from './task.js';
import { runTaskTransition } from './task-transition.js';

const SECRET = 'AKIAIOSFODNN7EXAMPLE';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-exposure-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  return { repo, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } };
}

function digest(dir: string): string {
  const hash = createHash('sha256');
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        hash.update(`D:${relative(dir, full)}\n`);
        walk(full);
      } else {
        hash.update(`F:${relative(dir, full)}:${statSync(full).size}:`);
        hash.update(readFileSync(full));
        hash.update('\n');
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
}

describe('mnema exposure — the record scanned for credential shapes', () => {
  it('finds NOTHING in a record written through the content door', () => {
    // This is the whole point of the door: what an agent writes today cannot land
    // as a recognized credential, so a report over a record written today is empty
    // even when every write TRIED to record one.
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    runMemory({ cwd: repo, env }, { content: `remember ${SECRET}`, scope: 'public' });
    const created = runTask({ cwd: repo, env }, { title: `open ${SECRET}`, scope: 'public' });
    if (!created.ok) throw new Error('setup: task refused');
    runTaskTransition(
      { cwd: repo, env },
      { id: created.id, action: 'cancel', proof: { reason: `because ${SECRET}` } },
    );

    const result = runExposure({ cwd: repo, env });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.findings).toEqual([]);
    // And it really did read the record — "0 findings" over 0 events proves nothing.
    expect(result.report.scanned).toBeGreaterThan(3);
  });

  it('finds a record written BEFORE the door existed, naming its tree and class', () => {
    // The gap the report exists for. There is no way to write one through the
    // surface any more, so the past is simulated the only honest way: by appending
    // the raw event a pre-door write would have left.
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const legacy = appendUnscreened(repo, env, `the old note held ${SECRET}`);

    const result = runExposure({ cwd: repo, env });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const finding = result.report.findings.find((f) => f.id === legacy);
    expect(finding?.scope).toBe('public');
    expect(finding?.kind).toBe('memory.captured');
    expect(finding?.classes).toEqual(['aws-access-key']);
  });

  it('never carries the value — not in the object, not in what --json would print', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    appendUnscreened(repo, env, `the old note held ${SECRET}`);

    const result = runExposure({ cwd: repo, env });
    if (!result.ok) return;
    // `--json` emits exactly this object, so asserting over its serialization is
    // asserting over every path the command can print by.
    const serialized = JSON.stringify(result.report);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain('AKIA');
  });

  it('refuses NO_PROJECT outside a project', () => {
    const { repo, env } = setup(); // no init
    expect(runExposure({ cwd: repo, env })).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });

  it('writes NOTHING — the sandbox is byte-identical before and after', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    runMemory({ cwd: repo, env }, { content: 'a note', scope: 'public' });
    const before = digest(sandbox);
    runExposure({ cwd: repo, env });
    expect(digest(sandbox)).toBe(before);
  });
});

/**
 * Appends a `memory.captured` whose content was NOT screened, the way a write
 * before the content door existed would have, and returns its subject.
 *
 * It goes around the core operation deliberately: there is no longer any way to
 * put a recognized credential into the chain through a write, which is exactly what
 * makes the audit's subject the PAST. Faking that past at the chain level is the
 * only way to test the read that answers for it.
 */
function appendUnscreened(repo: string, env: DiscoveryEnv, content: string): string {
  const trees = resolveTrees(repo, env);
  // The tree's OWN writer, the same one every write verb opens, so the entry is
  // hash-chained and signed by this machine's key — a record the verifier accepts,
  // which is the case that matters (a report about entries nothing would verify
  // would be a report about nothing).
  const writer = openTreeForWriting(trees, 'public');
  const id = LEGACY_ID;
  writer.append(
    memoryCaptured(
      {
        at: '2026-01-01T00:00:00.000Z',
        who: writer.anchor,
        signerFp: writer.signerFingerprint,
        subject: id,
      },
      { content },
    ),
  );
  writer.checkpoint();
  return id;
}

/** The id the faked pre-door record is given, so a test can look it up. */
const LEGACY_ID = '019fa8b7-0410-717b-9af2-cfeb013fc4ac';
