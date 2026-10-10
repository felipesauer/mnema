/**
 * The closed forms a stack name and a version label take in the record.
 *
 * The write door refuses what is not in them (`stack-operations.ts`), and a reader that prints
 * either checks the same predicate, so that a fact appended past the door cannot carry text of
 * its own into a session: one rule, written once, for both sides.
 */

/** The stack-name form: lower-case ASCII letters and digits, joined by single hyphens. */
const STACK_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const STACK_NAME_MAX = 64;

/** A version's characters, starting with a letter or a digit. */
const STACK_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]*$/;
const STACK_VERSION_MAX = 64;

/** Whether `text` is a stack name in the form the record admits. */
export function isStackName(text: string): boolean {
  return STACK_NAME.test(text) && text.length <= STACK_NAME_MAX;
}

/** Whether `text` is a version label in the form the record admits. */
export function isStackVersion(text: string): boolean {
  return STACK_VERSION.test(text) && text.length <= STACK_VERSION_MAX;
}
