/**
 * EVERY VALUE THE DOMAIN PUTS IN A SENTENCE, AND WHERE IT CAME FROM.
 *
 * Two slices before this one closed the lines the SURFACE words — the wiring's, with a
 * template tag (`a-line-of-success-is-one-line.test.ts`), and the readings', value by
 * value (`the-line-a-reading-words-is-one-line.test.ts`). Both stopped at the same wall
 * and both named it: a sentence `@mnema/chain` or `@mnema/core` wrote is handed to the
 * surface ALREADY JOINED, so no rule the surface applies can reach inside it. The
 * wiring's table carries two entries whose verdict is `elsewhere` for exactly this, and
 * the readings' slice named `core`'s two prune refusals the same way.
 *
 * SO THE RULE CAME DOWN, and it came down further than the debt said. `@mnema/core` is
 * where the refusals of the whole product are worded, but it cannot hold the rule:
 * the dependency runs `core → chain`, and `@mnema/chain` words the verifier's findings —
 * which is the sharpest reader there is, because a verdict is what a third party reads
 * to decide whether to believe the record. `one-line.ts` is therefore in `@mnema/chain`,
 * published as its own subpath so reaching it is not reaching the proof engine, and
 * `core` and `code` re-export it. There is ONE place the rule of the line comes from and
 * it is under everything (A3).
 *
 * THE CLASS IS WHAT THESE PACKAGES RETURN, NEVER WHAT THEY THROW. A finding and a
 * refusal are one per line under a count; an exception is not — the line it eventually
 * occupies is worded by the surface's last-resort catch, which is a different layer with
 * a rule of its own. So {@link sitesInSource} seeds on the three fields these packages
 * carry prose out in — `message`, `detail` and `reason` — plus the two a verdict's
 * clauses use, follows a sink that takes one as a parameter and a function that produces
 * one, and everything under a `throw` is out. That boundary is structural, so a parser's
 * complaint moving from an exception into a finding lands in the classification by
 * itself.
 *
 * NOTHING HERE IS FOUND BY A LIST. This series has now missed four times from the same
 * cause — a handoff's addresses standing in for a rule — and the handoff for THIS slice
 * says twenty-three sites, twelve in `core` and eleven in `chain`. It counted SENTENCES,
 * not values, and it counted only the ones written at a `detail:` or a `message:`
 * directly: the walk finds eighty-one values. Six of the ones it adds are in
 * `verifyTailOwnership`, which words its four findings through a local `push` — and one
 * of those six is a forgery this file drives end to end.
 *
 * WHAT WAS OPEN, MEASURED AGAINST THE SHIPPED BINARY, and all three are driven below:
 *
 *   - `mnema key revoke $'aa\nthe record counts fake as a key here.'` came back as TWO
 *     lines, the second a whole sentence the record never said. `--fingerprint` is a
 *     positional nothing validates before the roster answers about it.
 *   - a `tailproof.json` holding a newline made `mnema verify` print a second line under
 *     the issue heading, through the JSON reader's own message — which quotes the bytes
 *     it choked on, newline and all.
 *   - a tail DIRECTORY named `aa\n  forged  public  a record nobody wrote` broke the
 *     issue line in two, twice over: once in the chain's own detail and once in the
 *     heading the wiring puts in front of it. Both halves are closed here.
 *
 * THE DISCRIMINANT IS THE ORIGIN OF THE VALUE and the question is the one this family
 * always asks — CAN THIS HOLD A NEWLINE. A count, a `seq`, a byte total, a word of a
 * closed union, a constant of the module that prints it cannot. What arrived through the
 * argv, came back OUT OF THE RECORD, or was read off this machine's disk can — and in
 * the verifier that is nearly everything, because the verifier's whole premise is that
 * what it is reading may have been written by somebody it does not trust.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verify } from '@mnema/chain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';
import { sourceFiles } from './support/reading-source.js';

/** The two packages that word a sentence before the surface ever sees it. */
const LAYERS: readonly { readonly name: string; readonly src: string }[] = [
  { name: '@mnema/chain', src: fileURLToPath(new URL('../../chain/src', import.meta.url)) },
  { name: '@mnema/core', src: fileURLToPath(new URL('../../core/src', import.meta.url)) },
];

/** A newline, built rather than typed, so no literal in this file spans two lines. */
const LF = String.fromCharCode(10);
/** The collapse — `@mnema/chain/one-line`, and the one door these two packages have. */
const DOOR = 'oneLine';

/**
 * The fields a sentence leaves these packages in.
 *
 * `message` is a refusal's, `detail` is an issue's and a census note's, `reason` is a
 * declined key's; `text` and `summary` are the verdict's, whose clauses are a line too.
 * They are the product's own words for "prose about what happened", and each of them is
 * asserted to be REACHED below, so a name that stopped meaning anything cannot sit here
 * making the seed look wider than it is.
 */
const CARRIES_PROSE = ['message', 'detail', 'reason', 'text', 'summary'] as const;

/**
 * The subset a function may take as a PARAMETER and still be a sink.
 *
 * `text` is not in it and that is deliberate: half the content layer takes a `text:
 * string`, and so does the rule of the line itself. What names a sink is a parameter
 * that means "the prose of a no" — `err(code, message)` in the gates, `push(detail)` in
 * the verifier's ownership check.
 */
const SINK_PARAMETERS: readonly string[] = ['message', 'detail', 'reason'];

// ---------------------------------------------------------------------------
// Reading the source
// ---------------------------------------------------------------------------

/**
 * The source with comments blanked and every offset kept, so a `detail:` inside a
 * paragraph of prose is not a field and a `//` never eats a line of code.
 *
 * Strings keep their content — a sentence is often a template followed by `+` and a
 * plain string — and templates are left whole, because their text is what
 * {@link readTemplate} reads a shape out of.
 */
function withoutComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const char = source[i] as string;
    if (char === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== LF) {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (char === '/' && source[i + 1] === '*') {
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === LF ? LF : ' ';
        i += 1;
      }
      out += '  ';
      i += 2;
      continue;
    }
    if (char === "'" || char === '"') {
      out += char;
      i = copyQuoted(source, i, (text) => {
        out += text;
      });
      continue;
    }
    out += char;
    i += 1;
  }
  return out;
}

/** Copies a `'` or `"` string from just after its opening quote, escapes included. */
function copyQuoted(source: string, at: number, keep: (text: string) => void): number {
  const quote = source[at];
  let i = at + 1;
  while (i < source.length && source[i] !== quote) {
    if (source[i] === '\\') {
      keep(source.slice(i, i + 2));
      i += 2;
      continue;
    }
    keep(source[i] as string);
    i += 1;
  }
  keep(source[i] ?? '');
  return i + 1;
}

/** Past a `'` or `"` string, escapes included. */
function pastQuoted(text: string, at: number): number {
  const quote = text[at];
  let i = at + 1;
  while (i < text.length && text[i] !== quote) i += text[i] === '\\' ? 2 : 1;
  return i + 1;
}

/**
 * One template: what it SAYS with `{}` where each value goes, and the values as they are
 * written. The shape is the key rather than a line number, because a line number moves
 * whenever anything above it does and a shape is what a reader recognizes.
 */
