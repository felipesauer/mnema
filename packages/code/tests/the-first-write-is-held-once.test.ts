/**
 * The first write is held once: with `edit-first-write-gate` switched on, the first write of a
 * session to a file a rule addresses is refused with the rules in the reason, so they arrive before
 * the write instead of beside its result — and the same write, repeated, goes through.
 *
 * WHAT IS HELD HERE. The product's half: that the channel is OFF until a tree switches it on (and
 * says so where switches are listed), that the hold is once per path per connection, that the
 * refusal cites each rule as a fact of the record before it is made, that a person already asked
 * is asked and not refused, and that nothing is said where no rule addresses the path. That the
 * host refuses a write on `deny` and hands the reason to the model was measured, and is not asserted here.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type CatalogEvent, catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ourWordsInTheHold } from '../src/edit-rules-push.js';
import { openSession, type Session } from '../src/mcp/session.js';
import { runRulesBeforeAnEditTool } from '../src/mcp/tools.js';
import { type CliIo, run } from '../src/program.js';
import { STARTS_OFF, tellsWhatToDo } from '../src/record-framing.js';

const GATE = 'edit-first-write-gate';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;

/** Runs `mnema <argv>` in process; `failed` says whether it asked for a non-zero exit. */
async function mnema(
  ...argv: string[]
): Promise<{ out: string[]; err: string[]; failed: boolean }> {
  const seen = { out: [] as string[], err: [] as string[], failed: false };
  const io: CliIo = {
    out: (line) => seen.out.push(line),
    err: (line) => seen.err.push(line),
    fail: () => {
      seen.failed = true;
    },
  };
  await run(argv, io);
  return seen;
}

/** Runs a verb and refuses to continue if it was refused — setup, not assertion. */
async function did(...argv: string[]): Promise<string> {
  const seen = await mnema(...argv);
  expect(seen.failed, `${argv.join(' ')}: ${seen.err.join(' / ')}`).toBe(false);
  return seen.out.join('\n');
}

/** A decision in force, linked to a path with a relation. */
async function ruleAt(title: string, path: string, rel: string): Promise<string> {
  const said = await did('decision', 'record', title, `why ${title}`);
  const id = said.match(/\(([0-9a-f-]{20,})\)/)?.[1] as string;
  await did('decision', 'move', 'accept', id, '--note', 'agreed');
  await did('link', id, path, '--rel', rel);
  return id;
}

/** An agent connection over this project: one connection is one session. */
function connect(): Session {
  return openSession({ clientName: 'agent-alpha', roots: [pathToFileURL(repo).href], env });
}

/** What the tool answers for a path, as the host parses it. */
function answer(
  session: Session,
  path: string,
): {
  context?: string;
  decision?: string;
  reason?: string;
  empty: boolean;
} {
  const result = runRulesBeforeAnEditTool(session, { path });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  const reply = JSON.parse(JSON.stringify(result.value)) as {
    hookSpecificOutput?: {
      additionalContext?: string;
      permissionDecision?: string;
      permissionDecisionReason?: string;
    };
  };
  const said = reply.hookSpecificOutput;
  return {
    empty: said === undefined,
    ...(said?.additionalContext !== undefined ? { context: said.additionalContext } : {}),
    ...(said?.permissionDecision !== undefined ? { decision: said.permissionDecision } : {}),
    ...(said?.permissionDecisionReason !== undefined
      ? { reason: said.permissionDecisionReason }
      : {}),
  };
}

/** Every event of the public tree. */
function publicEvents(): CatalogEvent[] {
  return orderedEvents(
    { root: resolveTrees(repo, env).projectPublic as string },
    catalogUpcasters(),
  );
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-first-write-'));
  repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'src', 'billing'), { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  originalXdg = process.env.XDG_DATA_HOME;
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  env = { home: join(sandbox, 'home') };
  process.chdir(repo);
  await did('init');
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the channel starts off, and says so', () => {
  it('is one of the channels that begin off, and the listing says nobody switched it on', async () => {
    expect(STARTS_OFF).toEqual([GATE, 'user-corrections']);
    const listed = (await did('switch')).split('\n').find((line) => line.includes(GATE)) ?? '';
    expect(listed).toContain(' off ');
    expect(listed).toContain('off until switched on, and nobody has');
    // Every other channel is still on, with no attribution beside it.
    const others = (await did('switch'))
      .split('\n')
      .filter((line) => /^ {2}[a-z]/.test(line) && !STARTS_OFF.some((name) => line.includes(name)));
    expect(others.length).toBeGreaterThan(4);
    for (const line of others) expect(line, line).toMatch(/^ {2}\S+ +on /);
  });

  it('does nothing while it is off: the write is not held and the rules arrive beside it', async () => {
    await ruleAt('Round money at the boundary', 'src/billing', 'governs');
    const first = answer(connect(), 'src/billing/invoice.ts');
    expect(first.decision).toBeUndefined();
    expect(first.context).toContain('Round money at the boundary');
  });

  it('is switched on by a fact, and the switch says what it now does', async () => {
    const said = await did('switch', 'on', GATE);
    expect(said).toContain(`Switched ${GATE} on`);
    expect(said).toContain(`${GATE} is now ON: it was off until this switch`);
    const listed = (await did('switch')).split('\n').find((line) => line.includes(GATE)) ?? '';
    expect(listed).toContain(' on ');
    // And switching it off again is a fact too: off wins, as it does for every channel.
    await did('switch', 'off', GATE, '--reason', 'not while I port this');
    expect((await did('switch')).split('\n').find((line) => line.includes(GATE))).toContain(
      'switched off by',
    );
  });
});

