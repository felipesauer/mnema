/**
 * The Agent Skills format — the one module in this product that speaks somebody
 * else's shape, and the only direction it speaks in is OUT.
 *
 * A `SKILL.md` is `<name>/SKILL.md`: a YAML frontmatter with two required fields and
 * a markdown body, read by an agent host that decides which skill to activate. The
 * fields are the specification's (`agentskills.io/specification`, read 2026-08-13
 * and written down in the ecosystem study), and only three of them appear here:
 *
 *   - `name` — 1–64 characters, `[a-z0-9-]`, no hyphen at either end, no `--`, and
 *     EQUAL TO THE DIRECTORY NAME. {@link specName} is that rule, whole.
 *   - `description` — 1–1024 characters, and the field the host CHOOSES by, with
 *     nobody calling anything. {@link specDescription} is what fits in it.
 *   - `metadata` — optional, a free string→string map, and where the provenance
 *     rides (see `commands/skill-export.ts` for what goes in it and why).
 *
 * WHY IT IS EXPORT-ONLY, and the absence is the decision rather than a gap: a
 * `SKILL.md` from somewhere else, read INTO the record, would enter as a body signed
 * by us asserting a provenance we do not have. That is forging authorship. So there is
 * no parser here, and there is no reader of one anywhere in this package.
 *
 * NOTHING HERE TOUCHES THE BODY. The body is what was signed; a summary, a reflow or
 * a "cleanup" of it would make the exported file stop being the thing the chain
 * proves. {@link agentSkillFile} concatenates and never edits, so the bytes after the
 * frontmatter are the recorded body exactly — asserted in
 * `the-pattern-leaves-in-the-hosts-shape.test.ts` by a sentinel inside the body.
 *
 * EVERY SCALAR IS WRITTEN QUOTED — keys and values, one rule with no branch. The
 * market's own files write `description:` unquoted, which breaks the moment the text
 * holds a colon, and the text here is DERIVED FROM RECORDED PROSE: it is exactly the
 * value a rule with a branch gets the branch wrong on. An unparseable frontmatter is
 * the worst outcome this file has, because a host does not complain — it ignores the
 * skill, and nobody learns why.
 */

import { oneLine } from './served-patterns.js';

/** The file every exported skill directory holds — the specification's own name. */
export const SKILL_FILE = 'SKILL.md';

/** The specification's ceiling on `name`, in characters. */
export const NAME_LIMIT = 64;

/**
 * The specification's ceiling on `description`, in characters.
 *
 * It is the field the host routes on, so it is the one field of this file that has to
 * be there and has to say something: {@link specDescription} cuts to this and refuses
 * an empty answer rather than writing a field that would make the host choose by
 * nothing.
 */
export const DESCRIPTION_LIMIT = 1024;

/** Whether a recorded name is a name of the specification, and why not when it is not. */
export type SpecName =
  | { readonly ok: true }
  /** The clause of the rule it broke, as the half of a sentence after "because". */
  | { readonly ok: false; readonly why: string };

/**
 * Whether `name` is a name the specification allows — the WHOLE rule, in one place.
 *
 * A recorded skill name is a short title somebody typed; the specification's name is
 * an identifier that must equal the directory holding the file. So the two are not the
 * same kind of value, and this is the one honest thing to do about that: ask whether
 * the recorded name already IS one, and refuse when it is not.
 *
 * IT DERIVES NOTHING. Slugging "One slice per PR" into `one-slice-per-pr` would put a
 * name in the file that nobody recorded and nothing signed, and the name is the KEY —
 * the directory is named by it, and the host matches on it. A derived DESCRIPTION is
 * declared and cut from text that was signed; a derived name would be a new identity
 * for the pattern, invented at the door. The caller's way out of a refusal is to
 * record the pattern under a name the specification takes, which is why the refusal
 * says the rule rather than only saying no.
 *
 * The clauses are checked in the order a reader most often trips them: an empty name,
 * then a character outside the set (a space or a capital, which is nearly always what
 * happened), then the length, then the two hyphen rules. The charset is asked as a
 * SEARCH for a character outside the set rather than as an anchored match over the
 * whole string, so no regex end-anchor subtlety decides whether a trailing byte counts.
 */
