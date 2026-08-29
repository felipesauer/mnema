import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogUpcasters, ensureTree, verify } from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  PROJECT_DIR,
  type ResolvedTrees,
  resolveTrees,
  type Scope,
} from '@mnema/core';
import { createTask, openTreeForWriting } from '@mnema/core/write';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDecision } from '../src/commands/decision.js';
import { runDecisionImport } from '../src/commands/decision-import.js';
import { runDecisionTransition } from '../src/commands/decision-transition.js';
import { runHandoff } from '../src/commands/handoff.js';
import { runInit } from '../src/commands/init.js';
import { runKeyEnroll } from '../src/commands/key-enroll.js';
import { runKeyRequest } from '../src/commands/key-request.js';
import { runKeyRevoke } from '../src/commands/key-revoke.js';
import { runLink } from '../src/commands/link.js';
import { runMemory } from '../src/commands/memory.js';
import { runObserve } from '../src/commands/observe.js';
import { runRunEnd } from '../src/commands/run-end.js';
import { runRunStart } from '../src/commands/run-start.js';
import { runSkill } from '../src/commands/skill.js';
import { runSkillTransition } from '../src/commands/skill-transition.js';
import { runSwitch } from '../src/commands/switch.js';
import { runTailPrune } from '../src/commands/tail-prune.js';
import { runTask } from '../src/commands/task.js';
import { runTaskTransition } from '../src/commands/task-transition.js';
import { closeSession, openSession, openWrite, type Session } from '../src/mcp/session.js';
import {
  runCaptureMemory,
  runCreateSkill,
  runCreateTask,
  runLinkKnowledge,
  runDecisionTransition as runMcpDecisionTransition,
  runSkillTransition as runMcpSkillTransition,
  runTaskTransition as runMcpTaskTransition,
  runRecordDecision,
  runRecordHandoff,
  runRecordObservation,
  runRulesBeforeAnEditTool,
  runSkillsTool,
} from '../src/mcp/tools.js';

/**
 * The invariant this file exists for: EVERY path that puts an event on a tail SIGNS
 * what it wrote before it returns, and no write path can skip the signing.
 *
 * WHAT GOES WRONG WITHOUT IT is quiet, which is why nothing had caught it. A write
 * that forgets its checkpoint still succeeds: the event lands, the reply says so, the
 * chain still reads. What changes is the record's LEVEL — the events sit above the
 * last checkpoint, so the tree drops from `fully-signed` to
 * `signed-through-last-checkpoint`, and it says so only to somebody who runs `verify`
 * and reads the word. The proof the product sells is that a fact is signed; a fact
 * resting on the hash chain alone is a fact whose signature nobody made.
 *
 * IT WAS NOT HYPOTHETICAL. Building this guard found two live paths on the MCP
 * surface — the one an agent actually uses — and both were measured before they were
 * fixed:
 *
 *   - `closeSession` appended a `run.ended` for every run the connection opened and
 *     signed none of them. A tree that was `fully-signed` a moment earlier ended the
 *     session at `signed-through-last-checkpoint` with 1 event uncovered, and stayed
 *     there: the connection is over, so nothing was ever coming back for it.
 *   - `ensureRun` appended `run.started` (and, on a fresh tree, the founding under it)
 *     and left both to whatever the tool did next. When the tool was REFUSED it
 *     checkpointed nothing by design, so a session whose first call was refused left
 *     the tree at `hash-chain-only` with 2 events uncovered — a record that has never
 *     been signed at all.
 *
 * THE CADENCE THIS GUARDS IS ONE SIGNATURE PER ACT OF WRITING, and it is not new: it
 * is what 33 writing paths already did by remembering to. Measured on the binary over
 * 30 writes to a fresh record — 32 events, 31 checkpoints, 1.03 events per
 * checkpoint. This file does not change it; it makes it a rule instead of a habit.
 *
 * So the tests come in two halves, and neither is sufficient alone:
 *
 *   1. THE SOURCE GUARD. Every function of the shipped surface that reaches an
 *      append must also reach a checkpoint. This is the half that catches a write
 *      path added TOMORROW, which no behavioural test can, because a test cannot
 *      drive an operation nobody has written yet. Both ends of it are derived from
 *      the source — the operations that append are found from the append door, not
 *      listed — so the guard cannot be made vacuous by renaming an operation.
 *   2. THE BEHAVIOURAL SWEEP. Every one of those paths is driven for real, in its own
 *      sandbox, and after each the whole workspace is asked the product's own
 *      question: how many events rest above a checkpoint? The answer must be zero,
 *      every time. And the set driven is checked against the set the source guard
 *      found, so a path cannot be added to one half and forgotten in the other.
 *
 * WHAT THIS DOES NOT CATCH — the honest half, because a guard read as more than it is
 * becomes the next silence:
 *
 *   - A path that signs SOMETHING but not everything it wrote. The question asked is
 *     "is anything uncovered when you return", so a checkpoint over the wrong range
 *     would have to be caught by the writer's own range assertion, not here.
 *   - A path outside `packages/code/src`. An embedder calling `@mnema/core/write`
 *     directly owns its own signing; the core's operations deliberately do not sign
 *     (`enrollKey` and `revokeKey` are the two that do, because they complete an act
 *     of their own). The source guard's stage 1 names them, the sweep does not drive
 *     them, and this is where that boundary is stated.
 *   - A function that is not top-level. The scanner reads declarations at column 0,
 *     which is every function in these files today; a write moved inside a closure
 *     would drop out of the enumeration, and the pinned counts below are what makes
 *     that fail rather than pass.
 *   - The CLI's virgin-tree case, which is deliberate and pinned elsewhere: a CLI
 *     write refused on a tree nobody ever wrote to leaves the founding behind
 *     unsigned (see `every-append.test.ts`). Reaching it needs a project directory
 *     with a tree and no `init`, which the CLI itself never produces.
 *   - WHETHER SIGNING IS THE RIGHT CADENCE AT ALL. That was decided with a study and
 *     is not re-litigated here; the ceiling under it is a different mechanism and has
 *     its own case at the end of this file.
 */

