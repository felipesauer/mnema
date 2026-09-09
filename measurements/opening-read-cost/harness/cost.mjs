/**
 * WHAT THE DECLARATION COSTS THE OPENING READ — measured, because the module it was
 * added to is documented almost entirely about not spending.
 *
 * The claim under test is narrow and it is the only one this slice makes about cost:
 * `unreadKinds` adds two indexed COUNT(*) queries per tree to a read that already
 * opens caches, folds five derivations and sorts three lists. The question is what
 * fraction of the whole read that is.
 *
 * HOW IT REFUSES TO FLATTER ITSELF:
 *
 *   - ALTERNATING ORDER. Each round measures the whole read and the addition alone,
 *     then measures them again in the other order. Identical work has to tie; a gap
 *     between the two orders is the machine, not the code (`reference:
 *     bench-write-next-to-read`).
 *   - A CONTROL THAT HAS TO TIE. A third timer runs the SAME `bootstrap` a second
 *     time under a different name. Its two figures are two measurements of one thing,
 *     so a difference between them is the noise floor — and no difference smaller than
 *     that floor may be reported as a finding.
 *   - ITS OWN SANDBOX, made and destroyed here (A6). Nothing is written into the
 *     working tree.
 *   - A RECORD THE READ'S OWN DOC SIZES. 30 live tasks, 15 decisions, 25 adopted
 *     patterns, 20 memories, 10 observations — the "modest record" the budget
 *     paragraph of `bootstrap.ts` was written against, so the number is comparable to
 *     the 854-line payload measured there.
 *
 * WHAT IT DOES NOT MEASURE: what an agent does with the declaration, and whether a
 * session that reads it behaves differently. That is a bench round against a model,
 * it costs the owner's session window, and it is declared out of this slice.
 *
 *   pnpm build && node measurements/opening-read-cost/harness/cost.mjs
 */

import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = new URL('../../../', import.meta.url).pathname;

const { ProjectionCache, resolveTrees, chainRootForScope } = await import(
  join(REPO, 'packages/core/dist/index.js')
);
const { bootstrap } = await import(join(REPO, 'packages/copilot/dist/index.js'));
const { unreadKinds } = await import(
  join(REPO, 'packages/copilot/dist/context/unread.js')
);
const chain = await import(join(REPO, 'packages/chain/dist/index.js'));
const { openTreeForWriting } = await import(join(REPO, 'packages/core/dist/write.js'));

/** How many live tasks, decisions, patterns, memories and observations the record holds. */
const RECORD = { tasks: 30, decisions: 15, skills: 25, memories: 20, observations: 10 };

/** How many times each timer runs one read. Large enough that a 0.1 ms read is resolvable. */
const ITERATIONS = 400;

const sandbox = mkdtempSync(join(tmpdir(), 'mnema-unread-cost-'));
process.on('exit', () => rmSync(sandbox, { recursive: true, force: true }));

mkdirSync(join(sandbox, 'repo', '.mnema'), { recursive: true });
const trees = resolveTrees(join(sandbox, 'repo'), {
  xdgDataHome: join(sandbox, 'data'),
  home: join(sandbox, 'home'),
});
const writer = openTreeForWriting(trees, 'public');
const root = chainRootForScope(trees, 'public');
const who = writer.anchor;

let tick = 0;
const now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString();
const env = (subject) => ({ at: now(), who, signerFp: writer.signerFingerprint, subject });