export function specName(name: string): SpecName {
  const characters = [...name];
  if (characters.length === 0) return { ok: false, why: 'it is empty' };
  if (/[^a-z0-9-]/.test(name)) {
    return {
      ok: false,
      why: 'it holds something that is not a lowercase letter, a digit or a hyphen',
    };
  }
  if (characters.length > NAME_LIMIT) {
    return {
      ok: false,
      why: `it is ${characters.length} characters and the specification allows ${NAME_LIMIT}`,
    };
  }
  if (name.startsWith('-') || name.endsWith('-')) {
    return { ok: false, why: 'it begins or ends with a hyphen' };
  }
  if (name.includes('--')) return { ok: false, why: 'it holds two hyphens in a row' };
  return { ok: true };
}

/** A blank line: where the first paragraph of a body ends. */
const PARAGRAPH_BREAK = /\r?\n[ \t]*\r?\n/;

/**
 * The first sentence of a collapsed paragraph: up to a `.`, `!` or `?` that is
 * followed by a space or by the end of it.
 *
 * The lookahead is what keeps a decimal from ending the sentence early — `1.5` has no
 * space after the stop — and `.*?` is lazy, so the FIRST stop that qualifies ends it.
 */
const SENTENCE_END = /^(.*?[.!?])(?:\s|$)/;

/**
 * The description this product derives from a body — the MECHANICAL rule, and it is
 * mechanical on purpose.
 *
 * The record holds no description and will not: a field on the catalogue is a new kind
 * of thing the product promises to prove, and this one exists for the host's router,
 * a role the record does not have. No model is asked for one either, anywhere in this
 * path: a sentence a model wrote about a signed body would be our text presented as
 * the description of somebody else's, and a file leaving this record may not assert
 * more than the record does. So the rule is a CUT of text that WAS signed — the first
 * paragraph of the body, its first sentence when it has one, whitespace collapsed to
 * one line.
 *
 * The rule is stated in the verb's `--help` and said again on the line the export
 * prints, because a caller who cannot see how the field was produced cannot judge
 * whether it will make the host choose the right pattern. When it will not, the way
 * out is `--description`.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: skip a leading markdown heading. A body that opens
 * with `# Something` yields that heading as its description, which is a poor
 * description and a rule with one clause; the exception would make it a rule with a
 * branch, and a branch is what gets wrong the value nobody is watching. The flag is
 * the answer for that body.
 */
export function derivedDescription(body: string): string | undefined {
  const paragraph = body.split(PARAGRAPH_BREAK)[0] ?? body;
  const collapsed = oneLine(paragraph);
  return specDescription(SENTENCE_END.exec(collapsed)?.[1] ?? collapsed);
}

/**
 * `text` as a description the specification accepts: one line, cut to
 * {@link DESCRIPTION_LIMIT} characters — or `undefined` when there is nothing usable
 * in it.
 *
 * BOTH DESCRIPTIONS GO THROUGH HERE, the derived one and the one a caller gave, and
 * that is the point of it being a function: a `--description ""` and a body with no
 * text in it are the same answer, and two readings of "is there anything here" is how
 * one of them comes to accept what the other refuses.
 *
 * "NOTHING USABLE" IS THE PRODUCT'S OWN READING OF EMPTY, never a second one invented
 * here. `oneLine` collapses what JavaScript calls whitespace and trims, which is what
 * `canonicalIdentity` does when it decides whether a `--which` names an agent — and it
 * means a text of only zero-width characters (U+200B and its neighbours are not
 * whitespace to a trim) is a VALUE here, exactly as it is a name there. Invisible, and
 * this product does not judge content; a second notion of blank, written here, would
 * be the divergence this bench keeps paying for.
 *
 * The cut is by CODE POINT and not by UTF-16 unit, so a description ending at the
 * ceiling can never be a file with half an astral character in it.
 */
