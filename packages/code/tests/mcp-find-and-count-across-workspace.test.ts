/**
 * What the two reads that FIND and COUNT look in when the workspace holds several
 * projects — and what each of them is allowed to merge.
 *
 * The three reads keyed by an id already span every project: an id is minted once,
 * so widening the search can only turn a null into an answer. These two are not
 * keyed by an id, and that is why they were left out of that change: the union
 * changes what the ANSWER MEANS, and it means something different in each.
 *
 *   `search` returns ITEMS. Merging widens the list and nothing in it changes
 *   meaning — a hit is a hit, and each one now says which project holds it. Not
 *   finding what exists is the defect this whole sequence removes, and a search of
 *   one project that never said it looked in one project is that defect exactly.
 *
 *   `accountability` returns an AGGREGATE. Merging would SUM, and a summed total
 *   answers "how much is in this workspace" under the name of "how much is in this
 *   record" — the reader takes the wrong number with nothing warning them. So it
 *   comes back DECOMPOSED: one account per project, each number meaning exactly
 *   what it meant when it was the only one. The sum is the reader's to make.
 *
 * What is tested here:
 *
 *   1. ONE test per read, so a union lost in one of the two fails naming that one;
 *   2. a ONE-project workspace does not regress — and the proof is the CLI, which
 *      resolves a single project from `cwd`, has no workspace, and is untouched:
 *      its answer and this one must reconcile exactly;
 *   3. a hit from a sibling project is FOUND and LABELLED;
 *   4. the limit that shuts a whole project out of the list SAYS SO — the honest
 *      half of a merged ranking, reported only when it happened;
 *   5. `accountability` never fuses: the same author in three projects is three
 *      accounts, not one sum, and there is no workspace total beside them;
 *   6. the machine-global tree — which every project resolves to the same path —
 *      is counted ONCE, whatever the project count.
 *
 * Every fact is written through the write tools and read back through the read
 * tools, so what is asserted is what an agent receives.
 */

import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureTree } from '@mnema/chain';
import { type DiscoveryEnv, PROJECT_DIR } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAccountability } from '../src/commands/accountability.js';
import { runSearch } from '../src/commands/search.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { closeSession, openSession, type Session } from '../src/mcp/session.js';
import { runAccountabilityTool, runCaptureMemory, runSearchTool } from '../src/mcp/tools.js';

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
function openOn(...projects: readonly string[]): Session {
  return openSession({
    clientName: 'claude-code',
    roots: projects.map((dir) => pathToFileURL(dir).href),
    env,
  });
}

/** Captures a memory in a project (or the session's own), returning its id. */
function memoryIn(
  session: Session,
  content: string,
  where: { project?: string; scope?: 'public' | 'private' | 'global' } = {},
): string {
  const captured = runCaptureMemory(session, { content, ...where });
  if (!captured.ok) throw new Error(`setup: capture refused — ${captured.message}`);
  return captured.id;
}

/** The search result, or a thrown setup error — the refusals have their own tests. */
function search(session: Session, input: Parameters<typeof runSearchTool>[1]) {
  const found = runSearchTool(session, input);
  if (!found.ok) throw new Error(`search refused — ${found.message}`);
  return found.value;
}

/** The account, or a thrown setup error — `NO_PROJECT` has its own test. */
function account(session: Session, input: Parameters<typeof runAccountabilityTool>[1] = {}) {
  const result = runAccountabilityTool(session, input);
  if (!result.ok) throw new Error(`accountability refused — ${result.message}`);
  return result.value;
}

/** One record's account, as the two shapes this file reads it in. */
interface Counted {
  readonly byWho: readonly { readonly byKind: readonly { kind: string; count: number }[] }[];
}