for (let i = 0; i < RECORD.tasks; i += 1) {
  const id = `task-${String(i).padStart(3, '0')}`;
  writer.append(chain.taskCreated(env(id), { title: `Task number ${i}`, initial: 'DRAFT' }));
  writer.append(
    chain.taskTransitioned(env(id), { from: 'DRAFT', to: 'READY', action: 'submit' }),
  );
}
for (let i = 0; i < RECORD.decisions; i += 1) {
  const id = `dec-${String(i).padStart(3, '0')}`;
  writer.append(
    chain.decisionRecorded(env(id), {
      title: `Decision number ${i}`,
      rationale: 'because the measurement said so',
      adr: `ADR-${i + 1}`,
      initial: 'proposed',
      alternatives: 'the other way, turned down',
    }),
  );
  writer.append(
    chain.decisionTransitioned(env(id), {
      from: 'proposed',
      to: 'accepted',
      action: 'accept',
      note: 'agreed in review',
    }),
  );
}
for (let i = 0; i < RECORD.skills; i += 1) {
  const id = `skill-${String(i).padStart(3, '0')}`;
  writer.append(
    chain.skillCreated(env(id), {
      name: `Pattern number ${i}`,
      body: 'do it this way',
      initial: 'proposed',
    }),
  );
  writer.append(
    chain.skillTransitioned(env(id), {
      from: 'proposed',
      to: 'reviewed',
      action: 'review',
      note: 'it reads well',
    }),
  );
  writer.append(
    chain.skillTransitioned(env(id), {
      from: 'reviewed',
      to: 'adopted',
      action: 'adopt',
      note: 'we work this way already',
    }),
  );
}
for (let i = 0; i < RECORD.memories; i += 1) {
  writer.append(
    chain.memoryCaptured(env(`mem-${String(i).padStart(3, '0')}`), {
      content: `a fact worth keeping, number ${i}, with enough words to be a real body`,
    }),
  );
}
for (let i = 0; i < RECORD.observations; i += 1) {
  writer.append(
    chain.observationRecorded(env(`obs-${String(i).padStart(3, '0')}`), {
      about: 'task-000',
      topic: 'note',
      text: `something observed, number ${i}`,
    }),
  );
}

const cache = ProjectionCache.open(root);
cache.rebuild();
const caches = [cache];
const scope = { actor: who, asOf: '2026-01-01T02:00:00.000Z', sessionRuns: [] };

// The answer is real before anything is timed: a bench over a read that returns nothing
// measures an early return.
const sample = bootstrap(caches, scope);
// The work list is CUT at the read's own limit, so the total is what says the record
// is the size this bench meant to build.
if (sample.workTotal !== RECORD.tasks) throw new Error(`bench: workTotal ${sample.workTotal}`);
if (sample.skills.length !== RECORD.skills) throw new Error(`bench: skills ${sample.skills.length}`);
if (sample.decisionsTotal !== RECORD.decisions) {
  throw new Error(`bench: decisionsTotal ${sample.decisionsTotal}`);
}
if (JSON.stringify(sample.unread) !== '[{"kind":"memory","held":20},{"kind":"observation","held":10}]') {
  throw new Error(`bench: the declaration is wrong — ${JSON.stringify(sample.unread)}`);
}

const time = (fn) => {
  const started = process.hrtime.bigint();
  for (let i = 0; i < ITERATIONS; i += 1) fn();
  return Number(process.hrtime.bigint() - started) / 1e6 / ITERATIONS;
};

const WHOLE = () => bootstrap(caches, scope);
const ADDITION = () => unreadKinds(caches);

// Warm: the first pass through a JIT is not what a session pays.
time(WHOLE);
time(ADDITION);

const forward = { whole: time(WHOLE), addition: time(ADDITION) };
const reversed = { addition: time(ADDITION), whole: time(WHOLE) };
const control = { first: time(WHOLE), second: time(WHOLE) };

const ms = (n) => `${n.toFixed(4)} ms`;
const noiseFloor = Math.abs(control.first - control.second);

console.log(`record: ${JSON.stringify(RECORD)}`);
console.log(`iterations per timer: ${ITERATIONS}`);
console.log('');
console.log(`CONTROL  bootstrap (a)      ${ms(control.first)}`);
console.log(`CONTROL  bootstrap (b)      ${ms(control.second)}`);
console.log(`         noise floor        ${ms(noiseFloor)}  <- no smaller gap is a finding`);
console.log('');
console.log(`FORWARD  whole read         ${ms(forward.whole)}`);
console.log(`FORWARD  the declaration    ${ms(forward.addition)}`);
console.log(`REVERSE  the declaration    ${ms(reversed.addition)}`);
console.log(`REVERSE  whole read         ${ms(reversed.whole)}`);
console.log('');
const whole = (forward.whole + reversed.whole) / 2;
const addition = (forward.addition + reversed.addition) / 2;
console.log(`whole read, both orders     ${ms(whole)}`);
console.log(`declaration, both orders    ${ms(addition)}`);
console.log(`the declaration is          ${((addition / whole) * 100).toFixed(1)}% of the read`);
console.log('');
console.log(`order gap, whole read       ${ms(Math.abs(forward.whole - reversed.whole))}`);
console.log(`order gap, the declaration  ${ms(Math.abs(forward.addition - reversed.addition))}`);
console.log('(identical work has to tie; a gap above the noise floor is the machine)');


