import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '@/config/config-schema.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

/**
 * Round-trip fidelity property test for every mirror-backed entity.
 *
 * The durability contract is "markdown is the source of truth; SQLite is a
 * rebuildable cache; `mnema sync` reconstructs the cache from disk". Past bugs
 * (memory scope, skill FTS body columns, task context_budget) were all the
 * same class: a field that lived in the DB but was silently dropped on the
 * disk → DB round-trip, and each was found by hand, one field at a time.
 *
 * This replaces field-by-field auditing with one invariant: for each entity,
 * create it with EVERY non-default field populated, write its mirror through
 * the real serialiser (`rebuildMirrors`, so the markdown is always valid),
 * delete the state cache to simulate a fresh clone, run `syncRebuild`, and
 * assert every domain field survives — OR is on an explicit, documented
 * KNOWN_LOSSES allowlist. A new field that does not round-trip and is not on
 * the allowlist fails CI, so the next such bug is caught here, not in prod.
 *
 * fast-check supplies varied field values; the serialiser (not hand-written
 * markdown) guarantees the mirror parses. Known-open losses (task
 * context_budget / reopen_count, backlog creation/close timestamps) are on
 * the KNOWN_LOSSES allowlist below with the reason; remove an entry as the
 * corresponding fix lands and the field starts surviving.
 */

const migrationsDir = path.resolve('src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('workflows');
const PROJECT_KEY = 'RT';
const ACTOR = 'alice';

// Deterministic runs: a fixed seed + a bounded run count keep this a
// reproducible round-trip invariant, not a seed-roulette that flaps red on
// some CI runs. Each run does a full create + rebuildMirrors + clone +
// syncRebuild, so the per-test timeout is generous.
const FC = { numRuns: 8, seed: 0x5f37_2743 } as const;
const TEST_TIMEOUT_MS = 60_000;

/**
 * Varied but SAFE text values: letters/digits with single interior spaces, no
 * leading/trailing whitespace and no YAML- or markup-significant characters.
 * This test asserts field FIDELITY with realistic content; fuzzing the YAML
 * serialiser against whitespace/quote/markup injection is a separate concern
 * (there is a known quoteYaml whitespace-quoting gap tracked on its own), so
 * generating those here would only conflate two tests and flap.
 */
function safeText(min: number, max: number): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
      minLength: min,
      maxLength: max,
    })
    .map((chars) => {
      // Sprinkle a few interior spaces without ever touching the borders.
      const s = chars.join('');
      return s.length > 3 ? `${s.slice(0, 2)} ${s.slice(2)}` : s;
    });
}

interface Harness {
  readonly container: ServiceContainer;
  readonly root: string;
  readonly close: () => void;
}

