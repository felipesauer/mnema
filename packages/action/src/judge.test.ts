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
}

function worldWith(
  over: {
    verify?: { passed: boolean; said: string };
    files?: string[];
    reviews?: { user: string; state: string }[];
    rules?: Record<string, unknown>;
    base?: string;
    hasCommit?: boolean;
    commentFails?: boolean;
    noRecord?: boolean;
  } = {},
): { world: World; seen: Seen } {
  const seen: Seen = { comments: [], asked: [], warnings: [] };
  const world: World = {
    git: {
      hasCommit: () => over.hasCommit ?? true,
      recordAt: (ref) => (over.noRecord ? [] : [ref === 'HEAD' ? grown : (over.base ?? born)]),
    },
    mnema: {
      verify: () => over.verify ?? { passed: true, said: 'ok' },
      rules: (path) => {
        seen.asked.push(path);
        return over.rules?.[path] ?? {};
      },
    },
    github: {
      changedFiles: async () => over.files ?? [],
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
    expect(seen.comments[0]?.body).toContain('`src/a.ts` — governed by rule d1');
    expect(seen.comments[0]?.onlyIfThere).toBe(false);
  });

  it('fails the check when the record does not verify as signed', async () => {
    const { world, seen } = worldWith({ verify: { passed: false, said: 'checkpoint missing' } });
    const verdict = await judge(world, pr);
    expect(verdict.failed).toBe(true);
    expect(verdict.reasons).toEqual(['the record does not verify as signed']);
    expect(seen.comments[0]?.body).toContain('checkpoint missing');
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

  it('keeps the verdict when the comment cannot be written, and warns', async () => {
    const { world, seen } = worldWith({ commentFails: true });
    expect(await judge(world, pr)).toEqual({ failed: false, reasons: [] });
    expect(seen.warnings).toEqual(['the comment was not written: GitHub answered 403']);
  });
});