function readTemplate(text: string, at: number): { shape: string; values: string[]; end: number } {
  let shape = '';
  const values: string[] = [];
  let i = at + 1;
  while (i < text.length && text[i] !== '`') {
    if (text[i] === '\\') {
      shape += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (text[i] === '$' && text[i + 1] === '{') {
      const end = pastInterpolation(text, i + 2);
      values.push(oneExpression(text.slice(i + 2, end - 1)));
      shape += '{}';
      i = end;
      continue;
    }
    shape += text[i] === LF ? ' ' : (text[i] as string);
    i += 1;
  }
  return { shape, values, end: i + 1 };
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

/** An expression as one line of text, so how the source wraps cannot move a key. */
function oneExpression(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Every template literal in a slice of source, at the top level of it. */
function templatesIn(text: string): { shape: string; values: string[]; at: number }[] {
  const found: { shape: string; values: string[]; at: number }[] = [];
  let i = 0;
  while (i < text.length) {
    const char = text[i] as string;
    if (char === "'" || char === '"') i = pastQuoted(text, i);
    else if (char === '`') {
      const template = readTemplate(text, i);
      found.push({ shape: template.shape, values: template.values, at: i });
      i = template.end;
    } else i += 1;
  }
  return found;
}

/** The expression a `<field>:` is given, up to the top-level `,`, `;` or closing brace. */
function valueOfProperty(text: string, from: number): string {
  let i = from;
  let depth = 0;
  let out = '';
  while (i < text.length) {
    const char = text[i] as string;
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') {
      if (depth === 0) break;
      depth -= 1;
    } else if ((char === ',' || char === ';') && depth === 0) break;
    if (char === "'" || char === '"') {
      const end = pastQuoted(text, i);
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (char === '`') {
      const end = readTemplate(text, i).end;
      out += text.slice(i, end);
      i = end;
      continue;
    }
    out += char;
    i += 1;
  }
  return out;
}

/** The top-level arguments — or parameters — of the list whose `(` is at `open`. */
function argumentsOf(text: string, open: number): string[] {
  const found: string[] = [];
  let i = open + 1;
  let depth = 1;
  let start = i;
  while (i < text.length && depth > 0) {
    const char = text[i] as string;
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      i += 1;
    } else if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      if (depth === 0) {
        found.push(text.slice(start, i));
        break;
      }
      i += 1;
    } else if (char === ',' && depth === 1) {
      found.push(text.slice(start, i));
      i += 1;
      start = i;
    } else if (char === "'" || char === '"') {
      i = pastQuoted(text, i);
    } else if (char === '`') {
      i = readTemplate(text, i).end;
    } else {
      i += 1;
    }
  }
  return found.map((argument) => argument.trim()).filter((argument) => argument.length > 0);
}

/**
 * The spans a `throw` covers, so what is raised can be told from what is returned.
 *
 * This is the boundary of the whole class and it is read off the source rather than
 * declared: a parser's complaint that stops being thrown and starts being a finding
 * becomes a site the moment it moves, and this file goes red until it is classified.
 */
function throwSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const raised of text.matchAll(/\bthrow\b/g)) {
    let i = raised.index ?? 0;
    let depth = 0;
    while (i < text.length) {
      const char = text[i] as string;
      if (char === '(' || char === '[' || char === '{') depth += 1;
      else if (char === ')' || char === ']' || char === '}') depth -= 1;
      else if (char === ';' && depth === 0) {
        i += 1;
        break;
      } else if (char === "'" || char === '"') {
        i = pastQuoted(text, i);
        continue;
      } else if (char === '`') {
        i = readTemplate(text, i).end;
        continue;
      }
      i += 1;
    }
    spans.push([raised.index ?? 0, i]);
  }
  return spans;
}

/** The body of every `function name(…) …{ … }` in a file, by name. */
function functionBodies(text: string): Map<string, string> {
  const bodies = new Map<string, string>();
  for (const declared of text.matchAll(/function\s+([A-Za-z0-9_$]+)\s*\(/g)) {
    let i = (declared.index ?? 0) + (declared[0] as string).length - 1;
    let depth = 0;
    while (i < text.length) {
      const char = text[i] as string;
      if (char === '(') depth += 1;
      else if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          break;
        }
      }
      i += 1;
    }
    while (i < text.length && text[i] !== '{') i += 1;
    const opens = i;
    let braces = 0;
    while (i < text.length) {
      const char = text[i] as string;
      if (char === '{') braces += 1;
      else if (char === '}') {
        braces -= 1;
        if (braces === 0) {
          i += 1;
          break;
        }
      } else if (char === "'" || char === '"') {
        i = pastQuoted(text, i);
        continue;
      } else if (char === '`') {
        i = readTemplate(text, i).end;
        continue;
      }
      i += 1;
    }
    bodies.set(declared[1] as string, text.slice(opens, i));
  }
  return bodies;
}

// ---------------------------------------------------------------------------
// The sites, read off the source
// ---------------------------------------------------------------------------

/** One value that reaches the text of a sentence these packages hand out. */
interface Site {
  /** The package, and the file within its `src`. */
  readonly file: string;
  /** The expression, as it is written — whitespace collapsed so a wrap cannot move it. */
  readonly expression: string;
  /** `<package> <file> «<shape>» <expression> #<n>`. */
  readonly key: string;
}

/** What one package's walk found. */
interface Walk {
  readonly sites: Site[];
  /** The fields that really did seed something, so no name in the list is decoration. */
  readonly seeded: Set<string>;
  /** Functions taking the prose of a no as a parameter — a sink by its own signature. */
  readonly sinks: string[];
  /** Functions that PRODUCE one, reached from a sentence and followed into. */
  readonly producers: string[];
  /** Files that word at least one value into a sentence. */
  readonly wording: string[];
  /** Files whose prose the walk never entered — the completeness hole, if any. */
  readonly missed: string[];
}

/**
 * Every value one package puts in a sentence, with the indirections followed.
 *
 * THE SEED is a property of an object literal named one of {@link CARRIES_PROSE}. That
 * is where a refusal, an issue, a census note and a verdict clause are each written, and
 * it is the product's own vocabulary rather than a list of addresses.
 *
 * THE SINK is a function whose parameter is named one of {@link SINK_PARAMETERS} and
 * typed `string`. The gates hand their refusals to `err(code, message)` and the
 * verifier's ownership check to a local `push(detail)`, so a walk that read only the
 * literal `message:` would have missed six sentences — four of them in the one function
 * whose forgery is measured. A call through a member (`issues.push`) is not one: the
 * name collides with an array's, and a scan that took it would count every object
 * pushed anywhere as a sentence.
 *
 * THE PRODUCER is a function a sentence is `f(…)` of: its whole body is a sentence in
 * turn, so `keyWithoutTailDetail` and `coverageClause` are followed rather than trusted.
 * The expansion is a fixpoint, so a producer that words itself out of another one is
 * reached too.
 *
 * WHAT IS UNDER A `throw` IS NOT A SITE, and that is the class's edge — see this file's
 * head.
 */
function walk(src: string): Walk {
  const files = sourceFiles(src);
  const sinks = new Map<string, number>();
  for (const file of files) {
    // The rule of the line is not a sink: it takes a `text: string` because it is the
    // door, and every value that goes through it is a site somewhere else already.
    if (relative(src, file) === 'one-line.ts') continue;
    const text = withoutComments(readFileSync(file, 'utf-8'));
    for (const declared of text.matchAll(
      /(?:function\s+([A-Za-z0-9_$]+)|const\s+([A-Za-z0-9_$]+)\s*=\s*)\s*\(/g,
    )) {
      const name = (declared[1] ?? declared[2]) as string;
      const open = (declared.index ?? 0) + (declared[0] as string).length - 1;
      argumentsOf(text, open).forEach((parameter, nth) => {
        const written = oneExpression(parameter);
        for (const sink of SINK_PARAMETERS) {
          if (new RegExp(`^${sink}\\??\\s*:\\s*string\\b`).test(written)) sinks.set(name, nth);
        }
      });
    }
  }

  const seeded = new Set<string>();
  const sentences: { file: string; text: string; seeds?: string }[] = [];
  const bodies = new Map<string, { file: string; text: string }>();
  for (const file of files) {
    const path = relative(src, file);
    const text = withoutComments(readFileSync(file, 'utf-8'));
    for (const [name, body] of functionBodies(text)) bodies.set(name, { file: path, text: body });
    for (const property of text.matchAll(new RegExp(`\\b(${CARRIES_PROSE.join('|')})\\s*:`, 'g'))) {
      const written = oneExpression(
        valueOfProperty(text, (property.index ?? 0) + (property[0] as string).length),
      );
      sentences.push({ file: path, text: written, seeds: property[1] as string });
    }
    for (const [name, nth] of sinks) {
      for (const call of text.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))) {
        const at = call.index ?? 0;
        if (text[at - 1] === '.') continue;
        if (/\b(function|const|let|var)\s+$/.test(text.slice(0, at))) continue;
        const argument = argumentsOf(text, at + (call[0] as string).length - 1)[nth];
        if (argument !== undefined) sentences.push({ file: path, text: oneExpression(argument) });
      }
    }
  }

  const producers: string[] = [];
  for (let more = true; more; ) {
    more = false;
    for (const sentence of [...sentences]) {
      const call = /^([A-Za-z0-9_$]+)\s*\(/.exec(sentence.text);
      const body = call === null ? undefined : bodies.get(call[1] as string);
      if (call === null || body === undefined || producers.includes(call[1] as string)) continue;
      producers.push(call[1] as string);
      if (sentence.seeds !== undefined) seeded.add(sentence.seeds);
      sentences.push({
        ...body,
        ...(sentence.seeds === undefined ? {} : { seeds: sentence.seeds }),
      });
      more = true;
    }
  }

  const sites: Site[] = [];
  const seen = new Map<string, number>();
  for (const sentence of sentences) {
    for (const template of templatesIn(sentence.text)) {
      if (sentence.seeds !== undefined && template.values.length > 0) seeded.add(sentence.seeds);
      for (const value of template.values) {
        const said = `${sentence.file} «${template.shape}» ${value}`;
        const nth = (seen.get(said) ?? 0) + 1;
        seen.set(said, nth);
        sites.push({ file: sentence.file, expression: value, key: `${said} #${nth}` });
      }
    }
  }

  // A file that words a sentence with a value in it but yielded no site is a file this
  // walk did not enter — which is the one way the classification below can be total
  // about nothing. It is derived, so it cannot be forgotten.
  const wording = [...new Set(sites.map((site) => site.file))].sort();
  const missed: string[] = [];
  for (const file of files) {
    const path = relative(src, file);
    if (wording.includes(path)) continue;
    const text = withoutComments(readFileSync(file, 'utf-8'));
    for (const property of text.matchAll(new RegExp(`\\b(${CARRIES_PROSE.join('|')})\\s*:`, 'g'))) {
      const written = valueOfProperty(text, (property.index ?? 0) + (property[0] as string).length);
      if (templatesIn(written).some((template) => template.values.length > 0)) missed.push(path);
    }
  }
  return {
    sites,
    seeded,
    sinks: [...sinks.keys()].sort(),
    producers: producers.sort(),
    wording,
    missed: [...new Set(missed)].sort(),
  };
}

