/** The key types Node names whose name is said starting on a vowel sound: ec, ar-ess-ay, ed, ex. */
const BEGINS_WITH_A_VOWEL_SOUND: ReadonlySet<string> = new Set([
  'ec',
  'rsa',
  'rsa-pss',
  'ed448',
  'x25519',
  'x448',
]);

/** The kind of a key as one says it: an EC key, an RSA key, an ed448 key, a dsa key. */
export function nameOfAKeyKind(kind: string): string {
  const said = kind === 'ec' || kind === 'rsa' ? kind.toUpperCase() : kind;
  return `${BEGINS_WITH_A_VOWEL_SOUND.has(kind) ? 'an' : 'a'} ${said} key`;
}
