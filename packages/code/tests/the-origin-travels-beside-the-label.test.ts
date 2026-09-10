/**
 * The origin travels beside the label, on every read that serves one record whole.
 *
 * `mnema decision import` reads a directory of ADRs and freezes its OWN `ADR-<n>` into
 * each decision, so a file named `ADR-008` becomes `ADR-2` in the record. That is
 * deliberate and stays: two projects can each hold an ADR-1, and a label re-derived on
 * read would silently cite a different decision. The source's number is not lost — it
 * is in the file NAME, and the import records that name as a `derived-from` edge.
 *
 * MEASURED BEFORE ANY OF THIS WAS WRITTEN, on a real clone: `show`, `show --json` and
 * `read_record` served the decision without the edge. And `brief` sends a reader to
 * exactly one of them — *"For the argument behind one, ask `read_record` for its id"* —
 * so the door the product NAMES was the door without the fact. `mnema refs` had it all
 * along, which is why this is a gap in three reads rather than a missing write.
 *
 * WHAT EACH CASE IS FOR:
 *   - the three reads carry it, and the DIVERGENCE is asserted beside it. A case that
 *     only checked the field would pass over a record whose label happened to match its
 *     file, which is the one record for which this whole item is invisible.
 *   - THE CONTRAST, and without it the first case passes on a product that stamps the
 *     field on everything: a decision recorded HERE, by hand, carries no `origin` at
 *     all — absent, not empty, so nobody reads `[]` as "derived from nothing".
 *   - N EDGES. A subject may assert several provenances, and a read that reduced them
 *     to one would be choosing by row order — the defect class that made a verdict
 *     print either of two sentences depending on a third party's file order.
 *   - THE PRIVATE-TREE EDGE. A link is legitimately cross-tree, so a private assertion
 *     can name a public decision. These reads do not go looking for one: the answer has
 *     to be the same in a clone, and `refs` is the read that crosses trees. Both halves
 *     are asserted, because "does not serve it" is only honest if something does.
 *   - THE FACT SITS ABOVE THE BODY, for a kind that prints one and a kind that does
 *     not. The printer inserts the provenance positionally rather than inside each of
 *     five arms, and this is what holds the invariant that placement leans on.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DERIVED_FROM_RELATION, type DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDecision } from '../src/commands/decision.js';
import { runDecisionImport } from '../src/commands/decision-import.js';
import { runInit } from '../src/commands/init.js';
import { runLink } from '../src/commands/link.js';
import { runReferences } from '../src/commands/references.js';
import { runShow } from '../src/commands/show.js';
import { runTask } from '../src/commands/task.js';
import { closeSession, openSession, type Session } from '../src/mcp/session.js';
import { runReadRecordTool } from '../src/mcp/tools.js';
import { renderPlain } from '../src/presentation/plain.js';
import { recordReport } from '../src/presentation/record.js';

/** The file whose own number is not the number the record will freeze. */
const GATEWAY = 'ADR-008-the-gateway-is-idempotent.md';

let sandbox: string;
let env: DiscoveryEnv;
let repo: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-origin-'));
  env = { home: join(sandbox, 'home'), xdgDataHome: join(sandbox, 'xdg') };
  mkdirSync(env.home, { recursive: true });
  repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'docs', 'adr'), { recursive: true });
  writeFileSync(
    join(repo, 'docs', 'adr', GATEWAY),
    [
      '# ADR-008 — The gateway is idempotent',
      '',
      '## Context',
      '',
      'Retries were duplicating charges, so every write carries an idempotency key.',
      '',
    ].join('\n'),
  );
  runInit({ cwd: repo, env });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** Imports the ADR directory for real and returns the one decision it recorded. */
function imported(): { readonly id: string; readonly adr: string; readonly path: string } {
  const done = runDecisionImport({ cwd: repo, env }, { from: 'docs/adr', write: true });
  if (!done.ok) throw new Error(`import refused: ${done.reason}`);
  const proposal = done.proposals[0];
  if (proposal?.id === undefined || proposal.adr === undefined) {
    throw new Error('the import recorded no decision');
  }
  return { id: proposal.id, adr: proposal.adr, path: proposal.path };
}

/** What `runShow` says, or a throw naming the refusal. */
function shown(id: string): ReturnType<typeof runShow> & { ok: true } {
  const result = runShow({ cwd: repo, env }, { id });
  if (!result.ok) throw new Error(`show refused: ${result.reason}`);
  return result;
}

/** The lines `mnema show` prints, through the product's own plain renderer. */
function printed(id: string): string[] {
  const result = shown(id);
  return recordReport(renderPlain, result.record, {
    anchors: result.anchors,
    ...(result.consultations !== undefined ? { consultations: result.consultations } : {}),
  });
}

/** A session over the repository, for the tool that has no command-line twin. */
function session(): Session {
  return openSession({ clientName: 'claude-code', roots: [pathToFileURL(repo).href], env });
}

