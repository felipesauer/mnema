/**
 * The rule reaches the writing: the first thing this product pushes at a model that is not
 * the opening document. It reaches it BESIDE THE RESULT of the write that fired the hook —
 * in time for every edit after it and for a correction of that one, and not for the bytes of
 * that first write. This sentence used to say "the rule reaches the moment the code is
 * written", and the host falsified it: the request it sends after the write carries the text
 * after that write's result, measured on 2.1.228 and again on 2.1.281. Nothing below can hold that either way, for the reason
 * the next paragraph gives.
 *
 * WHAT IS PROVED HERE AND WHAT CANNOT BE. The host is what dispatches the hook, and no
 * test in this repository can make it do so — so the assertions below stop exactly where
 * the product's reach stops. They cover: what the tool hands back, in the shape the host
 * parses; which rules reach it and which are held out; that a title holding a newline
 * cannot forge a second rule; that the silence is silence and not an error; and that the
 * two files the plugin ships AGREE about the server the hook names. What they cannot
 * cover — that the host calls the tool at all, and that what it returns arrives in the
 * session, and where — was measured instead, against the real binary (on 2026-08-19, and for where the
 * text lands, on the host installed on 29 Sep 2026), and the captures are not held by a file
 * of this tree. A hook only
 * the host dispatches is not testable in CI, and saying so is part of the delivery.
 *
 * THE NAME OF THE SERVER IS THE MOST FRAGILE THING IN THIS SLICE, and it gets a case of
 * its own for that reason. A hook naming a server the host does not know is not an
 * error: the tool is never called, nothing is injected, and the session proceeds exactly
 * as if the plugin were not installed — read on Claude Code 2.1.228, against five spellings. The name the host answers to
 * for a server a PLUGIN declares is `plugin:<plugin>:<server>`, which is documented
 * nowhere and was found by asking `claude mcp list`. So the case below rebuilds that name
 * from `plugin.json` and requires `hooks.json` to hold it: renaming the plugin, or its
 * server, is red here rather than silent in the field.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { RulesAtPath } from '@mnema/context';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { editRulesNotice, editRulesTold, ourWordsIn } from '../src/edit-rules-push.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { openSession, type Session } from '../src/mcp/session.js';
import { runGoverningRulesTool, runRulesBeforeAnEditTool } from '../src/mcp/tools.js';
import { HOOK_TEXT_CEILING } from '../src/presentation/within-a-hook.js';
import { type CliIo, run } from '../src/program.js';
import { tellsWhatToDo } from '../src/record-framing.js';

/** The clause that says who accepted a rule — held where the lines say it, ignored where they are not about it. */
const bare = (line: string | undefined): string | undefined =>
  line?.replace(/ · accepted by mnid:[0-9a-f]{8} \(a person\)$/, '');

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

/** The id in the parentheses of an echo — never the leading `ADR-<n>`, which is display. */
function idIn(said: Said): string {
  const id = said.out.join('\n').match(/\(([0-9a-f-]{20,})\)/)?.[1];
  if (id === undefined) throw new Error(`setup: no id in ${said.out.join(' / ')}`);
  return id;
}

/** Records a decision and accepts it, so that it is IN FORCE. */
async function ruleInForce(title: string, ...extra: string[]): Promise<string> {
  const recorded = await mnema('decision', 'record', title, `why ${title}`, ...extra);
  expect(recorded.failed, recorded.err.join(' / ')).toBe(false);
  const id = idIn(recorded);
  const accepted = await mnema('decision', 'move', 'accept', id, '--note', 'agreed');
  expect(accepted.failed, accepted.err.join(' / ')).toBe(false);
  return id;
}

