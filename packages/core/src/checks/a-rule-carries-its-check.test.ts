/**
 * A rule carries its check, and a key that signs only check results records whether it held.
 *
 * Driven through the operations a surface uses, against a real tree in a sandbox, with two key
 * roots: a person's and a CI runner's. What is held:
 *   - a check is declared on a rule of the record, and refused on an id that is no rule;
 *   - a key is enrolled as a checker only from a checker request, and a member request is
 *     refused at that door (and the reverse at the other);
 *   - the checker runs every check of a rule in force, through the runner it is handed, and the
 *     record verifies with its results in it, `who` being the checker's own anchor;
 *   - a key that is not a checker runs nothing and writes nothing;
 *   - what a check printed is recorded bounded and with its control bytes made visible.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CatalogEvent, catalogUpcasters, deriveAnchor, verify } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHECKER_REQUEST_PREFIX,
  decodeKeyRequest,
  requestEnrollment,
} from '../identity/handshake.js';
import { captureMemory } from '../knowledge/operations.js';
import { orderedEvents } from '../projections/order.js';
import { resolveTrees } from '../topology/resolve.js';
import { chainRootForScope, deferredWrite, openTreeForWriting } from '../topology/routing.js';
import { acceptDecision, recordDecision } from '../workflow/decision-operations.js';
import type { WriteContext } from '../workflow/operations.js';
import { checkersIn, consentsToCheck } from './checkers.js';
import {
  type DeclaredCheck,
  declareCheck,
  enrollChecker,
  OUTPUT_LIMIT,
  runRuleChecks,
} from './operations.js';

const upcasters = catalogUpcasters();
const COMMIT = 'c0ffee'.padEnd(40, '0');

describe('a rule carries its check', () => {
  let sandbox: string;
  let repo: string;
  let root: string;
  let person: WriteContext;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mnema-checks-'));
    repo = join(sandbox, 'repo');
    mkdirSync(join(repo, '.mnema'), { recursive: true });
    const trees = resolveTrees(repo, { home: join(sandbox, 'person') });
    root = chainRootForScope(trees, 'public') as string;
    person = { writer: openTreeForWriting(trees, 'public'), layout: { root }, upcasters };
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  function acceptedRule(title: string): string {
    const recorded = recordDecision(person, {
      title,
      rationale: 'Money in floats loses cents.',
    });
    if (!recorded.ok) throw new Error(recorded.message);
    const accepted = acceptDecision(person, {
      id: recorded.id,
      fields: { note: 'agreed by the team' },
    });
    if (!accepted.ok) throw new Error(accepted.message);
    return recorded.id;
  }

  const ciTrees = () => resolveTrees(repo, { home: join(sandbox, 'ci') });
  const personAnchor = (): string => deriveAnchor(person.writer.signerFingerprint);

  function checkerRequest(): { request: string; fingerprint: string } {
    const made = requestEnrollment({
      anchor: personAnchor(),
      keyRoot: ciTrees().keyRoot,
      asChecker: true,
    });
    if (!made.ok) throw new Error(made.message);
    return made;
  }

  function enrolledChecker(): string {
    const { request, fingerprint } = checkerRequest();
    const enrolled = enrollChecker(person, { request });
    if (!enrolled.ok) throw new Error(enrolled.message);
    return fingerprint;
  }

  const kinds = (): string[] => orderedEvents({ root }, upcasters).map((e) => e.kind);

  it('records a check on a rule, and refuses an id that names no rule', () => {
    const rule = acceptedRule('Money is kept in integer cents');
    const declared = declareCheck(person, {
      rule,
      command: 'node',
      args: ['scripts/check-cents.js', 'a;b'],
    });
    expect(declared.ok).toBe(true);

    const refused = declareCheck(person, { rule: 'no-such-rule', command: 'true' });
    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.code).toBe('UNKNOWN_RULE');
    expect(kinds().filter((k) => k === 'check.declared')).toHaveLength(1);
  });

  it('a checker runs the checks of the rules in force, and the record verifies', () => {
    const held = acceptedRule('Money is kept in integer cents');
    const broken = acceptedRule('Every query is parameterized');
    declareCheck(person, { rule: held, command: 'node', args: ['cents.js'] });
    declareCheck(person, { rule: broken, command: 'node', args: ['queries.js'] });
    const checkerFp = enrolledChecker();
    person.writer.checkpoint();

    const ran: DeclaredCheck[] = [];
    const ci = deferredWrite(ciTrees(), 'public');
    const result = runRuleChecks(ci, {
      commit: COMMIT,
      rulesInForce: new Set([held, broken]),
      run: (check) => {
        ran.push(check);
        return check.rule === held
          ? { passed: true, output: 'all amounts are integers' }
          : { passed: false, failure: 'exited with code 1', output: 'src/q.ts:3 concatenates' };
      },
    });
    expect(result.ok).toBe(true);
    expect(ran.map((c) => c.args)).toEqual(expect.arrayContaining([['cents.js'], ['queries.js']]));

    const results = orderedEvents({ root }, upcasters).filter(
      (e): e is CatalogEvent => e.kind === 'check.passed' || e.kind === 'check.failed',
    );
    expect(results.map((e) => [e.kind, e.subject]).sort()).toEqual(
      [
        ['check.failed', broken],
        ['check.passed', held],
      ].sort(),
    );
    for (const e of results) {
      expect(e.who).toBe(deriveAnchor(checkerFp));
      expect(e.signerFp).toBe(checkerFp);
    }
    const verdict = verify(root, upcasters);
    expect(verdict.issues).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it('a check of a rule not in force is not run', () => {
    const rule = acceptedRule('Money is kept in integer cents');
    declareCheck(person, { rule, command: 'node' });
    enrolledChecker();
    const ran: string[] = [];
    const result = runRuleChecks(deferredWrite(ciTrees(), 'public'), {
      commit: COMMIT,
      rulesInForce: new Set(),
      run: (check) => {
        ran.push(check.rule);
        return { passed: true, output: '' };
      },
    });
    expect(result.ok).toBe(true);
    expect(ran).toEqual([]);
  });

  it('a key that is not a checker runs nothing and writes nothing', () => {
    const rule = acceptedRule('Money is kept in integer cents');
    declareCheck(person, { rule, command: 'node' });
    const before = kinds().length;
    let ran = 0;
    const result = runRuleChecks(deferredWrite(ciTrees(), 'public'), {
      commit: COMMIT,
      rulesInForce: new Set([rule]),
      run: () => {
        ran += 1;
        return { passed: true, output: '' };
      },
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.code).toBe('NOT_A_CHECKER');
    expect(ran).toBe(0);
    expect(kinds()).toHaveLength(before);
  });

  it('names the keys the record enrolls as checkers, and only those whose consent holds', () => {
    expect(checkersIn({ root }, upcasters).size).toBe(0);
    const { request, fingerprint } = checkerRequest();
    const decoded = decodeKeyRequest(request, CHECKER_REQUEST_PREFIX);
    if (decoded === null) throw new Error('the request did not decode');
    // The consent is over ONE identity: the same signature is no consent for another.
    expect(consentsToCheck(decoded.key, personAnchor(), decoded.reverseSig)).toBe(true);
    expect(consentsToCheck(decoded.key, 'mn-someone-else', decoded.reverseSig)).toBe(false);
    expect(consentsToCheck(decoded.key, personAnchor(), 'not hex at all')).toBe(false);

    expect(enrollChecker(person, { request }).ok).toBe(true);
    expect([...checkersIn({ root }, upcasters)]).toEqual([fingerprint]);
  });

  it('a member request is refused at the checker door', () => {
    const made = requestEnrollment({ anchor: personAnchor(), keyRoot: ciTrees().keyRoot });
    if (!made.ok) throw new Error(made.message);
    const refused = enrollChecker(person, { request: made.request });
    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.code).toBe('MALFORMED_REQUEST');
    expect(kinds()).not.toContain('checker.enrolled');
  });

  it('records what a check printed bounded, with its control bytes made visible', () => {
    const rule = acceptedRule('Money is kept in integer cents');
    declareCheck(person, { rule, command: 'node' });
    enrolledChecker();
    const loud = `${'x'.repeat(OUTPUT_LIMIT * 2)}\u001b[2Jtail`;
    runRuleChecks(deferredWrite(ciTrees(), 'public'), {
      commit: COMMIT,
      rulesInForce: new Set([rule]),
      run: () => ({ passed: false, failure: 'exited with code 2', output: loud }),
    });
    const failed = orderedEvents({ root }, upcasters).find((e) => e.kind === 'check.failed');
    const output = failed?.kind === 'check.failed' ? (failed.payload.output ?? '') : '';
    expect(output.length).toBeLessThanOrEqual(OUTPUT_LIMIT + 2);
    expect(output.endsWith('\\u001b[2Jtail')).toBe(true);
    expect(output).not.toContain('\u001b');
  });
  it('a checker key cannot found an identity, so it cannot write anything but a result', () => {
    enrolledChecker();
    const before = kinds().length;
    const trees = ciTrees();
    const ci: WriteContext = {
      writer: openTreeForWriting(trees, 'public'),
      layout: { root },
      upcasters,
    };
    expect(() => captureMemory(ci, { content: 'The runner has an opinion.' })).toThrow(
      /enrolled in this record as a checker/,
    );
    expect(kinds()).toHaveLength(before);
  });
});
