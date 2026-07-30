/**
 * What the two reads that fold TAILS look in when the workspace holds several
 * projects — and what each of them is allowed to merge.
 *
 * These two were the last reads answering about a workspace from one project's trees,
 * and the reason they stayed behind is mechanical rather than semantic: `exposure` and
 * `antipatterns` read the raw event stream instead of the projection caches (the
 * question is about the TEXT of every fact, which no projection keeps), so reaching
 * every project is a different change from the one that widened the five cached reads.
 *
 * The defect is the worst shape an audit can take. In a workspace of three projects,
 * with a cleartext credential sitting in a sibling's record, `audit_exposure` answered
 * `{"findings": [], "scanned": 300}` — a denominator that reads as ground covered. And
 * the reads that promise NOTHING about values printed that same credential in full:
 * `search`, `read_record` and `audit_timeline` all span the workspace already. So the
 * defence was scoped to a project while the service was not, and the one read that
 * would have said "go and rotate this" was the one that stopped at the boundary.
 *
 * Widening it does NOT stop the leak — the record is the record, and a read of a
 * neighbour's record serving its text is that read working. It makes the WARNING reach
 * as far as the service does.
 *
 * What each may merge follows from the shape of its answer, the same rule the earlier
 * reads follow:
 *
 *   `exposure` returns BOTH shapes in one answer. Its findings are ITEMS, so they
 *   merge, each labelled with the project to go and rotate in — three repositories
 *   all have a `public` tree, so the scope alone cannot say where. Its `scanned` is
 *   an AGGREGATE, so it decomposes: one count per record, which is what stops an
 *   empty `findings` from reading as "nothing is exposed" rather than "these records
 *   were read and hold nothing recognizable".
 *
 *   `antipatterns` returns aggregates only — counts with their evidence — so it
 *   decomposes whole. Its skill candidates make the reason concrete: a pattern is
 *   distilled by whoever is doing the work that kept reopening, so a candidate list
 *   pooled across projects points a person at somebody else's work.
 *
 * ⚠️ HOW THE FIXTURES ARE BUILT, and why it cannot be otherwise: an agent CANNOT
 * produce an exposure finding through the surfaces. The content door and this audit
 * call the same `detectSecrets`, and the placeholder the door leaves is guarded
 * against re-matching — so a screened record is genuinely clean for the audit, by
 * design and with the reason stated. This read is entirely about HISTORY: a chain
 * imported, a record written before the door existed, events written by another
 * version. So a credential fixture is appended through the TREE'S OWN WRITER
 * (hash-chained and signed by this machine's key, a record the verifier accepts),
 * never through a write tool. The last test asserts that agreement holds.
 */

import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureTree, memoryCaptured } from '@mnema/chain';
import { type DiscoveryEnv, PROJECT_DIR, resolveTrees, type Scope } from '@mnema/core';
import { openTreeForWriting } from '@mnema/core/write';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAntipatterns } from '../src/commands/antipatterns.js';
import { runExposure } from '../src/commands/exposure.js';
import { closeSession, openSession, type Session } from '../src/mcp/session.js';
import {
  runAntipatternsTool,
  runCaptureMemory,
  runCreateSkill,
  runExposureTool,
  runReadRecordTool,
  runSkillTransition,
} from '../src/mcp/tools.js';

/** A recognized cloud key — the canonical example, and not a real credential. */
const SECRET = 'AKIAIOSFODNN7EXAMPLE';

let sandbox: string;
let env: DiscoveryEnv;

/** Makes a directory that IS a project (has a `.mnema/` tree), returns its path. */
function makeProject(name: string): string {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  ensureTree({ root: join(dir, PROJECT_DIR) });
  return dir;
}

/** A session over these project directories, announced as roots in order. */
function openOn(...roots: readonly string[]): Session {
  return openSession({
    clientName: 'claude-code',
    roots: roots.map((dir) => pathToFileURL(dir).href),
    env,
  });
}

