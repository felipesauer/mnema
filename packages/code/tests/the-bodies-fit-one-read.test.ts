/**
 * The patterns fit ONE read: all the bodies, or all the names.
 *
 * `skills` asked with no id used to return every adopted body, however many there
 * were. Measured against a project with 40 adopted patterns of the market's median
 * size (3,427 B — the median of 86 real `SKILL.md` files), that answer came back at
 * 146,431 B: 24.8× the opening context over the same patterns, and ~18% of a
 * 200k-token window spent in one call nobody had asked to spend.
 *
 * AND THE COST WAS NEVER THE WHOLE OF IT. The same call recorded 40 `skill.consulted`
 * facts, so the record asserted that forty patterns informed work an agent had read
 * two of. That is the defect this closes: the fact is the only evidence the record
 * ever gets that an adopted pattern earns its place, and mass delivery made it false
 * for every pattern at once. Serving names records nothing, which is what makes the
 * fact true again — so this file asserts the ABSENCE of consultations over the big
 * record as its central claim, and not only the smaller reply.
 *
 * The budget is 20 KiB of bodies and it is DERIVED: it is what the published skills
 * specification budgets for ONE activation (< 5,000 tokens of instructions), at four
 * characters per token. Serving N bodies unasked must not cost more than the market
 * spends serving the one a caller named — otherwise the mass read is strictly worse
 * than the N reads by id the same tool already answers.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { catalogUpcasters, ensureTree, verify } from '@mnema/chain';
import { chainRootForScope, type DiscoveryEnv, orderedEvents, PROJECT_DIR } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { openSession, type Session } from '../src/mcp/session.js';
import { runCreateSkill, runSkillsTool, runSkillTransition } from '../src/mcp/tools.js';
import { codeOnly, sourceFiles } from './support/reading-source.js';

/**
 * The median body of the market's real patterns, in bytes — the size the measurement
 * that produced this delivery used, and the size that makes "six is over the line"
 * mean something about a record somebody could actually have.
 *
 * The text is prose and it repeats: the content door screens what goes IN, and a body
 * of random-looking characters would be refused as a secret before any of this could
 * be read back.
 */
const MEDIAN_BODY = 3427;

/** A pattern body of exactly `bytes` ASCII characters, and legible as prose. */
function bodyOf(bytes: number): string {
  const sentence = 'One slice per pull request, and the proof travels with it. ';
  return sentence.repeat(Math.ceil(bytes / sentence.length)).slice(0, bytes);
}

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let sandbox: string;
let env: DiscoveryEnv;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-one-read-'));
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  env = { home, xdgDataHome: join(sandbox, 'data') };
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** Makes a directory that IS a project (has a `.mnema/` tree), returns its path. */
function makeProject(name: string): string {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  ensureTree({ root: join(dir, PROJECT_DIR) });
  return dir;
}

/**
 * Adopts a pattern the way the workflow does — born, reviewed, adopted. Both moves
 * carry their note: the gate refuses either without one, and a loop that swallowed
 * the refusal would adopt nothing and measure an empty record.
 */
function adoptSkill(session: Session, name: string, body: string): string {
  const created = runCreateSkill(session, { name, body });
  if (!created.ok) throw new Error(`setup: create refused (${created.code})`);
  for (const [action, note] of [
    ['review', 'read it'],
    ['adopt', 'we work this way'],
  ] as const) {
    const moved = runSkillTransition(session, { id: created.id, action, note });
    if (!moved.ok) throw new Error(`setup: ${action} refused (${moved.code})`);
  }
  return created.id;
}

/** Adopts `count` patterns of `bytes` each, in one session. Returns their ids. */
function adoptMany(session: Session, count: number, bytes: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    adoptSkill(session, `pattern ${i}`, `${i}: ${bodyOf(bytes).slice(String(i).length + 2)}`),
  );
}

/** The `skill.consulted` events in a tree, as subjects. */
function consultations(root: string): string[] {
  return orderedEvents({ root }, catalogUpcasters())
    .filter((e) => e.kind === 'skill.consulted')
    .map((e) => e.subject);
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
        hash.update(`D:${full}\n`);
        walk(full);
      } else {
        hash.update(`F:${full}:`);
        hash.update(readFileSync(full));
        hash.update('\n');
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
}

function sessionIn(project: string, clientName = 'claude-code'): Session {
  return openSession({ clientName, roots: [pathToFileURL(project).href], env });
}

