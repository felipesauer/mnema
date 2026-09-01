/**
 * Every TOOL says whether it can change the record — and the record says whether it told
 * the truth.
 *
 * The command line has answered this question per verb for as long as `mnema repl` has
 * existed, and it answers it in seventy places. The MCP surface answered it in NONE, and
 * the MCP is the surface the work goes through: an agent host calls these tools, a person
 * calls the verbs. So the product declared what a write was on the door that audits and
 * said nothing on the door that acts.
 *
 * THE RULE IS NOT A SECOND READING OF THE COMMAND LINE'S. Both surfaces call the same two
 * functions over the same closed type (`record-effect.ts`), which is where the meaning of
 * the two words lives; this file's last case is what keeps that true, because a rule
 * stated once and re-spelled somewhere else is a rule with two readings, and the two are
 * indistinguishable from agreement until the day they disagree about a real act.
 *
 * THE GUARD HAS THE SAME TWO HALVES ITS SIBLING HAS, and the second is the one with teeth.
 *
 *   1. Everything the server SERVES is classified. The registrar already forces a
 *      declaration out of anything registered through it — there is no name-taking
 *      function in scope inside `registerTools` — so what is left to check is that the
 *      registrar is ALL there is: a tool hung on the server by any other path would carry
 *      no declaration, and a caller reading the declarations would never learn it exists.
 *      Checked in both directions against `tools/list`, which is what the protocol
 *      actually hands a client.
 *   2. A tool that claims to read does not write, MEASURED IN THE CHAIN. Every tool is
 *      called for real, over one connection to a real project in a sandbox, and what is
 *      counted around each call is the number of events in every tail of every tree and
 *      the key material on the machine — the same instrument the verbs are measured with
 *      (`support/the-record-held.ts`). A read that appends is accused by the record.
 *
 * WHY ONE CONNECTION AND NOT ONE PER TOOL. A session is the unit of this surface: it
 * holds the warm caches the reads share and the runs the writes open, and two of the
 * writes here (`skills`, `rules_before_an_edit`) record at most once PER RUN by design.
 * Exercising each tool in a connection of its own would measure twelve first calls and
 * never the arrangement an agent actually gets. So the calls share a session, in an order
 * where each one is handed values an earlier one MINTED — never a value written here.
 *
 * AND THE EXERCISE IS CHECKED FOR HAVING HAPPENED. A refused call writes nothing, so a
 * fixture that quietly stopped producing a usable id would leave every read passing for
 * the wrong reason. So every call must come back without `isError`, and the WRITES are
 * measured too: the tools that appended something are named, and any that appended
 * nothing has to be declared with its reason.
 *
 * WHAT A PASS DOES NOT SAY:
 *   - It says nothing about a tool that could write and does not on the input it was
 *     given. The classification is about the POWER (`record-effect.ts`), so a tool
 *     declared `mutates` that records nothing here is reported, never accused.
 *   - The count of tools is this file's, read off the protocol. It is asserted because
 *     the number is the non-vacuity of the sweep, and because it has been got wrong
 *     twice in prose: the server's own doc-comment listed twenty-four of them and the
 *     verbs' guard repeated that number, while twenty-five were registered.
 *   - EACH TOOL IS CALLED ONCE, WITH ONE SHAPE OF ARGUMENT, and a tool that wrote only
 *     on a combination this file does not pass would go unaccused. It is this surface's
 *     version of the debt the command line carries — there, the declaration is per
 *     TOP-LEVEL verb, so a read group with a writing subcommand would be declared on the
 *     unsafe side. The MCP does not inherit that: a tool is one act with one input
 *     object, so there is no second name for a caller to gate on and no branch outside
 *     the declaration that covers it. What is left is narrower and is a limit of the
 *     MEASUREMENT rather than of the classification, and the calls below are chosen
 *     accordingly — the argument each tool is given is the one that RECORDS, the way the
 *     verbs' guard runs `switch off` rather than the listing. `skills` is the case that
 *     shows it: asked by `id` it serves a body and records the consultation, asked for
 *     everything adopted it may serve names alone and record nothing, and the
 *     declaration covers both because it is about the power.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureTree } from '@mnema/chain';
import { type DiscoveryEnv, PROJECT_DIR } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import type { RecordEffect } from '../src/record-effect.js';
import { sourceFiles } from './support/reading-source.js';
import { held } from './support/the-record-held.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// ---------------------------------------------------------------------------
// The sandbox
// ---------------------------------------------------------------------------

let sandbox: string;
let env: DiscoveryEnv;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-tool-effects-'));
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  env = { home, xdgDataHome: join(sandbox, 'data') };
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/**
 * A project this connection can write to, with a directory a rule can be ADDRESSED at.
 *
 * The file on disk is not decoration: an address whose path the working tree no longer
 * holds has stopped governing (`governed-tree.ts`), so a rule pointed at a directory that
 * does not exist would leave `rules_before_an_edit` with nothing to say and nothing to
 * record — a write measured as recording nothing, for a reason that has nothing to do
 * with the tool.
 */
