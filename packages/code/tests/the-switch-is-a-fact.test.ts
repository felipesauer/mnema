/**
 * THE SWITCH IS A FACT: somebody turned off what this product pushes, and the record says
 * who, when and what.
 *
 * WHAT THIS SLICE IS FOR, and it arrives after the surface that needs it. The tie reads:
 * every charge mnema makes is switchable, and the switching is RECORDED — switching off is
 * legitimate, switching off in SILENCE is not. Two channels push text at a model without
 * anybody asking (the document a session opens with, the rules handed over as a file is
 * written) and until this slice there was no way to stop either short of uninstalling the
 * plugin. That is a debt, not a design, and this is it paid.
 *
 * WHY A FACT AND NOT A SETTING, since that is the decision everything else follows from. A
 * configuration file answers "can I turn it off" and defeats the second half of the tie:
 * nothing attributes it, nothing dates it, it does not travel, and a reader of the record
 * can never tell "no rule addressed that file" from "somebody had turned the push off that
 * week". As an event it inherits the whole envelope — the authorizing `who`, the executing
 * `which`, the run, the instant, the signature, the chain link — and it inherits the SCOPE,
 * which is what makes a switch that travels with the repository and a switch kept on one
 * machine the same mechanism in two trees.
 *
 * THE FOUR THINGS ASSERTED HERE, and each fails in its own direction:
 *
 *   - THE FACT. A switch is one `channel.switched` whose subject is the channel, attributed
 *     and dated, and it lands in the tree the KIND decides — public, so the team reads it.
 *   - THE EFFECT. The channel stops. The push replies with the same empty object it replies
 *     with when no rule addresses the path, and `mnema brief` refuses instead of printing an
 *     empty document — which is what makes the plugin's handler silent by the rule it
 *     already had.
 *   - THE HONESTY. A silence that means "switched off" says so where a silence can be paid
 *     for once: the document a session opens with. Without this half the slice would open a
 *     hole rather than close one — three different silences in one channel.
 *   - THE DEFAULT. Nothing arrives switched off, and there is no birth event to make it so.
 *
 * WHAT IS TOTAL AND WHAT IS A LIST. The set of switchable channels is derived from the union
 * of channels this surface pushes (`record-framing.ts`), and {@link HONOURED} is reconciled
 * against it at RUN TIME rather than by a type: a mapped type in a test file is not checked
 * by anything (`tsc -b` excludes tests and vitest erases types), so the obligation "every
 * switchable channel has a case here that proves it goes quiet" has to be an assertion.
 *
 * WHAT THIS FILE CANNOT COVER is what its sibling cannot either: the HOST is what dispatches
 * a hook, and no test here makes it do so. The reply's shape is the evidence, and that the
 * host reads that shape was measured against the real binary
 * (`measurements/mcp-tool-channel/`).
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type CatalogEvent, catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { openSession, type Session } from '../src/mcp/session.js';
import { runRulesBeforeAnEditTool } from '../src/mcp/tools.js';
import {
  ASKS_A_PERSON_CHANNEL,
  DOCUMENT_CHANNEL,
  EDIT_PUSH_CHANNEL,
  NOT_SWITCHABLE,
  SWITCHABLE_CHANNELS,
  WHAT_STOPS,
} from '../src/record-framing.js';

/** The repository root: `packages/code/tests/` is three levels under it. */
const REPO = fileURLToPath(new URL('../../../', import.meta.url));

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalXdg: string | undefined;
let originalHome: string | undefined;

/** What one invocation wrote, and whether it asked for a non-zero exit. */
interface Said {
  readonly out: string[];
  readonly err: string[];
  readonly failed: boolean;
}

/** Runs `mnema <argv>` the way the binary does. */
async function mnema(...argv: string[]): Promise<Said> {
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
  await run(argv, io);
  return { out, err, failed };
}

/** Runs a verb and refuses to continue if it was refused — the fixture's own floor. */
async function did(...argv: string[]): Promise<Said> {
  const said = await mnema(...argv);
  expect(said.failed, `mnema ${argv.join(' ')}: ${said.err.join(' / ')}`).toBe(false);
  return said;
}

