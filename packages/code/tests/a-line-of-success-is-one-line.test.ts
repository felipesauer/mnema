/**
 * A LINE THIS SURFACE PRINTS ON SUCCESS IS ONE LINE, AND THE VALUES ON IT CAME FROM
 * SOMEWHERE.
 *
 * The fourth and last family of this class. A pattern's NAME was closed in
 * `served-patterns.ts`, a project's DIRECTORY in `verify --workspace`, the id in a
 * REFUSAL in `wiring/no-such-record.ts`. What was left is the line a verb prints when it
 * FOUND what it was asked for — and unlike the other three, this family has no sentence
 * in common. So the discriminant cannot be a phrase: it is the ORIGIN of each value, and
 * the one question `mnema` asks of it is CAN THIS HOLD A NEWLINE.
 *
 * THE CLASSIFICATION IS THE DELIVERABLE, AND IT IS TOTAL. {@link sitesInSource} walks
 * every `io.out`/`io.err` in `src/wiring` and pulls out every interpolated template
 * literal inside one — the line this wiring WORDS itself. {@link CLASSIFIED} gives each
 * one a verdict, and the two are reconciled in both directions: a line added next year
 * is unclassified and RED, and a verdict whose site went away is a fossil and RED. The
 * verdict is checked against the source rather than trusted — `collapsed` means the
 * template really is tagged, `minted` means it really is not — so a value that quietly
 * stops being the product's own cannot keep an old verdict.
 *
 * WHAT THE HANDOFF'S OWN GREP MISSED, AND WHY IT MATTERS TWICE. The debt named 28 sites,
 * found with `io.out(` and a template on ONE line of `wiring/*.ts`. The discriminant
 * finds 60: the other 32 live inside a multi-line call, inside `render(fact(…))`, or are
 * the second template of a concatenation — the same shape of miss the refusal family had
 * (six declared, eight real), from the same cause, which is a list of ADDRESSES standing
 * in for a rule.
 *
 * AND THE SITE THE HANDOFF NAMED AS THE WORST IS NOT FORGEABLE. `next-actions` prints
 * `Task <id> — 2 legal move(s):` with one line per move under it, which is the list shape
 * `oneLine`'s doc names as the one a reader mis-attributes. But that line is reached only
 * when the id FOUND a task, and an id carrying a newline finds none — it is refused one
 * branch earlier, by the sentence the previous slice closed. The forgeable list header is
 * `timeline`'s, and it takes TWO steps: `observe <about>` does not validate its
 * positional, so a forged value enters the record through one verb and comes back out as
 * a list HEADING through another. Measured on the base, `mnema timeline` over a value
 * holding a break printed:
 *
 *     0198c2f1-4b7e-7a2d-8f31-6cd0a91e4b55
 *       start → doing — 1 event(s):
 *       2026-08-17T15:06:09.760Z  observation.recorded  [about]  mnid:755798b3
 *
 * — where the second line is indented exactly as the item under it is, and carries the
 * count. That is why {@link theListGainsNoItem} counts ITEMS and not lines.
 *
 * The sites are closed anyway where the value merely CANNOT break today rather than
 * cannot break in principle, for the reason `no-such-record.ts` gives: the rule is about
 * a value from outside on a line, and an exception granted for an improbable victim is
 * how a rule grows the hole the next value walks through.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';
import { sourceFiles } from './support/reading-source.js';

/** `packages/code/src/wiring` — the layer that words a verb's own lines. */
const WIRING = fileURLToPath(new URL('../src/wiring', import.meta.url));
/** `packages/code/src` — for the reconciliation of what is deliberately NOT here. */
const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** A newline, built rather than typed, so no literal in this file spans two lines. */
const LF = String.fromCharCode(10);
/** The tag that collapses every value of a template — `wiring/on-one-line.ts`. */
const TAG = 'onOneLine';
/** The module that DEFINES the tag, and so is the one file that does not call it. */
const WORDING = 'on-one-line.ts';

// ---------------------------------------------------------------------------
// The sites, read off the source
// ---------------------------------------------------------------------------

/** One interpolated template literal printed by a verb of this surface. */
interface Site {
  /** The file, relative to `src/wiring`. */
  readonly file: string;
  /** The template with every interpolation written `{}` — what the line SAYS. */
  readonly shape: string;
  /** Whether the template is tagged with {@link TAG}. */
  readonly tagged: boolean;
  /** `<file> «<shape>» #<n>` — what a verdict claims to be about. */
  readonly key: string;
}