/** Every template in a wording file that is NOT a site and is not raised, per package. */
function unwalked(src: string, wording: readonly string[], sites: readonly Site[]): string[] {
  const known = new Set(sites.map((site) => `${site.file}|${site.expression}`));
  const left: string[] = [];
  for (const file of sourceFiles(src)) {
    const path = relative(src, file);
    if (!wording.includes(path)) continue;
    const text = withoutComments(readFileSync(file, 'utf-8'));
    const raised = throwSpans(text);
    for (const template of templatesIn(text)) {
      if (raised.some(([from, to]) => template.at >= from && template.at < to)) continue;
      for (const value of template.values) {
        if (known.has(`${path}|${value}`)) continue;
        left.push(`${path} «${template.shape}» ${value}`);
      }
    }
  }
  return left.sort();
}

const FOUND = LAYERS.map((layer) => ({ ...layer, ...walk(layer.src) }));

/** Every site of both packages, keyed by the package that words it. */
const SITES: Site[] = FOUND.flatMap((layer) =>
  layer.sites.map((site) => ({ ...site, key: `${layer.name} ${site.key}` })),
);

/** Everything left over in a wording file, keyed the same way. */
const UNWALKED: string[] = FOUND.flatMap((layer) =>
  unwalked(layer.src, layer.wording, layer.sites).map((left) => `${layer.name} ${left}`),
);

// ---------------------------------------------------------------------------
// What each value IS
// ---------------------------------------------------------------------------

/**
 * Where one value in a sentence came from — the answer to the one question this family
 * asks.
 *
 *   - `collapsed` — it arrived through the argv, came back OUT OF THE RECORD, or was
 *     read off this machine's disk, so it goes through `oneLine` HERE. The table does
 *     not decide this: the expression really does hold the call, and a value that stops
 *     going through it goes red.
 *   - `minted` — it is the product's own and cannot hold whitespace: a count, a `seq`, a
 *     byte total, a word of a closed union, a field path of the content contract, a
 *     constant of the module that prints it, a fingerprint this run computed by hashing
 *     a key. It must NOT be collapsed, so a value that quietly stops being the product's
 *     own cannot keep this verdict.
 *   - `composed` — it is not text from anywhere yet: another function of this package
 *     words it, and every value THAT function puts in it is a site of its own.
 *
 * A NOTE ON THE VERIFIER, because it is where nearly every verdict is `collapsed` and
 * that looks excessive until you say why. Everywhere else in this product, "out of the
 * record" means text this product wrote and sealed. In `verify` it does not: the
 * verifier's whole premise is that the bytes under it may have been written by somebody
 * who wanted a particular answer. A tail id is a DIRECTORY NAME — anyone who can write
 * the tree can create one. A signer fingerprint is a field of a stored entry. A reader's
 * complaint quotes the bytes it choked on. So the values in a finding are exactly the
 * values an adversary chooses, and the line they land on is the line a third party reads
 * to decide whether to believe the record.
 */
type Verdict = 'collapsed' | 'minted' | 'composed';

/**
 * Every value these two packages put in a sentence, and where it comes from.
 *
 * The KEYS are reconciled against the source in both directions and the VERDICTS are
 * checked against it; the REASONS cannot be — no walk derives "a `seq` is a whole number
 * the catalog requires" from an expression. So the table carries what a reader knows, and
 * the part that rots — which values exist, and whether each is collapsed — is derived.
 */