/**
 * Appends a cleartext credential to one tree of one project, THE WAY HISTORY LEFT IT:
 * through the tree's own writer, so the entry is hash-chained and signed by this
 * machine's key. Returns the subject id to look the finding up by.
 *
 * Deliberately not through a write tool — the door would clean it, and a screened
 * record is clean for the audit too (the last test proves that agreement). Anything
 * that could be planted through a tool would not be the past this read exists for.
 */
function plantCredential(project: string, scope: Scope, subject: string): string {
  const writer = openTreeForWriting(resolveTrees(project, env), scope);
  writer.append(
    memoryCaptured(
      {
        at: '2026-01-01T00:00:00.000Z',
        who: writer.anchor,
        signerFp: writer.signerFingerprint,
        subject,
      },
      { content: `the old runbook said to use ${SECRET}` },
    ),
  );
  writer.checkpoint();
  return subject;
}

/** Captures a clean memory in a project (or the session's own), returning its id. */
function memoryIn(session: Session, content: string, where: { project?: string } = {}): string {
  const captured = runCaptureMemory(session, { content, ...where });
  if (!captured.ok) throw new Error(`setup: capture refused — ${captured.message}`);
  return captured.id;
}

/** The exposure report, or a thrown setup error — `NO_PROJECT` has its own test. */
function reportOn(session: Session) {
  const result = runExposureTool(session);
  if (!result.ok) throw new Error(`exposure refused — ${result.message}`);
  return result.value;
}

/** The shapes per record, or a thrown setup error. */
function shapesOn(session: Session) {
  const result = runAntipatternsTool(session);
  if (!result.ok) throw new Error(`antipatterns refused — ${result.message}`);
  return result.value;
}

/** How much one record was read, by the project it belongs to (undefined = global). */
function scannedIn(
  report: { scanned: readonly { project?: string; scanned: number }[] },
  project: string | undefined,
): number | undefined {
  return report.scanned.find((entry) => entry.project === project)?.scanned;
}

