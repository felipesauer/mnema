/**
 * The door every piece of free text goes through on its way into the record: one
 * size limit, then one scrub — which REDACTS a body and REFUSES a name.
 *
 * One function, for the reason the authority invariant is one function: the
 * shapes that need it are not alike — a birth's title, a transition's proof, a
 * fact's whole body, a session's goal, the ENVELOPE's executing agent — and
 * spread across those shapes as a copied block a check is simply MISSING from
 * whichever one nobody remembered. On an append-only log that turns a refusable
 * input into a permanent entry, so failing at the door is the whole point: one
 * function makes "every append is screened" a property of the code instead of a
 * habit. The agent name is the case that proves it: the first cut of this door
 * read "every free-text field" as "every free-text field of the payload", and
 * `which` — the one on the envelope, stamped on every event of a session — went
 * through unscreened while a payload-only sweep reported everything clean.
 *
 * WHICH FIELDS ARE HANDED IN IS THE CALLER'S CHOICE, and that is the one thing this
 * function cannot check. It screens what it is given; a field the caller never
 * passes is a field it never sees, and the test that drove every write point could
 * not tell the difference — measured, when an added `alternatives` bypassed this
 * door and the whole suite stayed green. What answers for the selection now is the
 * field classification (`fields.ts`) and the guard derived from it
 * (`every-field.test.ts`), which poison every field the catalog declares the caller's
 * and read the chain back. The selection stays the caller's; forgetting one no
 * longer passes in silence — and the KEYS are no longer the caller's at all, since a
 * key the classification does not answer for does not compile (see `ScreenedKey`).
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
 * REPLACING MEANS DIFFERENT THINGS IN DIFFERENT FIELDS, and this door used to treat
 * every field it was handed alike: refuse on size, replace on a credential. The
 * premise that made that right was that a screened field is still the field. A NAME
 * falsified it. A body with the credential replaced is still the fact — the decision
 * still says what was decided, and the credential did not enter. A name with the
 * credential replaced is a DIFFERENT ENTITY wearing the same id: `<SECRET:slack-token>`
 * is not the skill somebody created, every reading that keys on the name now misses,
 * and on an append-only log the name is gone for good. So a credential in a name is
 * REFUSED before anything is appended, and the person — who, unlike the author of an
 * imported document, is right here — is told the class and the field and can write it
 * again under a name.
 *
 * WHICH FIELDS ARE WHICH IS NOT DECIDED HERE. This door asks `screensAsAName`, and
 * that answer is folded from the field classification (`fields.ts`) that already had
 * to be total over the catalog. A second list of name-fields kept beside the door
 * would be a second enumeration of the catalog's fields, which is the precise shape
 * of the defect that classification exists to prevent. What the two share is
 * `ScreenedKey`: the keys this function accepts ARE the classified ones, as a type, so
 * a field nobody classified cannot be handed in at all.
 *
 * AND THE VALUE NEVER TRAVELS. The refusal carries the class and the field and
 * nothing else — not the value, not a prefix of it, not a digest. A message is printed
 * to a terminal, logged by a host and pasted into an issue; a refusal that quoted what
 * it refused would be the disclosure it exists to prevent.
 *
 * THE LIMIT IS GENEROUS ON PURPOSE. Measured over a real archive, the largest
 * text field of any kind was a 153-character title. 64 KiB is four hundred times
 * that and holds a document of roughly ten thousand words, so the refusal is
 * reached by a program pasting a file, never by someone writing something down.
 */

import { type ScreenedKey, screensAsAName } from './fields.js';
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

/**
 * A write refused because a field the record is ADDRESSED by carried something shaped
 * like a credential; nothing was appended.
 *
 * It is a refusal and not a scrub because the two are not interchangeable in a name —
 * see the module comment. The class and the field are in the MESSAGE and nowhere else:
 * the shape is `{ ok, code, message }` like every other refusal in the product, so a
 * surface reports it with the one line it already has. Carrying them as data too would
 * be two readings of one refusal with no caller for the second (the surfaces print
 * `Refused (CODE): message`), and the extra key collided with the gate's own `field`
 * where both refusals share a union. Neither the message nor the code carries the value.
 */
export interface NameHoldsASecretErr {
  readonly ok: false;
  readonly code: 'NAME_HOLDS_A_SECRET';
  readonly message: string;
}