/**
 * Every interpolated template literal inside an `io.out`/`io.err` call of `src/wiring`.
 *
 * It is a SCANNER and not a regular expression, because half of what the handoff's grep
 * missed is missed by any line-wise pattern: a call spans several lines, a template sits
 * three calls deep inside `render(fact(…))`, and two templates are concatenated into one
 * argument. So the walk tracks the bracket depth from the `(` to its match, and inside
 * that span it tracks the quoting — a `'` string, a `"` string, a template, and a
 * template's own `${…}`, which may hold another template.
 *
 * The SHAPE is the key rather than the line number: a line number moves whenever anything
 * above it does, and a shape is what a reader recognizes. Where one file prints the same
 * shape twice (`init` says `identity: {}` on both of its branches) the occurrence
 * disambiguates.
 */
function sitesInSource(): { sites: Site[]; files: number; calls: number } {
  const sites: Site[] = [];
  let calls = 0;
  const files = sourceFiles(WIRING).filter((file) => relative(WIRING, file) !== WORDING);
  for (const file of files) {
    const text = readFileSync(file, 'utf-8');
    const seen = new Map<string, number>();
    for (const call of text.matchAll(/io\.(?:out|err)\(/g)) {
      calls += 1;
      const found = templatesIn(text, (call.index ?? 0) + call[0].length);
      for (const template of found) {
        const nth = (seen.get(template.shape) ?? 0) + 1;
        seen.set(template.shape, nth);
        const path = relative(WIRING, file);
        sites.push({
          file: path,
          shape: template.shape,
          tagged: template.tagged,
          key: `${path} «${template.shape}» #${nth}`,
        });
      }
    }
  }
  return { sites, files: files.length, calls };
}

/** Walks from just after a `(` to its match, collecting the templates that hold a value. */
function templatesIn(text: string, open: number): { shape: string; tagged: boolean }[] {
  const found: { shape: string; tagged: boolean }[] = [];
  let i = open;
  let depth = 1;
  while (i < text.length && depth > 0) {
    const char = text[i] as string;
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      i += 1;
    } else if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      i += 1;
    } else if (char === "'" || char === '"') {
      i = pastQuoted(text, i);
    } else if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== LF) i += 1;
    } else if (char === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
    } else if (char === '`') {
      const template = readTemplate(text, i);
      if (template.interpolated) found.push({ shape: template.shape, tagged: template.tagged });
      i = template.end;
    } else {
      i += 1;
    }
  }
  return found;
}

/** Past a `'` or `"` string, escapes included. */
function pastQuoted(text: string, at: number): number {
  const quote = text[at];
  let i = at + 1;
  while (i < text.length && text[i] !== quote) i += text[i] === '\\' ? 2 : 1;
  return i + 1;
}

/**
 * One template literal: what it says with `{}` where its values go, whether it has any,
 * and whether the identifier immediately before its backtick is the tag.
 *
 * A nested template inside an interpolation is skipped rather than reported. It is a
 * value of the outer one — `${x ? ` — ${y}` : ''}` is ONE interpolation — and reporting
 * it as a site of its own would ask a verdict about half of a value.
 */
