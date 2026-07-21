/**
 * Deterministic canonicalization: an event value → the exact bytes that the
 * hash chain links and the Ed25519 checkpoint signs.
 *
 * The proof stands or falls on one property: any party — the writer now, a
 * verifier in ten years, an anonymous clone with no secret — must derive the
 * SAME bytes from the SAME event. If two honest parties disagree on the bytes,
 * every line reads as tampered; if a forger can vary the bytes while keeping
 * meaning, tamper-evidence is defeated.
 *
 * So canonicalization cannot lean on `JSON.stringify` over insertion order:
 * that is stable only by accident (it survives a round-trip through the same
 * engine but not reformatting, key reordering, or a re-parse that changes key
 * order). We serialize over recursively SORTED, NFC-NORMALIZED keys, normalize
 * string values to NFC, reject values JSON cannot round-trip losslessly, and
 * emit UTF-8 bytes.
 */

/** A value that canonicalizes: the closed set JSON round-trips losslessly. */
export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

/**
 * Serializes a value to its canonical JSON string. Object keys are sorted
 * (recursively, by code unit) so key order never affects the output; arrays
 * keep their order (it is semantic). Throws on any value JSON cannot represent
 * deterministically — a caught bug at write time is cheaper than a silently
 * unverifiable line later.
 */
export function canonicalStringify(value: CanonicalValue): string {
  return encode(value);
}

/**
 * Canonical bytes: the UTF-8 encoding of {@link canonicalStringify}. This is
 * the input to the hash chain and the signed checkpoint — never the raw
 * `.jsonl` line, whose whitespace and key order a reformat or merge can change
 * without changing the fact.
 */
export function canonicalBytes(value: CanonicalValue): Uint8Array {
  return new TextEncoder().encode(canonicalStringify(value));
}

function encode(value: CanonicalValue): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return encodeString(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return encodeNumber(value);
    case 'object':
      if (Array.isArray(value)) return encodeArray(value);
      return encodeObject(value as { readonly [key: string]: CanonicalValue });
    default:
      throw new CanonicalizationError(`cannot canonicalize a ${typeof value} value`);
  }
}

function encodeString(value: string): string {
  // Two strings that render identically but differ in Unicode composition
  // (NFC "é" = U+00E9 vs NFD "e"+U+0301) are byte-distinct, so an honest
  // renormalizing reformat of the stored line would fork the bytes and read as
  // tampered — and a homograph gives an adversary free bits in the signed
  // fact. Normalizing to NFC first, the same class of guard as -0, means "same
  // text" always yields "same bytes".
  const normalized = value.normalize('NFC');
  // A lone (unpaired) surrogate is not valid Unicode text; different tools
  // handle or drop it inconsistently, another fork-the-bytes hazard. Refuse it.
  if (hasLoneSurrogate(normalized)) {
    throw new CanonicalizationError('cannot canonicalize a string with a lone surrogate');
  }
  return JSON.stringify(normalized);
}

function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate must be followed by a low surrogate.
      const next = value.charCodeAt(i + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return true;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      // Low surrogate with no preceding high surrogate.
      return true;
    }
  }
  return false;
}

function encodeNumber(value: number): string {
  // NaN and ±Infinity have no JSON form; `JSON.stringify` silently turns them
  // into `null`, which would let two different events canonicalize identically.
  // Refuse them so the ambiguity can never reach the chain.
  if (!Number.isFinite(value)) {
    throw new CanonicalizationError(`cannot canonicalize the non-finite number ${value}`);
  }
  // `-0` and `0` are the same JSON number but stringify differently ("0" vs
  // "-0"); normalize so they cannot fork the bytes.
  return JSON.stringify(value === 0 ? 0 : value);
}

function encodeArray(value: readonly CanonicalValue[]): string {
  return `[${value.map(encode).join(',')}]`;
}

function encodeObject(value: { readonly [key: string]: CanonicalValue }): string {
  // Keys are normalized (NFC) for the same reason as string values, then the
  // encoded pairs are sorted by their normalized key so key order — and key
  // composition — never affect the bytes. Two keys that normalize to the same
  // string would make the object ambiguous, so refuse the collision.
  const seen = new Set<string>();
  const members = Object.keys(value).map((rawKey) => {
    const child = value[rawKey];
    // An explicit `undefined` property is neither valid JSON nor meaningful
    // proof — drop-or-keep would be an ambiguous choice, so refuse it and make
    // the caller decide (omit the key, or use null).
    if (child === undefined) {
      throw new CanonicalizationError(`cannot canonicalize an undefined value at key "${rawKey}"`);
    }
    const key = rawKey.normalize('NFC');
    if (seen.has(key)) {
      throw new CanonicalizationError(
        `cannot canonicalize colliding keys after normalization: "${key}"`,
      );
    }
    seen.add(key);
    return { key, encoded: `${encodeString(key)}:${encode(child)}` };
  });
  members.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return `{${members.map((m) => m.encoded).join(',')}}`;
}

/** Thrown when a value cannot be canonicalized deterministically. */
export class CanonicalizationError extends Error {
  override readonly name = 'CanonicalizationError';
}