const CLASSIFIED: Readonly<Record<string, { verdict: Verdict; why: string }>> = {
  // --- @mnema/chain: the enrollment fold's findings -------------------------------
  '@mnema/chain chain/enrollment.ts «re-adds {} revoked under signature coverage without being checkpointed itself» oneLine(fp) #1':
    {
      verdict: 'collapsed',
      why: 'a fingerprint a stored `key.enrolled` names — bytes in a tail, not a value this run made',
    },
  '@mnema/chain chain/enrollment.ts «event signer {} is not a key enrolled for {} at this point» oneLine(event.signerFp) #1':
    {
      verdict: 'collapsed',
      why: 'the signer a stored event claims; the catalog requires a non-empty string and nothing more',
    },
  '@mnema/chain chain/enrollment.ts «event signer {} is not a key enrolled for {} at this point» oneLine(event.who) #1':
    {
      verdict: 'collapsed',
      why: 'the identity a stored event claims to speak for, on the same terms as the signer',
    },

  // --- @mnema/chain: the verifier's findings --------------------------------------
  '@mnema/chain chain/verify.ts «tail {} ends in a partial line that was dropped — the mark of a write » oneLine(tail) #1':
    {
      verdict: 'collapsed',
      why: 'a directory name under `tails/` — anybody who can write the tree can choose it',
    },
  '@mnema/chain chain/verify.ts «tail {} has no committed key fingerprint (fabricated or relocated tail)» oneLine(tail) #1':
    {
      verdict: 'collapsed',
      why: 'the same directory name, and this is the finding a fabricated tail EARNS — the one measured',
    },
  '@mnema/chain chain/verify.ts «UNREADABLE: {}: {}» oneLine(withinChain(layout, error.locus)) #1':
    {
      verdict: 'collapsed',
      why: 'a path inside the chain, built from a directory name and a file name on this disk',
    },
  '@mnema/chain chain/verify.ts «UNREADABLE: {}: {}» oneLine(error.reason) #1': {
    verdict: 'collapsed',
    why: 'the JSON reader’s own complaint, which quotes the stored bytes it choked on',
  },
  '@mnema/chain chain/verify.ts «entry names tail {}, stored under {}» oneLine(entry.link.tail) #1':
    {
      verdict: 'collapsed',
      why: 'the tail a stored entry NAMES — the very field this finding exists to disagree with',
    },
  '@mnema/chain chain/verify.ts «entry names tail {}, stored under {}» oneLine(tail) #1': {
    verdict: 'collapsed',
    why: 'the directory it was actually found in',
  },
  '@mnema/chain chain/verify.ts «seq gap: expected {}, found {}» expectedSeq #1': {
    verdict: 'minted',
    why: 'a number this walk counted while reading the tail',
  },
  '@mnema/chain chain/verify.ts «seq gap: expected {}, found {}» entry.link.seq #1': {
    verdict: 'minted',
    why: 'a whole number — the catalog refuses the entry before this if it is not one',
  },
  '@mnema/chain chain/verify.ts «checkpoint names tail {}, stored under {}» oneLine(checkpoint.tail) #1':
    {
      verdict: 'collapsed',
      why: 'the tail a stored checkpoint names, on the same terms as an entry’s',
    },
  '@mnema/chain chain/verify.ts «checkpoint names tail {}, stored under {}» oneLine(tail) #1': {
    verdict: 'collapsed',
    why: 'the directory the checkpoint was found in',
  },
  '@mnema/chain chain/verify.ts «checkpoint coverage gap: expected to start at {}, starts at {}» covered + 1 #1':
    {
      verdict: 'minted',
      why: 'one past the seq this walk has covered so far — arithmetic, not text',
    },
  '@mnema/chain chain/verify.ts «checkpoint coverage gap: expected to start at {}, starts at {}» checkpoint.fromSeq #1':
    {
      verdict: 'minted',
      why: 'a whole number the catalog requires of a checkpoint’s range',
    },
  '@mnema/chain chain/verify.ts «external witness (T3): PENDING, which is not coverage — {}» witness.detail #1':
    {
      verdict: 'composed',
      why: 'the reading `witness.ts` composed — every value in it is a site of its own below',
    },
  '@mnema/chain chain/verify.ts «external witness (T3): covered — {}» witness.detail #1': {
    verdict: 'composed',
    why: 'the same reading, in the state that reaches the record’s top rung',
  },
  '@mnema/chain chain/verify.ts «external witness (T3): not covered — {}» witness.detail #1': {
    verdict: 'composed',
    why: 'the same reading, in the state every record is in until somebody asks for a witness',
  },
  '@mnema/chain chain/witness.ts «Bitcoin block {} at {}» attestation.height #1': {
    verdict: 'minted',
    why: 'a block height read as a NUMBER out of the proof’s own varuint — no byte of it is text',
  },
  '@mnema/chain chain/witness.ts «Bitcoin block {} at {}» new Date(header.time * 1000).toISOString() #1':
    {
      verdict: 'minted',
      why: 'the instant, formatted from a 32-bit field of an 80-byte header — a number, whoever wrote the file',
    },
  '@mnema/chain chain/witness.ts «an attestation was requested from {} and has not confirmed» oneLine(attestation.uri) #1':
    {
      verdict: 'collapsed',
      why: 'a calendar URI read out of a file in the tree — anybody who can write the tree chooses it',
    },
  '@mnema/chain chain/witness.ts «anchored in Bitcoin block {}, whose header this record does not carry» attestation.height #1':
    {
      verdict: 'minted',
      why: 'the same height, in the state where the record has the anchor and not the header',
    },
  '@mnema/chain chain/witness.ts «tail {} holds no attestation» oneLine(weakest.tail) #1': {
    verdict: 'collapsed',
    why: 'a tail DIRECTORY name, read off the disk — whoever writes the tree chooses it',
  },
  '@mnema/chain chain/witness.ts «the last attested checkpoint is dated by {}, with {} event(s) written after it» facts.dated.after #1':
    {
      verdict: 'minted',
      why: 'a count of events, arrived at by subtracting two seqs — arithmetic, not text',
    },
  '@mnema/chain chain/witness.ts «the last attested checkpoint is dated by {}, with {} event(s) written after it» facts.dated.attested.detail #1':
    {
      verdict: 'composed',
      why: 'the covered reading `witness.ts` composed — its height and its instant are sites above',
    },
  '@mnema/chain chain/witness.ts «the stored header for Bitcoin block {} carries another merkle root» attestation.height #1':
    {
      verdict: 'minted',
      why: 'the height a contradicted attestation named',
    },
  '@mnema/chain chain/witness.ts «the stored header for Bitcoin block {} carries no proof of work» attestation.height #1':
    {
      verdict: 'minted',
      why: 'the height whose stored header was mined at nothing',
    },
  '@mnema/chain chain/witness.ts «{}, and {}» all #1': {
    verdict: 'composed',
    why: 'the clauses of a tail’s sentence joined so far — the head’s own finding, and the dating',
  },
  '@mnema/chain chain/witness.ts «{}, and {}» one #1': {
    verdict: 'composed',
    why: 'the next clause of the same sentence — the dating above, or a request still in flight',
  },
  '@mnema/chain chain/witness.ts «the stored proof is unreadable: {}» oneLine(String((error as Error).message)) #1':
    {
      verdict: 'collapsed',
      why: 'the proof reader’s own complaint, which quotes the stored bytes it choked on',
    },
  '@mnema/chain chain/verify.ts «no committed public key for signer {}» oneLine(checkpoint.signerFp) #1':
    {
      verdict: 'collapsed',
      why: 'the fingerprint a stored checkpoint claims signed it, before anything has matched it',
    },
  '@mnema/chain chain/verify.ts «public key for {} does not match its fingerprint (key was swapped)» oneLine(checkpoint.signerFp) #1':
    {
      verdict: 'collapsed',
      why: 'the same claimed fingerprint, on the branch where the committed key disagrees with it',
    },
  '@mnema/chain chain/verify.ts «checkpoint failed: {}» verdict.reason #1': {
    verdict: 'minted',
    why: 'one of `verifyCheckpoint`’s three words — a closed union, so there is nothing to collapse',
  },
  '@mnema/chain chain/verify.ts «{} tail(s)» facts.tailCount #1': {
    verdict: 'minted',
    why: 'a count of the tails this verification read',
  },
  '@mnema/chain chain/verify.ts «tail {} has no ownership proof (fabricated or relocated tail)» oneLine(tail) #1':
    {
      verdict: 'collapsed',
      why: 'the directory name again, in the ownership check — worded through a local `push`',
    },
  '@mnema/chain chain/verify.ts «tail {} has a malformed ownership proof: {}» oneLine(tail) #1': {
    verdict: 'collapsed',
    why: 'the directory name, on the branch where its `tailproof.json` would not parse',
  },
  '@mnema/chain chain/verify.ts «tail {} has a malformed ownership proof: {}» oneLine((error as Error).message) #1':
    {
      verdict: 'collapsed',
      why: 'the JSON reader’s message over a WHOLE FILE, which quotes it — the second measured forgery',
    },
  '@mnema/chain chain/verify.ts «tail {} ownership proof cannot be checked: no committed public key» oneLine(tail) #1':
    {
      verdict: 'collapsed',
      why: 'the directory name, on the branch with no committed key to check the proof against',
    },
  '@mnema/chain chain/verify.ts «tail {} ownership proof is invalid ({})» oneLine(tail) #1': {
    verdict: 'collapsed',
    why: 'the directory name, on the branch where the proof is present and does not verify',
  },
  '@mnema/chain chain/verify.ts «tail {} ownership proof is invalid ({})» verdict.reason #1': {
    verdict: 'minted',
    why: 'one of `verifyTailProof`’s three words — a closed union, like the checkpoint’s',
  },
  '@mnema/chain chain/verify.ts «{} ({} event(s) through {}), » oneLine(waiver.tail) #1': {
    verdict: 'collapsed',
    why: 'the tail a stored waiver names as cut — a field of an event, chosen by whoever wrote it',
  },
  '@mnema/chain chain/verify.ts «{} ({} event(s) through {}), » waiver.eventCount #1': {
    verdict: 'minted',
    why: 'a whole number the catalog requires of a waiver’s claim',
  },
  '@mnema/chain chain/verify.ts «{} ({} event(s) through {}), » oneLine(waiver.throughHash) #1': {
    verdict: 'collapsed',
    why: 'the head the waiver claims the tail ended at — a string field of a stored event',
  },
  '@mnema/chain chain/verify.ts «authorized by {}» oneLine(waiver.who) #1': {
    verdict: 'collapsed',
    why: 'the identity a stored waiver names as its authorizer',
  },
  "@mnema/chain chain/verify.ts «committed public key has no tail on disk, and the record names the cut: {}» accounts.join('; ') #1":
    {
      verdict: 'composed',
      why: 'the four values above, joined — every one of them is a site of its own already',
    },
  '@mnema/chain chain/verify.ts «{} event(s) are hash-chained but NOT yet signature-covered» facts.uncheckpointed #1':
    {
      verdict: 'minted',
      why: 'a count of events resting on the hash chain alone',
    },
  '@mnema/chain chain/verify.ts «{} event(s) above the last checkpoint are hash-chained but NOT yet signature-covered» facts.uncheckpointed #1':
    {
      verdict: 'minted',
      why: 'the same count, on the branch where a verified checkpoint exists to be above',
    },

  // --- @mnema/core: the content door ----------------------------------------------
  '@mnema/core content/screen.ts «"{}" is {} bytes; a single field holds at most {}. » field #1': {
    verdict: 'minted',
    why: 'a field path of the content contract — `content/fields.ts` names them, not a caller',
  },
  '@mnema/core content/screen.ts «"{}" is {} bytes; a single field holds at most {}. » bytes #1': {
    verdict: 'minted',
    why: 'the field’s weight in UTF-8, counted here',
  },
  '@mnema/core content/screen.ts «"{}" is {} bytes; a single field holds at most {}. » FIELD_BYTE_LIMIT #1':
    {
      verdict: 'minted',
      why: 'the limit this module declares, printed beside the count that exceeded it',
    },
  '@mnema/core content/screen.ts «"{}" reads as {}, and it is a name the record is addressed by — » field #1':
    {
      verdict: 'minted',
      why: 'a field key of the content contract — `content/fields.ts` names them, not a caller',
    },
  '@mnema/core content/screen.ts «"{}" reads as {}, and it is a name the record is addressed by — » classes #1':
    {
      verdict: 'minted',
      why: 'the credential classes `content/secrets.ts` declares, joined here — never the value',
    },

  // --- @mnema/core: identity --------------------------------------------------------
  '@mnema/core identity/handshake.ts «"{}" is not an identity id — an identity looks like » oneLine(input.anchor) #1':
    {
      verdict: 'collapsed',
      why: 'the anchor a caller typed, in the refusal that says it is not one',
    },
  '@mnema/core identity/handshake.ts «{}<64 hex>, as printed when a project is founded» ANCHOR_PREFIX #1':
    {
      verdict: 'minted',
      why: 'the `mnid:` prefix this product mints anchors with — a constant',
    },
  '@mnema/core identity/handshake.ts «{} could not be read as a private key» oneLine(input.privateKeyPath) #1':
    {
      verdict: 'collapsed',
      why: 'a path a caller typed — nothing has opened it, which is what the refusal says',
    },
  "@mnema/core identity/membership.ts «this key belongs to more than one identity in that record ({}) — » oneLine(anchors.join(', ')) #1":
    {
      verdict: 'collapsed',
      why: 'the anchors the record proves this key joined, read back out of stored events',
    },
  '@mnema/core identity/membership.ts «this key was revoked from {} — a retired key that writes again » oneLine(retiredFrom) #1':
    {
      verdict: 'collapsed',
      why: 'the anchor a stored revocation names, on the same terms',
    },
  '@mnema/core identity/membership.ts «nothing in that record proves the key {} belongs to an identity — » key.fingerprint #1':
    {
      verdict: 'minted',
      why: 'this machine’s own fingerprint, computed by hashing the key material it just read',
    },
  '@mnema/core identity/restore.ts «{} could not be read as a private key» oneLine(input.privateKeyPath) #1':
    {
      verdict: 'collapsed',
      why: 'the path `key restore` was given, in the refusal that says it would not open',
    },
  '@mnema/core identity/restore.ts «this machine already holds the private key {} — » oneLine(other) #1':
    {
      verdict: 'collapsed',
      why: 'a FILE NAME in the key root, stripped of its suffix — whatever the directory holds',
    },
  '@mnema/core identity/roster.ts «that request does not prove the key {} consented to join {} — » oneLine(fingerprint) #1':
    {
      verdict: 'collapsed',
      why: 'a fingerprint decoded out of the request line a caller pasted in',
    },
  '@mnema/core identity/roster.ts «that request does not prove the key {} consented to join {} — » oneLine(anchor) #1':
    {
      verdict: 'collapsed',
      why: 'the anchor `decideAnchor` read out of the record and this machine’s local files',
    },
  '@mnema/core identity/roster.ts «a request is made for ONE identity, so check the joining machine asked to join {} » oneLine(anchor) #1':
    {
      verdict: 'collapsed',
      why: 'the same anchor, said a second time in the sentence that tells the reader what to check',
    },
  "@mnema/core identity/roster.ts «this machine's key is not currently valid for {} — the record retired it, » oneLine(anchor) #1":
    {
      verdict: 'collapsed',
      why: 'the same anchor, in the refusal `key enroll` gets from a machine the record retired',
    },
  "@mnema/core identity/roster.ts «this machine's key is not currently valid for {} — the record retired it, » oneLine(anchor) #2":
    {
      verdict: 'collapsed',
      why: 'the same sentence again, worded for `key revoke` — the two differ after the dash',
    },
  '@mnema/core identity/roster.ts «the record does not count {} as a key of {} — » oneLine(input.fingerprint) #1':
    {
      verdict: 'collapsed',
      why: 'THE MEASURED ONE: `key revoke`’s positional, which nothing validates before this',
    },
  '@mnema/core identity/roster.ts «the record does not count {} as a key of {} — » oneLine(anchor) #1':
    {
      verdict: 'collapsed',
      why: 'the anchor that refusal is about',
    },
  '@mnema/core identity/roster.ts «{} is the only key {} has — retiring it would leave the » oneLine(input.fingerprint) #1':
    {
      verdict: 'collapsed',
      why: 'the same positional, on the branch where the key IS a member and is the last one',
    },
  '@mnema/core identity/roster.ts «{} is the only key {} has — retiring it would leave the » oneLine(anchor) #1':
    {
      verdict: 'collapsed',
      why: 'the anchor that would be left unable to sign',
    },

  // --- @mnema/core: the write door and the gates -----------------------------------
  '@mnema/core workflow/append.ts «{}. The fact was NOT recorded — an entry no read could open would » reason #1':
    {
      verdict: 'composed',
      why: 'the content door’s own refusals, whose five values are sites in `content/screen.ts`',
    },
  '@mnema/core workflow/decision-gate.ts «"{}" requires a non-empty "{}"» oneLine(request.action) #1':
    {
      verdict: 'collapsed',
      why: 'the action word a caller typed — this gate refuses it without validating it first',
    },
  '@mnema/core workflow/decision-gate.ts «"{}" requires a non-empty "{}"» field #1': {
    verdict: 'minted',
    why: 'the proof field the transition table requires — one of a closed set this package owns',
  },
  '@mnema/core workflow/decision-gate.ts «"{}" is not a decision state» oneLine(request.from) #1': {
    verdict: 'collapsed',
    why: 'the state the caller says the decision is in, in the refusal that says it is not a state',
  },
  '@mnema/core workflow/decision-gate.ts «"{}" is not a decision action» oneLine(request.action) #1':
    {
      verdict: 'collapsed',
      why: 'the action word, in the refusal that says the vocabulary does not hold it',
    },
  '@mnema/core workflow/decision-gate.ts «cannot "{}" a decision in {}» oneLine(request.action) #1':
    {
      verdict: 'collapsed',
      why: 'the action, on the branch where both words are known and the move between them is not',
    },
  '@mnema/core workflow/decision-gate.ts «cannot "{}" a decision in {}» oneLine(request.from) #1': {
    verdict: 'collapsed',
    why: 'the state that move would have started from',
  },
  '@mnema/core workflow/decision-gate.ts «"{}" does not take a successor "by"» oneLine(request.action) #1':
    {
      verdict: 'collapsed',
      why: 'the action, in the refusal that says only `supersede` names one',
    },
  '@mnema/core workflow/decision-operations.ts «decision "{}" does not exist» oneLine(input.id) #1':
    {
      verdict: 'collapsed',
      why: 'the id a caller typed for a decision this tree has no record of',
    },
  '@mnema/core workflow/decision-operations.ts «supersede names a successor "{}" that does not exist» oneLine(verdict.by) #1':
    {
      verdict: 'collapsed',
      why: 'the successor `--by` named, which is the caller’s word until the record answers about it',
    },
  '@mnema/core workflow/gate.ts «"{}" requires a non-empty "{}"» oneLine(request.action) #1': {
    verdict: 'collapsed',
    why: 'the task action a caller typed',
  },
  '@mnema/core workflow/gate.ts «"{}" requires a non-empty "{}"» field #1': {
    verdict: 'minted',
    why: 'the proof field the task transition requires — the closed set again',
  },
  '@mnema/core workflow/gate.ts «"{}" is not a workflow state» oneLine(request.from) #1': {
    verdict: 'collapsed',
    why: 'the state the caller says the task is in',
  },
  '@mnema/core workflow/gate.ts «"{}" is not a workflow action» oneLine(request.action) #1': {
    verdict: 'collapsed',
    why: 'the action word, in the refusal that says the workflow does not have one',
  },
  '@mnema/core workflow/gate.ts «cannot "{}" a task in {}» oneLine(request.action) #1': {
    verdict: 'collapsed',
    why: 'the action, on the branch where the move itself is what the table refuses',
  },
  '@mnema/core workflow/gate.ts «cannot "{}" a task in {}» oneLine(request.from) #1': {
    verdict: 'collapsed',
    why: 'the state that move would have started from',
  },
  '@mnema/core workflow/identity-operations.ts «it is registered for another identity ({})» oneLine(registration.anchor) #1':
    {
      verdict: 'collapsed',
      why: 'the anchor read out of a `.enroll` file in the key root — a file, not a value this run made',
    },
  '@mnema/core workflow/operations.ts «task "{}" does not exist» oneLine(input.id) #1': {
    verdict: 'collapsed',
    why: 'the id a caller typed for a task this tree has no record of',
  },
  '@mnema/core workflow/prune-operations.ts «Tail {} is the one this write lands on. A waiver has to outlive the » oneLine(input.tail) #1':
    {
      verdict: 'collapsed',
      why: 'the tail `--tail` named — the refusal `a-refusal-is-one-line.test.ts` named as this slice’s',
    },
  '@mnema/core workflow/prune-operations.ts «No tail {} holds events in this tree. A waiver is written BEFORE the » oneLine(input.tail) #1':
    {
      verdict: 'collapsed',
      why: 'the same tail, on the branch where no tail of that name holds anything',
    },
  '@mnema/core workflow/session-operations.ts «run "{}" does not exist» oneLine(input.run) #1': {
    verdict: 'collapsed',
    why: 'the run id a caller typed, or the one `MNEMA_RUN` carried in',
  },
  '@mnema/core workflow/session-operations.ts «run "{}" is already ended» oneLine(input.run) #1': {
    verdict: 'collapsed',
    why: 'the same id, on the branch where the record has the run and it is closed',
  },
  '@mnema/core workflow/skill-gate.ts «"{}" requires a non-empty "{}"» oneLine(request.action) #1':
    {
      verdict: 'collapsed',
      why: 'the skill action a caller typed',
    },
  '@mnema/core workflow/skill-gate.ts «"{}" requires a non-empty "{}"» field #1': {
    verdict: 'minted',
    why: 'the proof field the skill transition requires — the closed set again',
  },
  '@mnema/core workflow/skill-gate.ts «"{}" is not a skill state» oneLine(request.from) #1': {
    verdict: 'collapsed',
    why: 'the state the caller says the skill is in',
  },
  '@mnema/core workflow/skill-gate.ts «"{}" is not a skill action» oneLine(request.action) #1': {
    verdict: 'collapsed',
    why: 'the action word, in the refusal that says the skill vocabulary does not hold it',
  },
  '@mnema/core workflow/skill-gate.ts «cannot "{}" a skill in {}» oneLine(request.action) #1': {
    verdict: 'collapsed',
    why: 'the action, on the branch where the move is what the table refuses',
  },
  '@mnema/core workflow/skill-gate.ts «cannot "{}" a skill in {}» oneLine(request.from) #1': {
    verdict: 'collapsed',
    why: 'the state that move would have started from',
  },
  '@mnema/core workflow/skill-operations.ts «skill "{}" does not exist» oneLine(input.id) #1': {
    verdict: 'collapsed',
    why: 'the id a caller typed for a skill this tree has no record of',
  },
};

