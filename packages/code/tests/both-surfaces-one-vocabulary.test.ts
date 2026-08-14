/**
 * The two surfaces, one vocabulary: what the CLI's declarations and the MCP's tool
 * schemas both read, and what neither of them types.
 *
 * The CLI stopped re-typing the domain's closed sets one slice ago; the MCP was still
 * doing it, and there the duplication had teeth. A help string that lists ten of eleven
 * actions misinforms a reader. A `z.enum(['public', 'private', 'global'])` typed by hand
 * REFUSES: an input schema is the contract the client validates against, so a fourth tree
 * added to the domain would have reached the CLI's help, its Tab and its refusal, and left
 * the agent-facing door rejecting a word the same product accepts — in the SDK's voice,
 * with a schema error, on the surface agents use.
 *
 * Three things are asserted here, and they are different:
 *   - THE MCP ADVERTISES THE DOMAIN'S SETS. Read off `tools/list` — the JSON Schema the
 *     protocol actually hands a client — and compared against `@mnema/core` and the
 *     surfaces' shared module, never against a list typed in this file.
 *   - WHAT IT ADVERTISES DID NOT CHANGE. Ten enums, the same ten values, in the same
 *     order. That is the acceptance criterion of this slice and not a side note: the whole
 *     change is meant to be functionally null today and impossible to drift tomorrow.
 *   - THE GLOSS IS ONE. Proved by pulling the phrase out of BOTH outputs — the real
 *     `--help` of the real binary, and the real description `tools/list` serves — and
 *     comparing them to each other. Never to a sentence written here: a test that spelled
 *     the gloss out would pass while both doors said the same wrong thing.
 *
 * WHICH WORDING WON, AND WHY. `private` was "this machine" on the CLI and "this machine,
 * this project" on the MCP. The second is true — the private tree is `.mnema/private/`
 * INSIDE a project, so a machine with four projects has four of them — and the first was
 * not a shorter way of saying it but a different claim, one a reader would act on by
 * expecting a private memory to follow them to the next repository. So the CLI's help
 * changed, at all seven births, and `cli.help.golden.txt` carries the diff.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureTree } from '@mnema/chain';
import {
  DECISION_ACTIONS,
  DECISION_TRANSITIONS,
  type DiscoveryEnv,
  PROJECT_DIR,
  type ProofField,
  SEARCH_KINDS,
  SKILL_ACTIONS,
  SKILL_TRANSITIONS,
  TASK_ACTIONS,
  TRANSITIONS,
} from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProgram, type CliIo } from '../src/cli.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { REFERENCE_DIRECTIONS } from '../src/reference-directions.js';
import * as shared from '../src/vocabulary.js';
import { actionsRequiring, listed, orListed, SCOPE_CHOICES, SCOPES } from '../src/vocabulary.js';
import { valuesDeclaredOn } from '../src/wiring/enumerated.js';
import { everyCommandOf } from '../src/wiring/misuse.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** A silent port: everything that reads declarations writes nothing. */
const silent: CliIo = { out: () => {}, err: () => {}, fail: () => {} };

let sandbox: string;
let env: DiscoveryEnv;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-both-surfaces-'));
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  env = { home, xdgDataHome: join(sandbox, 'data') };
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Reading each door
// ---------------------------------------------------------------------------

/** One property of one tool's input schema, as the protocol serves it. */
interface Advertised {
  /** `capture_memory.scope` — how a reader would name it. */
  readonly where: string;
  /** The closed set the schema says the value comes from, or undefined. */
  readonly values: readonly string[] | undefined;
  /** What the schema says the field is for. */
  readonly description: string;
}

