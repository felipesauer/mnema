// A synthetic record of a chosen size, written by the product's own writer and builders
// into a project that `mnema init` founded in a sandbox — so the trunk binary reads it as
// its own and `verify` has to pass on it.
//
// usage: GEN_WT=<built checkout> node make-record.mjs <projectDir> <keyRoot> <targetEvents> <seed> [tree]
//   tree: "public" (default) writes <projectDir>/.mnema; "private" writes <projectDir>/.mnema/private
//
// WHAT IT WRITES, and why each choice is the product's and not mine (A13):
//   - every event comes from a builder of @mnema/chain (decisionBirth, taskBirth, …);
//   - every state and action is picked from the product's own tables
//     (DECISION_TRANSITIONS, TRANSITIONS, SKILL_TRANSITIONS, the INITIAL_* states), and a
//     transition that owes a field carries it (`requires`);
//   - one CHECKPOINT per act, which is the product's cadence ("one signature per act of
//     writing", writer.ts) — an act is what one verb writes: a birth pair, or one event;
//   - ids are RFC 9562 v7 (48-bit ms timestamp, version 7, variant 10), the form the product mints;
//   - the text is drawn from a Zipf-distributed synthetic vocabulary, plus two planted
//     words: `zqneedle` in exactly 10 records whatever the size (a FIXED number of matches)
//     and `cache` in ~5% of text-bearing records (matches that GROW with the size).
// Deterministic: the same seed writes the same text, ids and order.
import { homedir } from 'node:os';
import { join } from 'node:path';

const WT = process.env.GEN_WT;
const chain = await import(`${WT}/packages/chain/dist/index.js`);
const core = await import(`${WT}/packages/core/dist/index.js`);

const [projectDir, keyRoot, target, seedArg, tree = 'public'] = process.argv.slice(2);
// The binary this record is read with must never be pointed at the real home: the key root is a
// sandbox's, and the guard is that it is not under the invoking user's own `~/.mnema`.
if (!projectDir || !keyRoot || keyRoot.startsWith(join(homedir(), '.mnema'))) {
  throw new Error('projectDir and keyRoot must be a sandbox, never the real home');
}
const TARGET = Number(target);
const chainRoot = tree === 'private' ? join(projectDir, '.mnema', 'private') : join(projectDir, '.mnema');

// mulberry32
let s = Number(seedArg ?? 1) >>> 0;
const rnd = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];

// A 3,000-word synthetic vocabulary with a Zipf(1) draw.
const SYL = ['ka', 'lo', 'mi', 'ne', 'ru', 'sa', 'ti', 'vo', 'ze', 'pa', 'qu', 'dor', 'lin', 'mas', 'tek', 'bri'];
const VOCAB = Array.from({ length: 3000 }, (_, i) => {
  let w = '';
  let n = i + 7;
  do {
    w += SYL[n % SYL.length];
    n = Math.floor(n / SYL.length);
  } while (n > 0);
  return w;
});
const H = VOCAB.reduce((a, _, i) => a + 1 / (i + 1), 0);
const CDF = [];
VOCAB.reduce((a, _, i) => {
  const c = a + 1 / (i + 1) / H;
  CDF.push(c);
  return c;
}, 0);
const word = () => {
  const u = rnd();
  let lo = 0;
  let hi = CDF.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (CDF[mid] < u) lo = mid + 1;
    else hi = mid;
  }
  return VOCAB[lo];
};
let needles = 0;
let texts = 0;
const needleEvery = Math.max(1, Math.floor(TARGET / 10 / 1.2));
const sentence = (n) => {
  texts += 1;
  const ws = Array.from({ length: n }, word);
  if (rnd() < 0.05) ws[Math.floor(rnd() * ws.length)] = 'cache';
  if (needles < 10 && texts % needleEvery === 0) {
    ws[0] = 'zqneedle';
    needles += 1;
  }
  return ws.join(' ');
};

// RFC 9562 v7 with a synthetic, strictly increasing clock.
let clock = Date.UTC(2026, 0, 5, 9, 0, 0);
const hex = (n, width) => n.toString(16).padStart(width, '0');
const v7 = () => {
  const ms = clock;
  const tsHex = hex(ms, 12);
  const r = () => Math.floor(rnd() * 0x10000);
  return `${tsHex.slice(0, 8)}-${tsHex.slice(8, 12)}-7${hex(r() & 0xfff, 3)}-${hex(0x8000 | (r() & 0x3fff), 4)}-${hex(r(), 4)}${hex(r(), 4)}${hex(r(), 4)}`;
};

const w = chain.openChainForWriting(chainRoot, { keyRoot });
const who = w.anchor;
const signerFp = w.signerFingerprint;
const env = (subject) => ({ at: new Date(clock).toISOString(), who, signerFp, subject });