// ---------------------------------------------------------------------------
// Half 1 — the source guard
// ---------------------------------------------------------------------------

const HERE = join(import.meta.dirname, '..');
const CORE_SRC = join(HERE, '..', 'core', 'src');
const CODE_SRC = join(HERE, 'src');

/** How many core functions reach an append. Pinned so a broken scan fails loudly. */
const CORE_OPERATIONS_THAT_APPEND = 32;

/** How many paths of the shipped surface reach one of them. */
const SURFACE_WRITE_PATHS = 33;

/** Every non-test TypeScript file under a source root. */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(path);
  }
  return found;
}

/**
 * The file with every comment and every string literal blanked to spaces, newlines
 * kept.
 *
 * Required, not tidiness. This codebase writes long doc-comments that NAME the
 * operations they describe, and a scanner reading them would report a write path in
 * every file that merely explains one — the failure mode is a guard that accuses the
 * innocent, which this bench has already had once (a sweep that matched from one
 * string literal into the next and accused its own file). Newlines survive so the
 * function boundaries below still line up with the real ones.
 */
function codeOnly(text: string): string {
  let out = '';
  let i = 0;
  const blank = (from: number, to: number) => {
    for (const ch of text.slice(from, to)) out += ch === '\n' ? '\n' : ' ';
  };
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === '//') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (two === '/*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    const quote = text[i];
    if (quote === "'" || quote === '"' || quote === '`') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text[j] === quote) break;
        j += 1;
      }
      const stop = Math.min(j + 1, text.length);
      out += quote;
      blank(i + 1, stop - 1);
      out += quote;
      i = stop;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return out;
}

/** One top-level function of a file: its name and its body, code only. */
interface Fn {
  readonly name: string;
  readonly body: string;
}

/**
 * The top-level function declarations of a file.
 *
 * A declaration starts at column 0 and ends at the first line that is exactly `}` —
 * true of every function in these two packages because the formatter says so. It is
 * a real limit and it is declared in this file's doc; the pinned counts are what turn
 * a violation of it into a failure instead of a silence.
 */