/** Drives a skill all the way to `deprecated` in whatever project a session adopted. */
function deprecateASkill(session: Session, name: string): string {
  const created = runCreateSkill(session, { name, body: 'how it used to be done' });
  if (!created.ok) throw new Error(`setup: create skill refused — ${created.message}`);
  for (const [action, field] of [
    ['review', 'note'],
    ['adopt', 'note'],
    ['deprecate', 'reason'],
  ] as const) {
    const moved = runSkillTransition(session, { id: created.id, action, [field]: 'because' });
    if (!moved.ok) throw new Error(`setup: ${action} refused — ${moved.message}`);
  }
  return created.id;
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-audit-workspace-'));
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  env = { home, xdgDataHome: join(sandbox, 'data') };
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('audit_exposure spans every project of the workspace', () => {
  it('finds a credential in a SIBLING project, and says which project to rotate in', () => {
    // The defect, stated as a session: the credential is in `nferural`, the cascade
    // landed on `plantae-legacy`, and the audit said `findings: []` with a denominator
    // beside it. Meanwhile `search` in the same session printed the value in full.
    const legacy = makeProject('plantae-legacy');
    const laravel = makeProject('plantae-laravel');
    const nferural = makeProject('nferural');
    const far = plantCredential(nferural, 'public', '019fa8b7-0410-717b-9af2-cfeb013fc4a1');

    const session = openOn(legacy, laravel, nferural);
    const report = reportOn(session);

    const finding = report.findings.find((f) => f.id === far);
    expect(finding).toBeDefined();
    // WHERE to rotate: the project, beside the tree it already carried. `public` alone
    // names a role that all three repositories have.
    expect(finding?.project).toBe(nferural);
    expect(finding?.scope).toBe('public');
    expect(finding?.classes).toEqual(['aws-access-key']);
    closeSession(session);
  });

  it('never carries the value — not in the object, not in its JSON, not a prefix of it', () => {
    const here = makeProject('here');
    const there = makeProject('there');
    plantCredential(there, 'public', '019fa8b7-0410-717b-9af2-cfeb013fc4a2');

    const session = openOn(here, there);
    const serialized = JSON.stringify(reportOn(session));

    expect(serialized).toContain('aws-access-key');
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain('AKIA');
    closeSession(session);
  });

  it('counts the machine-global tree ONCE, however many projects resolve it', () => {
    // Every project resolves the SAME global tree, so iterating projects hands that one
    // tree over N times. Merged findings do not absorb that: the union would report one
    // personal note three times over and tell someone to rotate three keys.
    const first = makeProject('first');
    const second = makeProject('second');
    const third = makeProject('third');
    const personal = plantCredential(first, 'global', '019fa8b7-0410-717b-9af2-cfeb013fc4a3');

    const session = openOn(first, second, third);
    const report = reportOn(session);

    expect(report.findings.filter((f) => f.id === personal)).toHaveLength(1);
    // And the denominator counts it once too, in ONE entry of its own.
    expect(report.scanned.filter((entry) => entry.project === undefined)).toHaveLength(1);
    closeSession(session);
  });

  it('leaves the machine-global finding UNLABELLED, because it belongs to no project', () => {
    // A personal cross-project note reported as coming from whichever project the read
    // reached it through would be a false claim about where to go and change a key —
    // and the tree is shared, so every project would make that claim differently.
    const only = makeProject('only');
    const personal = plantCredential(only, 'global', '019fa8b7-0410-717b-9af2-cfeb013fc4a4');
    const local = plantCredential(only, 'public', '019fa8b7-0410-717b-9af2-cfeb013fc4a5');

    const session = openOn(only);
    const report = reportOn(session);

    expect(report.findings.find((f) => f.id === personal)?.project).toBeUndefined();
    expect(report.findings.find((f) => f.id === local)?.project).toBe(only);
    closeSession(session);
  });

  it('keeps covering all THREE trees of the adopted project, told apart by scope', () => {
    // Non-regression on the dimension that was already right. The tree decides the
    // situation — a public record is committed and clones to every machine, a private
    // one is on this disk, a global one is on this disk and crosses projects — and
    // gaining the project must not cost the scope.
    const here = makeProject('here');
    const inPublic = plantCredential(here, 'public', '019fa8b7-0410-717b-9af2-cfeb013fc4a6');
    const inPrivate = plantCredential(here, 'private', '019fa8b7-0410-717b-9af2-cfeb013fc4a7');
    const inGlobal = plantCredential(here, 'global', '019fa8b7-0410-717b-9af2-cfeb013fc4a8');

    const session = openOn(here);
    const report = reportOn(session);

    expect(new Map(report.findings.map((f) => [f.id, f.scope]))).toEqual(
      new Map([
        [inPublic, 'public'],
        [inPrivate, 'private'],
        [inGlobal, 'global'],
      ]),
    );
    closeSession(session);
  });

  it('answers the same order twice, because the answer enters a prompt', () => {
    // Two identical calls must produce identical text: this goes into the prefix of an
    // agent's context, where a list that reshuffles reads as a record that changed.
    const one = makeProject('one');
    const two = makeProject('two');
    plantCredential(one, 'public', '019fa8b7-0410-717b-9af2-cfeb013fc4a9');
    plantCredential(two, 'public', '019fa8b7-0410-717b-9af2-cfeb013fc4aa');
    plantCredential(one, 'global', '019fa8b7-0410-717b-9af2-cfeb013fc4ab');

    const session = openOn(one, two);
    expect(JSON.stringify(reportOn(session))).toBe(JSON.stringify(reportOn(session)));
    closeSession(session);
  });
});

describe('the empty answer says where it looked', () => {
  it('lists every record it read with its count, so `findings: []` is not "nothing"', () => {
    // The half of the defect that outlives the false negative: `findings: []` beside a
    // single number reads as a search that covered the ground. One count per record is
    // the answer naming where it looked, in the payload rather than in prose.
    const alpha = makeProject('alpha');
    const beta = makeProject('beta');
    const gamma = makeProject('gamma');

    const session = openOn(alpha, beta, gamma);
    memoryIn(session, 'a clean note here');
    memoryIn(session, 'a clean note there', { project: beta });
    const report = reportOn(session);

    expect(report.findings).toEqual([]);
    // Every project of the workspace, and the machine-global tree last — including the
    // project nothing was ever written to, which at zero is distinguishable from a
    // project the read never opened.
    expect(report.scanned.map((entry) => entry.project)).toEqual([alpha, beta, gamma, undefined]);
    expect(scannedIn(report, alpha)).toBeGreaterThan(0);
    expect(scannedIn(report, beta)).toBeGreaterThan(0);
    expect(scannedIn(report, gamma)).toBe(0);
    // And no total across them: a workspace figure offered beside the entries is the
    // number a hurried reader divides by.
    expect('total' in report).toBe(false);
    closeSession(session);
  });

  it('is not broken by a root that is no project — it is not in the list either', () => {
    // A workspace regularly holds folders that are not projects (a scratch directory, a
    // checkout with no `.mnema/`). Such a root has no record to read, and naming it as
    // scanned would claim a search of something that does not exist.
    const real = makeProject('real');
    const notAProject = join(sandbox, 'just-a-folder');
    mkdirSync(notAProject, { recursive: true });

    const session = openOn(real, notAProject);
    const report = reportOn(session);

    expect(report.scanned.map((entry) => entry.project)).toEqual([real, undefined]);
    expect(shapesOn(session).byProject.map((entry) => entry.project)).toEqual([real, undefined]);
    closeSession(session);
  });

  it('opens no tree of a project it only reads THROUGH, and writes nothing anywhere', () => {
    // Both reads now walk every announced project. A tree that has never been written
    // does not exist on disk, and folding tails must leave it that way — these reads
    // open no writer and no cache, so there is nothing for them to create.
    const here = makeProject('here');
    const untouched = makeProject('untouched');

    const session = openOn(here, untouched);
    memoryIn(session, 'something here');
    reportOn(session);
    shapesOn(session);

    expect(readdirSync(join(untouched, PROJECT_DIR))).not.toContain('private');
    expect(session.runs.size).toBe(1);
    closeSession(session);
  });
});

describe('audit_antipatterns decomposes by record', () => {
  it('reports a deprecated skill under the project whose record holds it', () => {
    // The shapes are counts, so they are never merged. The skill was deprecated in one
    // project of three; pooling them would say the workspace deprecated something, and
    // the candidate list — which points at work a person might distill a pattern from —
    // would point them at another project's work.
    const first = makeProject('first');
    const second = makeProject('second');
    const third = makeProject('third');

    // Deprecated in `third`, from a session that adopted `third`: a transition follows
    // its entity's home TREE, and locating an entity across projects is a separate
    // change from this one.
    const own = openOn(third);
    const skill = deprecateASkill(own, 'the-old-way');
    closeSession(own);

    const session = openOn(first, second, third);
    const shapes = shapesOn(session);

    expect(shapes.byProject.map((entry) => entry.project)).toEqual([
      first,
      second,
      third,
      undefined,
    ]);
    const there = shapes.byProject.find((entry) => entry.project === third);
    expect(there?.deprecatedSkills.map((f) => f.entityId)).toEqual([skill]);
    // Every other record is listed with nothing recurring, rather than left out.
    for (const entry of shapes.byProject.filter((e) => e.project !== third)) {
      expect(entry.deprecatedSkills).toEqual([]);
      expect(entry.reopenedTasks).toEqual([]);
      expect(entry.supersededDecisions).toEqual([]);
      expect(entry.skillCandidates).toEqual([]);
    }
    closeSession(session);
  });

  it('carries the evidence of the record it belongs to, and no total across records', () => {
    const only = makeProject('only');
    const own = openOn(only);
    const skill = deprecateASkill(own, 'a-habit');
    closeSession(own);

    const session = openOn(only);
    const shapes = shapesOn(session);
    const here = shapes.byProject.find((entry) => entry.project === only);

    // The evidence is the events that make up the count — the transition itself.
    const evidence = here?.deprecatedSkills[0]?.evidence ?? [];
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.kind).toBe('skill.transitioned');
    expect(evidence[0]?.subject).toBe(skill);
    expect('reopenedTasks' in shapes).toBe(false);
    closeSession(session);
  });
});

