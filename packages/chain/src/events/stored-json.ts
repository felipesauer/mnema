/**
 * Reading one stored line of JSON with the refusals the format makes at PARSE time.
 *
 * `JSON.parse` keeps the LAST of two identical keys and says nothing, so on its own it
 * reads a line the format refuses. The danger is not an error in the proof: a false
 * `"title"` placed BEFORE the true one leaves the value `JSON.parse` returns exactly as
 * signed, the recomputed bytes equal the signed bytes, and every hash and signature
 * still verifies, while a reader that keeps the FIRST of two keys (or a person reading
 * the diff) sees the false title on a line the record calls signed. The bytes on disk
 * must be the bytes the signature covers (FORMAT.md section 4), and a duplicate is
 * content that one reader sees and the other does not; no honest reformatting produces
 * one. So it is refused here, at the one function every stored line is read through,
 * the way the second reader refuses it in `canonical.py`'s `strict_loads`.
 *
 * A LINE OF THE RECORD IS ALSO REFUSED WHEN IT IS NOT CANONICAL, by {@link parseCanonicalLine}.
 * This comment used to end by saying the product forgave key order, whitespace and Unicode
 * composition on a stored line, as an honest reformat, and that the tolerance was a decision
 * left as it was. The decision was taken the other way (01/10/2026): `FORMAT.md` section 4
 * says each line IS the canonical serialization of what it holds, the second reader refused
 * every such line while this product verified it, and nothing this product writes produces
 * one, so the two readers disagreed about bytes no honest writer of the format makes.
 * `parseStoredJson` itself stays tolerant, for the three documents that are not lines of the
 * record (see `both-readers-read-the-same-bytes.test.ts`, which names them).
 */

import { type CanonicalValue, canonicalStringify } from './canonical.js';

/** A stored line that cannot be read as JSON the format accepts; `message` says why. */
export class StoredJsonError extends Error {
  override readonly name = 'StoredJsonError';
}

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPEN_OBJECT = 0x7b;
const CLOSE_OBJECT = 0x7d;
const OPEN_ARRAY = 0x5b;
const CLOSE_ARRAY = 0x5d;
const COMMA = 0x2c;

/**
 * Strict: a byte sequence that is not UTF-8 throws instead of becoming U+FFFD, and a leading
 * byte-order mark is kept as the character it is rather than swallowed. Node's
 * `buffer.toString('utf-8')` and a default `TextDecoder` each do one of those two things.
 */
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * The offset of the first byte that does not begin a well-formed UTF-8 character (Unicode
 * 16.0, table 3-7), or -1 when every byte does. The offset is the one Python's decoder
 * reports as `start`, so the two readers name the same byte: an overlong form, a surrogate,
 * a code point past U+10FFFF and a sequence cut short are each placed at their FIRST byte.
 */
function firstByteNotUtf8(bytes: Uint8Array): number {
  let i = 0;
  while (i < bytes.length) {
    const lead = bytes[i] as number;
    if (lead < 0x80) {
      i += 1;
      continue;
    }
    // How many bytes follow the lead, and the range the FIRST of them must fall in: the
    // narrowed ranges are what refuse an overlong form, a surrogate and a code point too large.
    let follow = 0;
    let low = 0x80;
    let high = 0xbf;
    if (lead >= 0xc2 && lead <= 0xdf) follow = 1;
    else if (lead >= 0xe0 && lead <= 0xef) follow = 2;
    else if (lead >= 0xf0 && lead <= 0xf4) follow = 3;
    else return i;
    if (lead === 0xe0) low = 0xa0;
    if (lead === 0xed) high = 0x9f;
    if (lead === 0xf0) low = 0x90;
    if (lead === 0xf4) high = 0x8f;
    for (let k = 1; k <= follow; k += 1) {
      const next = bytes[i + k];
      if (next === undefined || next < low || next > high) return i;
      low = 0x80;
      high = 0xbf;
    }
    i += follow + 1;
  }
  return -1;
}

/**
 * The text of a line of the record, refusing bytes that are not UTF-8.
 *
 * Section 1, rule 6: the canonical bytes ARE UTF-8. A decode that replaced a bad sequence with
 * U+FFFD and read on would hand the parser a line whose characters are not the bytes on disk,
 * and the replacement character is canonical, so the line passed the byte-identity check of
 * section 4 over bytes no writer of the format produces. Every reader of the record decodes
 * through here. Throws {@link StoredJsonError}, naming the offset of the first bad byte.
 *
 * The decoder decides and the walk only places the refusal, so an honest line costs one
 * native decode and no loop over its bytes in this language.
 */