function functions(text: string): Fn[] {
  const lines = codeOnly(text).split('\n');
  const found: Fn[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const start = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/.exec(
      lines[i] as string,
    );
    if (start === null) continue;
    let j = i + 1;
    while (j < lines.length && lines[j] !== '}') j += 1;
    found.push({ name: start[1] as string, body: lines.slice(i, j + 1).join('\n') });
    i = j;
  }
  return found;
}

/** Whether a body calls `name(`. */
function calls(body: string, name: string): boolean {
  return new RegExp(`\\b${name}\\s*\\(`).test(body);
}

/**
 * Every function of the core that reaches a writer's append — directly through the
 * door (`appendEvent`/`appendEvents`), through the one deliberate exception that
 * calls the writer itself (the founding), or through another operation that does.
 *
 * Closed by fixpoint rather than by a list, and derived from the door rather than
 * from the names: an operation renamed tomorrow is still found, and an operation that
 * stops appending drops out on its own.
 */
function coreOperationsThatAppend(): Set<string> {
  const bodies = new Map<string, string>();
  for (const file of sourceFiles(CORE_SRC)) {
    for (const fn of functions(readFileSync(file, 'utf-8'))) bodies.set(fn.name, fn.body);
  }
  const reaching = new Set<string>();
  for (const [name, body] of bodies) {
    if (/\.append(All)?\s*\(|\bappendEvents?\s*\(/.test(body)) reaching.add(name);
  }
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, body] of bodies) {
      if (reaching.has(name)) continue;
      for (const op of reaching) {
        if (!calls(body, op)) continue;
        reaching.add(name);
        grew = true;
        break;
      }
    }
  }
  return reaching;
}

/** One path of the shipped surface that can put an event on a tail. */
interface WritePath {
  /** `<file>:<function>`, the key both halves of this file agree on. */
  readonly at: string;
  /** Whether it signs what it wrote before it returns. */
  readonly signs: boolean;
}

/** Every such path, and whether it signs. */
function surfaceWritePaths(operations: ReadonlySet<string>): WritePath[] {
  const found: WritePath[] = [];
  for (const file of sourceFiles(CODE_SRC)) {
    for (const fn of functions(readFileSync(file, 'utf-8'))) {
      if (![...operations].some((op) => calls(fn.body, op))) continue;
      found.push({
        at: `${relative(CODE_SRC, file).replaceAll('\\', '/')}:${fn.name}`,
        signs: /\.checkpoint\s*\(\s*\)/.test(fn.body),
      });
    }
  }
  return found.sort((a, b) => a.at.localeCompare(b.at));
}

const OPERATIONS = coreOperationsThatAppend();
const PATHS = surfaceWritePaths(OPERATIONS);

