/**
 * EVERY VALUE THIS LAYER PUTS ON A LINE, AND WHERE IT CAME FROM.
 *
 * The sibling slice closed the lines the WIRING words (`tests/a-line-of-success-is-one-line.test.ts`)
 * and named `presentation/` as debt, in a note that said "six of the ten modules". There
 * are twenty-four modules, and the count in the note was of the word `oneLine` rather
 * than of a call — four of the modules it counted only MENTION it in a comment. That is
 * the fourth miss of this series from the same cause: a list of addresses standing in for
 * a rule. So nothing here is found by a list. {@link sitesInSource} walks the layer and
 * {@link CLASSIFIED} answers it, in both directions.
 *
 * THE DISCRIMINANT IS THE ORIGIN OF THE VALUE, and the question is the one the family
 * has always asked — CAN THIS HOLD A NEWLINE. A uuid, an `ADR-<n>`, an anchor, a content
 * hash, an instant, a count, a tree, a word of a closed transition table cannot. What
 * arrived through the argv, came back out of the record, or was built out of this
 * machine's environment can, and every one of those goes through `oneLine`.
 *
 * WHAT IS A SITE HERE IS A VALUE, NOT A LINE, AND THAT IS THE ONE THING THIS SLICE DOES
 * DIFFERENTLY FROM ITS SIBLING. The wiring hands `io.out` a STRING: by the time the rule
 * applies the values are already bytes, so the only unit a guard can see is the whole
 * template — which is why that layer needed a TAG (`wiring/on-one-line.ts`), one that
 * takes the template and collapses every value in it by construction. This layer does not
 * word bytes. It builds a {@link Line} out of PARTS, and a part is a value of its own
 * (`presentation/line.ts`), so a list of columns is not a sentence with three holes in
 * it — it is three values in an array, which no tag could span. The finer unit is
 * available here, and with it "did this site collapse every field" stops being the
 * undecidable question it was over there: each field IS a site, and the guard reads the
 * verdict of each off the source. So the door is `oneLine` itself — the same function the
 * tag calls — applied where the value enters the line, and there is no second one.
 *
 * NOT EVERY MODULE HERE IS A SITE, and saying so is part of the classification rather
 * than an exemption. Eleven of the twenty-four never receive the record: they are the
 * primitives that shape whatever a caller hands them (`line.ts`, `items.ts`, `detail.ts`,
 * `verdict.ts`, `echo.ts`), the renderers that turn parts into bytes (`plain.ts`,
 * `styled.ts`, `folded.ts`, `render.ts`), the drawing of the product's own name
 * (`banner.ts`) and one sentence about a count (`consultation.ts`). A module that never
 * receives a value from outside has no value whose origin is in question, and the split
 * is DERIVED from the imports rather than written down — so a primitive that starts
 * reading the record becomes a composer, its values become unclassified, and this file
 * goes red.
 *
 * WHAT THIS SLICE CLOSED, and the one it was handed. `presentation/runs.ts` composes the
 * phrase BOTH `resume` and `status` print, and the run's goal inside it is text somebody
 * typed: `resume` collapsed it at its own line and `status` did not, so the same run came
 * out as one line through one verb and as two through the other. That is what the rule
 * living at a CALLER costs — as many doors as there are callers — and it is fixed by
 * moving the collapse into the phrase, where both readings pass. Five more values were
 * open and are named in the table: a search TERM the caller typed, the host store's PATH
 * `usage` reports, an edge's RELATION (`--rel`, which the record takes verbatim) and the
 * ids around it, the agent that adopted an exported pattern, and — the sharpest of them —
 * the fields `show` prints as FACTS under a subject, where an observation's `about` is
 * the value `observe` does not validate.
 *
 * WHAT IS DELIBERATELY NOT ONE LINE is one thing and it is written down twice, here and
 * in `record.ts`: the BODY of a record. `show` exists to serve it whole, and every one of
 * the five is reconciled by {@link SERVED_WHOLE} so a sixth cannot join them in silence.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';
import { sourceFiles } from './support/reading-source.js';

/** `packages/code/src/presentation` — the layer that words what a reading says. */
const LAYER = fileURLToPath(new URL('../src/presentation', import.meta.url));

/** A newline, built rather than typed, so no literal in this file spans two lines. */
const LF = String.fromCharCode(10);
/** The collapse — `one-line.ts`, and the one door this layer has. */
const DOOR = 'oneLine';

// ---------------------------------------------------------------------------
// Which modules are asked, and which are the machinery
// ---------------------------------------------------------------------------

/**
 * The source with comments blanked and every offset kept, so a `fact(` inside a
 * paragraph of prose is not a call and a `//` never eats a line of code.
 *
 * Strings keep their content — a builder's argument may BE a string literal, and the
 * scan has to see that it is one — and templates are left whole, because their text is
 * what {@link readTemplate} reads a shape out of.
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

/**
 * A module of this layer that RECEIVES the record — which is every module that imports
 * anything from outside `presentation/`.
 *
 * It is the discriminant for what gets asked at all, and it is derived rather than
 * listed for the reason this whole file exists. The eleven that import nothing but each
 * other are the primitives and the renderers: they shape what a caller hands them and
 * decide nothing about where it came from, so the question belongs to their callers.
 * The day one of them reaches for `@mnema/copilot` it joins the thirteen, its values
 * become sites, and the classification below stops being total.
 *
 * IT WAS *ANY IMPORT THAT IS NOT `./`* AND THAT IS NOT WHAT IT MEANS. The record arrives from a
 * PACKAGE of this workspace or from a layer above this one; a dependency off the registry brings
 * no record at all, and the first module here to take one — the authority over how many columns
 * text takes, which loads the measurement the layout library draws by — was classified as a
 * composer with nothing to classify. So the predicate names the two ways a record can arrive
 * instead of naming everything that is not local.
 */
function receivesTheRecord(source: string): boolean {
  return /from '(?:@mnema\/|\.\.\/)/.test(withoutComments(source));
}

// ---------------------------------------------------------------------------
// The sites, read off the source
// ---------------------------------------------------------------------------

/** One value that reaches the text of a line. */
interface Site {
  /** The file, relative to `src/presentation`. */
  readonly file: string;
  /** The expression, as it is written — whitespace collapsed so a wrap cannot move it. */
  readonly expression: string;
  /** `<file> «<shape>» <expression> #<n>`, or `<file> <builder>(<expression>) #<n>`. */
  readonly key: string;
}

/**
 * Every value this layer puts on a line, in the two forms it can be written in.
 *
 * A TEMPLATE'S INTERPOLATION — `` `topic: ${x}` `` — is one site per `${…}`, keyed by
 * the shape of the template it is in and by the expression itself. A nested template
 * inside an interpolation is part of ITS value rather than a site of its own, exactly as
 * the sibling has it: `${a ? ` — ${b}` : ''}` is one value, and asking a verdict about
 * half of it would be asking about half a decision.
 *
 * A BUILDER'S ARGUMENT — `itemLine([asId(x), oneLine(y)])`, `fact(z)` — is the other,
 * and it is the form no tag could ever have covered: the columns of a list are an
 * ARRAY, not a sentence. The builders are the functions of this layer that return a
 * `Line`, a `Column` or a `Part`, read off the source rather than listed, so one added
 * next year is scanned without anybody remembering to add it here. An argument that is
 * a literal is not a value from anywhere; one that is itself a builder call is not a
 * value yet; one that is a template is already covered by the form above.
 */
function sitesInSource(): {
  sites: Site[];
  composers: string[];
  machinery: string[];
  builders: string[];
} {
  const files = sourceFiles(LAYER);
  const builders: string[] = [];
  for (const file of files) {
    const text = withoutComments(readFileSync(file, 'utf-8'));
    for (const found of text.matchAll(
      /export function ([A-Za-z0-9_$]+)\([\s\S]*?\): (?:Line|Column|Part) \{/g,
    )) {
      builders.push(found[1] as string);
    }
  }
  const sites: Site[] = [];
  const composers: string[] = [];
  const machinery: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf-8');
    const path = relative(LAYER, file);
    if (!receivesTheRecord(source)) {
      machinery.push(path);
      continue;
    }
    composers.push(path);
    const seen = new Map<string, number>();
    const add = (expression: string, said: string): void => {
      const nth = (seen.get(said) ?? 0) + 1;
      seen.set(said, nth);
      sites.push({ file: path, expression, key: `${path} ${said} #${nth}` });
    };
    for (const template of templatesIn(source)) {
      for (const value of template.values) add(value, `«${template.shape}» ${value}`);
    }
    for (const argument of builderArguments(withoutComments(source), builders)) {
      add(argument.expression, `${argument.builder}(${argument.expression})`);
    }
  }
  return { sites, composers, machinery, builders };
}