describe('a record whose bodies do not fit one read', () => {
  it('serves the NAMES, and not one body', () => {
    const session = sessionIn(makeProject('proj'));
    // Six of the market's median size: 20,562 B of bodies, over the 20 KiB budget by
    // one pattern. Five of them would have fit, and this is where the rule refuses to
    // pick five — the whole answer changes layer instead of being trimmed.
    const ids = adoptMany(session, 6, MEDIAN_BODY);

    const result = runSkillsTool(session);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.served).toBe('names');
    expect(result.skills.map((s) => s.id).sort()).toEqual([...ids].sort());
    // THE ABSENCE. An assertion that the names are there passes just as well with
    // every body riding along beside them.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('One slice per pull request');
    for (const served of result.skills) {
      expect(Object.keys(served).sort()).toEqual(['id', 'name']);
    }
  });

  it('records NOTHING — the fact says a pattern was read, and none was', () => {
    const project = makeProject('proj');
    const session = sessionIn(project);
    adoptMany(session, 6, MEDIAN_BODY);
    const publicRoot = chainRootForScope(session.trees, 'public') as string;
    const before = digest(sandbox);

    expect(runSkillsTool(session).ok).toBe(true);

    // The claim this delivery is for: no consultation, because nothing was consulted.
    expect(consultations(publicRoot)).toEqual([]);
    // And not a byte moved — no run opened, no checkpoint signed, nothing marked
    // stale. Serving names is a pure read, exactly like serving nothing.
    expect(digest(sandbox)).toBe(before);
    expect(verify(publicRoot, catalogUpcasters()).ok).toBe(true);
  });

  it('says so, with the count and the way back to a body', () => {
    // Over the wire, because the sentence is the deliverable: an unannounced list of
    // names reads as a record of empty patterns, and the caller never learns there is
    // a body to ask for.
    const project = makeProject('proj');
    const session = sessionIn(project);
    adoptMany(session, 6, MEDIAN_BODY);

    return (async () => {
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

      const reply = await client.callTool({ name: 'skills', arguments: {} });
      const blocks = ((reply as { content?: { type: string; text?: string }[] }).content ?? [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '');

      const framing = blocks.slice(1).join('\n');
      expect(framing).toContain('6 adopted pattern(s)');
      expect(framing).toContain('their names');
      expect(framing).toContain('`id`');
      // One line, and no body anywhere in the reply.
      expect(framing.split('\n')).toHaveLength(1);
      expect(blocks.join('\n')).not.toContain('One slice per pull request');

      await client.close();
    })();
  });

  it('still serves any ONE of them whole, by id, and records that one', () => {
    const project = makeProject('proj');
    const session = sessionIn(project);
    const ids = adoptMany(session, 6, MEDIAN_BODY);
    const asked = ids[2] as string;

    const served = runSkillsTool(session, { id: asked });

    expect(served.ok).toBe(true);
    if (!served.ok) return;
    expect(served.served).toBe('bodies');
    expect(served.skills).toHaveLength(1);
    const [only] = served.skills;
    // The body is whole: the ceiling is on what arrives UNASKED, and a caller that
    // named a pattern named exactly this one.
    expect((only as { body: string }).body.length).toBe(MEDIAN_BODY);
    // And the fact is true again — one pattern served, one consultation.
    const publicRoot = chainRootForScope(session.trees, 'public') as string;
    expect(consultations(publicRoot)).toEqual([asked]);
  });

  it('a single body over the budget takes the names arm too', () => {
    // The content door lets a 64 KiB body in, so one pattern can be over one read on
    // its own. It is the rule working rather than an edge: what the ceiling protects
    // is the caller that named nothing.
    const session = sessionIn(makeProject('proj'));
    adoptSkill(session, 'the long one', bodyOf(21 * 1024));

    const result = runSkillsTool(session);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.served).toBe('names');
    expect(JSON.stringify(result)).not.toContain('One slice per pull request');
  });
});

describe('a record whose bodies DO fit one read', () => {
  it('serves them, with the provenance, exactly as it always did', () => {
    const project = makeProject('proj');
    const session = sessionIn(project);
    // Five of the median size: 17,135 B, under the budget. The last record that fits.
    const ids = adoptMany(session, 5, MEDIAN_BODY);

    const result = runSkillsTool(session);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.served).toBe('bodies');
    expect(result.skills.map((s) => s.id).sort()).toEqual([...ids].sort());
    for (const served of result.skills) {
      expect(Object.keys(served).sort()).toEqual(['adoptedBy', 'body', 'id', 'name', 'state']);
    }
    // And the consultations land, one per pattern, as they always did.
    const publicRoot = chainRootForScope(session.trees, 'public') as string;
    expect(consultations(publicRoot).sort()).toEqual([...ids].sort());
    expect(verify(publicRoot, catalogUpcasters()).ok).toBe(true);
  });
});

describe('the budget is written in ONE place', () => {
  /**
   * The rule is one function in `@mnema/copilot`, and the number it weighs against is
   * one constant beside it. A second copy anywhere in production is the shape this
   * accuses: two ceilings drift, and the surface would frame a cut the copilot did
   * not make (or fail to frame one it did).
   *
   * The discriminant is the NUMBER as it is written — `20 * 1024` — and not the
   * constant's name, because a copy is exactly what would not share the name.
   */
  const BUDGET_LITERAL = /20\s*\*\s*1024/;

  function productionFiles(): { path: string; text: string }[] {
    const found: { path: string; text: string }[] = [];
    for (const pkg of ['chain', 'core', 'copilot', 'code']) {
      for (const file of sourceFiles(join(PACKAGES, pkg, 'src'))) {
        // CODE, with the comments and the string literals blanked: the number is
        // written in prose in more than one place on purpose (it is the reason the
        // rule exists), and a guard that accused a doc-comment would be a guard
        // against explaining yourself.
        found.push({
          path: file.slice(PACKAGES.length + 1),
          text: codeOnly(readFileSync(file, 'utf-8')),
        });
      }
    }
    return found;
  }

  it('reads the whole of production, so the sweep below is not empty', () => {
    const files = productionFiles();
    expect(files.length).toBeGreaterThan(150);
    expect(files.map((f) => f.path)).toContain(join('copilot', 'src', 'context', 'skills.ts'));
  });

  it('holds the number once, where the rule that weighs it lives', () => {
    expect(
      productionFiles()
        .filter((file) => BUDGET_LITERAL.test(file.text))
        .map((file) => file.path),
    ).toEqual([join('copilot', 'src', 'context', 'skills.ts')]);
  });

  it('accuses a second copy — on input of its own', () => {
    // The net's teeth: with the tree honest the case above says only "nothing is
    // accused", so it has never shown it can go red.
    const copied = [
      { path: 'code/src/mcp/later.ts', text: 'const CAP = 20 * 1024;' },
      { path: 'code/src/mcp/other.ts', text: 'const other = 4096;' },
    ];
    expect(copied.filter((f) => BUDGET_LITERAL.test(f.text)).map((f) => f.path)).toEqual([
      'code/src/mcp/later.ts',
    ]);
  });
});