export function decodeStoredBytes(bytes: Uint8Array): string {
  try {
    return UTF8.decode(bytes);
  } catch {
    const at = firstByteNotUtf8(bytes);
    throw new StoredJsonError(at >= 0 ? `not UTF-8 at byte ${at}` : 'not UTF-8');
  }
}

/** The longest key a refusal repeats back; a key is untrusted text from a stored line. */
const KEY_SHOWN = 80;

/**
 * The first object key that appears twice in the same object of a document that is
 * ALREADY valid JSON, or undefined when there is none. Keys are compared as the strings
 * they decode to, so `"a"` and `"a"` are the same key.
 */
export function firstDuplicateKey(text: string): string | undefined {
  // One frame per open container: the set of keys seen so far for an object, null for
  // an array. `expectKey` says whether the next string in the top object is a key.
  const frames: (Set<string> | null)[] = [];
  let expectKey = false;
  const end = text.length;
  for (let i = 0; i < end; i += 1) {
    const c = text.charCodeAt(i);
    if (c === QUOTE) {
      let close = i + 1;
      for (;;) {
        close = text.indexOf('"', close);
        // Valid JSON closes every string; this only keeps a caller's bug from looping.
        if (close < 0) return undefined;
        let slashes = 0;
        while (text.charCodeAt(close - 1 - slashes) === BACKSLASH) slashes += 1;
        if (slashes % 2 === 0) break;
        close += 1;
      }
      const top = frames[frames.length - 1];
      if (expectKey && top) {
        const raw = text.slice(i + 1, close);
        const key = raw.includes('\\') ? (JSON.parse(`"${raw}"`) as string) : raw;
        if (top.has(key)) return key;
        top.add(key);
        expectKey = false;
      }
      i = close;
    } else if (c === OPEN_OBJECT) {
      frames.push(new Set());
      expectKey = true;
    } else if (c === OPEN_ARRAY) {
      frames.push(null);
      expectKey = false;
    } else if (c === CLOSE_OBJECT || c === CLOSE_ARRAY) {
      frames.pop();
      expectKey = false;
    } else if (c === COMMA) {
      expectKey = frames[frames.length - 1] instanceof Set;
    }
  }
  return undefined;
}

/**
 * Parses one stored line of JSON, refusing a duplicate key at any depth.
 * Throws {@link StoredJsonError}, whose message is already the whole sentence.
 */
export function parseStoredJson(text: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new StoredJsonError(`not valid JSON: ${(error as Error).message}`);
  }
  const duplicate = firstDuplicateKey(text);
  if (duplicate !== undefined) {
    const shown = JSON.stringify(
      duplicate.length > KEY_SHOWN ? `${duplicate.slice(0, KEY_SHOWN)}...` : duplicate,
    );
    throw new StoredJsonError(`a duplicate object key on the line: ${shown}`);
  }
  return parsed;
}

/**
 * Parses one LINE OF THE RECORD (an entry, a checkpoint, a tail proof, a stored block
 * header) refusing a duplicate key (as {@link parseStoredJson} does) AND a line that is not
 * the canonical serialization (`FORMAT.md` section 1) of the value it holds: whitespace, key
 * order, Unicode composition, an escape or a number spelled another way. The bytes on disk
 * are then the bytes every hash and signature was taken over, which is what section 4
 * promises and what the second reader checks (`is_canonical_line` in its `canonical.py`).
 *
 * A value with no canonical bytes at all, a lone surrogate, is refused here too, with the
 * canonicalizer's own words, rather than later when a proof first asks for the bytes.
 *
 * IT COSTS ONE SERIALIZATION PER LINE READ, and that is not free: measured on 01/10/2026,
 * `verify` over a tail of 10,001 events went from 303 ms to 400 ms (median of six, order
 * alternated; the same build against itself tied at 302-303 ms), about 10 µs a line. The
 * event's bytes are serialized again when its hash is recomputed, so a reading could reuse
 * these instead; that is not done. Throws {@link StoredJsonError}, whose message is
 * already the whole sentence.
 *
 * `shape`, when given, is run on the value before the bytes are compared, and throws what
 * the caller throws: the structure the line must have (which keys, and nothing else) is
 * checked first, as `mnemaverify` does, so both readers name the same first cause.
 */
export function parseCanonicalLine(text: string, shape?: (value: unknown) => void): unknown {
  const parsed = parseStoredJson(text);
  // THE SHAPE BEFORE THE BYTES, in the order the second reader asks: a line that is both
  // re-spelled and carries a key no writer puts there is refused for the key in both.
  shape?.(parsed);
  let canonical: string;
  try {
    // Sound by construction: `JSON.parse` yields only the closed set CanonicalValue names.
    canonical = canonicalStringify(parsed as CanonicalValue);
  } catch (error) {
    throw new StoredJsonError(`a value the format has no bytes for: ${(error as Error).message}`);
  }
  if (canonical !== text) {
    throw new StoredJsonError(
      `${canonical}\r` === text
        ? CRLF_REFUSAL
        : 'not the canonical serialization of what it holds (whitespace, key order, Unicode ' +
            'composition or spelling differ), so these are not the bytes the proof was taken over',
    );
  }
  return parsed;
}