/**
 * Either way this door says no. One name for the pair, because every caller of
 * {@link screenContent} propagates both identically — it has nothing to add to either
 * — and a union spelled out at each of them is a place to forget the second.
 */
export type ScreenRefusal = ContentTooLargeErr | NameHoldsASecretErr;

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
 * Screens the free-text fields of one append: refuses if any is over the limit or if
 * a NAME carries a credential, otherwise returns them with every credential in a BODY
 * replaced, together with what was replaced.
 *
 * Callers hand it the fields their event will carry, by the names the payload
 * uses, and build the payload from what comes back. The mapped constraint accepts
 * a literal (`{ title }`) and an existing shape alike (a transition's proof
 * fields), keeping the optionality of each key, so the result destructures
 * exactly like the input.
 *
 * THE KEYS ARE A CLOSED UNION, not strings. Every key must be one the field
 * classification answers for ({@link ScreenedKey}), so handing this door a field
 * nobody classified is a compile error rather than a field silently treated as a
 * body. That is the elo between the two: the classification decides name-or-body, and
 * the type is what stops a caller from asking under a key it never classified. The
 * transition proof meets it at the leaf — `fields.reason` is classified, `reason` is
 * handed in — and a subject is handed in AS `subject`, whatever the operation's own
 * input calls it, because that is the key the classification answers under.
 *
 * An absent field stays absent: it is not text, so there is nothing to weigh and
 * nothing to clean. A LIST is weighed whole and scrubbed per item — a thousand
 * short links cost the chain what one long field does, and weighing each
 * separately would let the total past the limit unnoticed.
 *
 * It never throws. Every refusal is data, so a surface reports it the way it
 * reports the gate's own.
 */
export function screenContent<
  T extends { [K in keyof T]: Screenable } & { [K in Exclude<keyof T, ScreenedKey>]: never },
>(fields: T): ScreenedContent<T> | ScreenRefusal {
  const screened: Record<string, Screenable> = {};
  const replaced: SecretClass[] = [];

  for (const field of Object.keys(fields)) {
    const value = (fields as Record<string, Screenable>)[field];
    if (value === undefined) continue;
    // Asked once per field, before either branch: the answer is what the branch does
    // with a match, and the size pass below is the same either way.
    const isName = screensAsAName(field);

    if (typeof value === 'string') {
      const oversize = refuseIfOversize(field, byteLength(value));
      if (oversize !== undefined) return oversize;
      const scrubbed = scrubSecrets(value);
      if (isName) {
        // The name is carried through UNCHANGED when it is clean, byte for byte — the
        // scrub's own contract when nothing matched — and the whole write is refused
        // when it is not. There is no third outcome: a partly-redacted name is the
        // corrupted identity this branch exists to prevent.
        if (scrubbed.replaced.length > 0) return refuseNamedSecret(field, scrubbed.replaced);
        screened[field] = value;
        continue;
      }
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
      // A list-valued name is refused on its FIRST dirty item, for the reason a
      // string-valued one is: the list is the address, and an address with one member
      // replaced names a different set. No field of the catalog is both a name and a
      // list today; this is what the door does the day one is declared, rather than a
      // case it would fall through.
      if (isName) {
        if (scrubbed.replaced.length > 0) return refuseNamedSecret(field, scrubbed.replaced);
        items.push(item);
        continue;
      }
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

/**
 * The refusal a name carrying a credential earns.
 *
 * The classes are de-duplicated and named in the order {@link scrubSecrets} applied
 * them, so a name matching one class twice reads as one class. The message says what
 * to do, because "refused" without a next step sends an agent to try the same value
 * again: the two ways out are a different name, or rotating the value. It quotes the
 * FIELD and never the value.
 */
function refuseNamedSecret(field: string, found: readonly SecretClass[]): NameHoldsASecretErr {
  const classes = [...new Set(found)].join(', ');
  return {
    ok: false,
    code: 'NAME_HOLDS_A_SECRET',
    message:
      `"${field}" reads as ${classes}, and it is a name the record is addressed by — ` +
      'so replacing it would record a different entity, not a redacted one. Nothing was ' +
      'recorded. Name it something else; if the value itself matters, rotate it.',
  };
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
