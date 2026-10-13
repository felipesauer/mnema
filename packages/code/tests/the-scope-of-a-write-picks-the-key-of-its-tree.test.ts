/**
 * THE TREE A WRITE LANDS IN PICKS THE KEY THAT SIGNS IT, VERB BY VERB.
 *
 * `every-verb-that-writes-signs-as-its-agent-and-verify-agrees` enrols the agent in all three
 * trees under one name, so a verb that asked for the key of the WRONG tree (the committed one,
 * say, whatever its `--scope` was) signs the same and passes. Here the agent `ci` is enrolled in
 * ONE tree at a time, with the person's key still on the machine, and each verb that takes a
 * `--scope` (or follows the tree of the entity it acts on) is run once into each of the three
 * trees, as `MNEMA_AGENT_KEY=ci` with `--which bot`:
 *   - into the tree that enrols the agent, the fact is signed by the agent and names `ci`, the
 *     record's name, whatever `--which` said;
 *   - into either of the others, the person's key signs it and the name is the declared `bot`.
 * A verb that reads the committed tree's standing for a fact it writes elsewhere (or the other
 * way round) is the one the values below disagree with. `verify` and `verify --global` still pass.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CatalogEvent, catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import { deferredWrite, enrollAgentFromRequest } from '@mnema/core/write';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/program.js';

const AGENT = 'MNEMA_AGENT_KEY';
const PASSPHRASE = 'MNEMA_KEY_PASSPHRASE';
const STACK = join(import.meta.dirname, '..', '..', 'stacks', 'examples', 'evidence-first');

type Scope = 'public' | 'private' | 'global';
const SCOPES: readonly Scope[] = ['public', 'private', 'global'];

interface Said {
  readonly out: string;
  readonly err: string;
  readonly failed: boolean;
}

/** One verb that writes where its scope says: `argv` into the tree `into`, as the agent. */
interface Case {
  readonly verb: string;
  readonly argv: (into: Scope, ids: Ids) => readonly string[];
  /** The trees it can write into, where it is not all three. */
  readonly into?: readonly Scope[];
  /** Whether the verb is given `--which bot`, which it takes. */
  readonly named?: boolean;
}

type Ids = Readonly<Record<string, string>>;

const named = (...argv: string[]): string[] => [...argv, '--which', 'bot'];

/** What each verb is asked, with the entity of the tree it is to land in where it follows one. */
const CASES: readonly Case[] = [
  {
    verb: 'decision record',
    argv: (s) => named('decision', 'record', `New in ${s}`, 'why', '--scope', s),
  },
  {
    verb: 'decision import',
    into: ['public', 'private'],
    argv: (s) => named('decision', 'import', `adr-${s}`, '--write', '--scope', s),
  },
  {
    verb: 'decision move',
    argv: (s, ids) =>
      named('decision', 'move', 'accept', ids[`d1-${s}`] as string, '--note', 'agreed'),
  },
  { verb: 'task create', argv: (s) => named('task', 'create', `New task in ${s}`, '--scope', s) },
  {
    verb: 'task move',
    argv: (s, ids) => named('task', 'move', 'submit', ids[`t1-${s}`] as string),
  },
  {
    verb: 'task handoff',
    argv: (s, ids) =>
      named('task', 'handoff', ids[`t2-${s}`] as string, 'ci', 'someone', '--scope', s),
  },
  {
    verb: 'skill create',
    argv: (s) => named('skill', 'create', `New skill in ${s}`, '--body', 'b', '--scope', s),
  },
  {
    verb: 'skill move',
    argv: (s, ids) => named('skill', 'move', 'review', ids[`k1-${s}`] as string, '--note', 'read'),
  },
  { verb: 'memory', argv: (s) => named('memory', `A note in ${s}`, '--scope', s) },
  {
    verb: 'retract',
    argv: (s, ids) => named('retract', ids[`m1-${s}`] as string, '--reason', 'r'),
  },
  {
    verb: 'observe',
    argv: (s, ids) =>
      named('observe', ids[`d2-${s}`] as string, '--topic', 't', '--text', 'seen', '--scope', s),
  },
  {
    verb: 'link',
    argv: (s, ids) =>
      named(
        'link',
        ids[`d3-${s}`] as string,
        ids[`d4-${s}`] as string,
        '--rel',
        'relates-to',
        '--scope',
        s,
      ),
  },
  {
    verb: 'unlink',
    argv: (s, ids) =>
      named(
        'unlink',
        ids[`d5-${s}`] as string,
        ids[`d6-${s}`] as string,
        '--rel',
        'relates-to',
        '--reason',
        'r',
      ),
  },
  { verb: 'switch', argv: (s) => named('switch', 'off', 'edit-asks-a-person', '--scope', s) },
  {
    verb: 'stack add',
    named: false,
    argv: (s, ids) => [
      'stack',
      'add',
      STACK,
      '--scope',
      s,
      '--expect',
      ids[`digest-${s}`] as string,
    ],
  },
  {
    verb: 'stack remove',
    named: false,
    argv: (s) => ['stack', 'remove', 'evidence-first', '--scope', s],
  },
];