describe('a one-project workspace does not regress, and the command line proves it', () => {
  it('finds the same exposure the untouched command line finds, with the same denominator', () => {
    // The regression that matters most: almost every session is one project, and the
    // union has nothing to add there. The witness is the COMMAND LINE, which resolves
    // one project from `cwd`, knows nothing of a workspace, and is untouched by this
    // change — so the check is not this read restating its own numbers.
    const only = makeProject('only');
    plantCredential(only, 'public', '019fa8b7-0410-717b-9af2-cfeb013fc4ac');
    plantCredential(only, 'global', '019fa8b7-0410-717b-9af2-cfeb013fc4ad');

    const session = openOn(only);
    const mine = reportOn(session);
    const cli = runExposure({ cwd: only, env });
    if (!cli.ok) throw new Error('unreachable');

    // The same findings in the same order — the project label is the ONLY difference.
    expect(mine.findings.map(({ project, ...rest }) => rest)).toEqual(cli.report.findings);
    // And the arithmetic: the decomposition adds up to the one fold's denominator,
    // every event counted once.
    const sum = mine.scanned.reduce((total, entry) => total + entry.scanned, 0);
    expect(sum).toBe(cli.report.scanned);
    closeSession(session);
  });

  it('reports the same shapes the untouched command line reports', () => {
    const only = makeProject('only');
    const own = openOn(only);
    const skill = deprecateASkill(own, 'a-habit');
    closeSession(own);

    const session = openOn(only);
    const shapes = shapesOn(session);
    const cli = runAntipatterns({ cwd: only, env });
    if (!cli.ok) throw new Error('unreachable');

    // The command line folds its one project's trees into one set of shapes, and that
    // is what the project's entry plus the global one have to account for.
    const here = shapes.byProject.find((entry) => entry.project === only);
    expect(here?.deprecatedSkills.map((f) => f.entityId)).toEqual([skill]);
    expect(cli.patterns.deprecatedSkills.map((f) => f.entityId)).toEqual([skill]);
    const global = shapes.byProject.find((entry) => entry.project === undefined);
    expect(global?.deprecatedSkills).toEqual([]);
    closeSession(session);
  });
});