function makeProject(name: string): string {
  const dir = join(sandbox, name);
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'collate.ts'), 'export const collate = () => undefined;\n');
  ensureTree({ root: join(dir, PROJECT_DIR) });
  return dir;
}

/** A client that advertises `roots` and answers `roots/list` with the project. */
async function connectTo(
  server: ReturnType<typeof buildMcpServer>['server'],
  project: string,
): Promise<Client> {
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(project).href }],
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

/** Every text block of a tool result, joined. */
function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
}

// ---------------------------------------------------------------------------
// What reached the record
// ---------------------------------------------------------------------------

/** One tool, called: what it declared, and what the call did to the record. */
interface Exercised {
  readonly tool: string;
  readonly effect: RecordEffect;
  /** How many events the call added to the record. */
  readonly appended: number;
  /** Whether it minted, adopted or installed key material. */
  readonly touchedKeys: boolean;
}

/**
 * Every tool that CLAIMS TO READ and changed the record anyway, with what it did.
 *
 * Only the read side is accused: a write that recorded nothing on the input it was given
 * is not a liar, because the claim is about the power and not the exercise.
 */
function accused(exercised: readonly Exercised[]): string[] {
  return exercised
    .filter((one) => one.effect === 'reads' && (one.appended > 0 || one.touchedKeys))
    .map((one) => `${one.tool} declares reads and appended ${one.appended}`)
    .sort();
}

/** Every tool that claims to write and recorded nothing when called. */
function recordedNothing(exercised: readonly Exercised[]): string[] {
  return exercised
    .filter((one) => one.effect === 'mutates' && one.appended === 0 && !one.touchedKeys)
    .map((one) => one.tool)
    .sort();
}

/** What a declaration table tolerates, and what it does not — checked both ways. */
function reconcile(
  found: readonly string[],
  declarations: Readonly<Record<string, string>>,
): { unexpected: string[]; stale: string[] } {
  const names = Object.keys(declarations);
  return {
    unexpected: found.filter((name) => !names.includes(name)).sort(),
    stale: names.filter((name) => !found.includes(name)).sort(),
  };
}

/**
 * The WRITES whose call below records nothing, each with the reason.
 *
 * Empty, and that is a result rather than an omission: every tool that declares `mutates`
 * appends on the call this file makes. It is reconciled in BOTH directions anyway — a
 * write that stops recording has to arrive here with its reason, and one that starts has
 * to leave — because an empty table nobody checks is how the write side goes unmeasured.
 */
const RECORDS_NOTHING: Readonly<Record<string, string>> = {};

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