const uuidIn = (text: string): string => {
  const found = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
  if (found === undefined) throw new Error(`setup: no id in ${text}`);
  return found;
};

describe.each(SCOPES)('the agent is enrolled in the %s tree alone', (enrolledIn) => {
  let sandbox: string;
  let home: string;
  let repo: string;
  let env: DiscoveryEnv;
  let originalCwd: string;
  let agentFp: string;
  let personFp: string;
  const ids: Record<string, string> = {};
  const seen = new Set<string>();
  const saved: Record<string, string | undefined> = {};

  async function mnema(agent: string | undefined, ...argv: string[]): Promise<Said> {
    const out: string[] = [];
    const err: string[] = [];
    let failed = false;
    const io: CliIo = {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      fail: () => {
        failed = true;
      },
    };
    if (agent === undefined) delete process.env[AGENT];
    else process.env[AGENT] = agent;
    try {
      await run(argv, io);
    } finally {
      delete process.env[AGENT];
    }
    return { out: out.join('\n'), err: err.join('\n'), failed };
  }

  /** Setup, as the person: it must succeed. */
  async function did(...argv: string[]): Promise<string> {
    const said = await mnema(undefined, ...argv);
    expect(said.failed, `${argv.join(' ')}: ${said.out}${said.err}`).toBe(false);
    return said.out;
  }

  const rootOf = (scope: Scope): string | undefined => {
    const trees = resolveTrees(repo, env);
    return scope === 'public'
      ? trees.projectPublic
      : scope === 'private'
        ? trees.projectPrivate
        : trees.global;
  };

  function eventsIn(scope: Scope): CatalogEvent[] {
    const root = rootOf(scope);
    return root === undefined || !existsSync(root)
      ? []
      : orderedEvents({ root }, catalogUpcasters());
  }

  /** What was appended since the last call, with the tree it went to. */
  function appended(): { scope: Scope; event: CatalogEvent }[] {
    const fresh: { scope: Scope; event: CatalogEvent }[] = [];
    for (const scope of SCOPES) {
      for (const event of eventsIn(scope)) {
        const key = `${scope}:${JSON.stringify(event)}`;
        if (!seen.has(key)) {
          seen.add(key);
          fresh.push({ scope, event });
        }
      }
    }
    return fresh;
  }

  beforeAll(async () => {
    sandbox = mkdtempSync(join(tmpdir(), 'mnema-scope-key-'));
    home = join(sandbox, 'home');
    repo = join(sandbox, 'repo');
    mkdirSync(home, { recursive: true });
    for (const s of ['public', 'private']) mkdirSync(join(repo, `adr-${s}`), { recursive: true });
    originalCwd = process.cwd();
    for (const name of ['HOME', 'XDG_DATA_HOME', 'MNEMA_HOME', 'MNEMA_RUN', AGENT, PASSPHRASE]) {
      saved[name] = process.env[name];
    }
    process.env.HOME = home;
    process.env.XDG_DATA_HOME = join(sandbox, 'data');
    for (const name of ['MNEMA_HOME', 'MNEMA_RUN', AGENT, PASSPHRASE]) delete process.env[name];
    env = { home };
    process.chdir(repo);
    for (const s of ['public', 'private']) {
      writeFileSync(
        join(repo, `adr-${s}`, '0001-use-x.md'),
        `# 1. Use X in ${s}\n\n## Status\n\nAccepted\n\n## Context\n\nWe need X.\n\n## Decision\n\nUse X.\n`,
      );
    }

    await did('init');
    for (const s of SCOPES) {
      for (const n of ['d1', 'd2', 'd3', 'd4', 'd5', 'd6']) {
        ids[`${n}-${s}`] = uuidIn(
          await did('decision', 'record', `Seed ${n} ${s}`, 'because', '--scope', s),
        );
      }
      for (const n of ['t1', 't2']) {
        ids[`${n}-${s}`] = uuidIn(await did('task', 'create', `Seed ${n} ${s}`, '--scope', s));
      }
      ids[`k1-${s}`] = uuidIn(
        await did('skill', 'create', `Seed skill ${s}`, '--body', 'b', '--scope', s),
      );
      ids[`m1-${s}`] = uuidIn(await did('memory', `Seed note ${s}`, '--scope', s));
      await did(
        'link',
        ids[`d5-${s}`] as string,
        ids[`d6-${s}`] as string,
        '--rel',
        'relates-to',
        '--scope',
        s,
      );
    }
    for (const s of SCOPES) {
      ids[`digest-${s}`] = (await did('stack', 'add', STACK, '--scope', s, '--dry-run')).match(
        /digest\s+([0-9a-f]{64})/,
      )?.[1] as string;
    }

    const anchor = (await did('audit', 'accountability')).match(/mnid:[0-9a-f]{8}/)?.[0] as string;
    const requested = await did('key', 'request', '--agent', 'ci', '--anchor', anchor);
    const line = requested.split('\n').find((one) => one.startsWith('mnema-agent-request:1:'));
    agentFp = requested.match(/\b[0-9a-f]{64}\b/)?.[0] as string;
    const write = deferredWrite(resolveTrees(repo, env), enrolledIn);
    const done = enrollAgentFromRequest(write, { request: line as string });
    expect(done.ok, JSON.stringify(done)).toBe(true);
    write.checkpoint();
    personFp = eventsIn('public').find((e) => e.kind === 'identity.founded')?.signerFp as string;
    appended();
  }, 240_000);

  afterAll(() => {
    process.chdir(originalCwd);
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(sandbox, { recursive: true, force: true });
  });

  for (const into of SCOPES) {
    for (const one of CASES) {
      if (one.into !== undefined && !one.into.includes(into)) continue;
      const signs = into === enrolledIn ? 'the agent, as ci' : 'the person, as bot';
      it(`${one.verb} into the ${into} tree is signed by ${signs}`, async () => {
        const said = await mnema('ci', ...one.argv(into, ids));
        expect(said.failed, `${said.out}${said.err}`).toBe(false);

        const fresh = appended();
        expect(fresh.length, 'it wrote nothing').toBeGreaterThan(0);
        const agentSigns = into === enrolledIn;
        for (const { scope, event } of fresh) {
          expect(
            { kind: event.kind, tree: scope, which: event.which, signer: event.signerFp },
            `${one.verb} -> ${into}`,
          ).toEqual({
            kind: event.kind,
            tree: into,
            // `stack` takes no --which: where the person signs, the name is the one the variable asked for.
            which: agentSigns ? 'ci' : one.named === false ? 'ci' : 'bot',
            signer: agentSigns ? agentFp : personFp,
          });
        }
        if (agentSigns && one.named !== false)
          expect(said.err).toContain('--which "bot" was ignored');
        else expect(said.err).not.toContain('was ignored');
      });
    }
  }

  it('leaves a record `verify` accepts, in the project and in the machine’s tree', async () => {
    for (const argv of [['verify'], ['verify', '--global']]) {
      const checked = await mnema(undefined, ...argv);
      expect(checked.failed, `${argv.join(' ')}: ${checked.out}${checked.err}`).toBe(false);
    }
  });
});