export function specDescription(text: string): string | undefined {
  const collapsed = oneLine(text);
  if (collapsed.length === 0) return undefined;
  return [...collapsed].slice(0, DESCRIPTION_LIMIT).join('');
}

/** One entry of the file's `metadata` map: the key, and what it says. */
export type MetadataEntry = readonly [key: string, value: string];

/** The frontmatter of one exported skill. */
export interface AgentSkillFields {
  /** The `name` — checked by {@link specName}, and the directory is named by it. */
  readonly name: string;
  /** The `description` — what the host chooses by, from {@link specDescription}. */
  readonly description: string;
  /**
   * The `metadata` map, and it is typed NON-EMPTY.
   *
   * The specification has it optional; this product's file always carries the
   * provenance, so the shape is one shape and a reader never has to ask whether this
   * particular file happens to say where it came from. Typed as a tuple with a head
   * rather than guarded at run time: a `metadata:` key with nothing under it would be
   * YAML null, and the branch that avoided writing one is a branch nothing ever takes.
   */
  readonly metadata: readonly [MetadataEntry, ...MetadataEntry[]];
}

/** The quote and the backslash, the two characters a scalar escapes with a prefix. */
const QUOTE = 0x22;
const BACKSLASH = 0x5c;

/**
 * Whether a code unit may not appear raw inside a double-quoted YAML scalar: a C0
 * control, a C1 control, or one of the two Unicode line separators.
 *
 * The C1 range and U+2028/U+2029 are in it because YAML 1.1 counts NEL and the two
 * separators as line breaks while YAML 1.2 does not — and the parser on the other side
 * of this file is the HOST's, not ours. A raw byte whose meaning depends on which
 * version the reader implements is a byte that decides, on somebody else's machine,
 * whether one field is two.
 *
 * The members are written as NUMBERS and the escaping is a loop rather than a
 * character class, deliberately: a control byte typed into a source file is invisible
 * in review and a tool on the way past can turn it into a space — a guard that quietly
 * stops covering what it names, which has already happened once on this bench.
 */
function mustEscape(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
}

/**
 * One code unit as it is written inside a scalar.
 *
 * Code UNITS and not code points, which is safe here and not a shortcut: no member of
 * the escaped set is a surrogate, so a surrogate pair passes through as its two units
 * in order and reassembles into exactly the character it was.
 */
function written(code: number): string {
  if (code === QUOTE || code === BACKSLASH) return `\\${String.fromCharCode(code)}`;
  if (mustEscape(code)) return `\\u${code.toString(16).padStart(4, '0')}`;
  return String.fromCharCode(code);
}

/**
 * `text` as a double-quoted YAML scalar — the one way this module writes a scalar,
 * key or value.
 *
 * See the module doc for why there is no unquoted branch. It is exported so the
 * escaping can be asserted on its own, over the values a recorded body can hold.
 */
export function quoted(text: string): string {
  let scalar = '';
  for (let index = 0; index < text.length; index += 1) scalar += written(text.charCodeAt(index));
  return `"${scalar}"`;
}

/**
 * The whole file: the frontmatter, then the body VERBATIM.
 *
 * The body is appended and never touched — not trimmed, not re-wrapped, and not given
 * a trailing newline it did not have. That last one looks like tidying and is not
 * available: what this file promises is that everything after the frontmatter is the
 * recorded body byte for byte, and a newline added at the end is a byte the chain does
 * not prove. So the document ends where the body ends.
 */
export function agentSkillFile(fields: AgentSkillFields, body: string): string {
  const frontmatter = [
    '---',
    `${quoted('name')}: ${quoted(fields.name)}`,
    `${quoted('description')}: ${quoted(fields.description)}`,
    `${quoted('metadata')}:`,
    ...fields.metadata.map(([key, value]) => `  ${quoted(key)}: ${quoted(value)}`),
    '---',
  ];
  return `${frontmatter.join('\n')}\n${body}`;
}