/** Records and adopts a pattern. */
async function patternAdopted(name: string, body: string): Promise<string> {
  const recorded = await mnema('skill', 'create', name, '--body', body);
  expect(recorded.failed, recorded.err.join(' / ')).toBe(false);
  const id = idIn(recorded);
  for (const action of ['review', 'adopt']) {
    const moved = await mnema('skill', 'move', action, id, '--note', 'read it');
    expect(moved.failed, moved.err.join(' / ')).toBe(false);
  }
  return id;
}

/** Gives a rule an address. */
async function addressAt(rule: string, path: string): Promise<void> {
  const linked = await mnema('link', rule, path, '--rel', 'governs');
  expect(linked.failed, linked.err.join(' / ')).toBe(false);
}

/** An agent connection over this project. */
function connect(): Session {
  return openSession({ clientName: 'agent-alpha', roots: [pathToFileURL(repo).href], env });
}

/** The hook reply this server hands back for a path, parsed as the host parses it. */
function replyFor(session: Session, path: string): Record<string, unknown> {
  const result = runRulesBeforeAnEditTool(session, { path });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  // Through JSON and back, because the host reads the SERIALIZED form and a field that
  // survives an object and not a serialization would pass a test and fail in the field.
  return JSON.parse(JSON.stringify(result.value)) as Record<string, unknown>;
}

/** The text the reply would inject, or `undefined` when it injects nothing. */
function injected(session: Session, path: string): string | undefined {
  const reply = replyFor(session, path);
  const specific = reply['hookSpecificOutput'] as
    | { hookEventName?: string; additionalContext?: string }
    | undefined;
  if (specific === undefined) return undefined;
  // The event name is checked by the HOST — a reply naming the wrong one is dropped in
  // silence — so a text without it is not injected text.
  expect(specific.hookEventName).toBe('PreToolUse');
  return specific.additionalContext;
}