function readTemplate(
  text: string,
  at: number,
): { shape: string; interpolated: boolean; tagged: boolean; end: number } {
  let before = at - 1;
  while (before >= 0 && /[A-Za-z0-9_$]/.test(text[before] as string)) before -= 1;
  const tagged = text.slice(before + 1, at) === TAG;
  let shape = '';
  let interpolated = false;
  let i = at + 1;
  while (i < text.length && text[i] !== '`') {
    if (text[i] === '\\') {
      shape += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (text[i] === '$' && text[i + 1] === '{') {
      interpolated = true;
      shape += '{}';
      i = pastInterpolation(text, i + 2);
      continue;
    }
    shape += text[i];
    i += 1;
  }
  return { shape, interpolated, tagged, end: i + 1 };
}

/** Past a `${…}`, through any braces, strings and nested templates inside it. */
function pastInterpolation(text: string, from: number): number {
  let i = from;
  let depth = 1;
  while (i < text.length && depth > 0) {
    const char = text[i] as string;
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (char === "'" || char === '"') {
      i = pastQuoted(text, i);
      continue;
    } else if (char === '`') {
      i = readTemplate(text, i).end;
      continue;
    }
    i += 1;
  }
  return i;
}

const FOUND = sitesInSource();

// ---------------------------------------------------------------------------
// What each line carries
// ---------------------------------------------------------------------------

/**
 * What the values on one line ARE — the answer to the one question this family asks.
 *
 *   - `collapsed` — at least one value came from the argv or out of the record, so every
 *     value on the line goes through the tag. The template IS tagged, and this file
 *     checks that rather than believing it.
 *   - `minted` — every value is one this product wrote: a uuid, an alias
 *     (`<prefix>-<hex>`), an `ADR-<n>`, a key fingerprint, an anchor (`mnid:` and 64 hex,
 *     which `resolveAnchorPrefix` enforces), a content hash, a count, a word of a closed
 *     transition table, or a sentence this surface composed out of those. None can hold a
 *     newline, so the line needs no collapse — and it must NOT be tagged, so that a value
 *     which stops being the product's own cannot keep this verdict quietly.
 *
 * THERE USED TO BE A THIRD, `elsewhere`, and it held the two lines of `wiring/verify.ts`
 * on the ground that the values on them are worded by `@mnema/chain`. That was half
 * right and the wrong half was the operative one: the DETAIL is the chain's, and the
 * rule for it belongs down there — but the TAIL on the same line is a directory name
 * this wiring interpolates itself, and a tail directory holding a newline broke the
 * issue line in two whatever the chain did. A verdict that says "somebody else's
 * problem" about a line THIS file lays out is a verdict that cannot be true. Both are
 * `collapsed` now, and the chain's half is classified in
 * `the-phrase-the-domain-words-is-one-line.test.ts`.
 */
type Verdict = 'collapsed' | 'minted';

/**
 * Every line this wiring words, and where its values come from.
 *
 * The KEYS are reconciled against the source in both directions; the REASONS cannot be —
 * no walk derives "an anchor is `mnid:` and 64 hex" from a template. So the table carries
 * only what a reader knows, and the part that rots (which lines exist, and whether each
 * is tagged) is the part that is derived.
 */
const CLASSIFIED: Readonly<Record<string, { verdict: Verdict; why: string }>> = {
  // --- readings whose values the record minted -----------------------------------
  'accountability.ts «{} fact(s) · {} author(s)» #1': {
    verdict: 'minted',
    why: 'two counts this reading computed',
  },
  'decision.ts «Recorded decision {} ({})» #1': {
    verdict: 'minted',
    why: 'an `ADR-<n>` and a uuid, both minted by the write that just landed',
  },
  'focus.ts «{} has no open runs.» #1': {
    verdict: 'minted',
    why: 'an anchor: `--actor` is resolved to one before the read runs',
  },
  'focus.ts «{} — {} open run(s):» #1': {
    verdict: 'minted',
    why: 'the same anchor, and a count — the runs under it are the collapsed pair below',
  },
  'init.ts «identity: {}» #1': {
    verdict: 'minted',
    why: 'an anchor this run derived — `mnid:` and 64 hex, so there is nothing to collapse',
  },
  'init.ts «identity: {}» #2': {
    verdict: 'minted',
    why: 'the same anchor, on the branch that found a project already here',
  },
  'init.ts «key {} enrolled in this project» #1': {
    verdict: 'minted',
    why: 'a key fingerprint, read off the registration',
  },
  'init.ts «key {} was NOT enrolled: {}» #1': {
    verdict: 'minted',
    why: 'a fingerprint, and a reason `identity-operations.ts` composed',
  },
  'key.ts «Restored key {}» #1': {
    verdict: 'minted',
    why: 'a fingerprint computed from the key material that was just installed',
  },
  'key.ts «identity: {}» #1': { verdict: 'minted', why: 'an anchor the record proved' },
  'key.ts «{}» #1': { verdict: 'minted', why: 'a ternary of two of this surface’s own clauses' },
  "key.ts «Created this machine's key {}» #1": {
    verdict: 'minted',
    why: 'a fingerprint computed from the key this run minted',
  },
  'key.ts «Requesting for key {}» #1': {
    verdict: 'minted',
    why: 'a fingerprint computed from the key being spoken for',
  },
  'key.ts «{}» #2': { verdict: 'minted', why: 'a ternary of two of this surface’s own clauses' },
  'key.ts «to join {}» #1': { verdict: 'minted', why: 'the anchor `--anchor` resolved to' },
  'key.ts «Key {} is already in {} — nothing recorded.» #1': {
    verdict: 'minted',
    why: 'a fingerprint decoded from the request, and an anchor',
  },
  'key.ts «Enrolled key {}» #1': {
    verdict: 'minted',
    why: 'a fingerprint decoded out of the request that was vouched for',
  },
  'key.ts «into {}» #1': { verdict: 'minted', why: 'the anchor the record proves it joined' },
  'key.ts «Revoked key {}» #1': {
    verdict: 'minted',
    why: 'the roster matched it before this line: `roster.has` is what refuses the rest',
  },
  'key.ts «from {} — {} key(s) left» #1': {
    verdict: 'minted',
    why: 'the anchor the key was retired from, and a count of the roster',
  },
  'memory.ts «Captured memory {}» #1': {
    verdict: 'minted',
    why: 'a uuid this write minted, and the only value on the line',
  },
  'next-actions.ts «{} → {}{}» #1': {
    verdict: 'minted',
    why: 'the transition table’s own words — an action, a state, the proof it requires',
  },
  'resume.ts «{} has no runs.» #1': {
    verdict: 'minted',
    why: 'an anchor: `--actor` is resolved to one before the read runs',
  },
  'run.ts «Started run {}» #1': { verdict: 'minted', why: 'a uuid the run was born with' },
  'run.ts «export {}={}» #1': {
    verdict: 'minted',
    why: 'this surface’s variable name, and a uuid',
  },
  'run.ts «Ended run {}» #1': { verdict: 'minted', why: 'the uuid of the run that was closed' },
  'run.ts «unset {}» #1': {
    verdict: 'minted',
    why: 'this surface’s own variable name, and nothing else',
  },
  'tail.ts «Authorized the cut of tail {}» #1': {
    verdict: 'minted',
    why: 'the tail the record was found holding — an unmatched one is refused earlier',
  },
  'tail.ts «{} event(s) through {}, the tail of {}» #1': {
    verdict: 'minted',
    why: 'a count, a content hash, an anchor',
  },
  'tail.ts «authorized by {}» #1': {
    verdict: 'minted',
    why: 'the anchor of the writer that signed the waiver',
  },
  'task.ts «Created task {} ({})» #1': {
    verdict: 'minted',
    why: 'an alias (`<prefix>-<hex>`, derived from the id) and the uuid',
  },
  'timeline.ts «[{}]» #1': {
    verdict: 'minted',
    why: 'the role an entity appears by — a closed word of this reading',
  },

  // --- lines a value from outside reaches ----------------------------------------
  'antipatterns.ts «{}» #1': {
    verdict: 'collapsed',
    why: 'entity ids out of the record — the sibling reading collapsed them and this one did not',
  },
  'antipatterns.ts «label naming more than one rule ({})» #1': {
    verdict: 'collapsed',
    why: 'an ADR label read back out of the record',
  },
  'antipatterns.ts «{}» #2': {
    verdict: 'collapsed',
    why: 'the entity ids that share that label, read back out of the record',
  },
  'focus.ts «{}» #1': {
    verdict: 'collapsed',
    why: 'the agent a run names — text whoever opened the session wrote',
  },
  'focus.ts « — {}» #1': {
    verdict: 'collapsed',
    why: 'the run’s goal; the dash is a chunk so the collapse cannot eat its space',
  },
  'guard.ts «{} {} → {}» #1': {
    verdict: 'collapsed',
    why: 'the id positional — not forgeable today (it had to match a task), closed as a rule',
  },
  'guard.ts «REFUSED ({})» #1': {
    verdict: 'collapsed',
    why: 'the gate’s own code — collapsed because it shares the line above’s tag, not its risk',
  },
  'handoff.ts «Recorded handoff on {}: {} → {}» #1': {
    verdict: 'collapsed',
    why: 'three positionals, none validated: a task and two agent NAMES',
  },
  'init.ts «Initialized mnema project at {}» #1': {
    verdict: 'collapsed',
    why: 'the project root — a directory name is what this class was first measured on',
  },
  'init.ts «Already a mnema project at {} — nothing to found.» #1': {
    verdict: 'collapsed',
    why: 'the same root, on the second branch',
  },
  'init.ts «backup key: created and enrolled — private half at {}» #1': {
    verdict: 'collapsed',
    why: 'a path built under this machine’s key root',
  },
  'key.ts «private half installed at {}» #1': {
    verdict: 'collapsed',
    why: 'a path under this machine’s key root',
  },
  'key.ts «Your copy at {} was read, not moved — keep it where it is.» #1': {
    verdict: 'collapsed',
    why: 'the positional itself, echoed back to say the copy was not consumed',
  },
  'key.ts «recorded in {}» #1': {
    verdict: 'collapsed',
    why: 'the project root, discovered from the cwd — the same value `init` prints',
  },
  'link.ts «Linked {} —{}→ {}» #1': {
    verdict: 'collapsed',
    why: 'subject, relation and target — none validated, and the relation is open by design',
  },
  'next-actions.ts «Task {} is terminal — no legal moves.» #1': {
    verdict: 'collapsed',
    why: 'the id positional; not forgeable today, and it heads a list on the next line',
  },
  'next-actions.ts «Task {} — {} legal move(s):» #1': {
    verdict: 'collapsed',
    why: 'the id positional, HEADING the list — reachable only with an id that matched',
  },
  'observe.ts «Recorded observation {} about {}» #1': {
    verdict: 'collapsed',
    why: '`about` is not validated — this is the door a forged value enters the record by',
  },
  'resume.ts «{} {}» #1': {
    verdict: 'collapsed',
    why: 'the actor, and the phrase — whose goal `presentation/runs.ts` now collapses too',
  },
  'run.ts «for {}» #1': {
    verdict: 'collapsed',
    why: 'the agent `--which` named, checked only for being blank',
  },
  'run.ts « — {}» #1': {
    verdict: 'collapsed',
    why: 'the goal `--goal` named — free text, and the dash is a chunk of its own template',
  },
  'run.ts «by {}» #1': {
    verdict: 'collapsed',
    why: 'the agent that closed the session, as recorded rather than as typed',
  },
  'skill.ts «Proposed skill "{}" ({})» #1': {
    verdict: 'collapsed',
    why: 'the name positional — the value `moved-record.ts` already collapses on a MOVE',
  },
  'tail.ts «The tail is still on disk at {} — nothing was removed.» #1': {
    verdict: 'collapsed',
    why: 'a path under the project root',
  },
  'timeline.ts «No history recorded for {}.» #1': {
    verdict: 'collapsed',
    why: 'the id positional, and this verb deliberately does not validate it',
  },
  'timeline.ts «{} — {} event(s):» #1': {
    verdict: 'collapsed',
    why: 'the id positional HEADING the list — the one forgeable list header there is',
  },

  // --- values another package worded, on a line this one lays out -------------------
  'verify.ts «census [{}] {} {}: {}» #1': {
    verdict: 'collapsed',
    why: '`@mnema/chain`’s census note: its kind, the fingerprint it points at, its detail',
  },
  'verify.ts «issue [{}] {} {}: {}» #1': {
    verdict: 'collapsed',
    why: 'the chain’s finding, and the TAIL it is about — a directory name, chosen on disk',
  },
};

// ---------------------------------------------------------------------------
// Driving the surface
// ---------------------------------------------------------------------------

/** Everything one invocation wrote, by stream. */
async function invoke(...argv: string[]): Promise<{ out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  await run(['--color=never', ...argv], {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fail: () => {},
  });
  return { out, err };
}

/** An ordinary value: well formed, nothing in it for anything to object to. */
const ORDINARY = '0198c2f1-4b7e-7a2d-8f31-6cd0a91e4b55';

/**
 * The value that forges a line, and its second half is an ITEM rather than a sentence.
 *
 * A refusal forges a refusal; a list header forges a HEADING WITH ITEMS UNDER IT, so the
 * half that matters here is one that reads as a row of the list it lands in — two spaces
 * and a legal-looking move. That is what {@link theListGainsNoItem} counts.
 */
const FORGED = `${ORDINARY}${LF}  start → doing`;

/**
 * The same forgery, with the id made UNIQUE per probe.
 *
 * One sandbox serves the whole file, and the probes WRITE: `observe` and `link` record a
 * fact about whatever they were handed. Reusing one value made the later probes read back
 * what the earlier ones wrote — `timeline` answered with a history instead of the empty
 * one its probe was written for, and the case failed for a reason that had nothing to do
 * with the product. A probe that consumes the fixture of the probe after it is a fixture
 * problem, not a finding, so each gets an id of its own.
 */
const forged = (nth: number): string =>
  `${ORDINARY.slice(0, -2)}${String(10 + nth).slice(-2)}${LF}  start → doing`;

let sandbox: string;
const cwdBefore = process.cwd();
const envBefore = { ...process.env };

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-success-line-'));
  const project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  process.chdir(project);
  await invoke('init');
}, 60_000);