describe('the door and the audit agree', () => {
  it('reports a SCREENED record as clean, which is the design and not a miss', () => {
    // The door and this audit call the same detector, and the placeholder is guarded
    // against re-matching. So a record the door cleaned is genuinely clean here — and a
    // "fix" that made this report it would have the audit accusing the product of what
    // the product already prevented, on every write it protected.
    const only = makeProject('only');
    const session = openOn(only);

    const captured = runCaptureMemory(session, { content: `deploy with ${SECRET}` });
    if (!captured.ok) throw new Error(`setup: capture refused — ${captured.message}`);
    expect(captured.replaced).toEqual(['aws-access-key']);

    // The record holds the placeholder, permanently — the value never arrived.
    const read = runReadRecordTool(session, { id: captured.id });
    if (!read.ok) throw new Error('unreachable');
    expect(JSON.stringify(read.value)).toContain('<SECRET:aws-access-key>');
    expect(JSON.stringify(read.value)).not.toContain(SECRET);

    // And the audit says so: the screened record is not among the findings, while the
    // denominator shows it was read.
    const report = reportOn(session);
    expect(report.findings.find((f) => f.id === captured.id)).toBeUndefined();
    expect(scannedIn(report, only)).toBeGreaterThan(0);
    closeSession(session);
  });
});