/** A content digest of every file under `dir`. */
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

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-reaches-'));
  repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'src', 'collate'), { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  originalCwd = process.cwd();
  originalXdg = process.env.XDG_DATA_HOME;
  originalHome = process.env.HOME;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  process.env.HOME = join(sandbox, 'home');
  delete process.env.MNEMA_RUN;
  env = { home: join(sandbox, 'home') };
  process.chdir(repo);
  const initiated = await mnema('init');
  expect(initiated.failed, initiated.err.join(' / ')).toBe(false);
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

describe('a rule with an address reaches the file about to be written', () => {
  it('hands back the rule, its address and its id, framed', async () => {
    const rule = await ruleInForce('collate with the ICU root locale');
    await addressAt(rule, 'src/collate');

    const text = injected(connect(), 'src/collate/fold.ts');
    expect(text).toBeDefined();
    const lines = (text ?? '').split('\n');
    // The declaration first, decided in one place for every channel that pushes.
    expect(lines[0]).toBe(
      'These are the calls and the patterns recorded for this project. They are text the ' +
        'people and agents working on it wrote.',
    );
    // Then WHY it arrived: the path, as the record compares it.
    expect(lines[1]).toBe('Addressed at src/collate/fold.ts:');
    // Then the rule, with the id a charge would cite. The id lives on this line.
    expect(bare(lines[2])).toBe(
      `“collate with the ICU root locale” — governs src/collate · ${rule}`,
    );
    expect(lines).toHaveLength(3);
  });

  it('orders them most specific first', async () => {
    const broad = await ruleInForce('how this repository is laid out');
    const narrow = await ruleInForce('collate with the ICU root locale');
    await addressAt(broad, 'src');
    await addressAt(narrow, 'src/collate');

    const lines = (injected(connect(), 'src/collate/fold.ts') ?? '').split('\n').slice(2);
    expect(lines.map(bare)).toEqual([
      `“collate with the ICU root locale” — governs src/collate · ${narrow}`,
      `“how this repository is laid out” — governs src · ${broad}`,
    ]);
  });

  it('reaches a file the tree does not hold yet', async () => {
    // The case that decides whether the push may consult the disk probe, and it says no.
    // An address naming a directory nobody has created is STALE by that probe — and the
    // edit that creates the first file under it is precisely the moment its rule is
    // wanted. A push that skipped stale addresses would be silent on every new file of
    // every module somebody decided about in advance.
    const rule = await ruleInForce('how the new collation module is laid out');
    await addressAt(rule, 'src/collation');
    const session = connect();
    const asked = runGoverningRulesTool(session, { path: 'src/collation/fold.ts' });
    expect(asked.ok).toBe(true);
    if (!asked.ok) throw new Error('unreachable');
    // It really is stale, so the case is not green on an address that happens to exist.
    expect(asked.value.counts.stale).toBe(1);
    expect(asked.value.rules[0]?.onDisk).toBe(false);

    const lines = (injected(session, 'src/collation/fold.ts') ?? '').split('\n').slice(2);
    expect(lines.map(bare)).toEqual([
      `“how the new collation module is laid out” — governs src/collation · ${rule}`,
    ]);
  });

  it('carries a pattern as readily as a decision', async () => {
    const pattern = await patternAdopted('small commits', 'keep them small');
    await addressAt(pattern, 'src/collate');
    const lines = (injected(connect(), 'src/collate/fold.ts') ?? '').split('\n').slice(2);
    expect(lines).toEqual([`“small commits” — governs src/collate · ${pattern}`]);
  });

  it('says when one of them is not committed, once and not per rule', async () => {
    const mine = await ruleInForce('a laptop-local convention', '--scope', 'private');
    await addressAt(mine, 'src/collate');
    const text = injected(connect(), 'src/collate/fold.ts') ?? '';
    expect(text).toContain('not committed to this project, so its id is not in a clone of it');
    // And the sentence is said ONCE even with two rules — the non-vacuity for "once and
    // not per rule", without which the case is green on a product that repeats it.
    const ours = await ruleInForce('collate with the ICU root locale');
    await addressAt(ours, 'src/collate/fold.ts');
    const both = injected(connect(), 'src/collate/fold.ts') ?? '';
    expect(both).toContain('not committed');
    expect(both.match(/not committed/g)).toHaveLength(1);
  });
});

describe('what does NOT reach the writing', () => {
  it('is silent when no rule addresses the path', async () => {
    const rule = await ruleInForce('collate with the ICU root locale');
    await addressAt(rule, 'src/collate');
    // The reply is EMPTY rather than a text saying nothing governs — the decision this
    // slice took, with the byte count behind it — and the host treats `{}` as no
    // injection and no diagnostic (measured).
    expect(replyFor(connect(), 'README.md')).toEqual({});
    expect(injected(connect(), 'README.md')).toBeUndefined();
  });

  it('is silent for a sibling whose name merely starts the same', async () => {
    const rule = await ruleInForce('collate with the ICU root locale');
    await addressAt(rule, 'src/collate');
    // The address is a prefix by SEGMENT, and the pushed channel inherits that rather
    // than re-deciding it. A string prefix would push this rule at a file nobody
    // addressed, in the middle of somebody writing it.
    expect(replyFor(connect(), 'src/collate_test.rb')).toEqual({});
  });

  it('holds back a rule that addresses the path but is no longer in force', async () => {
    const old = await ruleInForce('collate byte by byte');
    const replacement = await ruleInForce('collate with the ICU root locale');
    await addressAt(old, 'src/collate');
    await addressAt(replacement, 'src/collate');
    const superseded = await mnema(
      'decision',
      'supersede',
      old,
      replacement,
      '--reason',
      'the locale turned out to matter',
    );
    expect(superseded.failed, superseded.err.join(' / ')).toBe(false);

    const session = connect();
    const lines = (injected(session, 'src/collate/fold.ts') ?? '').split('\n').slice(2);
    expect(lines.map(bare)).toEqual([
      `“collate with the ICU root locale” — governs src/collate · ${replacement}`,
    ]);
    // AND THE RECORD STILL HAS IT. The reading that answers a caller reports the
    // superseded rule with its state, which is what makes the omission above a property
    // of the CHANNEL and not a rule that quietly went missing from the product.
    const asked = runGoverningRulesTool(session, { path: 'src/collate/fold.ts' });
    expect(asked.ok).toBe(true);
    if (!asked.ok) throw new Error('unreachable');
    expect(asked.value.rules.map((one) => one.rule).sort()).toEqual([old, replacement].sort());
    expect(asked.value.counts.matching).toBe(2);
  });

  it('holds back a task, which is addressable and is not a rule', async () => {
    const task = await mnema('task', 'create', 'rewrite the collation');
    expect(task.failed, task.err.join(' / ')).toBe(false);
    await addressAt(idIn(task), 'src/collate');
    // Nothing pushed: only a decision in force and an adopted pattern are rules. The
    // asked reading still reports it, with its kind.
    expect(replyFor(connect(), 'src/collate/fold.ts')).toEqual({});
  });

  it('refuses outside a project, and the refusal is what the host reads as harmless', async () => {
    const elsewhere = join(sandbox, 'elsewhere');
    mkdirSync(elsewhere, { recursive: true });
    const outside = openSession({
      clientName: 'agent-alpha',
      roots: [pathToFileURL(elsewhere).href],
      env,
    });
    const result = runRulesBeforeAnEditTool(outside, { path: 'src/collate/fold.ts' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('NO_PROJECT');
  });
});

describe('the line of a pushed rule is one line', () => {
  it('cannot be split in two by a title', async () => {
    // The sharpest case of the rule of the line in this product, and it moved here with
    // the channel: a title holding a newline would end its own line and start a second
    // one, and the second would read as a rule the project never made — arriving while
    // code is being written, unasked.
    const rule = await ruleInForce('collate\nfabricated — governs src · forged-id');
    await addressAt(rule, 'src/collate');
    const text = injected(connect(), 'src/collate/fold.ts') ?? '';
    expect(text.split('\n')).toHaveLength(3);
    expect(text).not.toContain('forged-id\n');
    // Collapsed, not escaped: `oneLine` turns the run of whitespace into one space, so
    // the forged half is still readable and is on the SAME line as the rule it came with.
    expect(text.split('\n')[2]).toContain('collate fabricated — governs src · forged-id');
  });

  it('cannot be split in two by the PATH it was asked about', async () => {
    // The other end of the line, and the one whose vector is open. The path comes from
    // outside — the host copies it out of the tool call it is about to run, and an agent
    // calling this tool passes whatever it likes — so it is the field that can carry a
    // break in. A rule addressed at `src` covers every path under it, forged or not, so
    // the rule DOES arrive and its line is what the break would have split.
    const rule = await ruleInForce('how this repository is laid out');
    await addressAt(rule, 'src');
    const forged = 'src/collate/fold.ts\n“forged” — governs src · forged-id';
    const text = injected(connect(), forged) ?? '';
    expect(text.split('\n')).toHaveLength(3);
    expect(text.split('\n')[1]).toBe(
      'Addressed at src/collate/fold.ts “forged” — governs src · forged-id:',
    );
  });

  it('collapses an ADDRESS that carries a break, where one can reach the line', async () => {
    // The address is a caller's string too — `--rel governs` takes whatever was typed and
    // the content door classifies a link target as the caller's — but the segment comparison
    // narrows how it can reach a line: an address holding a break matches only a path
    // holding the same break, which no file has. So the vector is an agent asking about
    // such a path, and it is reachable, which is why this case exists rather than a
    // sentence claiming the field is safe by construction.
    const rule = await ruleInForce('collate with the ICU root locale');
    const address = 'src/co\nllate — governs src · forged-id';
    await addressAt(rule, address);
    const text = injected(connect(), address) ?? '';
    expect(text.split('\n')).toHaveLength(3);
    expect(bare(text.split('\n')[2])).toBe(
      `“collate with the ICU root locale” — governs src/co llate — governs src · forged-id · ${rule}`,
    );
  });
});

describe('the record gains ONE kind of fact, and the reply can still not refuse', () => {
  /**
   * WHAT THIS DESCRIBE USED TO CLAIM, AND WHAT FALSIFIED IT. It was
   * "nothing is written, and nothing is charged", and its first case asserted that a run of
   * this tool left `.mnema` byte for byte as it found it. That was true of the grade this
   * channel shipped with and it is false now: a push that recorded nothing left "the rules
   * reached that session" and "the plugin was never installed" as the same nothing, and the
   * fact that separates them (`channel.served`) is appended by the tool that does the
   * pushing.
   *
   * What survives is the half that was never about writing: the reply cannot refuse, cannot
   * allow and cannot rewrite the edit, and none of the three is representable. The cases
   * below are the same two claims with the first one INVERTED rather than deleted — the
   * digest still has to be stable across the second and later calls of a run, which is where
   * the once-per-run rule lives.
   */
  it('appends the service fact ONCE for a run, and nothing on the calls after it', async () => {
    const rule = await ruleInForce('collate with the ICU root locale');
    await addressAt(rule, 'src/collate');
    // The session is opened BEFORE the digest, so what is measured is the TOOL and not
    // the connection: opening one builds projections, and this case is not about that.
    const session = connect();
    const before = digest(join(repo, '.mnema'));
    replyFor(session, 'src/collate/fold.ts');
    const afterFirst = digest(join(repo, '.mnema'));
    // Something WAS written — without this the case below would hold over a tool that
    // still writes nothing, which is the shape this pair replaced.
    expect(afterFirst).not.toBe(before);

    // And then nothing, for the rest of the run, whatever the path: the fact is about the
    // channel and the run, so a second one would be the same sentence signed again — on a
    // path that fires up to 3,424 times in one measured session.
    for (const path of ['src/collate/fold.ts', 'README.md', 'src/collate_test.rb']) {
      replyFor(session, path);
    }
    expect(digest(join(repo, '.mnema'))).toBe(afterFirst);
  });

  it('carries no field that could refuse, allow or rewrite', async () => {
    const rule = await ruleInForce('collate with the ICU root locale');
    await addressAt(rule, 'src/collate');
    const reply = replyFor(connect(), 'src/collate/fold.ts');
    expect(Object.keys(reply)).toEqual(['hookSpecificOutput']);
    // `governs` alone is the INFORMING grade, so nothing here asks: the reply is context and
    // the event name, exactly as it was. What a rule that asks for a person adds, and what
    // the type refuses to let it add, is the charge's own case
    // (`the-record-asks-for-a-person.test.ts`).
    expect(Object.keys(reply['hookSpecificOutput'] as object).sort()).toEqual([
      'additionalContext',
      'hookEventName',
    ]);
  });
});

describe('the plugin names the server the host will answer to', () => {
  it('builds the hook’s server name out of the manifest it ships beside', () => {
    // The failure this prevents is invisible by construction: a hook naming a server the
    // host does not know is never called, injects nothing, and produces no error — so the
    // plugin would look installed and do half of what it says. Read on Claude Code 2.1.228,
    // and the name that works for a server a PLUGIN
    // declares is `plugin:<plugin>:<server>`, which no document states.
    const manifest = JSON.parse(
      readFileSync(join(REPO, 'plugin', '.claude-plugin', 'plugin.json'), 'utf-8'),
    ) as { name: string; mcpServers: Record<string, unknown> };
    const config = JSON.parse(
      readFileSync(join(REPO, 'plugin', 'hooks', 'hooks.json'), 'utf-8'),
    ) as { hooks: Record<string, { hooks: { type: string; server?: string; tool?: string }[] }[]> };

    const servers = Object.keys(manifest.mcpServers);
    expect(servers).toHaveLength(1);
    const expected = `plugin:${manifest.name}:${servers[0]}`;

    const named = Object.values(config.hooks)
      .flatMap((matchers) => matchers.flatMap((matcher) => matcher.hooks))
      .filter((hook) => hook.type === 'mcp_tool')
      .map((hook) => hook.server);
    // At least one, so the case is not green on a plugin that stopped declaring the hook.
    expect(named.length).toBeGreaterThan(0);
    for (const server of named) expect(server).toBe(expected);
  });

  it('calls a tool this server actually registers', async () => {
    // The other half of the pair. A hook naming a tool the server does not have fails the
    // same silent way, and the tool's name is not checked by anything the compiler sees:
    // it is a string in a JSON file.
    const config = JSON.parse(
      readFileSync(join(REPO, 'plugin', 'hooks', 'hooks.json'), 'utf-8'),
    ) as { hooks: Record<string, { hooks: { type: string; tool?: string }[] }[]> };
    const tools = Object.values(config.hooks)
      .flatMap((matchers) => matchers.flatMap((matcher) => matcher.hooks))
      .filter((hook) => hook.type === 'mcp_tool')
      .map((hook) => hook.tool);
    expect(tools).toEqual(['rules_before_an_edit']);
    // Asked of the SERVER, which answers what it registered — every tool travels back
    // with what calling it can do to the record (`mcp/server.ts`). This used to look for
    // `server.registerTool(\n    '<name>'` in the source text, which is a check on
    // somebody's formatting: the registration shape changed and this went red for a
    // reason that had nothing to do with the hook.
    const registered = buildMcpServer({ cwd: sandbox, env, log: () => undefined }).tools.map(
      (one) => one.act,
    );
    expect(registered.length).toBeGreaterThan(20);
    for (const tool of tools) expect(registered).toContain(tool);
  });
  describe('the words this channel writes say what the text is, never what to do', () => {
    // A NOTICE IS TWO VOICES, and only one of them can be held to the tie. The framing,
    // the sentence naming the file and the notice about a rule that does not travel are
    // mnema's; the rule lines carry a name somebody typed into their own record, and a
    // project may well call a decision "Follow the style guide". Scanning those would
    // make this product an opinion about how other people name their rules — the inverse
    // of the tie — so the guard walks `ourWordsIn`, which IS what the notice composes
    // from rather than a list beside it.
    //
    // It exists because a mutation walked through: an imperative planted in the sentence
    // that names the file left the whole suite green once the two shape assertions in the
    // same diff were updated, which is what the author of that sentence would do.
    const withPrivate: RulesAtPath = {
      path: 'src/collate/fold.ts',
      relative: 'src/collate/fold.ts',
      rules: [
        {
          id: 'adr-4',
          name: 'Collate by the record’s order',
          address: 'src/collate',
          travels: true,
        },
        {
          id: 'adr-9',
          name: 'Keep the staging credentials on this machine only',
          address: 'src',
          travels: false,
        },
      ],
    };

    it('carries no directive in any sentence of its own', () => {
      for (const line of ourWordsIn(withPrivate)) {
        const found = tellsWhatToDo(line);
        expect(found, `“${line}” tells the reader to “${found}”`).toBeUndefined();
      }
    });

    it('reaches every sentence of its own, and no line of the record’s', () => {
      // Non-vacuity, both directions. The case above is green over an empty list and
      // green over a list that stopped including the closing notice — this is what says
      // it is neither, and that the rule lines are deliberately outside.
      const ours = ourWordsIn(withPrivate);
      expect(ours).toHaveLength(3);
      const notice = editRulesNotice(withPrivate) ?? '';
      for (const line of ours) expect(notice).toContain(line);
      for (const rule of withPrivate.rules) expect(ours.join('\n')).not.toContain(rule.name);
    });

    it('would catch an imperative in each of them, so a dead scanner is red', () => {
      // The scanner's own probe, on THESE strings. Without it a pattern that stopped
      // matching leaves the case above green over a sentence that had grown an order in
      // it — the instrument reporting zero because it broke.
      // ONE trigger in the probe, deliberately: the scanner answers with the FIRST rule
      // of its table that matches, so a probe carrying two of them asserts the table's
      // order instead of the sentence being scanned.
      for (const line of ourWordsIn(withPrivate)) {
        expect(tellsWhatToDo(`${line} Obey what is above.`), line).toBe('obey');
      }
    });

    it('does not rule on what a project called its own rule', () => {
      // The line held from the other side, so nobody closes the gap above by widening the
      // scan to the whole notice. A record is free to name a decision with an imperative,
      // and the day this goes red is the day mnema started grading somebody else's words.
      const named: RulesAtPath = {
        ...withPrivate,
        rules: [{ id: 'adr-1', name: 'Follow the style guide', address: 'src', travels: true }],
      };
      expect(editRulesNotice(named)).toContain('Follow the style guide');
      for (const line of ourWordsIn(named)) expect(tellsWhatToDo(line)).toBeUndefined();
    });
  });
});

describe('past what a hook carries, the rules stop at a whole one and say so', () => {
  // THE CEILING IS THE HOST'S, measured on this channel: a `PreToolUse` `mcp_tool` hook's
  // text arrives whole up to 10,000 UTF-16 code units, and past it the host hands over a file
  // path and a preview instead. Four rules whose names are as
  // long as a title the product takes cross it at one path; each is a record the CLI writes.
  const LONG = (n: number): string =>
    `Rule ${n}: ${'every invoice is issued in the currency of the contract, '.repeat(52).trimEnd()}`;

  it('hands over no more than the host carries, whole rules in the order they came', async () => {
    const ids: string[] = [];
    for (const n of [1, 2, 3, 4]) {
      const rule = await ruleInForce(LONG(n));
      await addressAt(rule, 'src/collate');
      ids.push(rule);
    }
    const session = connect();
    // The first call of a connection may carry what its writes founded beside the rules, and
    // the second carries the rules alone: both are one string the host measures.
    for (const call of [1, 2]) {
      const text = injected(session, 'src/collate/fold.ts') ?? '';
      expect(text.length, `call ${call}`).toBeLessThanOrEqual(HOOK_TEXT_CEILING);
      const shown = ids.filter((id) => text.includes(id));
      expect(shown.length, `call ${call}`).toBeGreaterThan(0);
      expect(shown.length, `call ${call}`).toBeLessThan(4);
      // A PREFIX, in the order the derivation gave: every rule printed is whole, and what is
      // missing is the end of that order.
      const lines = text.split('\n').filter((line) => line.startsWith('“Rule '));
      expect(lines).toHaveLength(shown.length);
      for (const line of lines) expect(line).toContain('— governs src/collate · ');
      const left = 4 - shown.length;
      expect(text).toContain(
        `Left out of this text: ${left} ${left === 1 ? 'rule' : 'rules'} addressed at this path`,
      );
      expect(text).toContain('`governing_rules` with this path serves every one of them.');
    }
  });

  it('prints the same bytes as before under the ceiling', () => {
    const at: RulesAtPath = {
      path: 'src/collate/fold.ts',
      relative: 'src/collate/fold.ts',
      rules: [
        {
          id: 'adr-4',
          name: 'Collate by the record’s order',
          address: 'src/collate',
          travels: true,
        },
      ],
    };
    const notice = editRulesNotice(at) ?? '';
    expect(notice).not.toContain('Left out of this text');
    expect(notice.split('\n').at(-1)).toBe(
      '“Collate by the record’s order” — governs src/collate · adr-4',
    );
  });

  it('cuts exactly at the ceiling, not a unit before it', () => {
    // The notice's lines are joined with no newline after the last, so a notice of exactly
    // the room is whole and one unit past it is cut.
    const base: RulesAtPath = {
      path: 'src/a.ts',
      relative: 'src/a.ts',
      rules: [
        { id: 'adr-1', name: 'one', address: 'src', travels: true },
        { id: 'adr-2', name: 'two', address: 'src', travels: true },
      ],
    };
    const whole = editRulesNotice(base) ?? '';
    expect(editRulesNotice(base, whole.length)).toBe(whole);
    expect(editRulesNotice(base, whole.length - 1)).not.toBe(whole);
    // The declaration is longer than a short rule, so the unit that cuts one cuts both.
    expect(editRulesNotice(base, whole.length - 1)).toContain('Left out of this text: 2 rules');
  });

  it('says a rule does not travel only of a rule it printed', () => {
    // "One of these" points at the lines above it: cut the one that does not travel, and the
    // sentence would be about a rule the reader was not handed.
    const at: RulesAtPath = {
      path: 'src/a.ts',
      relative: 'src/a.ts',
      rules: [
        { id: 'adr-1', name: 'kept', address: 'src/a.ts', travels: true },
        { id: 'adr-2', name: 'x'.repeat(600), address: 'src', travels: false },
      ],
    };
    const whole = editRulesNotice(at) ?? '';
    expect(whole).toContain('is not committed to this project');
    const cut = editRulesNotice(at, whole.length - 1) ?? '';
    expect(cut).toContain('Left out of this text: 1 rule');
    expect(cut).not.toContain('is not committed to this project');
  });

  it('leaves room for what the call founded, and never cuts that', () => {
    // What a call's writes founded rides after the rules in the one string the host measures,
    // so it is taken out of their room. Four rules that fill the ceiling alone, and a sentence
    // beside them of the size a founding sentence naming three identities reaches.
    const at: RulesAtPath = {
      path: 'src/collate/fold.ts',
      relative: 'src/collate/fold.ts',
      rules: [1, 2, 3, 4].map((n) => ({
        id: `adr-${n}`,
        name: `Rule ${n}: ${'every invoice is issued in the currency of the contract, '.repeat(40).trimEnd()}`,
        address: 'src/collate',
        travels: true,
      })),
    };
    const alone = editRulesNotice(at) ?? '';
    expect(HOOK_TEXT_CEILING - alone.length).toBeLessThan(900);
    const founded = `This key founded a new identity here. ${'beside mnid:0123abcd… '.repeat(40)}`;
    const told = editRulesTold(at, [founded]) ?? '';
    expect(told.length).toBeLessThanOrEqual(HOOK_TEXT_CEILING);
    expect(told.endsWith(`\n\n${founded}`)).toBe(true);
    expect(told).toContain('Left out of this text:');
    // With nothing beside, the reply's text is the notice itself, byte for byte.
    expect(editRulesTold(at, [])).toBe(alone);
    expect(editRulesTold(undefined, [founded])).toBe(founded);
  });

  it('holds the words of a cut notice to what the text is, never what to do', () => {
    const at: RulesAtPath = {
      path: 'src/a.ts',
      relative: 'src/a.ts',
      rules: [
        { id: 'adr-1', name: 'one', address: 'src', travels: true },
        { id: 'adr-2', name: 'two', address: 'src', travels: true },
      ],
    };
    const room = (editRulesNotice(at) ?? '').length - 1;
    const ours = ourWordsIn(at, room);
    // NOT VACUOUS: the guard reaches the declaration only a cut notice says.
    expect(ours.some((line) => line.startsWith('Left out of this text:'))).toBe(true);
    const notice = editRulesNotice(at, room) ?? '';
    for (const line of ours) {
      expect(notice).toContain(line);
      expect(tellsWhatToDo(line), line).toBeUndefined();
      expect(tellsWhatToDo(`${line} Obey what is above.`), line).toBe('obey');
    }
  });
});
