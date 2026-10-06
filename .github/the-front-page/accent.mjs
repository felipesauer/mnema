// The one accent of the front page, and the only saturated colour its pictures may use.
//
// The console's accent is magenta, SGR 35. The recordings are rendered by `agg` with its
// `github-dark` theme, whose palette paints that slot `#c4a0f5` (slot 5): that is the dark hex,
// the tone a reader already sees in every GIF. agg's `github-light` theme carries the same
// palette, and `#c4a0f5` on white is about 2:1; the other magenta the palette defines (slot 13,
// `#997dbf`, about 3.5:1 on white) is the light hex. A shields.io badge does not change with the
// theme, so it takes the light one.
//
// `draw.mjs` paints with these, and `packages/code/tests/the-front-page-is-drawn-from-the-console.test.ts`
// fails on any other saturated colour in `docs/assets/` or in a badge's `color=`.

/** The accent per theme of the page that shows the picture. */
export const ACCENT = Object.freeze({ dark: '#c4a0f5', light: '#997dbf' });