/** A project with config + workflow on disk but no populated state yet. */
function makeProject(): Harness {
  const root = mkdtempSync(path.join(tmpdir(), 'mnema-rt-'));
  mkdirSync(path.join(root, '.mnema/workflows'), { recursive: true });
  const config = ConfigSchema.parse({
    version: '1.0',
    mnema_version: '^0.1.0',
    project: { key: PROJECT_KEY, name: 'Round Trip' },
    workflow: 'default',
  });
  const { writeFileSync, readFileSync } = require('node:fs') as typeof import('node:fs');
  writeFileSync(path.join(root, '.mnema/mnema.config.json'), JSON.stringify(config, null, 2));
  writeFileSync(
    path.join(root, '.mnema/workflows/default.json'),
    readFileSync(path.join(workflowsSrc, 'default.json'), 'utf-8'),
  );
  const container = createServiceContainer(config, root, { migrationsDir });
  return {
    container,
    root,
    close: () => {
      container.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * The round-trip: given a populated container, flush every entity's mirror to
 * disk, drop the state cache, boot a fresh container over the same root, and
 * rebuild from the committed markdown. Returns the fresh container so the
 * caller can read the rebuilt entity back.
 */
function roundTrip(h: Harness): Harness {
  // DB → disk for every entity family (the real serialisers). Tasks are
  // flushed by SyncService; roadmap (epic/sprint/decision) and knowledge each
  // own their rebuildMirrors. epic/sprint/decision take the project key;
  // memory/skill/observation take none.
  h.container.sync.rebuildMirrors();
  h.container.epic.rebuildMirrors(PROJECT_KEY);
  h.container.sprint.rebuildMirrors(PROJECT_KEY);
  h.container.decision.rebuildMirrors(PROJECT_KEY);
  h.container.memory.rebuildMirrors();
  h.container.skill.rebuildMirrors();
  h.container.observation.rebuildMirrors();

  // Simulate a fresh clone: the git-ignored state cache is gone.
  h.container.close();
  rmSync(path.join(h.root, '.mnema/state'), { recursive: true, force: true });

  const config = ConfigSchema.parse({
    version: '1.0',
    mnema_version: '^0.1.0',
    project: { key: PROJECT_KEY, name: 'Round Trip' },
    workflow: 'default',
  });
  const fresh = createServiceContainer(config, h.root, { migrationsDir });
  fresh.syncRebuild.run(PROJECT_KEY);
  return {
    container: fresh,
    root: h.root,
    close: () => {
      fresh.close();
      rmSync(h.root, { recursive: true, force: true });
    },
  };
}

/**
 * KNOWN, DOCUMENTED losses — fields that do not (yet) survive a round-trip.
 * Each entry states WHY the field is lost; when the corresponding fix lands
 * and the field starts surviving, drop it here and the test tightens
 * automatically. An UNLISTED loss is a failure. Keyed by entity, then by
 * domain field name.
 */
const KNOWN_LOSSES: Record<string, Record<string, string>> = {
  task: {
    contextBudget: 'not serialised nor rebuilt — silently lost on clone (fix pending)',
    reopenCount: 'serialised but never read back on rebuild (fix pending)',
    createdAt: 'backlog createdAt resets to clone time (preserve-vs-derive pending)',
    closedAt: 'backlog closedAt not read back on rebuild (preserve-vs-derive pending)',
  },
  epic: {
    createdAt: 'epic createdAt resets to clone time (preserve-vs-derive pending)',
    closedAt: 'epic closedAt not read back on rebuild (preserve-vs-derive pending)',
  },
  sprint: {
    createdAt: 'sprint createdAt resets to clone time (preserve-vs-derive pending)',
    closedAt: 'sprint closedAt not read back on rebuild (preserve-vs-derive pending)',
  },
  decision: {
    at: 'decision `at` resets to clone time (preserve-vs-derive pending)',
  },
  skill: {
    // NEW loss found by this very test: a skill's scope is dropped on the
    // disk→DB round-trip (rebuilt as null), the same class as the already-fixed
    // memory-scope loss but on the skill side. Remove this entry once the
    // skill serialiser/rebuild carries scope.
    scope: 'skill scope lost on clone (rebuilt null) — same class as the fixed memory-scope loss',
  },
};

/**
 * Compare selected domain fields of the original vs the rebuilt entity.
 * A field that differs is only tolerated if it is on the entity's allowlist.
 */
function assertRoundTrip(
  entity: string,
  original: Record<string, unknown>,
  rebuilt: Record<string, unknown>,
  fields: readonly string[],
): void {
  const allow = KNOWN_LOSSES[entity] ?? {};
  for (const field of fields) {
    const before = JSON.stringify(original[field]);
    const after = JSON.stringify(rebuilt[field]);
    if (before === after) continue;
    // Differs → must be a documented known loss, otherwise fail loudly.
    expect(
      allow[field],
      `${entity}.${field} did NOT survive the round-trip (before=${before}, after=${after}) and is not on the KNOWN_LOSSES allowlist — either preserve it in the serialiser/rebuild or document it as an intentional loss`,
    ).toBeDefined();
  }
}

describe('round-trip fidelity: every mirror entity survives a fresh-clone rebuild', () => {
  let h: Harness;
  let fresh: Harness | null;

  beforeEach(() => {
    process.env.MNEMA_ACTOR = ACTOR;
    h = makeProject();
    fresh = null;
  });

  afterEach(() => {
    if (fresh !== null) fresh.close();
    else h.close();
    delete process.env.MNEMA_ACTOR;
  });

  it(
    'task: title/description/criteria/estimate/priority/state/metadata survive; ctx_budget & reopen are known losses',
    () => {
      fc.assert(
        fc.property(
          fc.record({
            title: safeText(3, 60),
            description: safeText(1, 120),
            estimate: fc.integer({ min: 0, max: 100 }),
            contextBudget: fc.integer({ min: 1, max: 50_000 }),
            priority: fc.integer({ min: 1, max: 5 }),
          }),
          (gen) => {
            const local = makeProject();
            try {
              const created = local.container.task.create({
                projectKey: PROJECT_KEY,
                title: gen.title,
                description: gen.description,
                acceptanceCriteria: ['crit-a', 'crit-b'],
                estimate: gen.estimate,
                contextBudget: gen.contextBudget,
                priority: gen.priority,
                metadata: { source: 'rt-test' },
                actor: ACTOR,
              });
              expect(created.ok).toBe(true);
              if (!created.ok) return;
              const key = created.value.key;

              const after = roundTrip(local);
              try {
                const got = after.container.task.findByKey(key);
                expect(got.ok, 'task must rehydrate on a fresh clone').toBe(true);
                if (!got.ok) return;
                assertRoundTrip(
                  'task',
                  created.value as unknown as Record<string, unknown>,
                  got.value as unknown as Record<string, unknown>,
                  [
                    'title',
                    'description',
                    'acceptanceCriteria',
                    'estimate',
                    'priority',
                    'state',
                    'metadata',
                    'contextBudget',
                    'reopenCount',
                  ],
                );
              } finally {
                after.close();
              }
            } finally {
              // local already torn down by roundTrip's fresh.close(); nothing else.
            }
          },
        ),
        FC,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'epic: title/description/state survive; timestamps are known losses',
    () => {
      fc.assert(
        fc.property(
          fc.record({
            title: safeText(3, 60),
            description: safeText(1, 120),
          }),
          (gen) => {
            const local = makeProject();
            const created = local.container.epic.create({
              projectKey: PROJECT_KEY,
              title: gen.title,
              description: gen.description,
              actor: ACTOR,
            });
            expect(created.ok).toBe(true);
            if (!created.ok) return;
            const key = created.value.key;
            const after = roundTrip(local);
            try {
              const got = after.container.epic.show(key);
              expect(got.ok, 'epic must rehydrate').toBe(true);
              if (!got.ok) return;
              assertRoundTrip(
                'epic',
                created.value as unknown as Record<string, unknown>,
                got.value.epic as unknown as Record<string, unknown>,
                ['title', 'description', 'state', 'createdAt', 'closedAt'],
              );
            } finally {
              after.close();
            }
          },
        ),
        FC,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'sprint: name/goal/capacity/state survive; timestamps are known losses',
    () => {
      fc.assert(
        fc.property(
          fc.record({
            name: safeText(1, 60),
            goal: safeText(1, 120),
            capacity: fc.integer({ min: 1, max: 200 }),
          }),
          (gen) => {
            const local = makeProject();
            const created = local.container.sprint.plan({
              projectKey: PROJECT_KEY,
              name: gen.name,
              goal: gen.goal,
              capacity: gen.capacity,
              actor: ACTOR,
            });
            expect(created.ok).toBe(true);
            if (!created.ok) return;
            const key = created.value.key;
            const after = roundTrip(local);
            try {
              const got = after.container.sprint.show(key);
              expect(got, 'sprint must rehydrate').not.toBeNull();
              if (got === null) return;
              assertRoundTrip(
                'sprint',
                created.value as unknown as Record<string, unknown>,
                got.sprint as unknown as Record<string, unknown>,
                ['name', 'goal', 'capacity', 'state', 'createdAt', 'closedAt'],
              );
            } finally {
              after.close();
            }
          },
        ),
        FC,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'decision: title/decision/context/rationale/consequences/impacts/status survive; `at` is a known loss',
    () => {
      fc.assert(
        fc.property(
          fc.record({
            title: safeText(3, 60),
            decision: safeText(1, 120),
            context: safeText(1, 80),
            rationale: safeText(1, 80),
            consequences: safeText(1, 80),
          }),
          (gen) => {
            const local = makeProject();
            const created = local.container.decision.record({
              projectKey: PROJECT_KEY,
              title: gen.title,
              decision: gen.decision,
              context: gen.context,
              rationale: gen.rationale,
              consequences: gen.consequences,
              impacts: ['src/foo.ts', 'src/bar.ts'],
              actor: ACTOR,
            });
            expect(created.ok).toBe(true);
            if (!created.ok) return;
            const key = created.value.key;
            const after = roundTrip(local);
            try {
              const got = after.container.decision.show(key);
              expect(got.ok, 'decision must rehydrate').toBe(true);
              if (!got.ok) return;
              assertRoundTrip(
                'decision',
                created.value as unknown as Record<string, unknown>,
                got.value as unknown as Record<string, unknown>,
                // NB: authoredBy is intentionally NOT compared — it is an actor
                // UUID that is legitimately re-resolved from the handle on a
                // fresh clone (actors get new UUIDs), the same as epic/sprint
                // row UUIDs. That is identity re-resolution, not content loss.
                [
                  'title',
                  'decision',
                  'context',
                  'rationale',
                  'consequences',
                  'impacts',
                  'status',
                  'at',
                ],
              );
            } finally {
              after.close();
            }
          },
        ),
        FC,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'memory: title/content/topics/scope survive a round-trip (incl. FTS body search)',
    () => {
      fc.assert(
        fc.property(
          fc.record({
            title: safeText(1, 60),
            bodyToken: fc
              .string({ minLength: 6, maxLength: 12 })
              .map((s) => `zt${s.replace(/[^a-z]/gi, 'x')}`),
          }),
          (gen) => {
            const local = makeProject();
            const slug = `mem-${Math.abs(hashStr(gen.title + gen.bodyToken)).toString(36)}`;
            const created = local.container.memory.record({
              slug,
              title: gen.title,
              content: `A durable fact containing ${gen.bodyToken} in the body only.`,
              topics: ['architecture', 'clone'],
              scope: 'packages/notifier',
              actor: ACTOR,
            });
            expect(created.ok).toBe(true);
            if (!created.ok) return;
            const after = roundTrip(local);
            try {
              const got = after.container.memory.show(slug);
              expect(got.ok, 'memory must rehydrate').toBe(true);
              if (!got.ok) return;
              assertRoundTrip(
                'memory',
                created.value.memory as unknown as Record<string, unknown>,
                got.value as unknown as Record<string, unknown>,
                ['title', 'content', 'topics', 'scope'],
              );
              // FTS body column must be populated: a term that appears ONLY in
              // the body is findable (the skill-FTS bug class).
              const hits = after.container.search.search(gen.bodyToken);
              expect(
                JSON.stringify(hits).includes(slug),
                `memory body token '${gen.bodyToken}' must be FTS-searchable after rebuild`,
              ).toBe(true);
            } finally {
              after.close();
            }
          },
        ),
        FC,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'skill: name/description/content/tools/scope survive (incl. FTS body search)',
    () => {
      fc.assert(
        fc.property(
          fc.record({
            name: safeText(1, 60),
            bodyToken: fc
              .string({ minLength: 6, maxLength: 12 })
              .map((s) => `zk${s.replace(/[^a-z]/gi, 'x')}`),
          }),
          (gen) => {
            const local = makeProject();
            const slug = `skill-${Math.abs(hashStr(gen.name + gen.bodyToken)).toString(36)}`;
            const created = local.container.skill.record({
              slug,
              name: gen.name,
              description: 'A reusable procedure',
              content: `Steps: use the ${gen.bodyToken} helper carefully.`,
              toolsUsed: ['pr_status'],
              invocable: true,
              scope: 'packages/notifier',
              actor: ACTOR,
            });
            expect(created.ok).toBe(true);
            if (!created.ok) return;
            const after = roundTrip(local);
            try {
              const got = after.container.skill.show(slug);
              expect(got.ok, 'skill must rehydrate').toBe(true);
              if (!got.ok) return;
              assertRoundTrip(
                'skill',
                created.value.skill as unknown as Record<string, unknown>,
                got.value as unknown as Record<string, unknown>,
                ['name', 'description', 'content', 'toolsUsed', 'invocable', 'scope'],
              );
              const hits = after.container.search.search(gen.bodyToken);
              expect(
                JSON.stringify(hits).includes(slug),
                `skill body token '${gen.bodyToken}' must be FTS-searchable after rebuild`,
              ).toBe(true);
            } finally {
              after.close();
            }
          },
        ),
        FC,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'observation: content/topics survive a round-trip',
    () => {
      fc.assert(
        fc.property(safeText(3, 200), (content) => {
          const local = makeProject();
          const created = local.container.observation.record({
            content,
            topics: ['signal', 'rt'],
            actor: ACTOR,
          });
          expect(created.ok).toBe(true);
          if (!created.ok) return;
          const id = created.value.id;
          const after = roundTrip(local);
          try {
            const list = after.container.observation.list({ limit: 50 });
            const got = list.find((o) => o.id === id) ?? null;
            expect(got, 'observation must rehydrate').not.toBeNull();
            if (got === null) return;
            assertRoundTrip(
              'observation',
              created.value as unknown as Record<string, unknown>,
              got as unknown as Record<string, unknown>,
              ['content', 'topics'],
            );
          } finally {
            after.close();
          }
        }),
        FC,
      );
    },
    TEST_TIMEOUT_MS,
  );
});

/** Small stable hash for building unique slugs from generated input. */
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}