/**
 * What a file that words a sentence ALSO holds, and why none of it is one.
 *
 * The walk enters a file through a field a sentence leaves in. What it cannot see is a
 * template that same file builds for some other purpose — so every one of those is named
 * here, with what it is instead. It is reconciled in both directions: a template that
 * appears has to be declared, and a declaration whose template went away has to leave.
 */
const NOT_A_SENTENCE: Readonly<Record<string, string>> = {
  '@mnema/chain chain/enrollment.ts «{}|{}» anchor':
    'half a key of a `Set`, not a sentence — `restoreKey` pairs an anchor with a fingerprint',
  '@mnema/chain chain/enrollment.ts «{}|{}» fp': 'the other half of that same Set key',
  '@mnema/chain chain/verify.ts «{} committed key(s) without a tail (see census — informational, not a break)» count':
    'a clause of the verdict sentence, worded through a table of wordings per kind of note ' +
    'that this walk does not enter. It interpolates a COUNT and nothing else.',
  '@mnema/chain chain/verify.ts «{} tail(s) ending in a dropped partial line (see census — informational, not a break)» count':
    'the other clause of that same table, and a count on the same terms',
  '@mnema/chain chain/verify.ts «{}/» layout.root':
    'the prefix `withinChain` STRIPS — what makes the locus a path inside the chain rather ' +
    'than wherever this clone sits. It is never printed.',
  '@mnema/core workflow/decision-operations.ts «ADR-{}» decisions.size + 1':
    'the alias a decision is minted with, from a count of the decisions already recorded',
  '@mnema/chain chain/witness.ts «{}\\n» serializeStoredHeader(height, header)':
    'a LINE OF A FILE this package writes — the canonical form of one stored block ' +
    'header, terminated. Nobody reads it as a sentence; the reader that opens it ' +
    'refuses a line it cannot parse rather than quoting one.',
};