const decisions = []; // { id, state }
const tasks = []; // { id, state }
const skills = []; // { id, state }
let adr = 0;
let written = 0;
let acts = 0;
const byKind = {};
const fieldFor = (req) => (req.length === 0 ? undefined : Object.fromEntries(req.map((k) => [k, sentence(8)])));
const move = (table, entity) => {
  const options = table.filter((t) => t.from === entity.state);
  if (options.length === 0) return null;
  const t = pick(options);
  return t;
};
const DIRS = ['src', 'lib', 'app', 'packages'];
const SUB = Array.from({ length: 40 }, (_, i) => `m${i}`);

const t0 = performance.now();
while (written < TARGET) {
  clock += 30_000 + Math.floor(rnd() * 90_000);
  const u = rnd();
  let events;
  if (u < 0.3) {
    events = [chain.memoryCaptured(env(v7()), { content: sentence(12 + Math.floor(rnd() * 28)) })];
  } else if (u < 0.45) {
    const id = v7();
    adr += 1;
    events = chain.decisionBirth(env(id), {
      title: sentence(5 + Math.floor(rnd() * 5)),
      rationale: sentence(20 + Math.floor(rnd() * 20)),
      adr: `ADR-${adr}`,
      initial: core.INITIAL_DECISION_STATE,
      ...(rnd() < 0.6 ? { alternatives: sentence(10 + Math.floor(rnd() * 10)) } : {}),
    });
    decisions.push({ id, state: core.INITIAL_DECISION_STATE });
  } else if (u < 0.55 && decisions.length > 0) {
    const d = pick(decisions);
    const t = move(core.DECISION_TRANSITIONS.filter((x) => x.action !== 'supersede'), d);
    if (t === null) continue;
    events = [chain.decisionTransitioned(env(d.id), { from: t.from, to: t.to, action: t.action, fields: fieldFor(t.requires) })];
    d.state = t.to;
  } else if (u < 0.65) {
    const id = v7();
    events = chain.taskBirth(env(id), { title: sentence(4 + Math.floor(rnd() * 6)), initial: core.INITIAL_STATE });
    tasks.push({ id, state: core.INITIAL_STATE });
  } else if (u < 0.8 && tasks.length > 0) {
    const tk = pick(tasks);
    const t = move(core.TRANSITIONS, tk);
    if (t === null) continue;
    events = [chain.taskTransitioned(env(tk.id), { from: t.from, to: t.to, action: t.action, fields: fieldFor(t.requires) })];
    tk.state = t.to;
  } else if (u < 0.9 && decisions.length > 0) {
    const d = pick(decisions);
    events = [chain.observationRecorded(env(v7()), { about: d.id, topic: sentence(3), text: sentence(15 + Math.floor(rnd() * 20)) })];
  } else if (u < 0.95 && decisions.length > 0) {
    const d = pick(decisions);
    const path = `${pick(DIRS)}/${pick(SUB)}${rnd() < 0.5 ? `/${pick(SUB)}` : ''}`;
    events = [chain.knowledgeLinked(env(d.id), { target: path, rel: core.GOVERNS_RELATION })];
  } else {
    const id = v7();
    events = chain.skillBirth(env(id), { name: sentence(3), body: sentence(30 + Math.floor(rnd() * 30)), initial: core.INITIAL_SKILL_STATE });
    skills.push({ id, state: core.INITIAL_SKILL_STATE });
    // Half the patterns move on through the product's own table, one act per move.
  }
  w.appendAll(events);
  w.checkpoint();
  acts += 1;
  written += events.length;
  for (const e of events) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  if (rnd() < 0.5 && skills.length > 0) {
    const sk = pick(skills);
    const t = move(core.SKILL_TRANSITIONS, sk);
    if (t !== null) {
      clock += 1000;
      const e = chain.skillTransitioned(env(sk.id), { from: t.from, to: t.to, action: t.action, fields: fieldFor(t.requires) });
      w.appendAll([e]);
      w.checkpoint();
      acts += 1;
      written += 1;
      byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
      sk.state = t.to;
    }
  }
}
const ms = performance.now() - t0;
console.log(
  JSON.stringify({
    chainRoot,
    events: written,
    acts,
    needles,
    ms: Math.round(ms),
    perActMs: Math.round((ms / acts) * 1000) / 1000,
    decisions: decisions.length,
    inForce: decisions.filter((d) => d.state === 'accepted').length,
    tasks: tasks.length,
    skills: skills.length,
    adopted: skills.filter((k) => k.state === 'adopted').length,
    byKind,
  }),
);
