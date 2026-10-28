import { describe, expect, it } from 'vitest';
import { judge, MOST_ASKED, type PullRequest, type World } from './judge.js';

const tail = (...events: [string, string, Record<string, unknown>?][]): string =>
  events
    .map(([hash, kind, payload]) =>
      JSON.stringify({ event: { kind, subject: 'd1', payload: payload ?? {} }, link: { hash } }),
    )
    .join('\n');

const born = tail(['1', 'decision.recorded', { adr: 'ADR-1', title: 'Cents' }]);
const grown = tail(
  ['1', 'decision.recorded', { adr: 'ADR-1', title: 'Cents' }],
  ['2', 'decision.transitioned', { to: 'accepted' }],
);

interface Seen {
  comments: { body: string; onlyIfThere: boolean }[];
  asked: string[];
  warnings: string[];
  checked: string[];
  /** The base each `verify` was asked to hold the record to. */
  since: string[];
  /** The bases the rules were read at, and how many of those readings were closed. */
  readAt: string[];
  closed: number;
}

function worldWith(
  over: {
    verify?: { passed: boolean; said: string };
    files?: (string | { path: string; renamedFrom?: string })[];
    reviews?: { user: string; state: string }[];
    rules?: Record<string, unknown>;
    /** What `mnema rules` answers over the base commit; nothing addresses any file by default. */
    baseRules?: Record<string, unknown>;
    base?: string;
    hasCommit?: boolean;
    commentFails?: boolean;
    noRecord?: boolean;
    checks?: { passed: boolean; said: string };
  } = {},
): { world: World; seen: Seen } {
  const seen: Seen = {
    comments: [],
    asked: [],
    warnings: [],
    checked: [],
    since: [],
    readAt: [],
    closed: 0,
  };
  const world: World = {
    git: {
      hasCommit: () => over.hasCommit ?? true,
      recordAt: (ref) => (over.noRecord ? [] : [ref === 'HEAD' ? grown : (over.base ?? born)]),
    },
    mnema: {
      verify: (base) => {
        seen.since.push(base);
        return over.verify ?? { passed: true, said: 'ok' };
      },
      rules: (path) => {
        seen.asked.push(path);
        return over.rules?.[path] ?? {};
      },
      rulesAt: (base) => {
        seen.readAt.push(base);
        return {
          rules: (path) => over.baseRules?.[path] ?? {},
          close: () => {
            seen.closed += 1;
          },
        };
      },
      checkRun: (key) => {
        seen.checked.push(key);
        return over.checks ?? { passed: true, said: '1 passed · 0 failed at abc' };
      },
    },
    github: {
      changedFiles: async () =>
        (over.files ?? []).map((file) => (typeof file === 'string' ? { path: file } : file)),
      reviews: async () => over.reviews ?? [],
      upsertComment: async (body, onlyIfThere) => {
        if (over.commentFails) throw new Error('GitHub answered 403');
        seen.comments.push({ body, onlyIfThere });
        return 'created';
      },
    },
    log: { info: () => {}, warning: (line) => seen.warnings.push(line) },
  };
  return { world, seen };
}

const pr: PullRequest = { baseSha: 'abc', author: 'bob', requireApprovalForAsks: false };
const rule = (rule: string, state = 'accepted') => ({
  rule,
  name: `rule ${rule}`,
  kind: 'decision',
  state,
});