/** Everything `tools/list` advertises, per tool, plus each tool's own description. */
async function advertised(): Promise<{
  readonly fields: readonly Advertised[];
  readonly tools: readonly string[];
  readonly toolDescription: (name: string) => string;
}> {
  const project = join(sandbox, 'proj');
  mkdirSync(project, { recursive: true });
  ensureTree({ root: join(project, PROJECT_DIR) });

  const { server } = buildMcpServer({ env, log: () => {} });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(project).href }],
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const { tools } = await client.listTools();
  await client.close();

  const fields: Advertised[] = [];
  for (const tool of tools) {
    const properties = (tool.inputSchema.properties ?? {}) as Record<
      string,
      { enum?: readonly string[]; description?: string }
    >;
    for (const [name, schema] of Object.entries(properties)) {
      fields.push({
        where: `${tool.name}.${name}`,
        values: schema.enum,
        description: schema.description ?? '',
      });
    }
  }
  return {
    fields,
    tools: tools.map((tool) => tool.name),
    toolDescription: (name) => tools.find((tool) => tool.name === name)?.description ?? '',
  };
}

/** The MCP field at `where`, or a failure that names it. */
function fieldAt(fields: readonly Advertised[], where: string): Advertised {
  const found = fields.find((field) => field.where === where);
  expect(found, `no tool advertises \`${where}\``).toBeDefined();
  return found as Advertised;
}

/** The CLI's declared help for one option, by the path a caller types. */
function cliOptionHelp(path: string, long: string): string {
  const program = buildProgram(silent).program;
  const command = everyCommandOf(program).find((each) => {
    const names: string[] = [];
    for (let at = each; at.parent !== null; at = at.parent) names.unshift(at.name());
    return names.join(' ') === path;
  });
  expect(command, path).toBeDefined();
  const option = command?.options.find((each) => each.long === long);
  expect(option, `${path} ${long}`).toBeDefined();
  return option?.description ?? '';
}

/** The real `mnema <verb> --help`, unwrapped — commander breaks a description on width. */
function cliHelp(...args: string[]): string {
  const inherited = { ...process.env };
  delete inherited.MNEMA_RUN;
  const done = spawnSync(process.execPath, [CLI, ...args, '--help'], {
    cwd: sandbox,
    env: { ...inherited, HOME: join(sandbox, 'home'), XDG_DATA_HOME: join(sandbox, 'data') },
    encoding: 'utf-8',
  });
  return `${done.stdout}${done.stderr}`.replace(/\s+/g, ' ');
}

/**
 * The gloss each scope carries, pulled out of whatever text `where` produced.
 *
 * SHAPE, not content: the pattern is built from `SCOPES` — the domain's own set, in its
 * own order — and every gloss is a CAPTURE. So this function never states what a scope
 * means, which is the whole point of comparing two doors with it: if it held the sentence,
 * both doors could be wrong together and it would still pass.
 */
function scopeGlossesIn(text: string): readonly string[] | undefined {
  const shape = SCOPES.map(
    (scope, at) => `${at === SCOPES.length - 1 ? 'or ' : ''}${scope} \\(([^)]*)\\)`,
  ).join(', ');
  const found = new RegExp(shape).exec(text);
  return found === null ? undefined : found.slice(1);
}

// ---------------------------------------------------------------------------
// The MCP advertises the domain's sets
// ---------------------------------------------------------------------------