/** The id in the parentheses of an echo — never the leading `ADR-<n>`, which is display. */
function idIn(said: Said): string {
  const id = said.out.join('\n').match(/\(([0-9a-f-]{20,})\)/)?.[1];
  if (id === undefined) throw new Error(`setup: no id in ${said.out.join(' / ')}`);
  return id;
}

/** A decision in force, addressed at a path — the one thing the push has to say. */
async function ruleAddressedAt(title: string, path: string): Promise<string> {
  const id = idIn(await did('decision', title, `why ${title}`));
  await did('decision', 'move', 'accept', id, '--note', 'agreed');
  await did('link', id, path, '--rel', 'governs');
  return id;
}

/** Records a rule in force and links it as ASKING FOR A PERSON at a path. */
async function ruleAskingAt(title: string, path: string): Promise<string> {
  const id = idIn(await did('decision', title, `why ${title}`));
  await did('decision', 'move', 'accept', id, '--note', 'agreed');
  await did('link', id, path, '--rel', 'asks-for-a-person');
  return id;
}

/** An agent connection over this project. */
function connect(): Session {
  return openSession({ clientName: 'agent-alpha', roots: [pathToFileURL(repo).href], env });
}

/**
 * The text the push would inject for a path, or `undefined` when it injects nothing.
 *
 * Through JSON and back, because the host reads the SERIALIZED reply: a field that survived
 * an object and not a serialization would pass here and vanish in the field.
 */
function injected(session: Session, path: string): string | undefined {
  const result = runRulesBeforeAnEditTool(session, { path });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  const reply = JSON.parse(JSON.stringify(result.value)) as {
    hookSpecificOutput?: { hookEventName?: string; additionalContext?: string };
  };
  if (reply.hookSpecificOutput === undefined) return undefined;
  expect(reply.hookSpecificOutput.hookEventName).toBe('PreToolUse');
  return reply.hookSpecificOutput.additionalContext;
}

/**
 * The reason the push would ASK a person with, or `undefined` when it asks nobody.
 *
 * A second reader and not a flag on {@link injected}, because the two channels ride in one
 * reply and a helper that returned "whatever is there" would let a case about the gate pass
 * on the text channel's context.
 */
function asked(session: Session, path: string): string | undefined {
  const result = runRulesBeforeAnEditTool(session, { path });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  const reply = JSON.parse(JSON.stringify(result.value)) as {
    hookSpecificOutput?: {
      hookEventName?: string;
      permissionDecision?: string;
      permissionDecisionReason?: string;
    };
  };
  if (reply.hookSpecificOutput?.permissionDecision === undefined) return undefined;
  expect(reply.hookSpecificOutput.hookEventName).toBe('PreToolUse');
  // The one value this server can send. A reply naming any other is refused by the host's
  // schema and DISCARDS the whole reply, injection included (`measurements/asks-a-person/`).
  expect(reply.hookSpecificOutput.permissionDecision).toBe('ask');
  return reply.hookSpecificOutput.permissionDecisionReason;
}

/** Every event of one of this project's trees, in the tree's own order. */
function eventsIn(scope: 'public' | 'private'): CatalogEvent[] {
  const trees = resolveTrees(repo, env);
  const root = scope === 'public' ? trees.projectPublic : trees.projectPrivate;
  return orderedEvents({ root: root as string }, catalogUpcasters());
}

/** The switch events of a tree. */
function switchesIn(scope: 'public' | 'private'): CatalogEvent[] {
  return eventsIn(scope).filter((event) => event.kind === 'channel.switched');
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-switch-'));
  repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'src', 'billing'), { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  originalCwd = process.cwd();
  originalXdg = process.env.XDG_DATA_HOME;
  originalHome = process.env.HOME;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  process.env.HOME = join(sandbox, 'home');
  delete process.env.MNEMA_RUN;
  env = { home: join(sandbox, 'home'), xdgDataHome: join(sandbox, 'data') };
  process.chdir(repo);
  await did('init');
});

