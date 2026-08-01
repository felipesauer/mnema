/**
 * How a pattern's consultations are worded, wherever one is reported.
 *
 * `skills` audits every pattern and `show` opens one, and both have to say the same
 * number the same way. Two readings wording it twice is two wordings, and the second
 * one to change would be the one nobody noticed — the argument this module shares
 * with `runs.ts`, for the same reason.
 *
 * IT IS ALWAYS SAID, including when the answer is none. A pattern nobody has opened
 * is the interesting case for a person deciding whether a pattern deserves to be one,
 * and a field that disappeared when the count was zero would leave them inferring
 * from a gap: was it never read, or does this verb not report it? For a pattern that
 * was never adopted the answer is a tautology (nothing serves an unadopted pattern,
 * so nothing consults it) and it is printed anyway — a uniform line costs a reader
 * nothing, and a line that is sometimes there costs them the question of why.
 *
 * It says CONSULTED, never "used" or "followed". The fact behind it records that a
 * session was served the body; whether the work then went the pattern's way is not
 * observable from here, and a wording that implied it would claim what nothing proves.
 */

/** How a pattern's consultations read on a line: the count, in runs. */
export function consultedLine(runs: number): string {
  return runs === 0 ? 'never consulted' : `consulted in ${runs} run(s)`;
}