describe('the MCP takes its sets from the domain', () => {
  it('advertises, at every enumerated field, exactly a set the machine owns', async () => {
    const { fields } = await advertised();
    // Every closed set the protocol advertises, matched against the machine's own — by
    // value, because JSON Schema is what crossed the wire and an array's identity does
    // not survive it. A field enumerating anything else lands in `foreign` and is red
    // there, named, rather than making some count wrong somewhere else.
    const known = [[...SCOPES], [...SEARCH_KINDS], [...REFERENCE_DIRECTIONS]];
    const enumerated = fields.filter((field) => field.values !== undefined);
    const foreign = enumerated.filter(
      (field) =>
        !known.some(
          (set) =>
            set.length === field.values?.length &&
            set.every((value, at) => value === field.values?.[at]),
        ),
    );
    expect(foreign.map((field) => `${field.where} = ${JSON.stringify(field.values)}`)).toEqual([]);
    // And there ARE enumerated fields — eight scopes, a kind, a direction. A schema that
    // stopped enumerating would satisfy the assertion above by having nothing to check.
    expect(enumerated).toHaveLength(10);
    expect(enumerated.filter((field) => field.where.endsWith('.scope'))).toHaveLength(8);
  });

  it('advertises the SAME values it advertised before, in the same order', async () => {
    const { fields } = await advertised();
    // THE ACCEPTANCE CRITERION. The nine hand-typed arrays and the set now read from the
    // domain agree today — which is what makes this slice safe — so the values below are
    // the ones the protocol served before the change, written out ON PURPOSE: this is the
    // one assertion in the file that must NOT be derived, because deriving it from the
    // same source the production code reads would make it true by construction and say
    // nothing about what a client used to be able to send.
    for (const where of [
      'capture_memory.scope',
      'record_observation.scope',
      'record_handoff.scope',
      'link_knowledge.scope',
      'create_task.scope',
      'record_decision.scope',
      'create_skill.scope',
      'search.scope',
    ]) {
      expect(fieldAt(fields, where).values, where).toEqual(['public', 'private', 'global']);
    }
    expect(fieldAt(fields, 'audit_refs.direction').values).toEqual(['both', 'out', 'in']);
    expect(fieldAt(fields, 'search.kind').values).toEqual([
      'memory',
      'observation',
      'decision',
      'task',
      'skill',
    ]);
  });

  it('leaves a transition’s `action` free text, so the GATE still refuses a bad word', async () => {
    const { fields } = await advertised();
    // The other half of "nothing validates". A `z.enum` on `action` would have the SDK
    // reject `nonsense` before any adapter ran, and the refusal an agent must get is the
    // gate's own, with its own code — the same reason the CLI's `<action>` carries no
    // `.choices()`. Three tools, one rule.
    for (const where of [
      'task_transition.action',
      'decision_transition.action',
      'skill_transition.action',
      'guard.action',
    ]) {
      expect(fieldAt(fields, where).values, where).toBeUndefined();
    }
    // And the words are still SAID, which is how an agent learns a vocabulary the schema
    // does not own: each transition tool names every member of its own workflow's set —
    // whole, in one generated phrase, so a set listed short is red at whichever tool did
    // it. The `action` field of `guard` reads the task vocabulary too, from the tool
    // description that carries it.
    const { toolDescription } = await advertised();
    for (const [tool, set] of [
      ['task_transition', TASK_ACTIONS],
      ['decision_transition', DECISION_ACTIONS],
      ['skill_transition', SKILL_ACTIONS],
    ] as const) {
      for (const action of set)
        expect(toolDescription(tool), `${tool}/${action}`).toContain(action);
    }
    // And WHOLE, in one generated phrase, at the place each tool says it. The three shapes
    // differ because the three sentences do, and each is generated: the task list runs
    // inside the tool's own description, the other two in their `action` field.
    expect(toolDescription('task_transition')).toContain(listed(TASK_ACTIONS));
    expect(fieldAt(fields, 'decision_transition.action').description).toContain(
      orListed(DECISION_ACTIONS),
    );
    expect(fieldAt(fields, 'skill_transition.action').description).toContain(
      orListed(SKILL_ACTIONS),
    );
  });

  it('names, in each proof field, exactly the actions the workflow table requires it for', async () => {
    const { fields } = await advertised();
    // The MCP's ten proof descriptions, against the rows the gate enforces — derived HERE,
    // independently of the production helper, over each workflow's own table. That
    // independence is the whole assertion and it was learned the hard way: a first version
    // read `actionsRequiring`, so inverting that function's filter left these ten cases
    // green while every one of the sentences was wrong. A test that asks the code what it
    // should have produced proves nothing about what it produced.
    const requiring = (
      table: readonly { readonly action: string; readonly requires: readonly ProofField[] }[],
      actions: readonly string[],
      field: ProofField,
    ): string =>
      actions
        .filter((action) =>
          table.some((row) => row.action === action && row.requires.includes(field)),
        )
        .join(', ');

    expect(fieldAt(fields, 'task_transition.reason').description).toBe(
      `Why (${requiring(TRANSITIONS, TASK_ACTIONS, 'reason')}).`,
    );
    expect(fieldAt(fields, 'task_transition.note').description).toBe(
      `What was done (${requiring(TRANSITIONS, TASK_ACTIONS, 'note')}).`,
    );
    expect(fieldAt(fields, 'task_transition.feedback').description).toBe(
      `What must change (${requiring(TRANSITIONS, TASK_ACTIONS, 'feedback')}).`,
    );
    expect(fieldAt(fields, 'guard.reason').description).toBe(
      `Simulate the reason (${requiring(TRANSITIONS, TASK_ACTIONS, 'reason')}).`,
    );
    expect(fieldAt(fields, 'guard.note').description).toBe(
      `Simulate the note (${requiring(TRANSITIONS, TASK_ACTIONS, 'note')}).`,
    );
    expect(fieldAt(fields, 'guard.feedback').description).toBe(
      `Simulate the feedback (${requiring(TRANSITIONS, TASK_ACTIONS, 'feedback')}).`,
    );
    expect(fieldAt(fields, 'decision_transition.note').description).toBe(
      `Why this verdict (${requiring(DECISION_TRANSITIONS, DECISION_ACTIONS, 'note')}).`,
    );
    expect(fieldAt(fields, 'decision_transition.reason').description).toBe(
      `Why it is being replaced (${requiring(DECISION_TRANSITIONS, DECISION_ACTIONS, 'reason')}).`,
    );
    expect(fieldAt(fields, 'skill_transition.note').description).toBe(
      `Why this verdict (${requiring(SKILL_TRANSITIONS, SKILL_ACTIONS, 'note')}).`,
    );
    expect(fieldAt(fields, 'skill_transition.reason').description).toBe(
      `Why it fell out of use (${requiring(SKILL_TRANSITIONS, SKILL_ACTIONS, 'reason')}).`,
    );
    // Each of those lists has to hold something, or the ten assertions above would pass
    // on empty parentheses — which is what a table read the wrong way round produces.
    for (const [table, actions, field] of [
      [TRANSITIONS, TASK_ACTIONS, 'reason'],
      [TRANSITIONS, TASK_ACTIONS, 'note'],
      [TRANSITIONS, TASK_ACTIONS, 'feedback'],
      [DECISION_TRANSITIONS, DECISION_ACTIONS, 'note'],
      [DECISION_TRANSITIONS, DECISION_ACTIONS, 'reason'],
      [SKILL_TRANSITIONS, SKILL_ACTIONS, 'note'],
      [SKILL_TRANSITIONS, SKILL_ACTIONS, 'reason'],
    ] as const) {
      expect(requiring(table, actions, field).length, field).toBeGreaterThan(0);
    }
    // And the production helper agrees with the table read here, which is what makes the
    // CLI's nine sentences and the MCP's ten the SAME rule rather than two that match.
    expect(listed(actionsRequiring('task', 'reason'))).toBe(
      requiring(TRANSITIONS, TASK_ACTIONS, 'reason'),
    );
  });
});

