/**
 * The name an agent key is enrolled under, as this product's doors let it through.
 *
 * The FORMAT allows any canonical name that is not the identity it is enrolled into (section 6.2),
 * and a reader holds a record to no more than that. The doors are narrower on purpose: the name is
 * also the directory the agent's key lives in (`<data directory>/agents/<name>/`), so it is a
 * lower-case word with dots, dashes and underscores inside, at most 64 characters, and starts with a
 * letter or a digit — nothing that reads as a path, a flag, an option, or another identity (`mnid:`
 * has a colon, which the set does not hold).
 */

/** What a name enrolled through a door of this product looks like. */
export const AGENT_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * Why `name` is not an agent name this product enrols, or `undefined` when it is one.
 *
 * The sentence does not carry the value: it is what the caller typed, or what a request carried,
 * and it can hold anything, so what is said is the form, and the caller already has what it gave.
 */
export function agentNameRefusal(name: string): string | undefined {
  if (AGENT_NAME.test(name)) return undefined;
  return (
    'that is not a name an agent key is enrolled under: it is a lower-case word of letters, digits, ' +
    'dots, dashes and underscores, 1 to 64 characters, starting with a letter or a digit ' +
    '(it is also the folder the agent key lives in)'
  );
}
