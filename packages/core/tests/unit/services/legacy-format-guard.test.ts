import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A grep-gate that keeps the store single-format after the wave-1 rebuild. The
 * store speaks ONE keyed event format (`EVENT_FORMAT_VERSION`), attestation is
 * one canonical `.att`, and re-baseline is one signed waiver. This test walks
 * the SOURCE and fails if a legacy format name (a `v2`/`v3` event, the old
 * `truncation-accepted.json`, or a deleted waiver module) creeps back in — the
 * reader of the new code must not even learn a legacy existed.
 *
 * It scans source only: tests legitimately name old shapes to prove they are
 * rejected, and this guard file names them to forbid them.
 */
const SRC_ROOTS = [path.resolve('packages/core/src'), path.resolve('packages/mnema/src')];

/** This guard file itself, excluded so its own forbidden strings do not trip it. */
const SELF = path.resolve('packages/core/tests/unit/services/legacy-format-guard.test.ts');

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTsFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const sourceFiles = SRC_ROOTS.flatMap(walkTsFiles).filter((f) => f !== SELF);

describe('single-format guard (source)', () => {
  it('names no legacy event format (v2/v3 / v>=2)', () => {
    // The single format is `EVENT_FORMAT_VERSION`. A comment or check that
    // speaks of a `v2`/`v3` event, or a `v>=2` chaining rule, is a scar from a
    // multi-format lineage that no longer exists.
    const forbidden = /\bv[23]\b|v\s*>=\s*2/;
    const hits: string[] = [];
    for (const file of sourceFiles) {
      const lines = readFileSync(file, 'utf-8').split('\n');
      lines.forEach((line, i) => {
        if (forbidden.test(line)) hits.push(`${path.relative('.', file)}:${i + 1}  ${line.trim()}`);
      });
    }
    expect(hits, `legacy event-format references:\n${hits.join('\n')}`).toEqual([]);
  });

  it('references the old truncation-accepted marker only as history, never as a write path', () => {
    // The unified signed waiver (`mnema-rebaseline/v1`) replaced the old
    // `truncation-accepted.json`. No source should read or write that file.
    const forbidden = /truncation-accepted/;
    const hits: string[] = [];
    for (const file of sourceFiles) {
      const lines = readFileSync(file, 'utf-8').split('\n');
      lines.forEach((line, i) => {
        if (forbidden.test(line)) hits.push(`${path.relative('.', file)}:${i + 1}`);
      });
    }
    expect(hits, `truncation-accepted references:\n${hits.join('\n')}`).toEqual([]);
  });

  it('imports no deleted waiver module', () => {
    // prune-waiver / prune-store / truncation-waiver collapsed into the single
    // rebaseline-* modules. An import of the old paths is a broken reference.
    const forbidden = /from\s+['"][^'"]*(prune-waiver|prune-store|truncation-waiver)/;
    const hits: string[] = [];
    for (const file of sourceFiles) {
      const lines = readFileSync(file, 'utf-8').split('\n');
      lines.forEach((line, i) => {
        if (forbidden.test(line)) hits.push(`${path.relative('.', file)}:${i + 1}`);
      });
    }
    expect(hits, `deleted-module imports:\n${hits.join('\n')}`).toEqual([]);
  });
});