afterEach(() => {
  delete process.env.MNEMA_RUN;
  process.chdir(originalCwd);
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('switching a channel is a fact of the chain', () => {
  it('records one channel.switched whose subject IS the channel, attributed and dated', async () => {
    await did('switch', 'off', EDIT_PUSH_CHANNEL, '--reason', 'noisy while porting');

    const switches = switchesIn('public');
    expect(switches).toHaveLength(1);
    const fact = switches[0] as CatalogEvent & { kind: 'channel.switched' };
    expect(fact.subject).toBe(EDIT_PUSH_CHANNEL);
    expect(fact.payload).toEqual({ on: false, reason: 'noisy while porting' });
    // The whole point of the fact rather than a setting: it is attributed, dated and
    // signed. Nothing here asserts the VALUES — a `who` is derived from a key and an `at`
    // from the clock — only that the fact carries them, which a config file cannot.
    expect(fact.who).toMatch(/^mnid:/);
    expect(fact.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(fact.signerFp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('omits the reason rather than storing a blank one, because a switch never needs one', async () => {
    // The tie asks for the FACT and never for a justification: a product that refused to be
    // switched off until somebody composed prose would be charging for the switch. Absent is
    // how the record says there was none — never an empty string, which the reader refuses.
    await did('switch', 'off', EDIT_PUSH_CHANNEL);
    const fact = switchesIn('public')[0] as CatalogEvent & { kind: 'channel.switched' };
    expect(fact.payload).toEqual({ on: false });
    expect(Object.keys(fact.payload)).toEqual(['on']);
  });

  it('lands in the tree that TRAVELS by default, and in the named one when asked', async () => {
    // The default is the argument a reader comes to this slice to have: a switch nobody but
    // its own machine can read is silent to the team, which would leave the tie holding for
    // one reader. `--scope private` is the switch that means this machine, and it is
    // deliberate rather than the default.
    await did('switch', 'off', EDIT_PUSH_CHANNEL);
    expect(switchesIn('public')).toHaveLength(1);
    expect(switchesIn('private')).toHaveLength(0);

    await did('switch', 'off', DOCUMENT_CHANNEL, '--scope', 'private');
    expect(switchesIn('private')).toHaveLength(1);
    expect(switchesIn('public')).toHaveLength(1);
  });

  it('records the agent that switched it, when an agent is the one driving', async () => {
    await did('switch', 'off', EDIT_PUSH_CHANNEL, '--which', 'agent-alpha');
    const fact = switchesIn('public')[0] as CatalogEvent;
    expect(fact.which).toBe('agent-alpha');
    // And the listing says so, because "an agent turned this off" is the case a person
    // reading their own switches most needs to see.
    const listed = await did('switch');
    expect(listed.out.join('\n')).toContain('switched off by');
  });

  it('refuses a name no channel of this product answers to, before touching a tree', async () => {
    const refused = await mnema('switch', 'off', 'no-such-channel');
    expect(refused.failed).toBe(true);
    expect(refused.err.join('\n')).toContain('mnema pushes no channel by that name');
    // Nothing was written: the check is the surface's and it runs before any writer opens.
    expect(switchesIn('public')).toHaveLength(0);
  });

  it('takes both positions, and the last one is where the channel stands', async () => {
    // There is deliberately no "already off" refusal: the record is a log of what people
    // did, and switching a channel to where it already stands is a person saying so twice.
    await did('switch', 'off', EDIT_PUSH_CHANNEL, '--reason', 'first');
    await did('switch', 'off', EDIT_PUSH_CHANNEL, '--reason', 'again');
    await did('switch', 'on', EDIT_PUSH_CHANNEL);
    expect(switchesIn('public')).toHaveLength(3);
    expect(await standsAt(EDIT_PUSH_CHANNEL)).toBe('on');
  });
});

/** Where a channel stands, read off the listing the way a person reads it. */
async function standsAt(channel: string): Promise<'on' | 'off'> {
  const listed = await did('switch');
  const row = listed.out.find((line) => line.includes(channel));
  if (row === undefined) throw new Error(`no row for ${channel} in ${listed.out.join(' / ')}`);
  return / off /.test(row) ? 'off' : 'on';
}

describe('nothing arrives switched off', () => {
  it('says every channel is on over a record that has never been switched', async () => {
    const listed = await did('switch');
    expect(listed.out[0]).toContain(`${SWITCHABLE_CHANNELS.length} channel(s)`);
    for (const channel of SWITCHABLE_CHANNELS) {
      expect(await standsAt(channel)).toBe('on');
    }
    // And there is no birth event and no seeded row: the absence of a switch IS the on.
    expect(switchesIn('public')).toHaveLength(0);
  });

  it('says where it looked, so everything-on cannot be read as nothing-was-read', async () => {
    // `tails.ts`'s rule, and the reader who most needs it is the one who typed the verb in
    // the wrong directory: a project with no switches and a directory with no project print
    // the same rows otherwise.
    const listed = await did('switch');
    expect(listed.out[0]).toContain('looked in public, private, global');
  });
});

/**
 * How each switchable channel is DRIVEN and what its silence looks like.
 *
 * The keys are reconciled against {@link SWITCHABLE_CHANNELS} at run time, so a channel
 * added to the product's table with no case here is red. It cannot be a mapped type: a type
 * error in a test file leaves both the build and the suite green, so "the compiler catches
 * it" is false for anything that lives in `tests/`.
 */
const HONOURED: Readonly<
  Record<string, { readonly speaks: () => Promise<boolean>; readonly setUp: () => Promise<void> }>
> = {
  [DOCUMENT_CHANNEL]: {
    // The document is the whole of a verb's output, so "does it speak" is "did the verb
    // print one" — and the refusal is what the plugin's handler reads as silence.
    setUp: async () => {
      await did('decision', 'A call the document would carry', 'because it was made');
    },
    speaks: async () => {
      const said = await mnema('brief');
      return !said.failed && said.out.length > 0;
    },
  },
  [EDIT_PUSH_CHANNEL]: {
    setUp: async () => {
      await ruleAddressedAt('Round money at the boundary', 'src/billing');
    },
    speaks: async () => injected(connect(), 'src/billing/invoice.ts') !== undefined,
  },
  [ASKS_A_PERSON_CHANNEL]: {
    // The GATE, driven by the relation that asks rather than the one that governs — which
    // is what keeps this case from passing on the strength of the other channel's switch.
    setUp: async () => {
      await ruleAskingAt('Nobody touches billing alone', 'src/billing');
    },
    speaks: async () => asked(connect(), 'src/billing/invoice.ts') !== undefined,
  },
};

describe('a channel that is switched off stops', () => {
  it('has a case for every channel the product says is switchable, and no other', () => {
    // The non-vacuity of the sweep below, in both directions: a channel with no case would
    // be a channel this file never drove, and a case for one that stopped being switchable
    // would be a fossil measuring nothing.
    expect(Object.keys(HONOURED).sort()).toEqual([...SWITCHABLE_CHANNELS].sort());
  });

  for (const channel of SWITCHABLE_CHANNELS) {
    it(`goes quiet when ${channel} is switched off, and speaks again when it is on`, async () => {
      const driver = HONOURED[channel] as (typeof HONOURED)[string];
      await driver.setUp();
      // It SPOKE first, which is the half that keeps the rest of the case from being green
      // over a channel that had nothing to say anyway.
      expect(await driver.speaks(), `${channel} said nothing before being switched`).toBe(true);

      await did('switch', 'off', channel, '--reason', 'not while I am porting this');
      expect(await driver.speaks(), `${channel} still speaks while switched off`).toBe(false);

      await did('switch', 'on', channel);
      expect(await driver.speaks(), `${channel} stays quiet after being switched on`).toBe(true);
    });
  }

  it('says WHY every channel it does not switch is not one — one sentence each', () => {
    // The other half of the totality. `Exclude<ModelChannel, SwitchableChannel>` is what
    // makes a channel added to the union fail to COMPILE until it is classified; this is
    // what keeps a classification from being the empty string.
    const unswitchable = Object.entries(NOT_SWITCHABLE);
    expect(unswitchable.length).toBeGreaterThan(0);
    for (const [channel, why] of unswitchable) {
      expect(why.length, channel).toBeGreaterThan(30);
      expect(SWITCHABLE_CHANNELS as readonly string[], channel).not.toContain(channel);
    }
    // And every switchable one says what stops, because a person deciding whether to turn
    // something off has to be told what they are turning off.
    for (const channel of SWITCHABLE_CHANNELS) {
      expect(WHAT_STOPS[channel].length, channel).toBeGreaterThan(30);
    }
  });

  it('answers the push with the SAME empty reply it gives when no rule addresses the path', async () => {
    // The shape matters and not just the absence: the host treats a reply with no
    // `hookSpecificOutput` as no injection and no diagnostic, and any other shape is a
    // diagnostic somebody did not ask for.
    await ruleAddressedAt('Round money at the boundary', 'src/billing');
    await did('switch', 'off', EDIT_PUSH_CHANNEL);
    const result = runRulesBeforeAnEditTool(connect(), { path: 'src/billing/invoice.ts' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value).toEqual({});
    // And it is the same reply a path nothing addresses gets, on a record with the push ON.
    await did('switch', 'on', EDIT_PUSH_CHANNEL);
    const unaddressed = runRulesBeforeAnEditTool(connect(), { path: 'src/elsewhere.ts' });
    expect(unaddressed.ok).toBe(true);
    if (!unaddressed.ok) throw new Error('unreachable');
    expect(unaddressed.value).toEqual({});
  });

  it('refuses `mnema brief` on stderr with a non-zero exit, naming the switch', async () => {
    // NOT an empty document. This verb's output is the whole of a file, so printing nothing
    // would look to `mnema brief > AGENTS.md` like a record with nothing in it and would
    // truncate a governance file the repository holds. A refusal on stderr with a non-zero
    // exit is exactly what the plugin's `SessionStart` handler treats as silence.
    await did('switch', 'off', DOCUMENT_CHANNEL, '--reason', 'we keep AGENTS.md by hand');
    const refused = await mnema('brief');
    expect(refused.failed).toBe(true);
    expect(refused.out).toEqual([]);
    const said = refused.err.join('\n');
    expect(said).toContain(`The ${DOCUMENT_CHANNEL} channel is switched off`);
    expect(said).toContain('switched it off at');
    expect(said).toContain(`mnema switch on ${DOCUMENT_CHANNEL}`);
  });

  it('reaches the OTHER surface as well: a switch is not a fact about the CLI', async () => {
    // The switch is read from the record, so the door a caller came through cannot change
    // the answer. Here the write is the command line's and the reading is the MCP server's,
    // over a session opened after it — which is the pair the plugin actually runs.
    await ruleAddressedAt('Round money at the boundary', 'src/billing');
    await did('switch', 'off', EDIT_PUSH_CHANNEL, '--which', 'agent-alpha');
    expect(injected(connect(), 'src/billing/invoice.ts')).toBeUndefined();
  });
});

describe('a switch of a tree that does not travel still governs this machine', () => {
  it('goes quiet on an OFF recorded privately, over an ON in the committed tree', async () => {
    // OFF WINS, and it is not a preference. There is no total order across trees — an
    // event's `at` is a clock on the machine that wrote it, and two trees share no sequence
    // — so "the most recent switch across the trees" is a comparison of two unordered
    // things, and a product deciding whether to speak by it would decide differently on two
    // machines whose clocks disagree. What is left is a rule that needs no order, and the
    // direction is the one that cannot mislead: a switch somebody flipped that did not take
    // effect is the product ignoring an instruction it recorded.
    await ruleAddressedAt('Round money at the boundary', 'src/billing');
    await did('switch', 'on', EDIT_PUSH_CHANNEL);
    await did('switch', 'off', EDIT_PUSH_CHANNEL, '--scope', 'private');
    expect(injected(connect(), 'src/billing/invoice.ts')).toBeUndefined();
    expect(await standsAt(EDIT_PUSH_CHANNEL)).toBe('off');
  });

  it('says in the listing that such a switch is not committed', async () => {
    // The one place a private switch is ever spelled. The document cannot carry it — it is
    // committed and compared with `diff`, so a fact about one machine in it would make the
    // staleness check report a difference that is not the record's — which is exactly why
    // this row has to say it.
    await did('switch', 'off', EDIT_PUSH_CHANNEL, '--scope', 'private', '--reason', 'my machine');
    const listed = await did('switch');
    const row = listed.out.find((line) => line.includes(EDIT_PUSH_CHANNEL)) ?? '';
    expect(row).toContain('(not committed to this project)');
    expect(row).toContain('my machine');
  });

  it('does not say it of a switch that DOES travel', async () => {
    // The non-vacuity of the line above: a report that printed the note either way would
    // pass the case above and tell every reader their team's switch is private.
    await did('switch', 'off', EDIT_PUSH_CHANNEL, '--reason', 'the team agreed');
    const listed = await did('switch');
    const row = listed.out.find((line) => line.includes(EDIT_PUSH_CHANNEL)) ?? '';
    expect(row).toContain('the team agreed');
    expect(row).not.toContain('not committed');
  });
});

describe('the document says when the push is switched off', () => {
  /** The document `mnema brief` prints, as lines. */
  async function document(): Promise<string[]> {
    return (await did('brief')).out.flatMap((line) => line.split('\n'));
  }

  it('replaces the sentence about what arrives, and names who switched it', async () => {
    // THE HALF WITHOUT WHICH THIS SLICE OPENS A HOLE. The document explains a silence: the
    // reader is told how many rules have an address, so nothing arriving at an edit reads as
    // "none of them names this file". A switched-off push produces the identical silence and
    // means something else, so the claim about what arrives is REPLACED rather than decorated
    // — a document carrying both sentences would leave a model to pick.
    await ruleAddressedAt('Round money at the boundary', 'src/billing');
    const on = await document();
    expect(on.join('\n')).toContain('the rules');
    expect(on.some((line) => line.includes('arrive on their own'))).toBe(true);

    await did('switch', 'off', EDIT_PUSH_CHANNEL, '--reason', 'noisy');
    const off = await document();
    expect(off.some((line) => line.includes('arrive on their own'))).toBe(false);
    const text = off.join('\n');
    expect(text).toContain('NOTHING of them arrives when a file is about');
    expect(text).toContain(`to be changed: ${EDIT_PUSH_CHANNEL} was switched off by`);
    expect(text).toContain('Run `mnema switch` for where every switch stands.');
    // The COUNT stays, and that is deliberate: it is still a fact about the rules below, and
    // it is what a person needs to know what switching the push back on would do.
    expect(text).toContain('of the rules below');
  });

  it('prints the bytes it printed before, for a project nobody switched', async () => {
    // The other half, and it is what keeps this slice from making every committed AGENTS.md
    // in the world stale. The document is compared with `mnema brief | diff - AGENTS.md`, so
    // a byte that moved for a record that did not change would turn that signal into noise.
    // The line is wrapped at exactly the column it was wrapped at before the switch existed.
    await ruleAddressedAt('Round money at the boundary', 'src/billing');
    const printed = await document();
    expect(printed).toContain(
      'repository, recorded beside the rule. When a file is about to be changed, the rules',
    );
    expect(printed).toContain(
      'addressed at it arrive on their own, and nothing arrives for a file none of them names.',
    );
  });

  it('cannot report a switch recorded privately, and this is the hole it leaves', async () => {
    // SAID OUT LOUD BECAUSE THE GUARD CANNOT SAY IT. The document carries the committed
    // record — every private rule is absent from it for the same reason, declared to the
    // reader in the same words — so a switch kept on one machine is invisible here while it
    // silences the push on that machine. The third silence ("the hook did not run") stays
    // open with it. Closing either would put a fact about ONE MACHINE into a file that is
    // committed and compared with `diff`.
    await ruleAddressedAt('Round money at the boundary', 'src/billing');
    await did('switch', 'off', EDIT_PUSH_CHANNEL, '--scope', 'private');
    // The push really is off on this machine…
    expect(injected(connect(), 'src/billing/invoice.ts')).toBeUndefined();
    // …and the document still says the rules arrive. This is the finding, asserted so that
    // the day it is closed this case goes red and the paragraph above is rewritten rather
    // than left standing over a product that moved on.
    const printed = await document();
    expect(printed.some((line) => line.includes('arrive on their own'))).toBe(true);
    // What a reader DOES have is the listing, which spans every tree.
    expect(await standsAt(EDIT_PUSH_CHANNEL)).toBe('off');
  });
});

describe('a reading already counts the window the switch was off for', () => {
  it('answers `timeline <channel>` with every switch, who made it and when', async () => {
    // THE DECISION THIS SLICE HAD TO TAKE, and the answer is that it was already taken. The
    // question was whether a reading that counts what governed a period of work should say
    // the push was off over it — and whether that needs a reading of its own. It does not:
    // a switch is a FACT whose SUBJECT is the channel, so the history reading that walks a
    // subject's events answers it with nothing added, over the union of trees, in the order
    // the record holds. That is the whole argument for a fact over a setting, arriving as a
    // property rather than as a feature.
    //
    // What the READINGS THAT COUNT RULES do is unchanged, and deliberately: `mnema rules`
    // and `governing_rules` answer which rules govern a path, and that answer is the same
    // whether or not the product is pushing it at anybody. `verify` is untouched — a switch
    // is a fact like any other and the proof covers it without a field or a level of its
    // own.
    await did('switch', 'off', EDIT_PUSH_CHANNEL, '--reason', 'the porting week');
    await did('switch', 'on', EDIT_PUSH_CHANNEL);

    const history = (await did('timeline', EDIT_PUSH_CHANNEL)).out.flatMap((line) =>
      line.split('\n'),
    );
    const text = history.join('\n');
    expect(text).toContain(`${EDIT_PUSH_CHANNEL} — 2 event(s)`);
    expect(history.filter((line) => line.includes('channel.switched'))).toHaveLength(2);
    // Attributed and dated on every row, which is what makes the window readable: an
    // instant, the kind, the role the channel appears by, and the anchor that authorized it.
    for (const row of history.filter((line) => line.includes('channel.switched'))) {
      expect(row).toMatch(/^\s+\d{4}-\d{2}-\d{2}T/);
      expect(row).toContain('[subject]');
      expect(row).toContain('mnid:');
    }
  });

  it('leaves `mnema rules` saying exactly what it said, switched off or not', async () => {
    // The other half, and it is an absence on purpose. What governs a path is a property of
    // the record; whether this product is PUSHING it at a model is not. A reading that
    // changed its answer because a channel was off would be answering a question nobody
    // asked it, and the count it reports would stop being about the record.
    await ruleAddressedAt('Round money at the boundary', 'src/billing');
    const on = await did('rules', 'src/billing/invoice.ts');
    await did('switch', 'off', EDIT_PUSH_CHANNEL);
    const off = await did('rules', 'src/billing/invoice.ts');
    expect(off.out).toEqual(on.out);
  });
});

describe('the door is the command line’s alone', () => {
  it('serves no MCP tool that switches a channel', () => {
    // NOT a claim that it cannot be done: anyone who can write to the record can append any
    // fact, and a switch appended some other way is a signed fact pointing at whoever
    // appended it. It is a claim about which doors this product OPENS — the same one `tail
    // prune` makes, and here the reason is sharper: an agent that could switch off what
    // governs its own work through the door built for agents would be an agent that opts
    // out of the record.
    //
    // Read off the SERVER ITSELF, which now answers what it registered: every tool is
    // hung with a declaration of what it can do to the record, and those declarations
    // travel back (`mcp/server.ts`). THIS USED TO MATCH THE SOURCE TEXT for
    // `server.registerTool(\n    '<name>'`, and the registration shape changed under it —
    // caught only because the count below is asserted, which is the whole argument for
    // asserting it. A pattern over somebody's formatting is not an enumeration.
    const { tools } = buildMcpServer({ env, log: () => undefined });
    const registered = tools.map((tool) => tool.act);
    // Non-vacuity first: a list that came back empty would make the absence below free.
    expect(registered.length).toBeGreaterThan(20);
    expect(registered).toContain('rules_before_an_edit');
    expect(registered.filter((name) => /switch/.test(name))).toEqual([]);
    const source = readFileSync(join(REPO, 'packages', 'code', 'src', 'mcp', 'server.ts'), 'utf-8');
    // And the writing surface of the core does export the operation, so the absence above is
    // a door this product declined to open rather than a capability it does not have.
    expect(source).not.toContain('switchChannel');
  });
});