describe('the first write to a file a rule addresses is held once', () => {
  beforeEach(async () => {
    await did('switch', 'on', GATE);
  });

  it('refuses it with the rules in the reason, and carries them nowhere else', async () => {
    const id = await ruleAt('Round money at the boundary', 'src/billing', 'governs');
    const held = answer(connect(), 'src/billing/invoice.ts');
    expect(held.decision).toBe('deny');
    expect(held.reason).toContain(
      'The first write to src/billing/invoice.ts in this session was held, so that the rules addressed at it arrive before it.',
    );
    expect(held.reason).toContain('The same write, repeated, goes through.');
    expect(held.reason).toContain('Round money at the boundary');
    expect(held.reason).toContain(id);
    // The rules are in the refusal and not also beside it.
    expect(held.context).toBeUndefined();
  });

  it('lets the same write through the second time, with the rules beside it as ever', async () => {
    await ruleAt('Round money at the boundary', 'src/billing', 'governs');
    const session = connect();
    expect(answer(session, 'src/billing/invoice.ts').decision).toBe('deny');
    const again = answer(session, 'src/billing/invoice.ts');
    expect(again.decision).toBeUndefined();
    expect(again.context).toContain('Round money at the boundary');
    // Another file under the same rule is another first write.
    expect(answer(session, 'src/billing/refund.ts').decision).toBe('deny');
    // And another connection is another session.
    expect(answer(connect(), 'src/billing/invoice.ts').decision).toBe('deny');
  });

  it('says nothing for a file no rule addresses, and holds nothing', async () => {
    await ruleAt('Round money at the boundary', 'src/billing', 'governs');
    expect(answer(connect(), 'src/elsewhere.ts')).toEqual({ empty: true });
  });

  it('holds a write through a link to a held path as it holds the direct one', async () => {
    await ruleAt('Round money at the boundary', 'src/billing', 'governs');
    symlinkSync(join(repo, 'src', 'billing'), join(repo, 'src', 'alias'));
    const direct = answer(connect(), 'src/billing/invoice.ts');
    const linked = answer(connect(), 'src/alias/invoice.ts');
    expect(direct.decision).toBe('deny');
    expect(linked.decision).toBe('deny');
    expect(linked.reason).toContain('Round money at the boundary');
  });

  it('asks a person where a rule asks, and does not also refuse', async () => {
    await ruleAt('Nobody touches billing alone', 'src/billing', 'asks-for-a-person');
    const asked = answer(connect(), 'src/billing/invoice.ts');
    expect(asked.decision).toBe('ask');
  });

  it('cites each rule as a fact before it refuses, and counts the service once per run', async () => {
    const id = await ruleAt('Round money at the boundary', 'src/billing', 'governs');
    const session = connect();
    answer(session, 'src/billing/invoice.ts');
    answer(session, 'src/billing/refund.ts');
    const asked = publicEvents().filter(
      (event): event is Extract<CatalogEvent, { kind: 'channel.asked' }> =>
        event.kind === 'channel.asked' && event.subject === GATE,
    );
    expect(asked.map((event) => `${event.payload.rule} @ ${event.payload.path}`)).toEqual([
      `${id} @ src/billing/invoice.ts`,
      `${id} @ src/billing/refund.ts`,
    ]);
    const served = publicEvents().filter(
      (event) => event.kind === 'channel.served' && event.subject === GATE,
    );
    expect(served).toHaveLength(1);
  });

  it('stops holding the moment it is switched off', async () => {
    await ruleAt('Round money at the boundary', 'src/billing', 'governs');
    await did('switch', 'off', GATE);
    expect(answer(connect(), 'src/billing/invoice.ts').decision).toBeUndefined();
  });

  it('says what it says as facts, never as an order', async () => {
    const id = await ruleAt('Round money at the boundary', 'src/billing', 'governs');
    const at = {
      path: 'src/billing/invoice.ts',
      relative: 'src/billing/invoice.ts',
      rules: [{ id, name: 'x', address: 'src/billing', travels: true }],
    };
    const words = ourWordsInTheHold(at as never);
    expect(words).toHaveLength(1);
    expect(tellsWhatToDo(words.join(' '))).toBeUndefined();
  });
});