describe('the origin travels beside the label', () => {
  it('is carried by all three reads that serve one record whole', () => {
    const decision = imported();

    // THE DIVERGENCE ITSELF, asserted rather than assumed: the file says 008 and the
    // record froze ADR-1. Without this line the case would pass over a record whose
    // label happened to agree with its file.
    expect(decision.adr).toBe('ADR-1');
    expect(decision.path).toBe(`docs/adr/${GATEWAY}`);

    // 1 · `show`, as a value.
    expect(shown(decision.id).record.origin).toEqual([`docs/adr/${GATEWAY}`]);
    // 2 · `show --json` is that same value serialized — the wiring prints `result.record`
    //     — so what is asserted here is what a person READS.
    expect(printed(decision.id)).toContain(`  derived from docs/adr/${GATEWAY}`);
    // 3 · `read_record`, the door `brief` names.
    const active = session();
    try {
      const read = runReadRecordTool(active, { id: decision.id });
      if (!read.ok) throw new Error(`read_record refused: ${read.code}`);
      expect(read.value.origin).toEqual([`docs/adr/${GATEWAY}`]);
    } finally {
      closeSession(active);
    }
  });

  it('gives a decision recorded here no origin at all', () => {
    // THE CONTRAST. Without it, a product that stamped `origin` on every record would
    // pass the case above. Absent, never empty.
    const native = runDecision(
      { cwd: repo, env },
      { title: 'Queues are at-least-once', rationale: 'Because the broker says so.' },
    );
    if (!native.ok) throw new Error(`decision refused: ${native.reason}`);

    expect(shown(native.id).record.origin).toBeUndefined();
    expect(printed(native.id).join('\n')).not.toContain('derived from');
    const active = session();
    try {
      const read = runReadRecordTool(active, { id: native.id });
      if (!read.ok) throw new Error(`read_record refused: ${read.code}`);
      expect(read.value.origin).toBeUndefined();
      expect(Object.keys(read.value)).not.toContain('origin');
    } finally {
      closeSession(active);
    }
  });

  it('carries every provenance a record asserts, in the record’s own order', () => {
    const decision = imported();
    // A second source, linked by hand — the shape a document that MOVED leaves behind.
    // Its target sorts before the imported one, so a read that took "the first row" and
    // a read that took "all of them" cannot agree by accident.
    const second = runLink(
      { cwd: repo, env },
      {
        subject: decision.id,
        target: 'docs/adr/0001-gateway-notes.md',
        rel: DERIVED_FROM_RELATION,
      },
    );
    if (!second.ok) throw new Error(`link refused: ${second.reason}`);

    expect(shown(decision.id).record.origin).toEqual([
      'docs/adr/0001-gateway-notes.md',
      `docs/adr/${GATEWAY}`,
    ]);
    // And both are printed, one line each, in that order.
    const lines = printed(decision.id);
    expect(lines.filter((line) => line.includes('derived from'))).toEqual([
      '  derived from docs/adr/0001-gateway-notes.md',
      `  derived from docs/adr/${GATEWAY}`,
    ]);
  });

  it('leaves a private assertion to the read that crosses trees', () => {
    const decision = imported();
    // A private tree asserting a provenance about a PUBLIC decision. It is a legal
    // fact — a link is cross-tree by design — and it is not part of what a clone of
    // the public tree would hold.
    const hidden = runLink(
      { cwd: repo, env },
      {
        subject: decision.id,
        target: 'notes/why-i-really-did-it.md',
        rel: DERIVED_FROM_RELATION,
        scope: 'private',
      },
    );
    if (!hidden.ok) throw new Error(`link refused: ${hidden.reason}`);

    // The three reads answer with the public provenance and only it.
    expect(shown(decision.id).record.origin).toEqual([`docs/adr/${GATEWAY}`]);
    // NOT LOST, and this half is what makes the sentence above honest rather than a
    // silent drop: the read built to cross trees serves it, and says which tree.
    const refs = runReferences({ cwd: repo, env }, { id: decision.id });
    if (!refs.ok) throw new Error(`refs refused: ${refs.reason}`);
    const targets = JSON.stringify(refs);
    expect(targets).toContain('notes/why-i-really-did-it.md');
    expect(targets).toContain(`docs/adr/${GATEWAY}`);
  });

  it('prints the provenance above a body, and last when there is none', () => {
    // The printer's positional insertion, on both shapes. A decision prints facts, a
    // blank line, then its rationale; a task prints facts and no body at all.
    const decision = imported();
    const lines = printed(decision.id);
    const provenance = lines.findIndex((line) => line.includes('derived from'));
    const blank = lines.indexOf('');
    expect(provenance).toBeGreaterThan(0);
    expect(blank).toBeGreaterThan(provenance);

    const task = runTask({ cwd: repo, env }, { title: 'Wire the idempotency key' });
    if (!task.ok) throw new Error(`task refused: ${task.reason}`);
    const linked = runLink(
      { cwd: repo, env },
      { subject: task.id, target: 'docs/plan.md', rel: DERIVED_FROM_RELATION },
    );
    if (!linked.ok) throw new Error(`link refused: ${linked.reason}`);
    const taskLines = printed(task.id);
    expect(taskLines).not.toContain('');
    expect(taskLines[taskLines.length - 1]).toBe('  derived from docs/plan.md');
  });
});