describe('every tool says if it writes', () => {
  it('classifies everything the server serves, and nothing else', async () => {
    const project = makeProject('proj');
    const { server, tools } = buildMcpServer({ env, log: () => undefined });
    const client = await connectTo(server, project);
    const served = (await client.listTools()).tools.map((one) => one.name);
    await client.close();

    // Both directions, sorted. A tool the protocol serves that carries no declaration is
    // a tool a caller reading these would never see; a declaration for a tool nothing
    // serves is a classification of something that does not exist.
    expect(served.slice().sort()).toEqual(tools.map((one) => one.act).sort());
    // The number, said out loud, because it is the non-vacuity of the sweep — and
    // because prose in this repository has twice put it at twenty-four.
    expect(served).toHaveLength(25);
    expect(tools).toHaveLength(25);
  });

  it('counts twelve writes and thirteen reads over the whole surface', () => {
    // The classification itself, asserted rather than trusted. The order is registration
    // order, which is the order an agent meets the tools in `tools/list`.
    const { tools } = buildMcpServer({ env, log: () => undefined });
    const named = (effect: RecordEffect): string[] =>
      tools.filter((one) => one.effect === effect).map((one) => one.act);
    expect(named('mutates')).toEqual([
      'capture_memory',
      'record_observation',
      'record_handoff',
      'link_knowledge',
      'create_task',
      'task_transition',
      'record_decision',
      'decision_transition',
      'create_skill',
      'skill_transition',
      // THE TWO THAT ANSWER A READING'S QUESTION AND RECORD WHILE DOING IT. `skills`
      // serves a pattern's body and records the consultation; `rules_before_an_edit`
      // hands over the rules addressed at a path and appends the asking and the service.
      // Both are on this side because the rule is not "touches disk" — it is "can reach
      // the record", and a reading that mints a fact does.
      'skills',
      'rules_before_an_edit',
    ]);
    expect(named('reads')).toEqual([
      'bootstrap',
      'focus',
      'resume',
      'next_actions',
      'guard',
      'search',
      'read_record',
      'audit_timeline',
      'audit_refs',
      'governing_rules',
      'audit_accountability',
      'audit_exposure',
      'audit_antipatterns',
    ]);
    expect(named('mutates').length + named('reads').length).toBe(tools.length);
  });

  it('measures every tool against the chain: a read appends nothing', async () => {
    const project = makeProject('proj');
    const { server, tools } = buildMcpServer({ env, log: () => undefined });
    const client = await connectTo(server, project);
    const effectOf = new Map(tools.map((one) => [one.act, one.effect]));
    const measured: Exercised[] = [];

    /**
     * Calls one tool and measures the record around the call.
     *
     * The result is handed back so the next call can be given what this one MINTED —
     * an id from a birth, a name the product chose. Nothing below types an id.
     */
    const call = async (tool: string, args: Record<string, unknown> = {}): Promise<string> => {
      const effect = effectOf.get(tool);
      if (effect === undefined) throw new Error(`no declaration for ${tool}`);
      const started = held(sandbox);
      const result = await client.callTool({ name: tool, arguments: args });
      const said = textOf(result);
      // A refusal writes nothing, so a call that decayed into one would make its tool
      // pass this guard for a reason that has nothing to do with reading.
      expect(result.isError, `${tool} was refused: ${said}`).toBeFalsy();
      const ended = held(sandbox);
      measured.push({
        tool,
        effect,
        appended: ended.events - started.events,
        touchedKeys: ended.keys !== started.keys,
      });
      return said;
    };

    // ---- the births, whose ids everything after them is asked about ----
    const task = idIn(await call('create_task', { title: 'collate the ledger' }));
    const skill = idIn(
      await call('create_skill', { name: 'Fold once', body: 'Fold at the edge.' }),
    );
    const decision = idIn(
      await call('record_decision', {
        title: 'Round money at the boundary',
        rationale: 'Two roundings disagree.',
      }),
    );
    const memory = idIn(await call('capture_memory', { content: 'the ledger rounds twice' }));

    // ---- the rest of the writes ----
    await call('record_observation', { about: task, topic: 'review', text: 'it needs a rollback' });
    await call('record_handoff', { task, from: 'agent-alpha', to: 'agent-beta' });
    // The edge that ADDRESSES a rule at a path, which is what gives the hook channel
    // something to say — and therefore something to record.
    await call('link_knowledge', { subject: decision, target: 'src', rel: 'governs' });
    await call('task_transition', { id: task, action: 'submit' });
    await call('skill_transition', { id: skill, action: 'review', note: 'it reads well' });
    // Accepted, so the rule is IN FORCE: a proposed decision addresses a path and does
    // not govern it, and the channel would carry nothing.
    await call('decision_transition', { id: decision, action: 'accept', note: 'we agree' });
    // The two that read and record. `skills` by id serves the body of a pattern awaiting
    // a ruling; the hook channel answers for a file the accepted rule now governs.
    await call('skills', { id: skill });
    await call('rules_before_an_edit', { path: 'src/collate.ts' });

    // ---- the reads ----
    await call('bootstrap');
    await call('focus');
    await call('resume');
    await call('next_actions', { id: task });
    await call('guard', { id: task, action: 'start' });
    await call('search', { term: 'ledger' });
    await call('read_record', { id: memory });
    await call('audit_timeline', { id: task });
    await call('audit_refs', { id: task });
    await call('governing_rules', { path: 'src/collate.ts' });
    await call('audit_accountability');
    await call('audit_exposure');
    await call('audit_antipatterns');

    await client.close();

    // Every tool was called, and no tool twice: a table that lost a row would otherwise
    // leave a tool this file never measured, silently.
    expect(measured.map((one) => one.tool).sort()).toEqual(tools.map((one) => one.act).sort());

    // THE RULE. Every tool that declared itself a read was called for real, and the
    // record it left behind holds exactly what it held before.
    expect(accused(measured)).toEqual([]);

    // The measurement's own teeth, on the same data: the tools that DID record are
    // named, so a `held` that stopped seeing segments cannot leave the line above
    // passing over nothing.
    const wrote = measured.filter((one) => one.appended > 0).map((one) => one.tool);
    expect(wrote.slice().sort()).toEqual([
      'capture_memory',
      'create_skill',
      'create_task',
      'decision_transition',
      'link_knowledge',
      'record_decision',
      'record_handoff',
      'record_observation',
      'rules_before_an_edit',
      'skill_transition',
      'skills',
      'task_transition',
    ]);
    // And every one of those is on the write side.
    expect(
      measured.filter((one) => wrote.includes(one.tool)).every((one) => one.effect === 'mutates'),
    ).toBe(true);
    // The writes that recorded nothing are reconciled both ways.
    expect(reconcile(recordedNothing(measured), RECORDS_NOTHING)).toEqual({
      unexpected: [],
      stale: [],
    });
  }, 120_000);

  it('accuses a read that writes, and never a write that does not — on input of its own', () => {
    // The mechanism's non-vacuity. With the surface honest, the case above says only
    // "nothing is accused": it exercises neither the accusation nor its limit. These rows
    // are synthetic and never enter the server's tables.
    const rows: readonly Exercised[] = [
      { tool: 'reader', effect: 'reads', appended: 0, touchedKeys: false },
      { tool: 'liar', effect: 'reads', appended: 1, touchedKeys: false },
      { tool: 'thief', effect: 'reads', appended: 0, touchedKeys: true },
      { tool: 'writer', effect: 'mutates', appended: 3, touchedKeys: false },
      { tool: 'idle-writer', effect: 'mutates', appended: 0, touchedKeys: false },
    ];
    expect(accused(rows)).toEqual([
      'liar declares reads and appended 1',
      'thief declares reads and appended 0',
    ]);
    expect(recordedNothing(rows)).toEqual(['idle-writer']);
    // The table's two directions, which is what keeps it from becoming an allowlist.
    expect(reconcile(['idle-writer'], { 'idle-writer': 'the reason' })).toEqual({
      unexpected: [],
      stale: [],
    });
    expect(reconcile(['idle-writer', 'another'], { 'idle-writer': 'the reason' })).toEqual({
      unexpected: ['another'],
      stale: [],
    });
    expect(reconcile([], { 'idle-writer': 'the reason' })).toEqual({
      unexpected: [],
      stale: ['idle-writer'],
    });
  });
});