/** How many facts of one kind an account holds, whoever authorized them. */
function countOfKind(entry: Counted | undefined, kind: string): number {
  if (entry === undefined) throw new Error(`no account to count ${kind} in`);
  let count = 0;
  for (const who of entry.byWho) {
    for (const cell of who.byKind) if (cell.kind === kind) count += cell.count;
  }
  return count;
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-mcp-count-'));
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  env = { home, xdgDataHome: join(sandbox, 'data') };
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('a one-project workspace does not regress', () => {
  it('answers search with the same index the untouched command line answers', () => {
    // The regression that matters most: almost every session is one project, and the
    // union has nothing to add there. The proof is not this test restating its own
    // numbers — it is the COMMAND LINE, which resolves one project from `cwd`, knows
    // nothing of a workspace, and was not touched by this change. Its index and this
    // one must be the same list, hit for hit, with only the new label added.
    const only = makeProject('only');
    const session = openOn(only);
    memoryIn(session, 'the deploy runbook, as I know it');
    memoryIn(session, 'the deploy runbook, as the team wrote it', { scope: 'public' });
    memoryIn(session, 'the deploy runbook, my own habit', { scope: 'global' });

    const mine = search(session, { term: 'runbook' });
    const cli = runSearch({ cwd: only, env }, { term: 'runbook' });
    if (!cli.ok) throw new Error('unreachable');

    expect(mine.total).toBe(3);
    expect(mine.total).toBe(cli.result.total);
    // The same hits in the same order — the label is the ONLY difference.
    expect(mine.hits.map(({ project, ...hit }) => hit)).toEqual(cli.result.hits);
    // And the label is present rather than the shape changing with a project count:
    // the two trees of the project carry it, the machine-global tree carries none.
    expect(new Map(mine.hits.map((hit) => [hit.scope, hit.project]))).toEqual(
      new Map([
        ['private', only],
        ['public', only],
        ['global', undefined],
      ]),
    );
    // Nothing was cut, so nothing is claimed about a cut.
    expect(mine.hidden).toBeUndefined();
    closeSession(session);
  });

  it('accounts for the one project and the machine-global tree, and reconciles with the command line', () => {
    // The shape DID change here, by decision: an aggregate cannot be merged, so it is
    // decomposed. What must not change is the arithmetic — the numbers a one-project
    // workspace reports are the numbers it always reported, split by which record
    // holds them and counted once each. The command line still folds its one project's
    // trees into a single total, and that total is what the entries have to add up to.
    const only = makeProject('only');
    const session = openOn(only);
    memoryIn(session, 'a fact of mine');
    memoryIn(session, 'a fact of the team', { scope: 'public' });
    memoryIn(session, 'a personal note', { scope: 'global' });

    const mine = account(session);
    const cli = runAccountability({ cwd: only, env });
    if (!cli.ok) throw new Error('unreachable');

    // Two records are visible: this project's trees, and the machine-global tree that
    // belongs to no project — which is what the absent label says.
    expect(mine.byProject.map((entry) => entry.project)).toEqual([only, undefined]);
    expect(countOfKind(mine.byProject[0], 'memory.captured')).toBe(2);
    expect(countOfKind(mine.byProject[1], 'memory.captured')).toBe(1);

    // The arithmetic: every fact counted once, and the fold and the decomposition
    // agree to the unit.
    const sum = mine.byProject.reduce((n, entry) => n + entry.total, 0);
    expect(sum).toBe(cli.account.total);
    // And there is no workspace total beside them — a summed number under this name
    // is the reason the answer is decomposed at all.
    expect('total' in mine).toBe(false);
    closeSession(session);
  });

  it('opens no tree of a project it only reads THROUGH, and writes to none', () => {
    // Both reads now reach every project of the workspace. A tree that has never been
    // written does not exist on disk, and asking it must leave it that way.
    const here = makeProject('here');
    const untouched = makeProject('untouched');
    const session = openOn(here, untouched);
    memoryIn(session, 'something here');

    expect(runSearchTool(session, { term: 'something' }).ok).toBe(true);
    expect(runAccountabilityTool(session, {}).ok).toBe(true);

    expect(readdirSync(join(untouched, PROJECT_DIR))).not.toContain('private');
    expect(session.runs.size).toBe(1);
    closeSession(session);
  });
});

describe('search spans every project of the workspace', () => {
  it('finds what a sibling project holds, and says which one holds it', () => {
    // The defect, stated as a session: the words are in `nferural`, the cascade landed
    // on `plantae-legacy`, and the search came back empty without a word saying two
    // projects were never opened.
    const legacy = makeProject('plantae-legacy');
    const laravel = makeProject('plantae-laravel');
    const nferural = makeProject('nferural');
    const session = openOn(legacy, laravel, nferural);

    const here = memoryIn(session, 'the migration runbook, in legacy');
    const there = memoryIn(session, 'the migration runbook, in laravel', { project: laravel });
    const far = memoryIn(session, 'the migration runbook, in nferural', { project: nferural });

    const found = search(session, { term: 'migration' });

    expect(found.total).toBe(3);
    expect(new Map(found.hits.map((hit) => [hit.id, hit.project]))).toEqual(
      new Map([
        [here, legacy],
        [there, laravel],
        [far, nferural],
      ]),
    );
    // Nothing was cut, so nothing is said about a cut.
    expect(found.hidden).toBeUndefined();
    closeSession(session);
  });

  it('lists the personal note from the machine-global tree ONCE, with three projects open', () => {
    // Every project resolves the SAME machine-global tree, so iterating projects hands
    // it over three times — and an index given one tree three times reports every hit
    // in it three times, with nothing in the answer saying so.
    const session = openOn(makeProject('one'), makeProject('two'), makeProject('three'));
    const personal = memoryIn(session, 'my own habit, whatever the project', { scope: 'global' });

    const found = search(session, { term: 'habit' });

    expect(found.hits.map((hit) => hit.id)).toEqual([personal]);
    expect(found.total).toBe(1);
    // The machine-global tree belongs to no project, so it is labelled with none —
    // which is what distinguishes it from a fact that came from one.
    expect(found.hits[0]?.project).toBeUndefined();
    expect(found.hits[0]?.scope).toBe('global');
    closeSession(session);
  });

  it('says which project the limit shut out of the list entirely', () => {
    // The debt this read carries and now has to declare. Each tree ranks its own hits
    // against its own corpus, so the merged order is an approximation — and the limit
    // can fill the list from one project and leave another INVISIBLE. `total` already
    // says the list was cut; it does not say the cut fell on a whole project, and a
    // reader who cannot tell the two apart concludes "nothing there" about a project
    // that matched. Which project wins the ranking is not the claim here — that the
    // answer NAMES the one it dropped, and with its count, is.
    const first = makeProject('first');
    const second = makeProject('second');
    const session = openOn(first, second);
    for (let i = 0; i < 3; i += 1) memoryIn(session, `a shared word, first ${i}`);
    for (let i = 0; i < 3; i += 1) {
      memoryIn(session, `a shared word, second ${i}`, { project: second });
    }

    const cut = search(session, { term: 'shared', limit: 1 });

    expect(cut.hits).toHaveLength(1);
    expect(cut.total).toBe(6);
    const shown = cut.hits[0]?.project;
    const dropped = [first, second].find((project) => project !== shown);
    expect(cut.hidden).toEqual([{ project: dropped, matched: 3 }]);

    // And it is strictly a refinement of the cut `total` already declares: a limit
    // that covers the answer hides nothing, and says nothing.
    const whole = search(session, { term: 'shared', limit: 10 });
    expect(whole.hits).toHaveLength(6);
    expect(whole.hidden).toBeUndefined();
    closeSession(session);
  });
});

describe('accountability accounts for each project, and never sums them', () => {
  it('gives the same author one account per project, not one total across them', () => {
    // One human, three codebases, one connection — the ordinary shape of the work this
    // surface exists for. Summed, the answer says "42 facts" for a record that holds
    // 12: the same name over a different question. Decomposed, every number still
    // means what it meant when the project was the only one.
    const legacy = makeProject('plantae-legacy');
    const laravel = makeProject('plantae-laravel');
    const nferural = makeProject('nferural');
    const session = openOn(legacy, laravel, nferural);

    memoryIn(session, 'one here');
    memoryIn(session, 'one there', { project: laravel });
    memoryIn(session, 'two there', { project: laravel });
    memoryIn(session, 'one far away', { project: nferural });

    const mine = account(session);

    // One entry per project, in the order the workspace presents them, and the
    // machine-global tree last — it belongs to none of them.
    expect(mine.byProject.map((entry) => entry.project)).toEqual([
      legacy,
      laravel,
      nferural,
      undefined,
    ]);
    expect(mine.byProject.map((entry) => countOfKind(entry, 'memory.captured'))).toEqual([
      1, 2, 1, 0,
    ]);
    // The SAME author authorized in all three, and appears in each — three accounts
    // of one person's work, not one number that lost track of where it happened.
    const asMe = mine.byProject.filter((entry) =>
      entry.byWho.some((who) => who.who === session.who),
    );
    expect(asMe).toHaveLength(3);
    // Nothing anywhere adds them up for the reader.
    expect('total' in mine).toBe(false);
    closeSession(session);
  });

  it('counts the machine-global tree once, whatever the project count', () => {
    const session = openOn(makeProject('one'), makeProject('two'), makeProject('three'));
    memoryIn(session, 'a personal note', { scope: 'global' });

    const mine = account(session);

    const global = mine.byProject.filter((entry) => entry.project === undefined);
    expect(global).toHaveLength(1);
    expect(countOfKind(global[0], 'memory.captured')).toBe(1);
    closeSession(session);
  });

  it('echoes the window it applied, and a filter that excludes everything is zero, not an error', () => {
    const first = makeProject('first');
    const second = makeProject('second');
    const session = openOn(first, second);
    memoryIn(session, 'a fact');
    memoryIn(session, 'another fact', { project: second });

    const none = account(session, { who: 'nobody', from: '2020-01-01T00:00:00.000Z' });

    expect(none.from).toBe('2020-01-01T00:00:00.000Z');
    // Every record still ACCOUNTED FOR, at zero: an entry missing from the list would
    // be indistinguishable from a project the read never opened.
    expect(none.byProject.map((entry) => entry.project)).toEqual([first, second, undefined]);
    expect(none.byProject.every((entry) => entry.total === 0 && entry.byWho.length === 0)).toBe(
      true,
    );
    closeSession(session);
  });
});

/** A client that advertises `roots` and answers `roots/list` with `roots`. */
async function connectClient(roots: readonly string[]): Promise<Client> {
  const { server } = buildMcpServer({ env, log: () => {} });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: roots.map((uri) => ({ uri, name: uri })),
  }));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
  return client;
}