// ---------------------------------------------------------------------------
// The classification is the source's
// ---------------------------------------------------------------------------

describe('every value the domain puts in a sentence is classified', () => {
  it('classifies every value, and no value that went away', () => {
    expect(Object.keys(CLASSIFIED).sort()).toEqual(SITES.map((site) => site.key).sort());
  });

  it('walks enough to mean something', () => {
    // The vacuous form of the case above is a walk that found nothing: two empty lists
    // are equal. The scale is stated, and so is what the HANDOFF said — twenty-three
    // sites, twelve in `core` and eleven in `chain` — because it counted sentences
    // written at a `message:` or a `detail:` directly, and a value is not a sentence.
    expect(SITES.length).toBe(98);
    expect(FOUND[0]?.sites.length).toBe(47);
    expect(FOUND[1]?.sites.length).toBe(51);
    expect(FOUND.flatMap((layer) => layer.wording).length).toBeGreaterThan(15);
  });

  it('follows the indirections rather than reading a field name', () => {
    // The three shapes the walk has to see through, each named by what it found. Without
    // the SINK it misses six sentences, four of them in `verifyTailOwnership` — which
    // holds the one measured forgery in the whole verifier. Without the PRODUCER it
    // misses the census note's own account of a cut.
    expect(FOUND[0]?.sinks).toEqual(['push']);
    expect(FOUND[1]?.sinks).toEqual(['err']);
    expect(FOUND[0]?.producers).toContain('keyWithoutTailDetail');
    expect(FOUND[0]?.producers).toContain('coverageClause');
    expect(FOUND[1]?.producers).toEqual(['faultReason']);
  });

  it('seeds on every field it says it does', () => {
    // A name in the seed that seeds nothing makes the walk look wider than it is. All
    // five are reached: `message` is a refusal's, `detail` an issue's and a census
    // note's, `reason` a declined key's, `text` a verdict clause's, and `summary` the
    // whole verdict's — which words nothing of its own, because it is the clauses joined.
    const seeded = new Set(FOUND.flatMap((layer) => [...layer.seeded]));
    expect([...seeded].sort()).toEqual([...CARRIES_PROSE].sort());
  });

  it('entered every file that words a sentence with a value in it', () => {
    // The one way the reconciliation above can be total about nothing: a file whose
    // prose the walk never reached has no sites, so it has nothing to disagree with.
    expect(FOUND.flatMap((layer) => layer.missed)).toEqual([]);
  });

  it('reads the verdict off the source rather than believing the table', () => {
    // `collapsed` has to BE collapsed and the other two must NOT be. The second half is
    // what stops the table from rotting quietly: a value that stops being the product's
    // own gets the call, and this goes red until somebody says so in words.
    const wrong = SITES.filter((site) => {
      const said = CLASSIFIED[site.key];
      if (said === undefined) return false;
      return new RegExp(`\\b${DOOR}\\b`).test(site.expression) !== (said.verdict === 'collapsed');
    }).map((site) => site.key);
    expect(wrong).toEqual([]);
  });

  it('found values of all three kinds, in the numbers the source holds', () => {
    // No arm of the case above may be empty, or that much of it is vacuous.
    const verdicts = Object.values(CLASSIFIED).map((said) => said.verdict);
    const count = (verdict: Verdict): number => verdicts.filter((said) => said === verdict).length;
    expect(count('collapsed')).toBe(64);
    expect(count('minted')).toBe(26);
    expect(count('composed')).toBe(8);
    expect(SITES.filter((site) => new RegExp(`\\b${DOOR}\\b`).test(site.expression))).toHaveLength(
      64,
    );
  });

  it('every reason says where the value comes from', () => {
    // A verdict with no reason is an allowlist entry, and an allowlist nobody wrote a
    // reason into is the thing this table exists instead of.
    const bare = Object.entries(CLASSIFIED)
      .filter(([, said]) => said.why.trim().length < 20)
      .map(([key]) => key);
    expect(bare).toEqual([]);
  });

  it('accounts for every other template a wording file holds', () => {
    // The direction that catches a value the walk cannot see. What is under a `throw` is
    // out of the class by construction — see this file's head — and everything else a
    // file that words a sentence builds has to be named.
    expect(UNWALKED.sort()).toEqual(Object.keys(NOT_A_SENTENCE).sort());
    const thin = Object.entries(NOT_A_SENTENCE).filter(([, why]) => why.trim().length < 20);
    expect(thin).toEqual([]);
  });

  it('tells a raised message from a returned one', () => {
    // The class's edge, on input this file owns — because if `throwSpans` matched
    // everything the case above would be green with nothing in it, and if it matched
    // nothing every parser complaint in the catalog would be demanding a verdict.
    // `${` is BUILT and not typed: a plain string holding one is a lint error, and a
    // sample that had to be written as a template would be read differently from the
    // source this scan reads.
    const open = `${'$'}{`;
    const thrown = `throw new Error(\`a ${open}x} b\`);`;
    const raised = throwSpans(`${thrown}${LF}const kept = \`c ${open}y} d\`;`);
    expect(raised).toHaveLength(1);
    expect(raised[0]?.[0]).toBe(0);
    expect(raised[0]?.[1]).toBe(thrown.length);
    expect(throwSpans(`const kept = \`c ${open}y} d\`;`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// One door, under everything
// ---------------------------------------------------------------------------

describe('the rule has one door and it is below both packages', () => {
  /**
   * The door's own body — `text.replace(/\s+/g, ' ')`, to ONE SPACE.
   *
   * The space is what makes it this rule. `decodeKeyRequest` strips whitespace to
   * NOTHING, which un-wraps a pasted base64url line rather than making a line of it, and
   * a pattern that matched any `\s` would have called that a rival.
   */
  const A_COLLAPSE = /replace\(\s*\/\\s\+\/g,\s*' '\)/;
  /** Where the rule lives now. */
  const RULE = fileURLToPath(new URL('../../chain/src/one-line.ts', import.meta.url));

  it('collapses with the shared function and with nothing of its own', () => {
    // A second collapse written in either package — a `replace` by hand, a local
    // helper — would be a second rule, and the one that stops agreeing is always the
    // second. The ban is checked against the place the shape really is first, or it
    // would pass on a pattern that matches nothing anywhere.
    expect(A_COLLAPSE.test(readFileSync(RULE, 'utf-8'))).toBe(true);
    const rivals = LAYERS.flatMap((layer) =>
      sourceFiles(layer.src)
        .filter((file) => relative(layer.src, file) !== 'one-line.ts')
        .filter((file) => A_COLLAPSE.test(withoutComments(readFileSync(file, 'utf-8'))))
        .map((file) => `${layer.name} ${relative(layer.src, file)}`),
    );
    expect(rivals).toEqual([]);
  });

  it('is re-exported by both packages and written out by neither', () => {
    // A3. `core` and `code` each keep the address their own modules import, and each of
    // them is one line of plumbing to the package below. A copy would be a second rule.
    for (const at of ['../../core/src/one-line.ts', '../src/one-line.ts']) {
      const source = readFileSync(fileURLToPath(new URL(at, import.meta.url)), 'utf-8');
      expect(source, at).toContain("export { oneLine } from '@mnema/chain/one-line';");
      expect(A_COLLAPSE.test(source), at).toBe(false);
    }
  });

  it('reaches the door by importing it, in every module that collapses anything', () => {
    // The other half of "one door": a module that collapses has the import, and a module
    // that has the import collapses. An import nobody uses is a door standing open onto
    // nothing, and a collapse with no import cannot be the shared one.
    const importing = LAYERS.flatMap((layer) =>
      sourceFiles(layer.src)
        .filter((file) =>
          /import \{[^}]*\boneLine\b[^}]*\} from '(?:\.\.\/)+one-line\.js'/.test(
            readFileSync(file, 'utf-8'),
          ),
        )
        .map((file) => `${layer.name} ${relative(layer.src, file)}`),
    ).sort();
    const collapsing = [
      ...new Set(
        SITES.filter((site) => new RegExp(`\\b${DOOR}\\b`).test(site.expression)).map((site) =>
          site.key.slice(0, site.key.indexOf(' «')),
        ),
      ),
    ].sort();
    // `search-store.ts` is the ONE importer that is not wording a sentence: it collapses
    // the head of a body into an excerpt for the index, which is a value the projection
    // stores rather than a line anybody prints. It is here rather than holding a
    // `replace` of its own for the reason this case exists — two collapses would be two
    // rules — and it is named so the day it stops importing the door this goes red.
    expect(importing).toEqual([...collapsing, '@mnema/core projections/search-store.ts'].sort());
  });

  it('accounts for every collapse these packages perform', () => {
    // If a file holds a `oneLine` that no site's expression holds, it is collapsing
    // something in a position this scan does not reach — which means the classification
    // is not total, whatever it says about itself.
    const atASite = new Map<string, number>();
    for (const site of SITES) {
      const uses = site.expression.match(new RegExp(`\\b${DOOR}\\b`, 'g'))?.length ?? 0;
      if (uses > 0) {
        const file = site.key.slice(0, site.key.indexOf(' «'));
        atASite.set(file, (atASite.get(file) ?? 0) + uses);
      }
    }
    const unaccounted: string[] = [];
    for (const layer of LAYERS) {
      for (const file of sourceFiles(layer.src)) {
        const path = relative(layer.src, file);
        if (path === 'one-line.ts') continue;
        const named = `${layer.name} ${path}`;
        // The import DECLARES the door; it does not walk through it.
        const text = withoutComments(readFileSync(file, 'utf-8')).replace(/^import [^;]*;$/gm, '');
        const uses = text.match(new RegExp(`\\b${DOOR}\\b`, 'g'))?.length ?? 0;
        const seen = atASite.get(named) ?? 0;
        if (uses !== seen) unaccounted.push(`${named}: ${uses} in source, ${seen} classified`);
      }
    }
    // The same one, from the other direction: one collapse in the source, none at a site.
    expect(unaccounted).toEqual([
      '@mnema/core projections/search-store.ts: 1 in source, 0 classified',
    ]);
  });
});

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

/**
 * The two shapes a forged half can take, one per family of line.
 *
 * A refusal is a one-item list — one per reply — so the second half only has to look
 * like a refusal to be one. An issue is one row of a list under a count, so the second
 * half is shaped like a row: the indent, the layer, the tree and a finding.
 */
const FORGED_REFUSAL = 'Refused (UNKNOWN_KEY): the record counts fake as a key here.';
/** A word of it that SURVIVES the collapse, so "did it arrive" is a separate question. */
const REFUSAL_MARK = 'counts fake as a key here';
const FORGED_ISSUE = '  issue [T1] public forged#0: a finding nobody made';
const ISSUE_MARK = 'a finding nobody made';

let sandbox: string;
const cwdBefore = process.cwd();
const envBefore = { ...process.env };

/** A project of its own, founded, with one record in it so a tail exists. */
async function founded(name: string): Promise<string> {
  const project = join(sandbox, name);
  mkdirSync(project, { recursive: true });
  process.chdir(project);
  await invoke('init');
  await invoke('memory', 'a memory');
  return project;
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-domain-line-'));
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
}, 60_000);

afterAll(() => {
  process.chdir(cwdBefore);
  process.env = envBefore;
  rmSync(sandbox, { recursive: true, force: true });
});

/**
 * The one tail a founded project has — asserted to be the only one.
 *
 * `readdirSync` does not promise an order, so "the first entry" is not a tail: the day
 * a probe fabricates a second one, a helper that took `[0]` would tamper with whichever
 * the filesystem happened to list first and the probe would pass or fail by luck. It
 * cost a flake to learn that here.
 */
function tailIn(project: string): string {
  const tails = join(project, '.mnema', 'tails');
  const found = readdirSync(tails);
  expect(found, tails).toHaveLength(1);
  return join(tails, found[0] as string);
}

describe('a value from outside cannot forge a second line', () => {
  it('keeps `key revoke` to one line — the fingerprint nothing validated', async () => {
    // THE DEFECT, AS MEASURED AGAINST THE SHIPPED BINARY. `--fingerprint` is a
    // positional, the roster answers about it before anything has checked its shape,
    // and the sentence it lands in is `identity/roster.ts`'s — a package the surface's
    // own rule cannot reach inside of.
    await founded('revoke');
    const said = await invoke('key', 'revoke', `aa${LF}${FORGED_REFUSAL}`, '--reason', 'a reason');
    const whole = said.err.join(LF);
    // THAT THE PROBE REACHED ITS SITE, and that the value arrived rather than being
    // dropped on the way. Every line of this surface is one line, so a count alone
    // passes for a probe that never got there.
    expect(whole).toContain('Refused (UNKNOWN_KEY)');
    expect(whole).toContain(REFUSAL_MARK);
    // AND THE FORGERY IS THE SECOND HALF STANDING AT THE HEAD OF A LINE. Counted over
    // the BYTES and not over the calls: the surface hands the whole refusal to `io.err`
    // in one go, so a break inside it is one call either way and a count of calls would
    // pass for a refusal that came out in two.
    expect(whole.split(LF)).toHaveLength(1);
  }, 60_000);

  it('keeps `verify` to one line — the JSON reader’s complaint about a whole file', async () => {
    // The proof a tail carries over its own id is read as ONE document, so the reader's
    // message quotes the bytes it choked on, newline and all. Anybody who can write the
    // tree can write that file.
    const project = await founded('tailproof');
    writeFileSync(join(tailIn(project), 'tailproof.json'), `x${LF}${FORGED_ISSUE}`);
    const said = await invoke('verify');
    const whole = said.err.join(LF);
    expect(whole).toContain('has a malformed ownership proof');
    // THAT THE BYTES ARRIVED AND THE BREAK IN THEM DID NOT. The reader quotes only the
    // head of the document it choked on, so the mark to look for is the newline ITSELF:
    // `x` then whitespace is what was written, and `x ` — one space — is what a reader
    // gets. Asserted on the collapse rather than on how many bytes V8 chooses to quote.
    expect(whole).toContain('"x ');
    expect(whole.split(LF).filter((line) => line.trimStart().startsWith('issue [T1]'))).toEqual([]);
  }, 60_000);

  it('keeps `verify` to one line — a tail directory named with a newline', async () => {
    // A tail is a DIRECTORY, and its name is in the finding twice: once in the chain's
    // own detail and once in the heading the wiring puts in front of it. Both halves are
    // the same rule at two layers, and this is the case that needs both of them.
    const project = await founded('tail-directory');
    tailIn(project);
    mkdirSync(join(project, '.mnema', 'tails', `aa${LF}${FORGED_ISSUE}`), { recursive: true });
    const said = await invoke('verify');
    const whole = said.err.join(LF);
    expect(whole).toContain('has no committed key fingerprint');
    expect(whole).toContain(ISSUE_MARK);
    // Both streams, split on the BYTES: the verdict and the census go to stdout and a
    // forged row there would read as a finding just as well.
    const everything = [...said.out, ...said.err].join(LF).split(LF);
    expect(everything.filter((line) => line.trimStart().startsWith('issue [T1]'))).toEqual([]);
    // And the count of issue lines is the count of issues, which is what a reader who
    // does not know the tail's name goes by.
    expect(everything.filter((line) => line.trimStart().startsWith('issue ['))).toHaveLength(1);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// The verdict is one line per finding, before anybody prints it
// ---------------------------------------------------------------------------

describe('the verifier’s own findings are one line each', () => {
  it('holds every detail and every clause to one line, over a tampered chain', async () => {
    // THE PROMISE STATED WHERE IT IS MADE. The three probes above go through the command
    // line, and the surface tags the line it lays the findings out on — which means a
    // collapse that left THIS package would still come out looking like one line there.
    // So the same tampering is read at the source: `verify` returns the findings, and
    // every one of them has to be one line before anybody has printed anything.
    //
    // Tampered three ways at once, so the branches that word a finding are reached
    // together: a fabricated tail DIRECTORY whose name holds a newline, a `tailproof.json`
    // that will not parse, and a stored line that will not either.
    // Two chains rather than one, because a tail whose stored line will not read is not
    // read far enough to have its ownership proof checked: the findings would not all be
    // in the same verdict, and a probe that never reached a branch proves nothing about
    // it. Both verdicts are held together.
    const one = await founded('the-chain-itself');
    // The real tail is taken BEFORE the fabricated one exists, or which of the two gets
    // the unparseable proof is up to the filesystem's listing order.
    writeFileSync(join(tailIn(one), 'tailproof.json'), `x${LF}${FORGED_ISSUE}`);
    mkdirSync(join(one, '.mnema', 'tails', `aa${LF}${FORGED_ISSUE}`), { recursive: true });
    const two = await founded('the-chain-unreadable');
    writeFileSync(join(tailIn(two), '000001.jsonl'), `y${LF}${FORGED_ISSUE}${LF}`);

    const said = [join(one, '.mnema'), join(two, '.mnema')].flatMap((root) => {
      const result = verify(root);
      return [
        ...result.issues.map((issue) => issue.detail),
        ...result.census.map((note) => note.detail),
        ...result.clauses.map((clause) => clause.text),
        result.summary,
      ];
    });
    // THAT THE TAMPERING REACHED THE BRANCHES, or every assertion below is about an
    // empty list. The three findings this fixture earns, named by what they say.
    expect(said.some((line) => line.includes('has no committed key fingerprint'))).toBe(true);
    expect(said.some((line) => line.includes('has a malformed ownership proof'))).toBe(true);
    expect(said.some((line) => line.includes('UNREADABLE:'))).toBe(true);
    // AND THAT THE FORGED HALVES ARRIVED — the directory's name, and the reader's own
    // quote of the bytes, whose newline is now the space that proves it went through.
    expect(said.some((line) => line.includes(ISSUE_MARK))).toBe(true);
    expect(said.some((line) => line.includes('"x '))).toBe(true);
    // THE PROMISE. Not one of them is two.
    expect(said.filter((line) => line.includes(LF))).toEqual([]);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Nothing else moved
// ---------------------------------------------------------------------------

describe('an ordinary value says what it always did', () => {
  it('refuses an unknown key in the words it always used', async () => {
    const project = await founded('ordinary-revoke');
    // The anchor is read out of the record this `init` wrote, never typed here: a value
    // this suite invented would be a value the product never minted.
    const anchor = /(mnid:[0-9a-f]{64})/.exec(
      readFileSync(join(tailIn(project), '000001.jsonl'), 'utf-8'),
    )?.[1];
    expect(anchor).toBeDefined();
    const said = await invoke('key', 'revoke', 'not-a-real-fingerprint', '--reason', 'a reason');
    expect(said.err[0]).toBe(
      `Refused (UNKNOWN_KEY): the record does not count not-a-real-fingerprint as a key of ${anchor} — it was never enrolled here, or it was retired already`,
    );
  }, 60_000);

  it('verifies a clean project in the words it always used', async () => {
    await founded('ordinary-verify');
    const said = await invoke('verify');
    expect(said.out[0]).toContain('public: local integrity verified (T1/T2/T4)');
    expect(said.err).toEqual([]);
  }, 60_000);
});