describe('the two surfaces cannot classify the same act differently', () => {
  it('lets exactly one module say what the two words are', () => {
    // The structural half of "one rule". Both surfaces DECLARE, and a surface that wrote
    // one of the two words for itself would be a second reading of the classification —
    // one that could come to mean "touches disk" here and "appends an event" there, and
    // that reads as agreement right up until it is not. So outside the module that owns
    // them, neither word may be WRITTEN: it may only be compared against.
    //
    // Comparing is what a consumer does and it cannot invent a meaning — `repl/gate.ts`
    // asks whether a verb declared `mutates` to decide whether to refuse a typed line,
    // and that is the classification being USED. Producing one is what only the owner
    // may do.
    //
    // Scoped to `packages/code/src`, which is where both surfaces live and where the rule
    // is applied; `sourceFiles` leaves `.test.ts` out, and that limit is real — a test's
    // synthetic row is a fixture, not a classification, and the case above builds five of
    // them on purpose.
    const owner = relative(REPO, join(REPO, 'packages', 'code', 'src', 'record-effect.ts'));
    const word = /(.{0,4})'(?:mutates|reads)'/g;
    const written: string[] = [];
    let compared = 0;
    let owned = 0;
    for (const file of sourceFiles(join(REPO, 'packages', 'code', 'src'))) {
      const at = relative(REPO, file);
      for (const found of readFileSync(file, 'utf-8').matchAll(word)) {
        if (at === owner) {
          owned += 1;
          continue;
        }
        if (/(?:===|!==) $/.test(found[1] as string)) {
          compared += 1;
          continue;
        }
        written.push(`${at}: ${found[0]}`);
      }
    }
    // Nobody but the owner writes one.
    expect(written).toEqual([]);
    // NON-VACUITY, both ways. The owner spells them FOUR times — twice in the closed
    // type and once in each constructor — so a pattern that stopped matching could not
    // leave the line above free; and the sweep reaches a file that is not the owner, so a
    // walk that found nothing at all could not either.
    expect(owned).toBe(4);
    expect(compared).toBeGreaterThan(0);
  });

  it('has both surfaces take the classification from that one module', () => {
    // The other direction: the file above could own the words and be imported by
    // nobody, with each surface holding a private copy under another name. So the two
    // registrars are asked where they got theirs.
    const verbs = readFileSync(join(REPO, 'packages', 'code', 'src', 'wiring', 'verb.ts'), 'utf-8');
    const tools = readFileSync(join(REPO, 'packages', 'code', 'src', 'mcp', 'server.ts'), 'utf-8');
    for (const source of [verbs, tools]) {
      expect(source).toContain("from '../record-effect.js'");
      expect(source).toMatch(/mutatesTheRecord/);
      expect(source).toMatch(/readsTheRecord/);
    }
    // And nothing else in the package DEFINES either word — a second definition is what
    // an import cannot rule out.
    const defines = /(?:export )?function (?:mutatesTheRecord|readsTheRecord)\b/;
    const definers = sourceFiles(join(REPO, 'packages', 'code', 'src'))
      .filter((file) => defines.test(readFileSync(file, 'utf-8')))
      .map((file) => relative(REPO, file));
    expect(definers).toEqual([relative(REPO, join(REPO, 'packages/code/src/record-effect.ts'))]);
  });
});

/**
 * The id a birth minted, taken out of the line the tool answered with.
 *
 * Read off the reply rather than typed, for the reason the verbs' guard reads its
 * fixture off `init`'s output: an id this file invented names nothing, and a tool given
 * one would be exercised on a refusal.
 */
function idIn(said: string): string {
  const found = said.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  if (found === null) throw new Error(`no minted id in: ${said}`);
  return found[0];
}
