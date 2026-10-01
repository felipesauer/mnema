// . What wide text costs the measure of a line, against ASCII of the same code-point count.
//   node wide-text-cost.mjs <repo-root>
// In-process, on the built modules. Every text is unique (a counter prefix) so the memo of
// `widthOfText` cannot answer; the arms are alternated block by block; a third arm (ASCII against
// ASCII) is the control that identical work must tie on.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const root = process.argv[2];
const { widthOfText, glyphsOf } = await import(pathToFileURL(join(root, 'packages/code/dist/presentation/width.js')).href);

const { rowsForTheLine } = await import(pathToFileURL(join(root, 'packages/code/dist/repl/scrolling.js')).href);

const LENGTH = 80; // code points per line
const PER_BLOCK = 600;
const BLOCKS = 31;
const WIDE = [...'二列を折り返すために必要になるほど長い題名の記録は決定事項として残される日本語の文章'];
const ASCII = [...'the quick brown fox jumps over the lazy dog while a record is being kept safe'];
let counter = 0;
const unique = () => String(counter++).padStart(6, '0');
const line = (alphabet) => {
  const tag = unique();
  let out = tag;
  for (let i = tag.length; i < LENGTH; i++) out += alphabet[(i + counter) % alphabet.length];
  return out;
};
const make = (alphabet) => Array.from({ length: PER_BLOCK }, () => line(alphabet));
const time = (fn, texts) => {
  const start = process.hrtime.bigint();
  let sink = 0;
  for (const text of texts) sink += fn(text);
  const spent = Number(process.hrtime.bigint() - start);
  if (sink < 0) console.log(sink);
  return spent;
};
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
// cold: every text is new to the memo. warm: the same texts asked a second time, which is what a
// console does on every frame it re-walks the roll (the memo answers, by the text).
const fns = {
  widthOfText_cold: { fn: (t) => widthOfText(t) },
  glyphsOf_cold: { fn: (t) => glyphsOf(t).length },
  rowsForTheLine_cold: { fn: (t) => rowsForTheLine(t, 78) },
  rowsForTheLine_warm: { fn: (t) => rowsForTheLine(t, 78), warm: true },
};
const out = {};
for (const [name, { fn, warm }] of Object.entries(fns)) {
  const ratios = [];
  const ties = [];
  const asciiNs = [];
  const wideNs = [];
  for (let block = 0; block < BLOCKS; block++) {
    const a = make(ASCII);
    const a2 = make(ASCII);
    const w = make(WIDE);
    const order = block % 2 === 0 ? ['a', 'w', 'a2'] : ['a2', 'w', 'a'];
    const got = {};
    for (const arm of order) {
      const texts = arm === 'a' ? a : arm === 'a2' ? a2 : w;
      if (warm) time(fn, texts);
      got[arm] = time(fn, texts);
    }
    ratios.push(got.w / got.a);
    ties.push(got.a2 / got.a);
    asciiNs.push(got.a / PER_BLOCK);
    wideNs.push(got.w / PER_BLOCK);
  }
  out[name] = {
    wide_over_ascii: +median(ratios).toFixed(2),
    control_ascii_over_ascii: +median(ties).toFixed(2),
    ns_per_line_ascii: Math.round(median(asciiNs)),
    ns_per_line_wide: Math.round(median(wideNs)),
    ratio_range: [+Math.min(...ratios).toFixed(2), +Math.max(...ratios).toFixed(2)],
  };
}
console.log(JSON.stringify({ load: (await import('node:fs')).readFileSync('/proc/loadavg', 'utf8').split(' ')[0], lineCodePoints: LENGTH, blocks: BLOCKS, perBlock: PER_BLOCK, ...out }, null, 1));