describe('judge', () => {
  it('runs the checks only when handed a checker key, and fails when one did not pass', async () => {
    const none = worldWith();
    expect(await judge(none.world, pr)).toEqual({ failed: false, reasons: [] });
    expect(none.seen.checked).toEqual([]);

    const held = worldWith();
    expect(await judge(held.world, { ...pr, checkerKey: 'PEM' })).toEqual({
      failed: false,
      reasons: [],
    });
    expect(held.seen.checked).toEqual(['PEM']);

    const broke = worldWith({ checks: { passed: false, said: '0 passed · 1 failed at abc' } });
    expect(await judge(broke.world, { ...pr, checkerKey: 'PEM' })).toEqual({
      failed: true,
      reasons: ['a rule’s check did not pass, or the checks did not run'],
    });
  });

  it('puts what each check said in the one comment, not only in the log', async () => {
    const said = [
      '1 passed · 1 failed at abc',
      '  passed rule-ok',
      '  failed rule-bad: exited 1',
      '  signed by anchor',
    ].join('\n');
    const { world, seen } = worldWith({ checks: { passed: false, said } });
    await judge(world, { ...pr, checkerKey: 'PEM' });
    expect(seen.comments).toHaveLength(1);
    const body = seen.comments[0]?.body ?? '';
    expect(body).toContain('**Checks the rules carry**');
    expect(body).toContain('1 passed · 1 failed at abc');
    expect(body).toContain('- passed `rule-ok`');
    expect(body).toContain('- failed `rule-bad`: exited 1');
    expect(body).not.toContain('signed by');
  });

  it('leaves the comment as it was when no check was asked for', async () => {
    const { world, seen } = worldWith();
    await judge(world, pr);
    expect(seen.comments[0]?.body).not.toContain('Checks the rules carry');
  });

  it('comments the new events and the governed files, and passes when the record verifies', async () => {
    const { world, seen } = worldWith({
      files: ['src/a.ts', 'src/b.ts', '.mnema/tails/x/000001.jsonl'],
      rules: { 'src/a.ts': { rules: [rule('d1')] } },
    });
    const verdict = await judge(world, pr);
    expect(verdict).toEqual({ failed: false, reasons: [] });
    expect(seen.asked).toEqual(['src/a.ts', 'src/b.ts']);
    expect(seen.comments).toHaveLength(1);
    expect(seen.comments[0]?.body).toContain('1 new event');
    expect(seen.comments[0]?.body).toContain('`src/a.ts`: governed by rule d1');
    expect(seen.comments[0]?.onlyIfThere).toBe(false);
  });

  it('fails the check when the record does not verify as signed', async () => {
    const { world, seen } = worldWith({ verify: { passed: false, said: 'checkpoint missing' } });
    const verdict = await judge(world, pr);
    expect(verdict.failed).toBe(true);
    expect(verdict.reasons).toEqual([
      'the record does not verify as signed, as the base record grown',
    ]);
    expect(seen.comments[0]?.body).toContain('checkpoint missing');
    // Held to the pull request's base, so a record cut back to an earlier state is caught too.
    expect(seen.since).toEqual([pr.baseSha]);
  });

  it('refreshes a comment it wrote but adds none when the pull request touches nothing', async () => {
    const { world, seen } = worldWith({ base: grown });
    expect(await judge(world, pr)).toEqual({ failed: false, reasons: [] });
    expect(seen.comments.map((c) => c.onlyIfThere)).toEqual([true]);
  });

  it('asks about no more than the cap', async () => {
    const files = Array.from({ length: MOST_ASKED + 5 }, (_, i) => `f${i}.ts`);
    const { world, seen } = worldWith({ files, base: grown });
    await judge(world, pr);
    expect(seen.asked).toHaveLength(MOST_ASKED);
    expect(seen.comments[0]?.body).toContain('5 changed files were not asked about');
  });

  it('says a repository without a record holds none, refreshes only a comment it wrote, and runs nothing', async () => {
    const { world, seen } = worldWith({
      noRecord: true,
      files: ['src/a.ts'],
      verify: { passed: false, said: 'x' },
    });
    const infos: string[] = [];
    world.log.info = (line) => infos.push(line);
    expect(await judge(world, pr)).toEqual({ failed: false, reasons: [] });
    expect(infos).toContain('::notice::this repository holds no mnema record');
    expect(seen.asked).toEqual([]);
    expect(seen.comments).toHaveLength(1);
    expect(seen.comments[0]?.onlyIfThere).toBe(true);
    expect(seen.comments[0]?.body).toContain('This repository holds no mnema record.');
  });

  it('refuses to compare against a base commit the clone does not hold', async () => {
    const { world } = worldWith({ hasCommit: false });
    await expect(judge(world, pr)).rejects.toThrow('check out the whole history');
  });

  describe('the approval check, when switched on', () => {
    const asking = { 'src/a.ts': { asks: [rule('d1')] } };
    const on = { ...pr, requireApprovalForAsks: true };

    it('fails when a file asks for a person and only the author has approved', async () => {
      const { world } = worldWith({
        files: ['src/a.ts'],
        rules: asking,
        reviews: [{ user: 'bob', state: 'APPROVED' }],
      });
      const verdict = await judge(world, on);
      expect(verdict.failed).toBe(true);
      expect(verdict.reasons).toEqual([
        'a rule asks for a person and no one but the author has approved',
      ]);
    });

    it('passes when someone else has approved', async () => {
      const { world } = worldWith({
        files: ['src/a.ts'],
        rules: asking,
        reviews: [{ user: 'ana', state: 'APPROVED' }],
      });
      expect((await judge(world, on)).failed).toBe(false);
    });

    it('passes when no changed file asks for anyone', async () => {
      const { world } = worldWith({ files: ['src/a.ts'] });
      expect((await judge(world, on)).failed).toBe(false);
    });

    it('does nothing about it when it is off', async () => {
      const { world } = worldWith({ files: ['src/a.ts'], rules: asking });
      expect((await judge(world, pr)).failed).toBe(false);
    });

    it('does not count a rule that is not accepted', async () => {
      const { world } = worldWith({
        files: ['src/a.ts'],
        rules: { 'src/a.ts': { asks: [rule('d1', 'proposed')] } },
      });
      expect((await judge(world, on)).failed).toBe(false);
    });
  });

  describe("the rules that judge the files are the base's", () => {
    const on = { ...pr, requireApprovalForAsks: true };
    const asking = { 'src/a.ts': { asks: [rule('d1')] } };
    // The pull request superseded d1 and edited src/a.ts: at its head nothing asks any more.
    const lifted = { 'src/a.ts': { asks: [rule('d1', 'superseded')] } };

    it('fails a pull request that lifts the rule off the file it edits', async () => {
      const { world, seen } = worldWith({
        files: ['src/a.ts'],
        rules: lifted,
        baseRules: asking,
        reviews: [{ user: 'bob', state: 'APPROVED' }],
      });
      const verdict = await judge(world, on);
      expect(verdict.failed).toBe(true);
      expect(verdict.reasons).toEqual([
        'a rule asks for a person and no one but the author has approved',
      ]);
      expect(seen.readAt).toEqual([pr.baseSha]);
      expect(seen.comments[0]?.body).toContain('asks for a person: rule d1');
      expect(seen.comments[0]?.body).toContain('Rules read at the base (`abc`)');
    });

    it('fails a rename that carries the protected file to a new path', async () => {
      const { world, seen } = worldWith({
        files: [{ path: 'src/b.ts', renamedFrom: 'src/a.ts' }],
        rules: {},
        baseRules: asking,
        reviews: [],
      });
      expect((await judge(world, on)).failed).toBe(true);
      expect(seen.asked).toEqual(['src/b.ts', 'src/a.ts']);
      expect(seen.comments[0]?.body).toContain(
        '`src/a.ts` (renamed to src/b.ts): asks for a person: rule d1',
      );
    });

    it('fails the removal of a protected file, and names the file a rename moves into one', async () => {
      const removed = worldWith({
        files: ['src/a.ts'],
        rules: {},
        baseRules: asking,
        reviews: [],
      });
      expect((await judge(removed.world, on)).failed).toBe(true);

      const into = worldWith({
        files: [{ path: 'src/a.ts', renamedFrom: 'src/old.ts' }],
        rules: {},
        baseRules: asking,
      });
      expect((await judge(into.world, on)).failed).toBe(true);
      expect(into.seen.comments[0]?.body).toContain(
        '`src/a.ts` (renamed from src/old.ts): asks for a person: rule d1',
      );
    });

    it('fails the control that only edits the file', async () => {
      const { world } = worldWith({
        files: ['src/a.ts'],
        rules: asking,
        baseRules: asking,
        reviews: [{ user: 'bob', state: 'APPROVED' }],
      });
      expect((await judge(world, on)).failed).toBe(true);
    });

    it('also counts a rule the pull request adds, once if both readings have it', async () => {
      const added = worldWith({
        files: ['src/a.ts'],
        rules: asking,
        reviews: [{ user: 'bob', state: 'APPROVED' }],
      });
      expect((await judge(added.world, on)).failed).toBe(true);

      const both = worldWith({ files: ['src/a.ts'], rules: asking, baseRules: asking });
      await judge(both.world, pr);
      const lines = (both.seen.comments[0]?.body ?? '').split('\n');
      expect(lines.filter((line) => line.includes('asks for a person: rule d1'))).toHaveLength(1);
    });

    it('lets a pull request through when someone else approved, whatever it lifted', async () => {
      const { world } = worldWith({
        files: ['src/a.ts'],
        rules: lifted,
        baseRules: asking,
        reviews: [{ user: 'ana', state: 'APPROVED' }],
      });
      expect((await judge(world, on)).failed).toBe(false);
    });

    it('closes the reading of the base even when asking fails', async () => {
      const { world, seen } = worldWith({ files: ['src/a.ts'], rules: asking });
      world.mnema.rulesAt = () => ({
        rules: () => {
          throw new Error('boom');
        },
        close: () => {
          seen.closed += 1;
        },
      });
      await expect(judge(world, on)).rejects.toThrow('boom');
      expect(seen.closed).toBe(1);
    });

    it('reads no base when the base holds no record, and says so', async () => {
      const first = worldWith({ files: ['src/a.ts'], rules: asking });
      const world = first.world;
      const grownOnly = world.git.recordAt;
      world.git.recordAt = (ref) => (ref === 'HEAD' ? grownOnly(ref) : []);
      const verdict = await judge(world, on);
      expect(verdict.failed).toBe(true);
      expect(first.seen.readAt).toEqual([]);
      expect(first.seen.comments[0]?.body).toContain('its base holds no record');
    });
  });

  it('keeps the verdict when the comment cannot be written, and warns', async () => {
    const { world, seen } = worldWith({ commentFails: true });
    expect(await judge(world, pr)).toEqual({ failed: false, reasons: [] });
    expect(seen.warnings).toEqual(['the comment was not written: GitHub answered 403']);
  });
});