// --- HOW IT SCALES ------------------------------------------------------------------
//
// The count is `search`'s own COUNT(*) over `record_search`, and that table declares
// `kind UNINDEXED` (`core/src/db/schema.ts`) — so a count of one kind scans every
// searchable record of every kind, not just the kind asked for. That makes the cost a
// function of the WHOLE record rather than of the memories in it, which a single-size
// measurement cannot see. So the sweep, over records up to fifty times the one above.
console.log('');
console.log('--- how it scales ---');
console.log('scale  searchable  declaration   whole read    share');
for (const scale of [1, 5, 20, 50]) {
  const grown = growARecord(scale);
  const t = (fn) => {
    const started = process.hrtime.bigint();
    for (let i = 0; i < 200; i += 1) fn();
    return Number(process.hrtime.bigint() - started) / 1e6 / 200;
  };
  const U = () => unreadKinds([grown.cache]);
  const B = () => bootstrap([grown.cache], { ...scope, actor: grown.who });
  t(U);
  t(B);
  // Both orders again, so a figure is never one timer's turn in the loop.
  const u = (t(U) + t(U)) / 2;
  const b = (t(B) + t(B)) / 2;
  console.log(
    String(scale).padEnd(6),
    String(75 * scale).padEnd(11),
    ms(u).padEnd(13),
    ms(b).padEnd(13),
    `${((u / b) * 100).toFixed(1)}%`,
  );
  grown.close();
}

cache.close();

/**
 * A second record, `scale` times the size of the one above, in its own sandbox.
 *
 * Only the searchable kinds are grown: what the scan crosses is `record_search`, and a
 * handoff or a link is not in it. Growing what the cost does not depend on would flatten
 * the curve for a reason that has nothing to do with the read.
 */
function growARecord(scale) {
  const dir = mkdtempSync(join(tmpdir(), 'mnema-unread-scale-'));
  mkdirSync(join(dir, 'repo', '.mnema'), { recursive: true });
  const grownTrees = resolveTrees(join(dir, 'repo'), {
    xdgDataHome: join(dir, 'data'),
    home: join(dir, 'home'),
  });
  const w = openTreeForWriting(grownTrees, 'public');
  let n = 0;
  const stamp = () => new Date(Date.UTC(2026, 0, 1, 0, 0, n++)).toISOString();
  const e = (subject) => ({ at: stamp(), who: w.anchor, signerFp: w.signerFingerprint, subject });
  for (let i = 0; i < RECORD.memories * scale; i += 1) {
    w.append(chain.memoryCaptured(e(`m${i}`), { content: `a fact worth keeping, number ${i}` }));
  }
  for (let i = 0; i < RECORD.observations * scale; i += 1) {
    w.append(chain.observationRecorded(e(`o${i}`), { about: 'm0', topic: 'note', text: `n ${i}` }));
  }
  for (let i = 0; i < RECORD.tasks * scale; i += 1) {
    const id = `t${i}`;
    w.append(chain.taskCreated(e(id), { title: `Task ${i}`, initial: 'DRAFT' }));
    w.append(chain.taskTransitioned(e(id), { from: 'DRAFT', to: 'READY', action: 'submit' }));
  }
  const grown = ProjectionCache.open(chainRootForScope(grownTrees, 'public'));
  grown.rebuild();
  return {
    cache: grown,
    who: w.anchor,
    close: () => {
      grown.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