/** The text of a tool reply's single content block. */
function replyText(result: unknown): string {
  return (result as { content: { text: string }[] }).content[0]?.text as string;
}

describe('over the real transport', () => {
  it('carries the label on a hit and the decomposition in the account', async () => {
    const first = makeProject('first');
    const second = makeProject('second');
    const client = await connectClient([first, second].map((p) => pathToFileURL(p).href));

    await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'the migration runbook', project: basename(second) },
    });

    const found = await client.callTool({ name: 'search', arguments: { term: 'migration' } });
    expect(found.isError).toBeFalsy();
    const index = JSON.parse(replyText(found)) as {
      hits: { project?: string }[];
      total: number;
    };
    expect(index.total).toBe(1);
    expect(index.hits[0]?.project).toBe(second);

    const counted = await client.callTool({ name: 'audit_accountability', arguments: {} });
    expect(counted.isError).toBeFalsy();
    const account = JSON.parse(replyText(counted)) as {
      byProject: { project?: string; total: number }[];
      total?: number;
    };
    expect(account.byProject.map((entry) => entry.project)).toEqual([first, second, undefined]);
    // The project that was written to has facts; the one that was not has none, and
    // says so rather than being absent.
    expect(account.byProject[1]?.total).toBeGreaterThan(0);
    expect(account.byProject[0]?.total).toBe(0);
    expect(account.total).toBeUndefined();
    await client.close();
  });
});