afterAll(() => {
  process.chdir(cwdBefore);
  process.env = envBefore;
  rmSync(sandbox, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The classification is the source's
// ---------------------------------------------------------------------------

describe('every line this wiring words is classified', () => {
  it('classifies every site, and no site that went away', () => {
    const inSource = FOUND.sites.map((site) => site.key).sort();
    const classified = Object.keys(CLASSIFIED).sort();
    expect(classified).toEqual(inSource);
  });

  it('walks enough to mean something', () => {
    // The vacuous form of the case above is a walk that found nothing: two empty lists
    // are equal. The scale is stated, and so is the SHARE — the handoff's own grep found
    // 28 of these, and a walk that regressed to a line-wise pattern would land near it.
    expect(FOUND.files).toBeGreaterThan(35);
    expect(FOUND.calls).toBeGreaterThan(80);
    expect(FOUND.sites.length).toBe(60);
  });

  it('reads the verdict off the source rather than believing the table', () => {
    // `collapsed` has to BE tagged and `minted` has to NOT be. The second half is what
    // stops the table from rotting quietly: a value that stops being the product's own
    // gets a tag, and this goes red until somebody says so in words.
    const wrong = FOUND.sites
      .filter((site) => {
        const said = CLASSIFIED[site.key];
        if (said === undefined) return false;
        return site.tagged !== (said.verdict === 'collapsed');
      })
      .map((site) => site.key);
    expect(wrong).toEqual([]);
  });

  it('found sites of both kinds, and the scanner sees a tag when there is one', () => {
    // Neither arm of the case above may be empty, or half of it is vacuous.
    const verdicts = Object.values(CLASSIFIED).map((said) => said.verdict);
    expect(verdicts.filter((verdict) => verdict === 'collapsed').length).toBe(28);
    expect(verdicts.filter((verdict) => verdict === 'minted').length).toBe(32);
    expect(FOUND.sites.filter((site) => site.tagged).length).toBe(28);
  });

  it('every reason says where the value comes from', () => {
    // A verdict with no reason is an allowlist entry, and an allowlist nobody wrote a
    // reason into is the thing this table exists instead of.
    const bare = Object.entries(CLASSIFIED)
      .filter(([, said]) => said.why.trim().length < 20)
      .map(([key]) => key);
    expect(bare).toEqual([]);
  });
});

describe('the rule has one door in this layer', () => {
  it('nothing in wiring collapses a value on its own', () => {
    // `oneLine` applied by hand is a rule a call site can forget one FIELD of. The tag
    // takes the whole template, so there is nothing to forget — and this is what keeps a
    // second way of doing it from growing back beside the first.
    const offenders = sourceFiles(WIRING)
      .filter((file) => relative(WIRING, file) !== WORDING)
      .filter((file) => /\boneLine\b/.test(readFileSync(file, 'utf-8')))
      .map((file) => relative(WIRING, file));
    // `verify.ts` hands `oneLine` in as a parameter (`Named`), which is a shape with an
    // open question over it — see WHAT_IS_NOT_CLOSED. It is named rather than silent, so
    // the day it changes this goes red and the exception is deleted with it.
    expect(offenders).toEqual(['no-such-record.ts', 'verify.ts']);
  });
});

// ---------------------------------------------------------------------------
// The forgery does not pass
// ---------------------------------------------------------------------------

/** One way to reach a closed site from the command line. */
interface Probe {
  /** What this covers, as {@link CLASSIFIED} keys it. */
  readonly keys: readonly string[];
  /** What a caller types, with the forged value written `VALUE`. */
  readonly argv: readonly string[];
  /** The line the site prints, with the forged value written `VALUE`. */
  readonly says: string;
}

/** Where the forged value goes in a probe's argv and in its expected line. */
const VALUE = '<value>';

/**
 * How each REACHABLE closed site is driven, with the forged value entering by the argv
 * exactly as somebody would type it.
 *
 * Seven of the twenty-six are reachable this way. The other nineteen are named in
 * {@link UNREACHABLE} with what stands between them and a command line, and the two lists
 * are reconciled against the classification — so a site cannot be quietly dropped from
 * both.
 */
const PROBES: readonly Probe[] = [
  {
    keys: ['observe.ts «Recorded observation {} about {}» #1'],
    argv: ['observe', VALUE, '--topic', 'a topic', '--text', 'an observation'],
    says: `about ${VALUE}`,
  },
  {
    keys: ['link.ts «Linked {} —{}→ {}» #1'],
    argv: ['link', VALUE, 'a-target', '--rel', 'relates-to'],
    says: `Linked ${VALUE} —relates-to→ a-target`,
  },
  {
    keys: ['handoff.ts «Recorded handoff on {}: {} → {}» #1'],
    argv: ['handoff', 'a-task', VALUE, 'to-agent'],
    says: `Recorded handoff on a-task: ${VALUE} → to-agent`,
  },
  {
    keys: ['skill.ts «Proposed skill "{}" ({})» #1'],
    argv: ['skill', VALUE, '--body', 'a reusable pattern'],
    says: `Proposed skill "${VALUE}"`,
  },
  {
    keys: ['timeline.ts «No history recorded for {}.» #1'],
    argv: ['timeline', VALUE],
    says: `No history recorded for ${VALUE}.`,
  },
  {
    keys: ['run.ts «for {}» #1', 'run.ts « — {}» #1'],
    argv: ['run', 'start', '--which', VALUE, '--goal', 'a goal'],
    says: `for ${VALUE} — a goal`,
  },
];

describe('a value from outside cannot forge a second line', () => {
  for (const [nth, probe] of PROBES.entries()) {
    it(`keeps it to one line — ${probe.keys.join(' + ')}`, async () => {
      const value = forged(nth);
      const said = await invoke(...probe.argv.map((word) => (word === VALUE ? value : word)));
      const whole = said.out.join(LF);
      // THAT THIS PROBE REACHED ITS SITE. Every line of this surface is one line, so a
      // count alone passes for a probe that never got there — which is exactly what a
      // refusal one branch earlier looks like.
      expect(whole, probe.keys[0]).toContain(probe.says.slice(0, probe.says.indexOf(VALUE)));
      // The forged half is INSIDE the sentence rather than under it. Asserted on the
      // line that carries the id, so a run where the break survived fails HERE — that
      // line would end at the id and the words after it would be a line of their own.
      const [head] = value.split(LF);
      const forgedLine = whole.split(LF).find((line) => line.includes(head as string));
      expect(forgedLine, probe.keys[0]).toContain('start → doing');
      // And the whole answer is exactly the lines this verb prints: nothing gained one.
      expect(whole.split(LF).filter((line) => line.includes('start → doing'))).toHaveLength(1);
    });
  }

  it('says the ordinary value exactly as it always did', async () => {
    // Byte for byte, against the literal this surface printed before the tag existed.
    const said = await invoke('link', ORDINARY, 'a-target', '--rel', 'relates-to');
    expect(said.out[0]).toBe(`Linked ${ORDINARY} —relates-to→ a-target`);
    const run = await invoke('run', 'start', '--which', 'an-agent', '--goal', 'a goal');
    expect(run.out[1]).toBe('  for an-agent — a goal');
  });
});

/**
 * The closed sites no argv reaches cheaply, and what stands in the way.
 *
 * Naming them is the point: a site with neither a probe nor an entry here is a site
 * somebody closed and nobody drove, and the reconciliation below is what says so.
 */
const UNREACHABLE: Readonly<Record<string, string>> = {
  'antipatterns.ts «{}» #1': 'needs a task reopened twice in the record',
  'antipatterns.ts «label naming more than one rule ({})» #1': 'needs two decisions sharing an ADR',
  'antipatterns.ts «{}» #2': 'the same collision',
  'focus.ts «{}» #1': 'the run’s own line — driven by `run start`, read back by `focus`',
  'focus.ts « — {}» #1': 'the same line',
  'guard.ts «{} {} → {}» #1': 'the id must match a task, so a forged one never reaches it',
  'guard.ts «REFUSED ({})» #1': 'the code is the gate’s, never a caller’s',
  'init.ts «Initialized mnema project at {}» #1': 'needs a directory whose NAME holds a newline',
  'init.ts «Already a mnema project at {} — nothing to found.» #1': 'the same directory',
  'init.ts «backup key: created and enrolled — private half at {}» #1': 'needs such a key root',
  'key.ts «private half installed at {}» #1': 'needs a PEM to restore from',
  'key.ts «Your copy at {} was read, not moved — keep it where it is.» #1': 'the same restore',
  'key.ts «recorded in {}» #1': 'needs a request from a second machine',
  'next-actions.ts «Task {} is terminal — no legal moves.» #1': 'the id must match a task',
  'next-actions.ts «Task {} — {} legal move(s):» #1': 'the id must match a task',
  'resume.ts «{} {}» #1': 'read back from a run this suite opens through `run start`',
  'run.ts «by {}» #1': 'needs an open run to close',
  'tail.ts «The tail is still on disk at {} — nothing was removed.» #1': 'needs a tail to cut',
  'timeline.ts «{} — {} event(s):» #1': 'reached in two steps — see the case below',
  'verify.ts «census [{}] {} {}: {}» #1':
    'needs a committed key with no tail on disk, which is file surgery and not an argv',
  'verify.ts «issue [{}] {} {}: {}» #1':
    'needs a fabricated tail DIRECTORY — driven, with the chain’s half of the same line, ' +
    'in `the-phrase-the-domain-words-is-one-line.test.ts`',
};

describe('every closed site is either driven or named', () => {
  it('covers all twenty-eight, once each', () => {
    const closed = Object.entries(CLASSIFIED)
      .filter(([, said]) => said.verdict === 'collapsed')
      .map(([key]) => key)
      .sort();
    const accounted = [
      ...PROBES.flatMap((probe) => probe.keys),
      ...Object.keys(UNREACHABLE),
    ].sort();
    expect(accounted).toEqual(closed);
  });
});

// ---------------------------------------------------------------------------
// The list gains no item
// ---------------------------------------------------------------------------

describe('theListGainsNoItem', () => {
  it('adds no row to the timeline, in the two steps a forged value really takes', async () => {
    // THE ONE FORGEABLE LIST HEADER, and it takes two verbs. `observe` does not validate
    // its positional, so the value lands in the record; `timeline` then reads it back and
    // puts it at the HEAD of a list, with the count beside it. On the base this printed
    // three lines where two were the record's, and the middle one was indented exactly
    // like the item under it.
    await invoke('observe', FORGED, '--topic', 'a topic', '--text', 'an observation');
    const said = await invoke('timeline', FORGED);
    const lines = said.out.filter((line) => line.length > 0);
    // The COUNT the header states, and the number of rows under it, have to agree — which
    // is the whole promise of the form. Counting lines alone would pass a run where the
    // forged half became a header of its own.
    const stated = /— (\d+) event\(s\):/.exec(lines[0] ?? '')?.[1];
    expect(stated, said.out.join(LF)).toBeDefined();
    const rows = lines.filter((line) => line.startsWith('  '));
    expect(rows).toHaveLength(Number(stated));
    expect(lines[0]).toContain('start → doing');
  });
});

// ---------------------------------------------------------------------------
// What this slice deliberately did not close
// ---------------------------------------------------------------------------

describe('WHAT_IS_NOT_CLOSED', () => {
  it('no longer names the twin reading, because the twin was closed', () => {
    // THIS CASE USED TO BE THE DEBT AND IT IS THE CORRECTION OF ITS OWN SHAPE. It said
    // `status` printed a run's goal raw and that it *cannot* collapse it "without a
    // static import that would put the copilot's edge on the floor of every invocation"
    // — which was wrong twice. `status.ts` already imports the rule of the line, and it
    // is loaded inside the action, so the floor was never the question; and the fix was
    // never `status`'s to make. The collapse belongs in `lastRunPhrase`, where the phrase
    // is WORDED, so both readings come through it (A3).
    //
    // AND THE RECONCILIATION COULD NOT HAVE GONE RED. It asserted `status.ts` does not
    // hold the TAG — and the right fix does not put the tag there, so the day the debt
    // was paid this case would have stayed green with a dead reason under it. What
    // replaces it points at the file that owns the question now, and that file's
    // classification is what goes red if the collapse leaves.
    const runs = readFileSync(join(SRC, 'presentation', 'runs.ts'), 'utf-8');
    expect(runs).toContain('oneLine(run.goal)');
    const owned = fileURLToPath(
      new URL('./the-line-a-reading-words-is-one-line.test.ts', import.meta.url),
    );
    expect(readFileSync(owned, 'utf-8')).toContain('runs.ts « — {}» oneLine(run.goal) #1');
  });

  it('no longer names the chain’s own detail, because the chain now words it one line', () => {
    // THIS CASE USED TO BE THE DEBT, and it is the second one in this file to be paid
    // rather than restated. It said `verify`'s issue line prints `@mnema/chain`'s detail
    // verbatim and that `oneLine` does not reach that package. The rule reaches it now:
    // it MOVED there — `@mnema/chain/one-line`, under `core` and under this surface —
    // and the detail goes through it where it is written.
    //
    // What replaces the debt is the assertion that the door is where it says it is, and
    // that the sentence which was named here comes out of it. The classification of the
    // values inside it is that slice's, and it goes red there if a collapse leaves.
    const chain = fileURLToPath(new URL('../../chain/src/chain/verify.ts', import.meta.url));
    const source = readFileSync(chain, 'utf-8');
    expect(source).toContain("import { oneLine } from '../one-line.js';");
    // `${` is BUILT and not typed: a plain string holding one is a lint error here.
    const open = `${'$'}{`;
    expect(source).toContain(`UNREADABLE: ${open}oneLine(withinChain(layout, error.locus))}`);
    const owned = fileURLToPath(
      new URL('./the-phrase-the-domain-words-is-one-line.test.ts', import.meta.url),
    );
    expect(readFileSync(owned, 'utf-8')).toContain(
      '«UNREADABLE: {}: {}» oneLine(withinChain(layout, error.locus)) #1',
    );
  });
});