/**
 * The canonical serialization of what a stored text holds, when that differs from the text and
 * is all that is wrong with it: the text is JSON with no key twice and a value the format has
 * bytes for, laid out another way (whitespace, line ends, indentation, key order, an escape or a
 * number spelled another way). Undefined for anything else, a text that is already canonical
 * included. The value it holds comes with it, read once.
 *
 * IT PROVES NOTHING, AND NOTHING READS IT AS PROOF. It says what a line would hold if a formatter
 * had only rewritten its layout; whether those are the bytes that were signed is asked of the
 * verifier, over them, and nowhere else (`verify.ts`, where the reformat is named).
 */
export function canonicalFormOf(
  text: string,
): { readonly text: string; readonly value: unknown } | undefined {
  let value: unknown;
  let canonical: string;
  try {
    value = parseStoredJson(text);
    // Sound by construction: `JSON.parse` yields only the closed set CanonicalValue names.
    canonical = canonicalStringify(value as CanonicalValue);
  } catch {
    return undefined;
  }
  return canonical === text ? undefined : { text: canonical, value };
}

/**
 * The refusal when a carriage return at the end is ALL that stands between a line and its
 * canonical bytes: what a checkout that rewrites line ends leaves on every line (git with
 * `core.autocrlf=true`, the Git for Windows default). Still a refusal: the bytes on disk are
 * not the bytes that were signed, and tolerating the `\r` would make them so for good. It
 * names the cause instead of the sentence a tampered line gets. The second reader says the
 * same (`CRLF` in its `canonical.py`).
 */
const CRLF_REFUSAL =
  'not the canonical serialization of what it holds: the line ends in CRLF, as a checkout ' +
  'that rewrites line ends leaves it (git with core.autocrlf), so these are not the bytes the ' +
  "proof was taken over; '* -text' in the tree's .gitattributes keeps git from doing it";

/**
 * Whether a stored object holds EXACTLY these keys: none missing, and none a writer of the
 * format never puts there. The entry hash takes no envelope and no whole link, and a
 * signature takes only its named keys, so a key added beside them leaves every hash and
 * signature closing and the line canonical: only the set of keys tells it from a line a
 * writer wrote (`FORMAT.md` sections 4, 6 and 6.1).
 */
export function holdsExactly(value: object, keys: readonly string[]): boolean {
  const held = Object.keys(value);
  return held.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/**
 * Keys as the second reader writes them in a refusal: sorted by code point and spelled the
 * way Python spells a list of strings (`['event', 'link']`), so both readers say one
 * sentence over the same bytes.
 */
export function keyList(keys: Iterable<string>): string {
  return `[${[...keys].sort(byCodePoint).map(pythonString).join(', ')}]`;
}

/**
 * A scheme a reader does not know, as both readers name it in the refusal: a string as Python's
 * `repr` spells it, an absent or `null` one as `None`, and any other value by its JSON type
 * alone, whose spelling the two languages do not share (`1.0` is `1` once JavaScript has read it).
 * `_scheme_named` in `mnemaverify/checkpoint.py` is the second reader's half.
 */
export function schemeNamed(value: unknown): string {
  if (typeof value === 'string') return pythonString(value);
  if (value === undefined || value === null) return 'None';
  if (typeof value === 'boolean') return 'a boolean';
  if (typeof value === 'number') return 'a number';
  return Array.isArray(value) ? 'an array' : 'an object';
}

function byCodePoint(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const delta = (left[i]?.codePointAt(0) ?? 0) - (right[i]?.codePointAt(0) ?? 0);
    if (delta !== 0) return delta;
  }
  return left.length - right.length;
}

/**
 * What Python's `repr` gives for a string: its quote, its backslash escapes, and the
 * hexadecimal escape for a character that does not print (a control, a format character, a
 * separator other than the space).
 */
function pythonString(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = quote;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (char === '\\' || char === quote) out += `\\${char}`;
    else if (char === '\n') out += '\\n';
    else if (char === '\r') out += '\\r';
    else if (char === '\t') out += '\\t';
    else if (char !== ' ' && /[\p{C}\p{Z}]/u.test(char)) {
      const hex = code.toString(16);
      out +=
        code < 0x100
          ? `\\x${hex.padStart(2, '0')}`
          : code < 0x10000
            ? `\\u${hex.padStart(4, '0')}`
            : `\\U${hex.padStart(8, '0')}`;
    } else out += char;
  }
  return out + quote;
}