// ---------------------------------------------------------------------------
// The gloss is one, in both doors
// ---------------------------------------------------------------------------

describe('one gloss, two doors', () => {
  it('glosses a scope identically in the CLI’s help and the MCP’s tool description', async () => {
    const { toolDescription } = await advertised();
    const fromMcp = scopeGlossesIn(toolDescription('capture_memory'));
    const fromCli = scopeGlossesIn(cliHelp('task'));
    // The two OUTPUTS, compared to each other. Not to a sentence written here: the failure
    // this guards is the two doors describing one tree differently, and a test holding the
    // text would pass on the day they agree on something false.
    expect(fromCli).toEqual(fromMcp);
    // Non-vacuity in both directions. The extractor returns undefined when the shape is
    // absent, and `[]`-of-empties when the glosses are blank — both would let the equality
    // above pass while proving nothing.
    expect(fromCli).toHaveLength(SCOPES.length);
    for (const gloss of fromCli ?? []) expect(gloss.length).toBeGreaterThan(0);
    // And it really is the phrase both surfaces build from one constant, so a future
    // reader can find the source from either output.
    expect(toolDescription('capture_memory')).toContain(SCOPE_CHOICES);
    expect(cliOptionHelp('task', '--scope')).toContain(SCOPE_CHOICES);
  });

  it('glosses it the same way at every door that glosses it at all', async () => {
    const { tools, toolDescription } = await advertised();
    const one = scopeGlossesIn(SCOPE_CHOICES);
    // FOUND, not listed: every advertised tool whose description carries the shape. A test
    // naming the four would go quietly vacuous the day a fifth write tool arrives without
    // the gloss — which is the very drift this slice exists to close.
    const glossing = tools.filter((tool) => scopeGlossesIn(toolDescription(tool)) !== undefined);
    for (const tool of glossing) {
      expect(scopeGlossesIn(toolDescription(tool)), tool).toEqual(one);
    }
    for (const verb of ['task', 'decision', 'skill', 'memory', 'observe', 'handoff', 'link']) {
      expect(scopeGlossesIn(cliOptionHelp(verb, '--scope')), verb).toEqual(one);
    }
    // The counts, so neither loop can be satisfied by finding nothing: four MCP tools spell
    // the scopes out, and the seven CLI births above are asked one by one.
    expect(glossing).toHaveLength(4);
    expect(one).toHaveLength(SCOPES.length);
  });

  it('extracts a gloss by SHAPE, and finds none where there is none', () => {
    // The extractor's own non-vacuity, on input this test owns. It has to read a gloss
    // that contains a comma — which is exactly what the wording that won contains — and
    // it has to return undefined for a list with no glosses at all, or the comparison
    // above would be `undefined === undefined` on two doors that lost the gloss together.
    expect(scopeGlossesIn('born: public (a), private (b, c), or global (d)')).toEqual([
      'a',
      'b, c',
      'd',
    ]);
    expect(scopeGlossesIn('born: public, private, or global')).toBeUndefined();
    expect(scopeGlossesIn('nothing about trees here')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Every set the shared module publishes is taken by a door
// ---------------------------------------------------------------------------

describe('the shared vocabulary publishes nothing plumbed to nowhere', () => {
  it('has a door taking every set it exports', async () => {
    const { fields } = await advertised();
    // A2 over the module BOTH surfaces read. A vocabulary declared, glossed and exported
    // with nothing taking it is the shape several defects of this series had: the code
    // under the gap is right, nothing feeds it, and every test passes because ABSENCE is
    // what there is to see. `every-public-value-has-a-caller.test.ts` walks the packages'
    // ENTRY POINTS and cannot see an export of a module inside one — which is what this
    // is, and it is the second slice in a row where that had to be closed by hand.
    //
    // "Taken" means one of the two doors reaches it: a CLI declaration registered through
    // the commander channel (by IDENTITY — the very array), or a set the MCP advertises in
    // a schema (by VALUE — JSON Schema does not carry identity).
    const declared = everyCommandOf(buildProgram(silent).program).flatMap((command) => [
      ...command.registeredArguments.map((argument) => valuesDeclaredOn(argument)),
      ...command.options.map((option) => valuesDeclaredOn(option)),
    ]);
    const advertisedSets = fields
      .map((field) => field.values)
      .filter((values): values is readonly string[] => values !== undefined);
    const taken = (set: readonly string[]): boolean =>
      declared.includes(set) ||
      advertisedSets.some(
        (other) => other.length === set.length && other.every((value, at) => value === set[at]),
      );

    const published = Object.entries(shared).filter(
      (entry): entry is [string, readonly string[]] =>
        Array.isArray(entry[1]) && entry[1].every((value) => typeof value === 'string'),
    );
    for (const [name, set] of published) {
      expect(taken(set), `${name} is exported and no door takes it`).toBe(true);
    }
    // And there are sets to check, so an export that stopped being an array cannot empty
    // this out. Both halves of `taken` must also be REACHED, or the rule would be a
    // one-door rule with a second clause nobody exercises.
    expect(published.length).toBeGreaterThanOrEqual(5);
    expect(declared.filter((set) => set.length > 0).length).toBeGreaterThan(10);
    expect(advertisedSets).toHaveLength(10);
    // A set nothing takes is refused by the same predicate — this file's own non-vacuity,
    // on a value the product does not produce.
    expect(taken(['reticulate', 'splines'])).toBe(false);
  });
});
