/**
 * The door every piece of free text goes through on its way into the record: one
 * size limit, then one scrub.
 *
 * One function, for the reason the authority invariant is one function: the
 * shapes that need it are not alike — a birth's title, a transition's proof, a
 * fact's whole body, a session's goal — and spread across those shapes as a
 * copied block a check is simply MISSING from whichever one nobody remembered.
 * On an append-only log that turns a refusable input into a permanent entry, so
 * failing at the door is the whole point: one function makes "every append is
 * screened" a property of the code instead of a habit.
 *
 * THE LIMIT COMES FIRST, AND IT IS NOT A PREFERENCE. Nothing capped the size of
 * a text field before this, and a single 5 MB event was accepted in 321 ms and
 * then cost 116.9 ms of replay on every rebuild afterwards — against 35.2 ms for
 * an entire archive of 3,508 events. Running the scrubber over that same field
 * costs 8.4 ms, three thousand times a typical append, so with no limit the
 * defense becomes the bottleneck it was added to survive. The limit runs first
 * and the scrubber only ever sees text of a bounded size.
 *
 * AND IT REFUSES RATHER THAN TRUNCATES. Truncating would drop the second half in
 * silence, which is the same fault as scrubbing in silence: the caller believes
 * it recorded something it did not. A refusal names the field and its size, so an
 * agent can split the record or record a pointer to the thing instead.
 *
 * THE LIMIT IS GENEROUS ON PURPOSE. Measured over a real archive, the largest
 * text field of any kind was a 153-character title. 64 KiB is four hundred times
 * that and holds a document of roughly ten thousand words, so the refusal is
 * reached by a program pasting a file, never by someone writing something down.
 */

import { type SecretClass, scrubSecrets } from './secrets.js';

/**
 * The most any single free-text field may weigh, in bytes of UTF-8 — the form the
 * chain stores, so the limit is measured in what it actually costs rather than in
 * characters (which would let a field of emoji weigh four times its count).
 */
export const FIELD_BYTE_LIMIT = 65_536;

/** A write refused because one field was over the limit; nothing was appended. */
export interface ContentTooLargeErr {
  readonly ok: false;
  readonly code: 'CONTENT_TOO_LARGE';
  readonly message: string;
}

/** The fields as they will be recorded, plus what was taken out of them. */
export interface ScreenedContent<T> {
  readonly ok: true;
  /**
   * The same fields, same keys, with every recognized credential replaced. This
   * is what the caller must build its event from — the point of the screen is
   * that the ORIGINAL never reaches the chain.
   */
  readonly fields: T;
  /**
   * One entry per value replaced, across every field. Empty when nothing was, and
   * a caller that reports it is what keeps the scrub from happening in silence.
   */
  readonly replaced: readonly SecretClass[];
}

/**
 * What a successful write reports about the text it screened — the half of every
 * write result that keeps a scrub from happening in silence.
 *
 * It travels on the SUCCESS, because a scrub is not a refusal: the fact WAS
 * recorded, with a placeholder where a credential used to be. The caller has to
 * be told, and told at the only moment it can still act — rotate the credential,
 * warn the person, record the thing again without it. Writing a different value
 * than the caller asked for and saying nothing would leave the next session
 * reading a placeholder with no idea why, and would leave a live credential
 * unrotated because nobody knew it had been typed.
 */
export interface ScreenedWrite {
  /** One entry per value replaced. Omitted entirely when the text was clean. */
  readonly replaced?: readonly SecretClass[];
}

/**
 * The {@link ScreenedWrite} half of a result, ready to spread: the classes when
 * something was replaced, nothing at all when the text was clean. Spreading it
 * keeps `replaced` ABSENT rather than an empty array on the ordinary write, so
 * "something was taken out" and "nothing was" stay distinguishable in the data
 * and not only in a length check.
 */
export function screened(replaced: readonly SecretClass[]): ScreenedWrite {
  return replaced.length > 0 ? { replaced } : {};
}

/** A field's value as it may enter the record: text, a list of text, or absent. */
type Screenable = string | readonly string[] | undefined;

/**
 * Screens the free-text fields of one append: refuses if any is over the limit,
 * otherwise returns them scrubbed together with what was replaced.
 *
 * Callers hand it the fields their event will carry, by the names the payload
 * uses, and build the payload from what comes back. The mapped constraint accepts
 * a literal (`{ title }`) and an existing shape alike (a transition's proof
 * fields), keeping the optionality of each key, so the result destructures
 * exactly like the input.
 *
 * An absent field stays absent: it is not text, so there is nothing to weigh and
 * nothing to clean. A LIST is weighed whole and scrubbed per item — a thousand
 * short links cost the chain what one long field does, and weighing each
 * separately would let the total past the limit unnoticed.
 *
 * It never throws. Every refusal is data, so a surface reports it the way it
 * reports the gate's own.
 */
export function screenContent<T extends { [K in keyof T]: Screenable }>(
  fields: T,
): ScreenedContent<T> | ContentTooLargeErr {
  const screened: Record<string, Screenable> = {};
  const replaced: SecretClass[] = [];

  for (const field of Object.keys(fields)) {
    const value = (fields as Record<string, Screenable>)[field];
    if (value === undefined) continue;

    if (typeof value === 'string') {
      const oversize = refuseIfOversize(field, byteLength(value));
      if (oversize !== undefined) return oversize;
      const scrubbed = scrubSecrets(value);
      replaced.push(...scrubbed.replaced);
      screened[field] = scrubbed.text;
      continue;
    }

    let bytes = 0;
    for (const item of value) bytes += byteLength(item);
    const oversize = refuseIfOversize(field, bytes);
    if (oversize !== undefined) return oversize;
    const items: string[] = [];
    for (const item of value) {
      const scrubbed = scrubSecrets(item);
      replaced.push(...scrubbed.replaced);
      items.push(scrubbed.text);
    }
    screened[field] = items;
  }

  // Every key the input carried with a value is present here, carrying the same
  // type it had; the keys that were absent are still absent. The cast states that
  // for the type system, which cannot follow a copy driven by `Object.keys`.
  return { ok: true, fields: screened as T, replaced };
}

/** The refusal a field over the limit earns, or undefined when it fits. */
function refuseIfOversize(field: string, bytes: number): ContentTooLargeErr | undefined {
  if (bytes <= FIELD_BYTE_LIMIT) return undefined;
  return {
    ok: false,
    code: 'CONTENT_TOO_LARGE',
    message:
      `"${field}" is ${bytes} bytes; a single field holds at most ${FIELD_BYTE_LIMIT}. ` +
      'Nothing was recorded — split it across several records, or record where it lives.',
  };
}

/** A string's weight in the form the chain stores it: bytes of UTF-8. */
function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}
