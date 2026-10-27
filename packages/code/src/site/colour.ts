/**
 * The colour arithmetic the record page's palette is calculated with: WCAG 2 contrast, a mix in
 * sRGB, and the darker accent small text needs.
 *
 * THIS IS THE RULE THE SITE'S THEME ALREADY APPLIES (`textAccent` in the site's build): the
 * smallest share, in steps of 1%, of the other theme's ground mixed into the accent that reads at the
 * floor or better on EVERY ground the text sits on, and a build that cannot find one stops. The
 * site builds in a tree with its own lockfile that the product does not ship, so the rule is
 * written again here, in the product, and `colour.test.ts` holds the two to the same answers over
 * the real inputs and over a spread of others: a second copy that is checked against the first is
 * the form this repository accepts for a rule that has to live on both sides of that boundary.
 */

const channelsOf = (hex: string): number[] =>
  [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

const hexOf = (rgb: readonly number[]): string =>
  `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;

/** `from` taken `share` (0 to 1) of the way toward `toward`, channel by channel in sRGB. */
export function mix(from: string, toward: string, share: number): string {
  const [a, b] = [channelsOf(from), channelsOf(toward)];
  return hexOf(a.map((c, i) => Math.round(c + ((b[i] ?? 0) - c) * share)));
}

/** WCAG 2 contrast ratio of two `#rrggbb` colours. */
export function contrastOf(one: string, other: string): number {
  const luminance = (hex: string): number => {
    const [r, g, b] = channelsOf(hex).map((c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  };
  const [hi, lo] = [luminance(one), luminance(other)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/**
 * The colour of accent text: the smallest share (in steps of 1%) of `toward` mixed into `ink`
 * that reads at `floor` or better on EVERY one of `grounds`. Throws when no share does, so a
 * theme whose grounds cannot carry the accent stops the build instead of shipping unreadable text.
 */
export function textAccent(options: {
  readonly ink: string;
  readonly toward: string;
  readonly grounds: readonly string[];
  readonly floor: number;
}): string {
  const { ink, toward, grounds, floor } = options;
  for (let percent = 0; percent <= 100; percent++) {
    const colour = mix(ink, toward, percent / 100);
    if (grounds.every((ground) => contrastOf(colour, ground) >= floor)) return colour;
  }
  throw new Error(`no mix of ${ink} toward ${toward} reads at ${floor}:1 on ${grounds.join(', ')}`);
}