/** Every template literal in a file, at the top level of the source. */
function templatesIn(text: string): { shape: string; values: string[] }[] {
  const found: { shape: string; values: string[] }[] = [];
  let i = 0;
  while (i < text.length) {
    const char = text[i] as string;
    if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== LF) i += 1;
    } else if (char === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
    } else if (char === "'" || char === '"') {
      i = pastQuoted(text, i);
    } else if (char === '`') {
      const template = readTemplate(text, i);
      if (template.values.length > 0) found.push(template);
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
 * One template: what it SAYS with `{}` where each value goes, and the values as they
 * are written. The shape is the key rather than a line number, because a line number
 * moves whenever anything above it does and a shape is what a reader recognizes.
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

/**
 * Every argument a builder is handed in this file, with the array a list's columns
 * arrive in flattened — an item's fields are its columns, not one value.
 */
function builderArguments(
  text: string,
  builders: readonly string[],
): { builder: string; expression: string }[] {
  const found: { builder: string; expression: string }[] = [];
  const calls = new RegExp(`\\b(${builders.join('|')})\\s*\\(`, 'g');
  const isBuilderCall = new RegExp(`^(${builders.join('|')})\\s*\\(`);
  for (const call of text.matchAll(calls)) {
    const at = call.index ?? 0;
    // The DECLARATION of a builder is not a call of one, and its parameter list would
    // otherwise read as a value with a type annotation on it.
    if (/\bfunction\s+$/.test(text.slice(0, at))) continue;
    const open = at + (call[0] as string).length - 1;
    let list = argumentsOf(text, open);
    const only = list[0];
    if (list.length === 1 && only !== undefined && only.trim().startsWith('[')) {
      list = argumentsOf(text, text.indexOf('[', open));
    }
    for (const argument of list) {
      const expression = oneExpression(argument);
      if (expression.length === 0) continue;
      // A literal came from nowhere; a builder call is not a value yet; a template is
      // already a site, once per value in it.
      if (/^(['"][\s\S]*['"]|-?\d+(\.\d+)?|true|false|undefined)$/.test(expression)) continue;
      if (expression.startsWith('`') || isBuilderCall.test(expression)) continue;
      found.push({ builder: call[1] as string, expression });
    }
  }
  return found;
}

/** The top-level arguments of the call whose `(` — or list whose `[` — is at `open`. */
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

const FOUND = sitesInSource();

// ---------------------------------------------------------------------------
// What each value IS
// ---------------------------------------------------------------------------

/**
 * Where one value on a line came from — the answer to the one question this family asks.
 *
 *   - `collapsed` — it arrived through the argv, came back out of the record, or was
 *     built out of this machine's environment, so it goes through `oneLine` HERE. The
 *     table does not decide this: the expression really does hold the call, and a value
 *     that stops going through it goes red.
 *   - `minted` — it is the product's own: a uuid, an alias, an `ADR-<n>`, an anchor, a
 *     content hash, an ISO-8601 instant, a count, one of the three trees, a word of a
 *     closed transition table, or a constant written in the module that prints it. None
 *     can hold a newline, and it must NOT be collapsed, so a value that quietly stops
 *     being the product's own cannot keep this verdict.
 *   - `composed` — it is not text from anywhere yet: another function of this layer words
 *     it, and every value THAT function puts in it is a site of its own. The reason names
 *     which function, so the chain can be followed rather than trusted.
 */
type Verdict = 'collapsed' | 'minted' | 'composed';

/**
 * Every value this layer puts on a line, and where it comes from.
 *
 * The KEYS are reconciled against the source in both directions and the VERDICTS are
 * checked against it; the REASONS cannot be — no walk derives "an anchor is `mnid:` and
 * 64 hex" from an expression. So the table carries what a reader knows, and the part
 * that rots — which values exist, and whether each is collapsed — is derived.
 */
const CLASSIFIED: Readonly<Record<string, { verdict: Verdict; why: string }>> = {
  // --- brief.ts: the document an agent reads on its own --------------------------
  'brief.ts «{} of the rules below {} an ADDRESS: a path in this» addressed #1': {
    verdict: 'minted',
    why: 'how many of the printed rules have an address — a count this document made, and the one number here that is not a list’s length',
  },
  "brief.ts «{} of the rules below {} an ADDRESS: a path in this» addressed === 1 ? 'has' : 'have' #1":
    {
      verdict: 'minted',
      why: 'one of two words written in this module, chosen by the count beside it — nothing from the record reaches it',
    },
  'brief.ts «{} of them {} for a PERSON at an address: where one» asking #1': {
    verdict: 'minted',
    why: 'how many of the printed rules can STOP a write — a count this document made',
  },
  "brief.ts «{} of them {} for a PERSON at an address: where one» asking === 1 ? 'asks' : 'ask' #1":
    {
      verdict: 'minted',
      why: 'one of two words written in this module, chosen by the count beside it — nothing from the record reaches it',
    },
  'brief.ts «{} was switched off by {} at» oneLine(gate.channel) #1': {
    verdict: 'collapsed',
    why: 'the channel a switch names — a subject somebody’s command line sent, in the middle of the paragraph about the gate',
  },
  "brief.ts «{} was switched off by {} at» oneLine(gate.by ?? '') #1": {
    verdict: 'collapsed',
    why: 'the anchor that switched the gate off — out of the record, and not on a bullet, so a break here forges a claim about the gate',
  },
  "brief.ts «{}. Run \\`mnema switch\\` for where every switch stands.» oneLine(gate.at ?? '') #1":
    {
      verdict: 'collapsed',
      why: 'when the gate was switched off — an instant out of the record, collapsed for the same reason the anchor is',
    },
  'brief.ts «{} — {}» decision.adr #1': {
    verdict: 'composed',
    why: 'the `ADR-<n>` half of a rule’s name — the whole name is collapsed by `rule` below',
  },
  'brief.ts «{} — {}» decision.title #1': {
    verdict: 'composed',
    why: 'the title an actor wrote, on the sharpest line there is — `rule` collapses the composed name',
  },
  'brief.ts «## {} ({})» heading #1': {
    verdict: 'minted',
    why: 'one of this document’s own two headings, handed in by the call above it',
  },
  'brief.ts «## {} ({})» printed #1': {
    verdict: 'minted',
    why: 'how many rules are printed under the heading — a count this document made',
  },
  'brief.ts «- **{}** · \\`{}\\`» oneLine(name) #1': {
    verdict: 'collapsed',
    why: 'the rule’s name: a title an actor wrote, or a pattern’s name',
  },
  'brief.ts «- **{}** · \\`{}\\`» oneLine(id) #1': {
    verdict: 'collapsed',
    why: 'the record id — minted, and collapsed anyway because the rule is the line’s',
  },
  'brief.ts «\\`{}\\`» oneLine(id) #1': {
    verdict: 'collapsed',
    why: 'one id sharing a label, inside the warning about the collision',
  },
  'brief.ts «- \\`{}\\` — {}» oneLine(collision.adr) #1': {
    verdict: 'collapsed',
    why: 'the label two rules answer to — an `ADR-<n>`, collapsed for the rule’s sake',
  },
  'brief.ts «- \\`{}\\` — {}» ids #1': {
    verdict: 'composed',
    why: 'the ids that share it, each one already collapsed in the template above',
  },

  // --- exported.ts: the file a pattern leaves in ---------------------------------
  'exported.ts «Exported skill "{}" to {}» done.name #1': {
    verdict: 'minted',
    why: 'it passed `specName` before the file was written: `a-z`, `0-9` and hyphens only',
  },
  'exported.ts «Exported skill "{}" to {}» oneLine(done.path) #1': {
    verdict: 'collapsed',
    why: 'the path the file went to, built under the directory `--out` named',
  },
  'exported.ts «description: {}» DESCRIPTION_SAID[done.descriptionFrom] #1': {
    verdict: 'minted',
    why: 'one of this module’s own two sentences, keyed by a closed union',
  },
  'exported.ts «provenance in the file: record {}, adopted by {} — » done.id #1': {
    verdict: 'minted',
    why: 'the record id the export was asked for',
  },
  'exported.ts «provenance in the file: record {}, adopted by {} — » oneLine(done.adoptedBy) #1': {
    verdict: 'collapsed',
    why: 'the agent that adopted the pattern — a name somebody typed',
  },

  // --- exposure.ts: what a scan for credentials found ----------------------------
  'exposure.ts «Nothing recognizable in {} record(s).» report.scanned #1': {
    verdict: 'minted',
    why: 'how many records were read — a count',
  },
  'exposure.ts «{} of {} record(s) hold a credential format:» report.findings.length #1': {
    verdict: 'minted',
    why: 'how many findings there are — a count',
  },
  'exposure.ts «{} of {} record(s) hold a credential format:» report.scanned #1': {
    verdict: 'minted',
    why: 'how many records were read — the same count',
  },

  // --- occurrence.ts: one event of the chain -------------------------------------
  'occurrence.ts «{} {}» BY #1': {
    verdict: 'minted',
    why: 'this module’s own word, written above as a constant',
  },
  'occurrence.ts «{} {}» oneLine(event.which ?? A_PERSON) #1': {
    verdict: 'collapsed',
    why: 'the agent on the envelope — text whoever opened the session wrote',
  },

  // --- provenance.ts: where a pattern came from ----------------------------------
  'provenance.ts «{} pattern(s):» patterns.length #1': {
    verdict: 'minted',
    why: 'how many patterns follow — the count the lines under it are counted by',
  },
  'provenance.ts «proposed by {}» oneLine(pattern.proposedBy ?? A_PERSON) #1': {
    verdict: 'collapsed',
    why: 'the agent that proposed it, or this surface’s word for a person',
  },
  'provenance.ts «adopted by {}» oneLine(pattern.adoption.by ?? A_PERSON) #1': {
    verdict: 'collapsed',
    why: 'the agent that adopted it, or this surface’s word for a person',
  },

  // --- record.ts: one whole record -----------------------------------------------
  'record.ts «{} {}» body.kind #1': {
    verdict: 'minted',
    why: 'which of the five kinds this record is — a closed word',
  },
  'record.ts «{} {}» body.id #1': {
    verdict: 'minted',
    why: 'the id the read was asked for and a record answered to',
  },
  'record.ts «captured {} by {}» body.record.capturedAt #1': {
    verdict: 'minted',
    why: 'an ISO-8601 instant off the record',
  },
  'record.ts «captured {} by {}» anchorText(context.anchors, body.record.who) #1': {
    verdict: 'minted',
    why: 'an anchor, written the way the record knows that identity',
  },
  'record.ts «about {} · recorded {}» oneLine(body.record.about) #1': {
    verdict: 'collapsed',
    why: 'what the observation is about — the positional `observe` does not validate',
  },
  'record.ts «about {} · recorded {}» body.record.recordedAt #1': {
    verdict: 'minted',
    why: 'an ISO-8601 instant off the record',
  },
  'record.ts «topic: {}» oneLine(body.record.topic) #1': {
    verdict: 'collapsed',
    why: 'the topic `--topic` named — free text, on a fact line of its own',
  },
  'record.ts «{} — {}» body.record.adr #1': {
    verdict: 'minted',
    why: 'the `ADR-<n>` the decision was minted with',
  },
  'record.ts «{} — {}» oneLine(body.record.title) #1': {
    verdict: 'collapsed',
    why: 'the decision’s title — text whoever recorded it wrote',
  },
  'record.ts «supersedes {}» oneLine(body.record.supersedes) #1': {
    verdict: 'collapsed',
    why: 'the id the decision names as superseded, as recorded rather than as checked',
  },
  'record.ts «superseded by {}» oneLine(body.record.supersededBy) #1': {
    verdict: 'collapsed',
    why: 'the id that superseded it, on the same terms',
  },
  'record.ts «created {} · updated {}» body.record.createdAt #1': {
    verdict: 'minted',
    why: 'an ISO-8601 instant off the record',
  },
  'record.ts «created {} · updated {}» body.record.updatedAt #1': {
    verdict: 'minted',
    why: 'an ISO-8601 instant off the record',
  },

  // --- references.ts: what an entity is connected to -----------------------------
  'references.ts « ({})» node.kind #1': {
    verdict: 'minted',
    why: 'a `SearchKind` the walk resolved the far end to',
  },
  'references.ts «{}{}» oneLine(id) #1': {
    verdict: 'collapsed',
    why: 'the entity id on an edge’s row, read back out of the record',
  },
  'references.ts «{}{}» said #1': {
    verdict: 'composed',
    why: 'the parenthesis after the id — a word of the walk’s vocabulary, carrying its own leading space',
  },
  'references.ts «{} ({})» heading #1': {
    verdict: 'minted',
    why: 'one of this report’s three group headings',
  },
  'references.ts «{} ({})» items.length #1': {
    verdict: 'minted',
    why: 'how many rows are under the heading — the count they are counted by',
  },
  'references.ts «{}:{}» link.role #1': {
    verdict: 'minted',
    why: 'one of `about`, `target`, `by` — which field carries the edge',
  },
  'references.ts «{}:{}» oneLine(link.rel) #1': {
    verdict: 'collapsed',
    why: 'the relation label — an OPEN string `mnema link --rel` records verbatim',
  },
  'references.ts «[{}]» link.scope #1': {
    verdict: 'minted',
    why: 'the tree the assertion lives in — one of three words',
  },
  'references.ts «→ {}» rel #1': {
    verdict: 'composed',
    why: 'the role and the relation, composed above with the relation collapsed',
  },
  'references.ts «← {}» rel #1': {
    verdict: 'composed',
    why: 'the same pair, on the row of an edge that points inward',
  },
  'references.ts «{} → {} → {}» label(link.from) #1': {
    verdict: 'composed',
    why: 'the near end’s id and what it resolved to — `label` collapses the id at its one exit',
  },
  'references.ts «{} → {} → {}» rel #1': {
    verdict: 'composed',
    why: 'the same role and relation, on the row of an edge that touches neither end',
  },
  'references.ts «{} → {} → {}» label(link.to) #1': {
    verdict: 'composed',
    why: 'the far end’s id and what it resolved to, worded by the same `label`',
  },
  'references.ts «{} hop(s)» node.depth #1': {
    verdict: 'minted',
    why: 'how far the walk reached to get there — a count',
  },
  'references.ts «cut at {} hop(s) — more lies beyond. Raise --depth to see it.» graph.depth #1': {
    verdict: 'minted',
    why: 'the depth cap the walk applied, after clamping — a count',
  },

  // --- rules.ts: which recorded rules govern a path -------------------------------
  'rules.ts subjectLine(oneLine(governed.relative ?? governed.path)) #1': {
    verdict: 'collapsed',
    why: 'the path the caller asked about, or the one the record’s own root-relative form made of it',
  },
  "rules.ts subjectLine(governed.relative === undefined ? 'outside this project' : 'in this project') #1":
    {
      verdict: 'minted',
      why: 'one of two phrases this report writes, saying whether the path is addressable here',
    },
  'rules.ts «{} govern this path · {} address this project · » counts.matching #1': {
    verdict: 'minted',
    why: 'how many addresses cover the path — a count',
  },
  'rules.ts «{} govern this path · {} address this project · » counts.governing #1': {
    verdict: 'minted',
    why: 'how many addresses the project’s record holds at all — a count',
  },
  'rules.ts «{} address nothing here» counts.stale #1': {
    verdict: 'minted',
    why: 'how many addresses name nothing in the working tree — a count',
  },
  'rules.ts «{} ask for a person here · {} ask in » counts.asks.matching #1': {
    verdict: 'minted',
    why: 'how many gate addresses cover the path — a count',
  },
  'rules.ts «{} ask for a person here · {} ask in » counts.asks.addressed #1': {
    verdict: 'minted',
    why: 'how many gate addresses the project’s record holds at all — a count',
  },
  'rules.ts «this project · {} ask about nothing here» counts.asks.stale #1': {
    verdict: 'minted',
    why: 'how many gate addresses name nothing in the working tree — a count, and the one that says a gate stopped closing in silence',
  },
  'rules.ts «{} ({})» heading #1': {
    verdict: 'minted',
    why: 'one of this report’s two group headings',
  },
  'rules.ts «{} ({})» rules.length #1': {
    verdict: 'minted',
    why: 'how many rows are under the heading — the count they are counted by',
  },
  'rules.ts itemLine(oneLine(rule.address ?? rule.recorded)) #1': {
    verdict: 'collapsed',
    why: 'the address `mnema link --rel governs` recorded — a caller’s string the core never validates',
  },
  'rules.ts itemLine(said) #1': {
    verdict: 'composed',
    why: 'the rule’s title, collapsed where it enters, or a word of this report’s own vocabulary',
  },
  'rules.ts «({})» rule.kind #1': {
    verdict: 'minted',
    why: 'a `SearchKind` the read resolved the rule to — one of five words',
  },
  'rules.ts itemLine(...(rule.state === undefined ? [] : [asState(oneLine(rule.state))])) #1': {
    verdict: 'collapsed',
    why: 'the column carrying the rule’s state, present only when its kind has one',
  },
  'rules.ts asState(oneLine(rule.state)) #1': {
    verdict: 'collapsed',
    why: 'the rule’s workflow state, read back out of the record',
  },
  'rules.ts asId(oneLine(rule.rule)) #1': {
    verdict: 'collapsed',
    why: 'the rule’s id — a link’s subject, which the core forwards without verifying it exists',
  },
  'rules.ts «[{}]» rule.assertedIn #1': {
    verdict: 'minted',
    why: 'the tree whose record asserts the address — one of three words',
  },

  // --- runs.ts: a run, for all three readings ------------------------------------
  'runs.ts «last run {} ({})» run.id #1': {
    verdict: 'minted',
    why: 'the uuid the run was born with',
  },
  "runs.ts «last run {} ({})» run.open ? 'open' : 'ended' #1": {
    verdict: 'minted',
    why: 'one of this module’s own two words for where a run stands',
  },
  'runs.ts « — {}» oneLine(run.goal) #1': {
    verdict: 'collapsed',
    why: 'the run’s goal — text whoever opened the session typed, and BOTH readings print it',
  },
  'runs.ts «{} run(s) still open» resume.focus.openRuns.length #1': {
    verdict: 'minted',
    why: 'how many runs are still open — a count',
  },
  "runs.ts «starts in {} (this machine's clock is behind the writer's)» humanDuration(-run.ageSeconds) #1":
    {
      verdict: 'composed',
      why: 'a duration this module words out of a number of seconds',
    },
  'runs.ts «open {}» humanDuration(run.ageSeconds) #1': {
    verdict: 'composed',
    why: 'the same duration, on the ordinary branch',
  },
  'runs.ts «last recorded {} ago» humanDuration(run.idleSeconds) #1': {
    verdict: 'composed',
    why: 'how long since the run recorded anything, worded the same way',
  },
  'runs.ts « · {} · {}» age #1': {
    verdict: 'composed',
    why: 'the age clause composed above — a duration or one of this module’s sentences',
  },
  'runs.ts « · {} · {}» idle #1': {
    verdict: 'composed',
    why: 'the idle clause composed above, on the same terms',
  },
  'runs.ts «{}{}» count #1': {
    verdict: 'minted',
    why: 'how many of a unit the duration holds — a number',
  },
  'runs.ts «{}{}» suffix #1': {
    verdict: 'minted',
    why: 'one of the four unit letters written above as a constant',
  },

  // --- search.ts: the index ------------------------------------------------------
  'search.ts « matching "{}"» oneLine(term) #1': {
    verdict: 'collapsed',
    why: 'the term the caller typed — the one value here that never came out of the record',
  },
  'search.ts «Nothing recorded{}.» forTerm #1': {
    verdict: 'composed',
    why: 'the matching clause composed above, with the term collapsed inside it',
  },
  'search.ts «{} of {}» result.hits.length #1': {
    verdict: 'minted',
    why: 'how many hits were served — a count',
  },
  'search.ts «{} of {}» result.total #1': {
    verdict: 'minted',
    why: 'how many there are — a count',
  },
  'search.ts «{}» result.total #1': {
    verdict: 'minted',
    why: 'the same count, on the branch where nothing was cut',
  },
  'search.ts «{} record(s){}:» shown #1': {
    verdict: 'composed',
    why: 'the `n of m` composed above out of two counts',
  },
  'search.ts «{} record(s){}:» forTerm #1': {
    verdict: 'composed',
    why: 'the same matching clause, on the header that counts the rows under it',
  },
  'search.ts «{} ({})» kind #1': {
    verdict: 'minted',
    why: 'one of `SEARCH_KINDS` — the group this run of rows is under',
  },
  'search.ts «{} ({})» group.length #1': {
    verdict: 'minted',
    why: 'how many rows are in the group — the count they are counted by',
  },

  // --- state.ts: a record's position ---------------------------------------------
  'state.ts «({})» state #1': {
    verdict: 'minted',
    why: 'a position in one of the three machines — a word of a closed transition table',
  },

  // --- status.ts: where things stand ---------------------------------------------
  'status.ts «{} — where things stand.» actor #1': {
    verdict: 'minted',
    why: 'an anchor: the reading resolved the actor to one before this line',
  },
  'status.ts «{} live task(s):» served(status.work.length, status.workTotal) #1': {
    verdict: 'composed',
    why: 'the `n of m` composed below out of two counts',
  },
  'status.ts «{} decision(s) in force:» served(status.decisions.length, status.decisionsTotal) #1':
    {
      verdict: 'composed',
      why: 'the same pair of counts, for the decisions',
    },
  'status.ts «{} adopted pattern(s):» status.skills.length #1': {
    verdict: 'minted',
    why: 'how many patterns are adopted — the one list nothing cuts',
  },
  'status.ts «{} awaiting a judgement:» served(status.awaitingJudgement.length, status.awaitingJudgementTotal) #1':
    {
      verdict: 'composed',
      why: 'the same pair of counts, for the mixed list',
    },
  'status.ts «{} · {}» item.adr #1': {
    verdict: 'composed',
    why: 'the label half of a waiting decision’s name — collapsed whole at the call site',
  },
  'status.ts «{} · {}» item.title #1': {
    verdict: 'composed',
    why: 'the title half, text an actor wrote — collapsed whole at the call site below',
  },
  'status.ts «{} of {}» shown #1': { verdict: 'minted', why: 'how many a list shows — a count' },
  'status.ts «{} of {}» total #1': { verdict: 'minted', why: 'how many there are — a count' },
  'status.ts «{}» total #1': {
    verdict: 'minted',
    why: 'the same count, on the branch where nothing was cut',
  },

  // --- tails.ts: the tails on disk -----------------------------------------------
  "tails.ts «No tail holds events in any tree here — looked in {}.» trees.join(', ') #1": {
    verdict: 'minted',
    why: 'the trees that were looked in — closed words, joined by this report',
  },
  'tails.ts «{} tail(s):» tails.length #1': {
    verdict: 'minted',
    why: 'how many tails follow — the count the rows are counted by',
  },
  'tails.ts «{} event(s) through {}» held.standing.eventCount #1': {
    verdict: 'minted',
    why: 'how many events the tail holds — a count',
  },
  'tails.ts «{} event(s) through {}» held.standing.throughHash #1': {
    verdict: 'minted',
    why: 'the content hash the tail runs through',
  },
  'tails.ts «the tail of {}» held.standing.who #1': {
    verdict: 'minted',
    why: 'the anchor the tail belongs to',
  },

  // --- witness.ts: where the external witness stands ------------------------------
  "witness.ts «No tail holds events in any tree here — looked in {}.» trees.join(', ') #1": {
    verdict: 'minted',
    why: 'the trees that were looked in — closed words, joined by this report',
  },
  'witness.ts «{} tail(s):» lines.length #1': {
    verdict: 'minted',
    why: 'how many tails follow — the count the rows are counted by',
  },
  'witness.ts «checkpoint {}» line.checkpoint #1': {
    verdict: 'minted',
    why: 'the digest an attestation is filed under — sixty-four hex characters this package computed',
  },

  // --- switches.ts: where the product's own switches stand ------------------------
  'switches.ts «{} channel(s), looked in {}:» rows.length #1': {
    verdict: 'minted',
    why: 'how many channels follow — the count the rows are counted by',
  },
  "switches.ts «{} channel(s), looked in {}:» trees.join(', ') #1": {
    verdict: 'minted',
    why: 'the trees that were looked in — closed words, joined by this report',
  },
  "switches.ts «switched off by {}» oneLine(anchorText(anchors, row.state.by ?? '')) #1": {
    verdict: 'collapsed',
    why: 'the anchor that switched it, in the short form the record knows — not forgeable today (it is derived from a key), closed as a rule because it is read back out of the record',
  },
  "switches.ts asWhen(row.state.at ?? '') #1": {
    verdict: 'minted',
    why: 'when the switch was made — an instant off the record',
  },
  'switches.ts «— {}» oneLine(row.state.reason) #1': {
    verdict: 'collapsed',
    why: 'why somebody switched it off — free text they typed at `--reason`, on a line the header counts',
  },

  // --- brief.ts: the document, and the switch that explains its silence -----------
  'brief.ts «to be changed: {} was switched off by {}» oneLine(push.channel) #1': {
    verdict: 'collapsed',
    why: 'the channel as the RECORD spells it — a switch’s subject is a caller’s string, so what the document reads back is not the closed set the verb refuses against',
  },
  "brief.ts «to be changed: {} was switched off by {}» oneLine(push.by ?? '') #1": {
    verdict: 'collapsed',
    why: 'the anchor that switched it, closed as a rule for the reason the listing’s is',
  },
  "brief.ts «at {}. Run \\`mnema switch\\` for where every switch stands.» oneLine(push.at ?? '') #1":
    {
      verdict: 'collapsed',
      why: 'the instant, closed as a rule: this is the file whose headings count the lines under them, and a break here forges one',
    },

  // --- usage.ts: what the host's transcripts cost --------------------------------
  "usage.ts «No run is recorded here — looked in {}.» listing.trees.join(', ') #1": {
    verdict: 'minted',
    why: 'the trees that were looked in — closed words, joined by this report',
  },
  'usage.ts «{} run(s):» listing.runs.length #1': {
    verdict: 'minted',
    why: 'how many runs follow — the count the rows are counted by',
  },
  'usage.ts «Read from {} — {} host session(s) there record work in this project.» oneLine(listing.store) #1':
    {
      verdict: 'collapsed',
      why: 'the host’s store — a PATH, built from this machine’s home and an environment',
    },
  'usage.ts «Read from {} — {} host session(s) there record work in this project.» listing.sessionsInStore #1':
    {
      verdict: 'minted',
      why: 'how many host sessions are in the store — a count',
    },
  'usage.ts «{} → {}» spend.startedAt #1': {
    verdict: 'minted',
    why: 'when the run opened — an instant off the record',
  },
  'usage.ts «{} → {}» spend.endedAt ?? STILL_OPEN #1': {
    verdict: 'minted',
    why: 'when it closed, or this module’s own word for a run still open',
  },
  'usage.ts «{} · {} host sessions overlap this run: {}» AMBIGUOUS #1': {
    verdict: 'minted',
    why: 'this module’s own word for what it could not attribute',
  },
  'usage.ts «{} · {} host sessions overlap this run: {}» spend.sessions.length #1': {
    verdict: 'minted',
    why: 'how many host sessions overlap — a count',
  },
  "usage.ts «{} · {} host sessions overlap this run: {}» spend.sessions.map(oneLine).join(', ') #1":
    {
      verdict: 'collapsed',
      why: 'the host session ids, each collapsed — they are the host’s values, not the record’s',
    },
  'usage.ts «in {} · out {} · cache-read {} · cache-write {} tokens» input #1': {
    verdict: 'minted',
    why: 'a token count read off the transcript',
  },
  'usage.ts «in {} · out {} · cache-read {} · cache-write {} tokens» output #1': {
    verdict: 'minted',
    why: 'a token count read off the transcript',
  },
  'usage.ts «in {} · out {} · cache-read {} · cache-write {} tokens» cacheRead #1': {
    verdict: 'minted',
    why: 'a token count read off the transcript',
  },
  'usage.ts «in {} · out {} · cache-read {} · cache-write {} tokens» cacheCreation #1': {
    verdict: 'minted',
    why: 'a token count read off the transcript',
  },
  'usage.ts «{} message(s)» messages #1': {
    verdict: 'minted',
    why: 'how many messages the run held — a count',
  },
  "usage.ts «session {}» oneLine(spend.sessions[0] ?? '') #1": {
    verdict: 'collapsed',
    why: 'the host session id this row was attributed to — the host’s value, not the record’s',
  },
  'usage.ts «{} line(s) passed over» passedOver #1': {
    verdict: 'minted',
    why: 'how many transcript lines the reading did not understand — a count',
  },

  // --- exported.ts: the file a pattern leaves in ---------------------------------
  'exported.ts aside(NOTHING_RECORDED) #1': {
    verdict: 'minted',
    why: 'this module’s own sentence about what the export did not write',
  },

  // --- exposure.ts: what a scan for credentials found ----------------------------
  'exposure.ts itemLine(finding.kind) #1': {
    verdict: 'minted',
    why: 'a `SearchKind` — one closed word of the record’s own vocabulary',
  },
  "exposure.ts itemLine(finding.classes.join(', ')) #1": {
    verdict: 'minted',
    why: 'the names of the credential formats recognized — this scanner’s own vocabulary',
  },
  'exposure.ts asScope(finding.scope) #1': {
    verdict: 'minted',
    why: 'one of the three trees, and nothing else can be there',
  },
  'exposure.ts asWhen(finding.at.slice(0, DATE_LENGTH)) #1': {
    verdict: 'minted',
    why: 'the first ten characters of an ISO-8601 instant',
  },
  'exposure.ts asId(finding.id) #1': {
    verdict: 'minted',
    why: 'the id of the record the format was found in',
  },

  // --- occurrence.ts: one event of the chain -------------------------------------
  'occurrence.ts itemLine(oneLine(event.kind)) #1': {
    verdict: 'collapsed',
    why: 'the event kind: closed today, and collapsed because the rule is the line’s',
  },
  'occurrence.ts asWhen(oneLine(event.at)) #1': {
    verdict: 'collapsed',
    why: 'the instant the event carries, as the chain recorded it',
  },
  'occurrence.ts asId(oneLine(event.subject)) #1': {
    verdict: 'collapsed',
    why: 'the id the event is about, read back out of the chain',
  },

  // --- provenance.ts: where a pattern came from ----------------------------------
  'provenance.ts itemLine(column(pattern.state, STATE_WIDTH)) #1': {
    verdict: 'minted',
    why: 'a pattern’s position — a word of its transition table, padded to a column',
  },
  'provenance.ts itemLine(oneLine(pattern.name)) #1': {
    verdict: 'collapsed',
    why: 'the pattern’s name — text an actor wrote, and the subject of the row',
  },
  "provenance.ts itemLine(acts.join(' · ')) #1": {
    verdict: 'composed',
    why: 'the two acts composed above, each with its agent collapsed, and a count of consultations',
  },
  'provenance.ts asId(pattern.id) #1': { verdict: 'minted', why: 'the pattern’s record id' },
  'provenance.ts asScope(column(pattern.scope, SCOPE_WIDTH)) #1': {
    verdict: 'minted',
    why: 'one of the three trees, padded to a column',
  },

  // --- record.ts: one whole record -----------------------------------------------
  'record.ts subjectLine(body.scope) #1': {
    verdict: 'minted',
    why: 'the tree this record lives in — one of three words',
  },
  'record.ts asState(body.record.state) #1': {
    verdict: 'minted',
    why: 'a decision’s position — a word of its machine’s transition table',
  },
  'record.ts statedFact(oneLine(body.record.title)) #1': {
    verdict: 'collapsed',
    why: 'a task’s title — text whoever created it wrote',
  },
  'record.ts asState(body.record.state) #2': {
    verdict: 'minted',
    why: 'a task’s position — a word of its machine’s transition table',
  },
  'record.ts statedFact(oneLine(body.record.name)) #1': {
    verdict: 'collapsed',
    why: 'a pattern’s name — text whoever proposed it wrote',
  },
  'record.ts asState(body.record.state) #3': {
    verdict: 'minted',
    why: 'a pattern’s position — a word of its machine’s transition table',
  },
  'record.ts fact(consultedLine(context.consultations ?? 0)) #1': {
    verdict: 'composed',
    why: 'a sentence `consultation.ts` words out of a count, and a count holds nothing',
  },

  // --- references.ts: what an entity is connected to -----------------------------
  'references.ts subjectLine(oneLine(graph.id)) #1': {
    verdict: 'collapsed',
    why: 'the id `refs` was asked for, which this verb deliberately does not validate',
  },
  'references.ts subjectLine(known) #1': {
    verdict: 'minted',
    why: 'what the origin resolved to — a `SearchKind`, or the word `unresolved`',
  },
  'references.ts itemLine(label(link.to)) #1': {
    verdict: 'composed',
    why: 'the far end of an outgoing edge, worded by `label` with the id collapsed',
  },
  'references.ts itemLine(tree) #1': {
    verdict: 'composed',
    why: 'the bracketed tree, composed above out of one of three words',
  },
  'references.ts itemLine(label(link.from)) #1': {
    verdict: 'composed',
    why: 'the near end of an incoming edge, worded by the same `label`',
  },
  'references.ts itemLine(tree) #2': {
    verdict: 'composed',
    why: 'the same bracketed tree, on an incoming edge’s row',
  },
  'references.ts itemLine(tree) #3': {
    verdict: 'composed',
    why: 'the same bracketed tree, on a row for an edge that touches neither end',
  },
  'references.ts itemLine(label(node.id)) #1': {
    verdict: 'composed',
    why: 'an entity reached by distance, worded by the same `label`',
  },

  // --- search.ts: the index ------------------------------------------------------
  'search.ts itemLine(oneLine(hit.title)) #1': {
    verdict: 'collapsed',
    why: 'the record’s title — text an actor wrote, and the subject of the row',
  },
  'search.ts itemLine(...(state !== undefined ? [asState(state)] : [])) #1': {
    verdict: 'composed',
    why: 'the state column when the hit has one, built by `asState` out of a closed word',
  },
  'search.ts asId(hit.id) #1': {
    verdict: 'minted',
    why: 'the record’s id, whole, because it is what the next command takes',
  },
  'search.ts asScope(hit.scope) #1': { verdict: 'minted', why: 'one of the three trees' },
  'search.ts asWhen(hit.at.slice(0, DATE_LENGTH)) #1': {
    verdict: 'minted',
    why: 'the first ten characters of an ISO-8601 instant',
  },
  'search.ts asState(state) #1': {
    verdict: 'minted',
    why: 'the hit’s position — a word of its machine’s transition table',
  },

  // --- status.ts: where things stand ---------------------------------------------
  'status.ts fact(lastRunPhrase(lastRun)) #1': {
    verdict: 'composed',
    why: 'the run’s phrase, worded by `runs.ts` — which is where the goal is collapsed',
  },
  'status.ts fact(openRunsPhrase(status.resume)) #1': {
    verdict: 'composed',
    why: 'a count, worded by `runs.ts` so both readings say it the same way',
  },
  'status.ts itemLine(oneLine(item.title)) #1': {
    verdict: 'collapsed',
    why: 'a live task’s title — text an actor wrote, under a header that counts the rows',
  },
  'status.ts asId(item.id) #1': { verdict: 'minted', why: 'the task’s record id' },
  'status.ts asState(item.state) #1': {
    verdict: 'minted',
    why: 'the task’s position — a word of its transition table',
  },
  'status.ts itemLine(item.adr) #1': {
    verdict: 'minted',
    why: 'the `ADR-<n>` the decision was minted with',
  },
  'status.ts itemLine(oneLine(item.title)) #2': {
    verdict: 'collapsed',
    why: 'a decision’s title — text whoever recorded it wrote',
  },
  'status.ts asId(item.id) #2': { verdict: 'minted', why: 'the decision’s record id' },
  'status.ts itemLine(oneLine(item.name)) #1': {
    verdict: 'collapsed',
    why: 'an adopted pattern’s name — text whoever proposed it wrote',
  },
  'status.ts asId(item.id) #3': { verdict: 'minted', why: 'the pattern’s record id' },
  'status.ts itemLine(column(item.kind, KIND_WIDTH)) #1': {
    verdict: 'minted',
    why: 'which machine the item is waiting in — one of three words, padded',
  },
  'status.ts itemLine(oneLine(named(item))) #1': {
    verdict: 'collapsed',
    why: 'what the waiting item is CALLED, composed per kind above and collapsed here',
  },
  'status.ts asId(item.id) #4': { verdict: 'minted', why: 'the waiting record’s id' },
  'status.ts asState(item.state) #2': {
    verdict: 'minted',
    why: 'its position — a word of its own machine’s transition table',
  },

  // --- tails.ts: the tails on disk -----------------------------------------------
  'tails.ts itemLine(held.authorized ? AUTHORIZED : NOT_AUTHORIZED) #1': {
    verdict: 'minted',
    why: 'one of this module’s own two words, written above as constants',
  },
  'tails.ts asId(held.tail) #1': {
    verdict: 'minted',
    why: 'the tail id, whole, because `tail prune` takes it',
  },
  'tails.ts asScope(column(held.scope, SCOPE_WIDTH)) #1': {
    verdict: 'minted',
    why: 'one of the three trees, padded to a column',
  },

  // --- witness.ts: where the external witness stands ------------------------------
  'witness.ts asId(line.tail) #1': {
    verdict: 'minted',
    why: 'the tail id, whole, exactly as the tails report writes it — a value the two reports must not disagree about',
  },
  'witness.ts asScope(column(line.scope, SCOPE_WIDTH)) #1': {
    verdict: 'minted',
    why: 'one of the three trees, padded to a column',
  },
  'witness.ts asWord(SAID[line.reading.status]) #1': {
    verdict: 'minted',
    why: 'one of this module’s own three words, written above as a table total over the union',
  },
  "witness.ts itemLine(line.checkpoint === null ? 'no checkpoint' : `checkpoint ${line.checkpoint}`) #1":
    {
      verdict: 'minted',
      why: 'this module’s own words, or the digest above — the tail with no checkpoint says so',
    },
  'witness.ts itemLine(line.reading.detail) #1': {
    verdict: 'composed',
    why: 'the reading `@mnema/chain` worded, every value of which is classified in `the-phrase-the-domain-words-is-one-line`',
  },

  'switches.ts itemLine(columnsOf(row, width, anchors)) #1': {
    verdict: 'minted',
    why: 'the columns this module composed, each classified on its own row here',
  },
  'switches.ts asId(column(row.state.channel, width)) #1': {
    verdict: 'minted',
    why: 'the channel name, whole, because `switch off` takes it — one of the product’s own two',
  },

  // --- usage.ts: what the host's transcripts cost --------------------------------
  'usage.ts itemLine(column(oneLine(spend.agent), AGENT_WIDTH)) #1': {
    verdict: 'collapsed',
    why: 'the agent the run was opened for — text whoever opened it typed',
  },
  'usage.ts itemLine(window(spend)) #1': {
    verdict: 'composed',
    why: 'the run’s window, worded below out of two instants',
  },
  'usage.ts itemLine(told(spend)) #1': {
    verdict: 'composed',
    why: 'what the transcripts told, worded below — every value on it is a site of its own',
  },
  'usage.ts asId(spend.run) #1': {
    verdict: 'minted',
    why: 'the run’s uuid, whole, because every other reading of a run takes it',
  },
};

// ---------------------------------------------------------------------------
// The classification is the source's
// ---------------------------------------------------------------------------

describe('every value this layer puts on a line is classified', () => {
  it('classifies every value, and no value that went away', () => {
    const inSource = FOUND.sites.map((site) => site.key).sort();
    const classified = Object.keys(CLASSIFIED).sort();
    expect(classified).toEqual(inSource);
  });

  it('walks enough to mean something', () => {
    // The vacuous form of the case above is a walk that found nothing: two empty lists
    // are equal. The scale is stated, and so is the SPLIT the debt got wrong — it said
    // "six of the ten modules", counting the WORD `oneLine`, four of whose ten hits are
    // a mention in a comment. There are twenty-seven modules and fifteen are asked.
    //
    // IT WAS TWENTY-FOUR, then twenty-five: the authority over how many COLUMNS text takes
    // (`width.ts`), which receives no record and words nothing — it is asked by the
    // renderer, by the fold and by every table on the surface. The twenty-sixth is a
    // COMPOSER and the first whose subject is not the work but this product: `switches.ts`
    // says where each of the channels mnema pushes unasked stands, and the value on its
    // line a person typed is the REASON somebody gave for switching one off. A module added
    // to this layer is counted here the day it is written, which is what this number is for.
    expect(FOUND.composers.length + FOUND.machinery.length).toBe(28);
    expect(FOUND.composers.length).toBe(16);
    expect(FOUND.machinery).toContain('items.ts');
    expect(FOUND.machinery).toContain('line.ts');
    expect(FOUND.machinery).toContain('width.ts');
    expect(FOUND.builders.length).toBeGreaterThan(10);
    expect(FOUND.sites.length).toBe(200);
  });

  it('reads the verdict off the source rather than believing the table', () => {
    // `collapsed` has to BE collapsed and the other two must NOT be. The second half is
    // what stops the table from rotting quietly: a value that stops being the product's
    // own gets the call, and this goes red until somebody says so in words.
    const wrong = FOUND.sites
      .filter((site) => {
        const said = CLASSIFIED[site.key];
        if (said === undefined) return false;
        return new RegExp(`\\b${DOOR}\\b`).test(site.expression) !== (said.verdict === 'collapsed');
      })
      .map((site) => site.key);
    expect(wrong).toEqual([]);
  });

  it('found values of all three kinds, in the numbers the source holds', () => {
    // No arm of the case above may be empty, or that much of it is vacuous.
    const verdicts = Object.values(CLASSIFIED).map((said) => said.verdict);
    const count = (verdict: Verdict): number => verdicts.filter((said) => said === verdict).length;
    expect(count('collapsed')).toBe(47);
    expect(count('minted')).toBe(116);
    expect(count('composed')).toBe(37);
    expect(FOUND.sites.filter((site) => /\boneLine\b/.test(site.expression))).toHaveLength(47);
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

// ---------------------------------------------------------------------------
// One door
// ---------------------------------------------------------------------------

describe('the rule has one door in this layer', () => {
  /** The shape of the door's own body — `text.replace(/\\s+/g, ' ')`. */
  const A_COLLAPSE = /replace\(\s*\/\\s/;

  it('collapses with the shared function and with nothing of its own', () => {
    // `oneLine` is what `wiring/on-one-line.ts`'s tag calls. A second collapse written
    // here — a `replace` by hand, a local helper — would be a second rule, and the one
    // that stops agreeing is always the second.
    //
    // IT LIVES IN `@mnema/chain` NOW, not in this package's `one-line.ts`, which
    // re-exports it. The rule went under everything because the sentences that need it
    // are written in three packages: `the-phrase-the-domain-words-is-one-line.test.ts`
    // classifies the two below this one. What this layer imports did not move.
    //
    // The ban is checked against the place the shape really is first, or it would pass on
    // a pattern that matches nothing anywhere.
    const door = fileURLToPath(new URL('../../chain/src/one-line.ts', import.meta.url));
    expect(A_COLLAPSE.test(readFileSync(door, 'utf-8'))).toBe(true);
    const rivals = sourceFiles(LAYER)
      .filter((file) => A_COLLAPSE.test(withoutComments(readFileSync(file, 'utf-8'))))
      .map((file) => relative(LAYER, file));
    expect(rivals).toEqual([]);
  });

  it('reaches the door by importing it, in every module that collapses anything', () => {
    // The other half of "one door": a module that collapses has the import, and a module
    // that has the import collapses. An import nobody uses is a door standing open onto
    // nothing, and a collapse with no import cannot be the shared one.
    const importing = sourceFiles(LAYER)
      .filter((file) =>
        /import \{[^}]*\boneLine\b[^}]*\} from '\.\.\/one-line\.js'/.test(
          readFileSync(file, 'utf-8'),
        ),
      )
      .map((file) => relative(LAYER, file))
      .sort();
    const collapsing = [
      ...new Set(
        FOUND.sites.filter((site) => /\boneLine\b/.test(site.expression)).map((site) => site.file),
      ),
    ].sort();
    expect(importing).toEqual(collapsing);
  });

  it('accounts for every collapse the layer performs', () => {
    // The direction that catches a value the walk cannot see: if a composer holds a
    // `oneLine` that no site's expression holds, it is collapsing something in a position
    // this scan does not reach — which means the classification is not total, whatever
    // it says about itself.
    const atASite = new Map<string, number>();
    for (const site of FOUND.sites) {
      const uses = site.expression.match(/\boneLine\b/g)?.length ?? 0;
      if (uses > 0) atASite.set(site.file, (atASite.get(site.file) ?? 0) + uses);
    }
    const unaccounted: string[] = [];
    for (const file of sourceFiles(LAYER)) {
      const path = relative(LAYER, file);
      if (!FOUND.composers.includes(path)) continue;
      // The import DECLARES the door; it does not walk through it.
      const text = withoutComments(readFileSync(file, 'utf-8')).replace(/^import [^;]*;$/gm, '');
      const uses = text.match(/\boneLine\b/g)?.length ?? 0;
      const seen = atASite.get(path) ?? 0;
      if (uses !== seen) unaccounted.push(`${path}: ${uses} in source, ${seen} classified`);
    }
    // `usage.ts` names the models a run used by handing `oneLine` to a `map` inside an
    // array this walk does not enter — the ONE collapse in the layer that is not at a
    // site. It is named rather than left silent, and it is reconciled: the day the count
    // moves, this goes red and the exception is deleted with it.
    expect(unaccounted).toEqual(['usage.ts: 5 in source, 4 classified']);
  });
});

// ---------------------------------------------------------------------------
// What is deliberately not one line
// ---------------------------------------------------------------------------

/**
 * The values `show` prints WHOLE, and why each is not in the class.
 *
 * A body is what that read exists to serve, and collapsing one would damage the only
 * thing anybody opened the record for. It is the one exception this layer grants, it is
 * granted per FIELD rather than per module, and it is derived from the source in both
 * directions below — so a sixth body cannot join the five without saying so.
 */
const SERVED_WHOLE: Readonly<Record<string, string>> = {
  'body.record.content': 'a memory’s text, which is the whole of that record',
  'body.record.text': 'an observation’s text, on the same terms',
  'body.record.rationale': 'the argument a decision was accepted on',
  'body.record.alternatives': 'what that decision turned down — a second paragraph, headed',
  'body.record.body': 'a pattern’s body, which is the instruction itself',
};

describe('the body is served whole, and it is the only thing that is', () => {
  it('names every value this layer prints as a line of its own', () => {
    // Everything else a reading writes goes through a template or through a part. What
    // is pushed as a BARE value is a paragraph, and there are five of them.
    const bare: string[] = [];
    for (const file of sourceFiles(LAYER)) {
      const text = withoutComments(readFileSync(file, 'utf-8'));
      for (const pushed of text.matchAll(
        /\.push\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*\)/g,
      )) {
        bare.push(pushed[1] as string);
      }
    }
    expect(bare.sort()).toEqual(Object.keys(SERVED_WHOLE).sort());
  });

  it('says why each one is not a line', () => {
    const thin = Object.entries(SERVED_WHOLE).filter(([, why]) => why.trim().length < 20);
    expect(thin).toEqual([]);
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

/** An ordinary value: well formed, nothing in it for anything to object to. */
const ORDINARY = '0198c2f1-4b7e-7a2d-8f31-6cd0a91e4b55';

/**
 * The forged value, with its id made UNIQUE per probe.
 *
 * The second half reads as a ROW of the list it lands in — two spaces and something a
 * reader would take for an item — because that is what a forged line costs here: not an
 * ugly answer, but a record nobody wrote, under a header that counts them.
 *
 * One sandbox serves the whole file and the probes WRITE, so a value reused across two
 * of them makes the later one read back what the earlier one recorded. That is a fixture
 * consuming the fixture after it, which is not a finding, so each probe gets its own id.
 */
/** The second half, shaped like a ROW of the list it lands in: columns, two spaces apart. */
const FORGED_ROW = 'forged  public  a record nobody wrote';
/** A word of it that SURVIVES the collapse, so "did it arrive" is a separate question. */
const FORGED_MARK = 'nobody wrote';

const forged = (nth: number): string =>
  `${ORDINARY.slice(0, -2)}${String(10 + nth).slice(-2)}${LF}  ${FORGED_ROW}`;

let sandbox: string;
/** The identity this installation recorded for the project — what `--actor` takes. */
let actor: string;
const cwdBefore = process.cwd();
const envBefore = { ...process.env };

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-reading-line-'));
  const project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  process.chdir(project);
  const founded = await invoke('init');
  // `status` and `resume` are asked ABOUT somebody, and this project has exactly one
  // identity: the one `init` just recorded. Read off the answer rather than written
  // down, because a value this suite typed would be a value the product never minted.
  actor = /(mnid:[0-9a-f]+)/.exec(founded.out.join(LF))?.[1] ?? '';
  expect(actor).toMatch(/^mnid:[0-9a-f]{64}$/);
}, 60_000);

afterAll(() => {
  process.chdir(cwdBefore);
  process.env = envBefore;
  rmSync(sandbox, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The forgery does not pass
// ---------------------------------------------------------------------------

/** One way to reach a closed value from the command line. */
interface Probe {
  /** Which values this covers, as {@link CLASSIFIED} keys them. */
  readonly keys: readonly string[];
  /** What has to be written BEFORE it, so the read has something to read. */
  readonly first?: readonly string[];
  /** What a caller types, with the forged value written {@link VALUE}. */
  readonly argv: readonly string[];
  /** A word of the line the value lands on, so a probe that never arrived fails. */
  readonly says: string;
}

/** Where the forged value goes in a probe's argv. */
const VALUE = '<value>';
/** Where the id the WRITE minted goes — a read that has to be asked by it. */
const RECORDED = '<recorded>';
/** Where the identity `init` recorded goes. */
const ACTOR = '<actor>';

/**
 * How each closed value REACHABLE from a command line is driven, with the forgery
 * entering exactly as somebody would type it.
 *
 * Four of the six take TWO verbs, and those are the sharpest: a forged value enters the
 * record through one verb — `observe`, which does not validate its positional, `task`,
 * `link`, `run start` — and comes back out through another, as a FACT under a subject in
 * `show`, as a ROW of a counted list in `status`, as an edge in `refs`. The rest are
 * named in {@link UNREACHABLE} with what stands in the way, and the two lists are
 * reconciled against the classification.
 */
const PROBES: readonly Probe[] = [
  {
    keys: ['search.ts « matching "{}"» oneLine(term) #1'],
    argv: ['search', VALUE],
    says: 'matching',
  },
  {
    keys: [
      'references.ts subjectLine(oneLine(graph.id)) #1',
      'references.ts «{}{}» oneLine(id) #1',
      'references.ts «{}:{}» oneLine(link.rel) #1',
    ],
    first: ['link', VALUE, 'a-target', '--rel', VALUE],
    argv: ['refs', VALUE],
    says: 'its own edges',
  },
  {
    keys: ['record.ts «about {} · recorded {}» oneLine(body.record.about) #1'],
    first: ['observe', VALUE, '--topic', 'a topic', '--text', 'an observation'],
    argv: ['show', RECORDED],
    says: 'about ',
  },
  {
    keys: ['record.ts «topic: {}» oneLine(body.record.topic) #1'],
    first: ['observe', 'a-subject', '--topic', VALUE, '--text', 'an observation'],
    argv: ['show', RECORDED],
    says: 'topic: ',
  },
  {
    keys: [
      'record.ts statedFact(oneLine(body.record.title)) #1',
      'status.ts itemLine(oneLine(item.title)) #1',
    ],
    first: ['task', VALUE],
    argv: ['status', '--actor', ACTOR],
    says: 'live task(s):',
  },
  {
    keys: ['runs.ts « — {}» oneLine(run.goal) #1', 'status.ts fact(lastRunPhrase(lastRun)) #1'],
    first: ['run', 'start', '--which', 'an-agent', '--goal', VALUE],
    argv: ['status', '--actor', ACTOR],
    says: 'last run ',
  },
];

/** The uuid a write reports back, so the read after it can be asked by that id. */
function mintedId(said: readonly string[]): string {
  return (
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(said.join(LF))?.[1] ?? ''
  );
}

describe('a value from outside cannot forge a second line', () => {
  for (const [nth, probe] of PROBES.entries()) {
    it(`keeps it to one line — ${probe.keys.join(' + ')}`, async () => {
      const value = forged(nth);
      const wrote =
        probe.first === undefined
          ? { out: [] as string[] }
          : await invoke(...probe.first.map((word) => (word === VALUE ? value : word)));
      const recorded = mintedId(wrote.out);
      const said = await invoke(
        ...probe.argv.map((word) =>
          word === VALUE ? value : word === RECORDED ? recorded : word === ACTOR ? actor : word,
        ),
      );
      const whole = said.out.join(LF);
      // THAT THIS PROBE REACHED ITS SITE. Every line of this surface is one line, so a
      // count alone passes for a probe that never got there — which is exactly what a
      // refusal one branch earlier looks like.
      expect(whole, probe.keys[0]).toContain(probe.says);
      // AND THAT THE VALUE ARRIVED, rather than being dropped on the way.
      expect(whole, probe.keys[0]).toContain(FORGED_MARK);
      // THE FORGERY IS THE SECOND HALF STANDING AT THE HEAD OF A LINE — that is what
      // reads as a row of the list it landed in, and it is what may not exist. Asserted
      // on the shape rather than on a count of lines, because a probe that covers three
      // values lands the half on three lines legitimately.
      const forgedRows = whole.split(LF).filter((line) => line.trimStart().startsWith('forged '));
      expect(forgedRows, probe.keys[0]).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// The phrase has one door, and both readings come through it
// ---------------------------------------------------------------------------

describe('the run’s phrase reads the same by both paths', () => {
  it('says the same goal through `resume` and through `status`', async () => {
    // THE CASE THIS SLICE WAS HANDED. `lastRunPhrase` is worded once and printed twice,
    // and the goal inside it is text somebody typed: the collapse used to be at
    // `resume`'s line, so `status` printed the same run raw. Asserted on the PHRASE
    // rather than on the two whole answers — the two readings say different things
    // around it, and what has to agree is the run.
    const goal = `a goal${LF}  ${FORGED_ROW}`;
    await invoke('run', 'start', '--which', 'the-same-agent', '--goal', goal);
    const resumed = await invoke('resume', '--actor', actor);
    const stood = await invoke('status', '--actor', actor);
    const phraseOf = (lines: readonly string[]): string =>
      lines.find((line) => line.includes('last run ')) ?? '';
    const fromResume = phraseOf(resumed.out);
    const fromStatus = phraseOf(stood.out);
    expect(fromResume).toContain('last run ');
    expect(fromStatus).toContain('last run ');
    // The same bytes from "last run" onward, and neither of them broken in two.
    expect(fromStatus.slice(fromStatus.indexOf('last run '))).toBe(
      fromResume.slice(fromResume.indexOf('last run ')),
    );
    expect(fromStatus).toContain(FORGED_MARK);
    expect(stood.out.filter((line) => line.trimStart().startsWith('forged '))).toEqual([]);
    await invoke('run', 'end');
  });
});

// ---------------------------------------------------------------------------
// Nothing else moved
// ---------------------------------------------------------------------------

describe('an ordinary value says what it always did', () => {
  it('prints the phrase byte for byte, with the goal in it', async () => {
    const started = await invoke('run', 'start', '--which', 'an-agent', '--goal', 'a plain goal');
    const id = /run ([0-9a-f-]{36})/.exec(started.out.join(LF))?.[1];
    expect(id).toBeDefined();
    const resumed = await invoke('resume', '--actor', actor);
    const phrase = resumed.out.find((line) => line.includes('last run ')) ?? '';
    expect(phrase).toContain(`last run ${id} (open) — a plain goal · open `);
    await invoke('run', 'end');
  });

  it('prints a record whole, with its body on its own lines', async () => {
    // The body is the one thing served whole, and this is what says the collapse above
    // did not reach it: the memory is recorded with two paragraphs and comes back with
    // two paragraphs.
    const captured = await invoke('memory', `first line${LF}${LF}second line`);
    const id = /memory ([0-9a-f-]{36})/.exec(captured.out.join(LF))?.[1];
    expect(id).toBeDefined();
    const shown = await invoke('show', id as string);
    expect(shown.out.join(LF)).toContain(`first line${LF}${LF}second line`);
  });
});