describe('the source guard — no write path can skip the signing', () => {
  it('reads its own instrument correctly before it accuses anything', () => {
    // The instrument gets its own case, because an instrument that cannot say it
    // broke is worse than none. Three things are checked on a fixture nobody else
    // touches: a call inside a line comment is not a call, a call inside a block
    // comment is not a call, and a call inside a string is not a call — while a real
    // one in the same file still is.
    const fixture = [
      'function innocent() {',
      '  // createTask(ctx, {});',
      '  /* createTask(ctx, {}); */',
      '  const said = "createTask(ctx, {})";',
      '  return said;',
      '}',
      'function guilty() {',
      '  return createTask(ctx, {});',
      '}',
    ].join('\n');
    const seen = functions(fixture);
    expect(seen.map((fn) => fn.name)).toEqual(['innocent', 'guilty']);
    expect(calls(seen[0]?.body as string, 'createTask')).toBe(false);
    expect(calls(seen[1]?.body as string, 'createTask')).toBe(true);
    // And the blanker keeps the line count, which is what makes the `}` boundary
    // above land where it really is.
    expect(codeOnly(fixture).split('\n')).toHaveLength(fixture.split('\n').length);
  });

  it('finds the operations from the door, not from a list', () => {
    // NON-VACUITY, both directions. The count fails when the fixpoint stops finding
    // anything (a renamed door, a moved package), and the two named members fail when
    // the transitive step stops working: `createTask` calls the door itself, and
    // `establishIdentity` reaches it only through another operation.
    expect(OPERATIONS.size).toBe(CORE_OPERATIONS_THAT_APPEND);
    expect(OPERATIONS.has('createTask')).toBe(true);
    expect(OPERATIONS.has('establishIdentity')).toBe(true);
    // And it does not simply include everything: a read of the record is not a write.
    expect(OPERATIONS.has('orderedEvents')).toBe(false);
  });

  it('finds every write path of the surface, and every one of them signs', () => {
    // The count is pinned for the reason the mold's is: a structural guard goes
    // vacuous, and "the set is empty" must fail as loudly as "a new path forgot". A
    // path added tomorrow moves this number and the author has to say so.
    expect(PATHS).toHaveLength(SURFACE_WRITE_PATHS);
    // THE RULE. A path listed here appended an event and returned without signing it,
    // which leaves the record below `fully-signed` with nothing coming back for it.
    // Sign before you return — `writer.checkpoint()` on the context you wrote through.
    expect(PATHS.filter((path) => !path.signs).map((path) => path.at)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Half 2 — the behavioural sweep
// ---------------------------------------------------------------------------

const upcasters = catalogUpcasters();

/** Every chain root of a workspace that exists, by scope. */
function rootsOf(trees: ResolvedTrees): { readonly scope: Scope; readonly root: string }[] {
  const scopes: Scope[] = ['public', 'private', 'global'];
  const found: { scope: Scope; root: string }[] = [];
  for (const scope of scopes) {
    const root = chainRootForScope(trees, scope);
    if (root !== undefined) found.push({ scope, root });
  }
  return found;
}

/** What rests above a checkpoint anywhere in this workspace, and how many events it holds. */
function acrossTrees(
  cwd: string,
  env: DiscoveryEnv,
): {
  readonly uncovered: readonly string[];
  readonly events: number;
  readonly levels: readonly string[];
} {
  const uncovered: string[] = [];
  const levels: string[] = [];
  let events = 0;
  for (const { scope, root } of rootsOf(resolveTrees(cwd, env))) {
    const verdict = verify(root);
    events += verdict.tails.reduce((sum, tail) => sum + tail.entryCount, 0);
    if (verdict.tails.length > 0) levels.push(verdict.level);
    if (verdict.uncheckpointedEvents > 0) {
      uncovered.push(`${scope}: ${verdict.uncheckpointedEvents} event(s), ${verdict.level}`);
    }
  }
  return { uncovered, events, levels };
}

let sandbox: string;
let env: DiscoveryEnv;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-signs-'));
  env = { home: join(sandbox, 'home'), xdgDataHome: join(sandbox, 'home', '.local', 'share') };
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A second machine's identity, sharing the sandbox but not the key root. */
function otherMachine(name: string): DiscoveryEnv {
  return { home: join(sandbox, name), xdgDataHome: join(sandbox, name, '.local', 'share') };
}

/**
 * Merges a tail this machine did not write into a tree, the way an offline copy is —
 * the only kind of tail a prune waiver may ever name.
 */
function mergeAForeignTail(into: string): string {
  const machine = mkdtempSync(join(tmpdir(), 'mnema-signs-other-'));
  try {
    const trees = { keyRoot: machine, projectPublic: machine } as unknown as ResolvedTrees;
    const writer = openTreeForWriting(trees, 'public');
    const made = createTask(
      { writer, layout: { root: machine }, upcasters },
      { title: 'work another machine did' },
    );
    if (!made.ok) throw new Error('the other machine wrote nothing to cut');
    writer.checkpoint();
    for (const tail of readdirSync(join(machine, 'tails'))) {
      cpSync(join(machine, 'tails', tail), join(into, 'tails', tail), { recursive: true });
    }
    for (const key of readdirSync(join(machine, 'keys'))) {
      if (key.endsWith('.pub')) cpSync(join(machine, 'keys', key), join(into, 'keys', key));
    }
    return writer.tail;
  } finally {
    rmSync(machine, { recursive: true, force: true });
  }
}

/**
 * One driven path: what it is called, and the act that reaches it.
 *
 * `at` is the key the source guard produced, so the two halves cannot drift: a path
 * added to one is missing from the other and the completeness check below says which.
 */
interface Driven {
  readonly at: string;
  /** Runs the act. Throws if the fixture could not produce what it needs. */
  readonly drive: () => void;
}

/** A path the sweep does not drive, and the reason — the honest half of the list. */
const NOT_DRIVEN: Readonly<Record<string, string>> = {};

describe('every write path leaves the record fully signed', () => {
  /**
   * The CLI surface, driven in one project, in order, so each act builds on the last.
   *
   * Every row is the invocation that RECORDS, never the one that is easiest: a
   * refusal appends nothing and would make its row pass for a reason that has nothing
   * to do with signing, which is why each row's write is asserted to have landed.
   */
  function cliSweep(): readonly Driven[] {
    const project = join(sandbox, 'repo');
    mkdirSync(project, { recursive: true });
    const ctx = { cwd: project, env };
    let task = '';
    let decision = '';
    let skill = '';
    let run = '';
    let backupKey = '';
    let foreignTail = '';
    const ok = <T extends { ok: boolean }>(what: string, result: T): T => {
      if (!result.ok) throw new Error(`${what} was refused: ${JSON.stringify(result)}`);
      return result;
    };
    return [
      {
        at: 'commands/init.ts:runInit',
        drive: () => {
          const made = runInit(ctx);
          if (!made.created) throw new Error('init founded nothing');
          backupKey = made.identity.backup?.fingerprint as string;
          if (backupKey === undefined) throw new Error('init made no backup key');
        },
      },
      {
        at: 'commands/task.ts:runTask',
        drive: () => {
          task = ok('task', runTask(ctx, { title: 'a task' })).id;
        },
      },
      {
        at: 'commands/task-transition.ts:runTaskTransition',
        drive: () => void ok('submit', runTaskTransition(ctx, { id: task, action: 'submit' })),
      },
      {
        at: 'commands/decision.ts:runDecision',
        drive: () => {
          decision = ok(
            'decision',
            runDecision(ctx, { title: 'a decision', rationale: 'because' }),
          ).id;
        },
      },
      {
        at: 'commands/decision-transition.ts:runDecisionTransition',
        drive: () =>
          void ok(
            'accept',
            runDecisionTransition(ctx, {
              id: decision,
              action: 'accept',
              proof: { note: 'we ship it' },
            }),
          ),
      },
      {
        at: 'commands/decision-import.ts:runDecisionImport',
        drive: () => {
          const adrs = join(project, 'docs', 'adr');
          mkdirSync(adrs, { recursive: true });
          writeFileSync(
            join(adrs, '0001-utc.md'),
            '# Use UTC everywhere\n\n- **Status:** Accepted\n\n## Context\n\nthe zone drifts\n',
            'utf-8',
          );
          const imported = ok('import', runDecisionImport(ctx, { from: 'docs/adr', write: true }));
          if (imported.ok && imported.proposals.length === 0) {
            throw new Error('the import recorded nothing');
          }
        },
      },
      {
        at: 'commands/skill.ts:runSkill',
        drive: () => {
          skill = ok('skill', runSkill(ctx, { name: 'a pattern', body: 'the pattern' })).id;
        },
      },
      {
        at: 'commands/skill-transition.ts:runSkillTransition',
        drive: () =>
          void ok(
            'review',
            runSkillTransition(ctx, { id: skill, action: 'review', proof: { note: 'seen' } }),
          ),
      },
      {
        at: 'commands/memory.ts:runMemory',
        drive: () => void ok('memory', runMemory(ctx, { content: 'worth keeping' })),
      },
      {
        at: 'commands/observe.ts:runObserve',
        drive: () =>
          void ok(
            'observe',
            runObserve(ctx, { about: task, topic: 'review', text: 'it needs a rollback' }),
          ),
      },
      {
        at: 'commands/handoff.ts:runHandoff',
        drive: () =>
          void ok('handoff', runHandoff(ctx, { task, fromAgent: 'alpha', toAgent: 'beta' })),
      },
      {
        at: 'commands/link.ts:runLink',
        drive: () =>
          void ok('link', runLink(ctx, { subject: decision, target: task, rel: 'relates-to' })),
      },
      {
        at: 'commands/run-start.ts:runRunStart',
        drive: () => {
          run = ok('run start', runRunStart(ctx, { agent: 'agent-alpha' })).id;
        },
      },
      {
        at: 'commands/run-end.ts:runRunEnd',
        drive: () => void ok('run end', runRunEnd(ctx, { run, which: 'agent-alpha' })),
      },
      {
        at: 'commands/switch.ts:runSwitch',
        drive: () =>
          void ok(
            'switch',
            runSwitch(ctx, { channel: 'edit-rules-push', on: false, reason: 'porting' }),
          ),
      },
      {
        at: 'commands/key-enroll.ts:runKeyEnroll',
        drive: () => {
          const joining = otherMachine('joiner');
          const anchor = runInit({ cwd: project, env }).anchor;
          const asked = ok(
            'key request',
            runKeyRequest({ cwd: project, env: joining }, { anchor }),
          );
          void ok(
            'key enroll',
            runKeyEnroll(ctx, { request: (asked as { request: string }).request }),
          );
        },
      },
      {
        at: 'commands/key-revoke.ts:runKeyRevoke',
        drive: () =>
          void ok(
            'key revoke',
            runKeyRevoke(ctx, { fingerprint: backupKey, reason: 'it left this machine' }),
          ),
      },
      {
        at: 'commands/tail-prune.ts:runTailPrune',
        drive: () => {
          const publicRoot = chainRootForScope(resolveTrees(project, env), 'public') as string;
          foreignTail = mergeAForeignTail(publicRoot);
          void ok(
            'tail prune',
            runTailPrune(ctx, { tail: foreignTail, reason: 'the person asked to be taken out' }),
          );
        },
      },
    ];
  }

  /**
   * The MCP surface, driven over its own project, in order.
   *
   * It is the surface an agent actually uses and the surface both defects were on, so
   * the session's own lifecycle — opening a run, closing the connection — has rows of
   * its own rather than being treated as plumbing under the tools.
   */
  function mcpSweep(): readonly Driven[] {
    const project = join(sandbox, 'served');
    mkdirSync(project, { recursive: true });
    ensureTree({ root: join(project, PROJECT_DIR) });
    let session: Session | undefined;
    const on = (): Session => {
      session ??= openSession({
        clientName: 'claude-code',
        roots: [pathToFileURL(project).href],
        env,
      });
      return session;
    };
    let task = '';
    let decision = '';
    let skill = '';
    const ok = <T extends { ok: boolean }>(what: string, result: T): T => {
      if (!result.ok) throw new Error(`${what} was refused: ${JSON.stringify(result)}`);
      return result;
    };
    return [
      {
        // The run's own opening, driven through the door rather than a tool, so what
        // this row proves is that the RUN is signed and not that some later write
        // happened to cover it.
        at: 'mcp/session.ts:ensureRun',
        drive: () => void openWrite(on(), 'public'),
      },
      {
        at: 'mcp/tools.ts:runCreateTask',
        drive: () => {
          task = (
            ok('create_task', runCreateTask(on(), { title: 'served work' })) as { id: string }
          ).id;
        },
      },
      {
        at: 'mcp/tools.ts:runTaskTransition',
        drive: () =>
          void ok('task_transition', runMcpTaskTransition(on(), { id: task, action: 'submit' })),
      },
      {
        at: 'mcp/tools.ts:runRecordDecision',
        drive: () => {
          decision = (
            ok(
              'record_decision',
              runRecordDecision(on(), { title: 'served decision', rationale: 'because' }),
            ) as { id: string }
          ).id;
        },
      },
      {
        at: 'mcp/tools.ts:runDecisionTransition',
        drive: () =>
          void ok(
            'decision_transition',
            runMcpDecisionTransition(on(), { id: decision, action: 'accept', note: 'we ship it' }),
          ),
      },
      {
        at: 'mcp/tools.ts:runCreateSkill',
        drive: () => {
          skill = (
            ok(
              'create_skill',
              runCreateSkill(on(), { name: 'a served pattern', body: 'the pattern' }),
            ) as { id: string }
          ).id;
        },
      },
      {
        at: 'mcp/tools.ts:runSkillTransition',
        drive: () => {
          void ok(
            'skill_transition',
            runMcpSkillTransition(on(), { id: skill, action: 'review', note: 'seen' }),
          );
          void ok(
            'skill_transition',
            runMcpSkillTransition(on(), { id: skill, action: 'adopt', note: 'we use it' }),
          );
        },
      },
      {
        at: 'mcp/tools.ts:runCaptureMemory',
        drive: () =>
          void ok('capture_memory', runCaptureMemory(on(), { content: 'worth keeping' })),
      },
      {
        at: 'mcp/tools.ts:runRecordObservation',
        drive: () =>
          void ok(
            'record_observation',
            runRecordObservation(on(), { about: task, topic: 'review', text: 'needs a rollback' }),
          ),
      },
      {
        at: 'mcp/tools.ts:runRecordHandoff',
        drive: () =>
          void ok('record_handoff', runRecordHandoff(on(), { task, from: 'alpha', to: 'beta' })),
      },
      {
        at: 'mcp/tools.ts:runLinkKnowledge',
        drive: () =>
          void ok(
            'link_knowledge',
            runLinkKnowledge(on(), { subject: decision, target: task, rel: 'relates-to' }),
          ),
      },
      {
        // Reached through the `skills` tool, which is the only way in: a consultation
        // is recorded by serving a pattern, never asked for on its own. The pattern
        // adopted above is what makes the catalogue serve a body at all.
        at: 'mcp/tools.ts:recordConsultations',
        drive: () => void ok('skills', runSkillsTool(on())),
      },
      {
        // Both channel writers are reached through the edit gate, and reaching them
        // takes a record that really governs: a rule that asks for a person at a path
        // (which makes the charge) and one that governs it (which makes the push
        // speak). Without those links the gate answers and writes nothing, and these
        // two rows would pass having driven nothing at all.
        at: 'mcp/tools.ts:recordAskings',
        drive: () => {
          void ok(
            'asks-for-a-person',
            runLinkKnowledge(on(), {
              subject: decision,
              target: 'src/billing',
              rel: 'asks-for-a-person',
            }),
          );
          const asked = runRulesBeforeAnEditTool(on(), { path: 'src/billing/invoice.ts' });
          if (!asked.ok) throw new Error('the edit gate refused');
        },
      },
      {
        at: 'mcp/tools.ts:recordServices',
        drive: () => {
          void ok(
            'governs',
            runLinkKnowledge(on(), { subject: decision, target: 'src', rel: 'governs' }),
          );
          const said = runRulesBeforeAnEditTool(on(), { path: 'src/billing/invoice.ts' });
          if (!said.ok) throw new Error('the edit gate refused');
        },
      },
      {
        // LAST, and this is the row the whole file was built by: closing the
        // connection is the final act of writing a session performs, and nothing can
        // ever come back to sign it.
        at: 'mcp/session.ts:closeSession',
        drive: () => {
          const closing = on();
          const closed = closeSession(closing);
          if (closed.closed.length === 0) throw new Error('the close recorded no run end');
          session = undefined;
        },
      },
    ];
  }

  it('sweeps every path the source guard found, or says why not', () => {
    // The completeness check, and the reason the two halves share one key. Without it
    // the sweep is a list, and a list is what nobody remembers to extend — the exact
    // failure this whole file exists against.
    const driven = [...cliSweep(), ...mcpSweep()].map((row) => row.at);
    expect(new Set(driven).size, 'a path is driven twice').toBe(driven.length);
    expect([...driven, ...Object.keys(NOT_DRIVEN)].sort()).toEqual(PATHS.map((p) => p.at).sort());
  });

  it('leaves nothing above a checkpoint, after every CLI write there is', () => {
    const project = join(sandbox, 'repo');
    for (const row of cliSweep()) {
      const before = acrossTrees(project, env);
      row.drive();
      const after = acrossTrees(project, env);
      // THE RULE. Anything here is an act of writing that returned without signing.
      expect(after.uncovered, row.at).toEqual([]);
      // And the row really wrote: a refusal appends nothing, so a row that decayed
      // into one would pass this guard having proved nothing about signing.
      expect(after.events, `${row.at} appended nothing`).toBeGreaterThan(before.events);
    }
    const end = acrossTrees(project, env);
    expect(end.levels).toContain('fully-signed');
  });

  it('leaves nothing above a checkpoint, after every MCP write there is', () => {
    const project = join(sandbox, 'served');
    for (const row of mcpSweep()) {
      const before = acrossTrees(project, env);
      row.drive();
      const after = acrossTrees(project, env);
      expect(after.uncovered, row.at).toEqual([]);
      expect(after.events, `${row.at} appended nothing`).toBeGreaterThan(before.events);
    }
    const end = acrossTrees(project, env);
    expect(end.levels).toContain('fully-signed');
  });

  it('keeps the cadence at one signature per act of writing', () => {
    // The non-regression the delivery owes: this is what the cadence WAS before any
    // of it, measured on the binary (30 writes to a fresh record — 32 events, 31
    // checkpoints, 1.03 events per checkpoint), and it must not have moved. Counted
    // off the files rather than through `verify`, because what is being pinned is the
    // ratio and not the level.
    const project = join(sandbox, 'cadence');
    mkdirSync(project, { recursive: true });
    const ctx = { cwd: project, env };
    runInit(ctx);
    for (let i = 0; i < 30; i += 1) {
      const captured = runMemory(ctx, { content: `note ${i}` });
      if (!captured.ok) throw new Error('the capture was refused');
    }
    const root = chainRootForScope(resolveTrees(project, env), 'public') as string;
    let events = 0;
    let checkpoints = 0;
    for (const tail of readdirSync(join(root, 'tails'))) {
      const dir = join(root, 'tails', tail);
      for (const file of readdirSync(dir)) {
        const lines = readFileSync(join(dir, file), 'utf-8').split('\n').filter(Boolean).length;
        if (/^\d+\.jsonl$/.test(file)) events += lines;
        if (file === 'checkpoints.jsonl') checkpoints += lines;
      }
    }
    expect(events).toBe(32);
    expect(checkpoints).toBe(31);
    expect(verify(root).level).toBe('fully-signed');
  });
});

// ---------------------------------------------------------------------------
// The ceiling under the cadence
// ---------------------------------------------------------------------------

describe('the ceiling the writer holds on its own', () => {
  it('fires on a real act too big to wait for, with nobody calling checkpoint', () => {
    // THE ELO, and the case that took `DEFAULT_MAX_UNSIGNED_EVENTS` off the list of
    // inert exports. `mnema decision import --write` puts TWO events on the tail per
    // ADR — the decision and the link that records where it came from — through a
    // single writer, and signs once at the end. So a directory of 33 ADRs crosses 64
    // in one act, the writer signs on its own before the command asks, and the record
    // has more checkpoints than the command wrote.
    //
    // What this measures is the CEILING, not the cadence: the ceiling caps how much
    // one act may leave open, the cadence is one signature per act, and this is the
    // only shape in which the two are distinguishable.
    const project = join(sandbox, 'bulk');
    const adrs = join(project, 'docs', 'adr');
    mkdirSync(adrs, { recursive: true });
    runInit({ cwd: project, env });
    const COUNT = 33;
    for (let i = 0; i < COUNT; i += 1) {
      writeFileSync(
        join(adrs, `${String(i + 1).padStart(4, '0')}-choice.md`),
        `# Choice number ${i}\n\n- **Status:** Accepted\n\n## Context\n\nit had to be settled\n`,
        'utf-8',
      );
    }
    const imported = runDecisionImport({ cwd: project, env }, { from: 'docs/adr', write: true });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.proposals).toHaveLength(COUNT);

    const root = chainRootForScope(resolveTrees(project, env), 'public') as string;
    let checkpoints = 0;
    for (const tail of readdirSync(join(root, 'tails'))) {
      const path = join(root, 'tails', tail, 'checkpoints.jsonl');
      checkpoints += readFileSync(path, 'utf-8').split('\n').filter(Boolean).length;
    }
    // `init` signed once and the import signed once at the end; a THIRD checkpoint is
    // one nobody asked for, and only the ceiling can have made it. Fewer than three
    // means the ceiling did not fire, which is what this case exists to refuse.
    expect(checkpoints).toBe(3);
    expect(verify(root).level).toBe('fully-signed');
  });
});
