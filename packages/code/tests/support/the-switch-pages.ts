/**
 * What the switch table (`src/record-framing.ts`: `WHAT_STOPS`, `STARTS_OFF`, `flipCommand`)
 * generates on the pages: the table of `docs/switches.md`, the listing `docs/cli-reference.md`
 * shows for `mnema switch`, and the sentence of `plugin/README.md` that says which channels begin
 * off. `the-switch-pages-are-generated.test.ts` compares each page with what this makes.
 *
 * A page keeps its own prose: only what sits between a pair of markers is regenerated.
 */

import { neverSwitchedOn } from '../../src/presentation/switches.js';
import {
  flipCommand,
  STARTS_OFF,
  SWITCHABLE_CHANNELS,
  WHAT_STOPS,
} from '../../src/record-framing.js';

/** The pages that carry a generated part, by their path from the repository's root. */
export const SWITCH_PAGES = [
  'docs/switches.md',
  'docs/cli-reference.md',
  'plugin/README.md',
] as const;

/** A pair of markers and what goes between them for one page. */
interface Part {
  readonly begin: string;
  readonly end: string;
  readonly body: () => string;
  /** Whether the part is a block (set off by blank lines) or runs inside a line. */
  readonly inline: boolean;
}

const TABLE: Part = {
  begin:
    '<!-- The table below is generated from packages/code/src/record-framing.ts: edit the table there. -->',
  end: '<!-- End of the generated table. -->',
  body: () => switchTable(),
  inline: false,
};

const LISTING: Part = {
  begin:
    '<!-- The listing below is generated from packages/code/src/record-framing.ts: edit the table there. -->',
  end: '<!-- End of the generated listing. -->',
  body: () => ['```sh', 'mnema switch', listing(), '```'].join('\n'),
  inline: false,
};

const OFF_SENTENCE: Part = {
  begin: '<!-- generated: the channels that begin off -->',
  end: '<!-- end -->',
  body: () => offSentence(),
  inline: true,
};

/** Which part each page carries. */
const PARTS: Readonly<Record<(typeof SWITCH_PAGES)[number], Part>> = {
  'docs/switches.md': TABLE,
  'docs/cli-reference.md': LISTING,
  'plugin/README.md': OFF_SENTENCE,
};

/** The table of `docs/switches.md`: every channel, where it begins, what it carries, how to flip it. */
export function switchTable(): string {
  const rows = SWITCHABLE_CHANNELS.map((channel) => {
    const begins = STARTS_OFF.includes(channel) ? 'off' : 'on';
    return `| \`${channel}\` | ${begins} | ${WHAT_STOPS[channel]} | \`${flipCommand(channel)}\` |`;
  });
  return [
    '| Channel | Begins | What it carries | To flip it |',
    '| --- | :---: | --- | --- |',
    ...rows,
  ].join('\n');
}

/** A sentence of the table cut at its first colon, or at a word near 72 characters, then an ellipsis. */
function shortened(sentence: string): string {
  const colon = sentence.indexOf(':');
  const head = colon === -1 ? sentence : sentence.slice(0, colon);
  if (colon === -1 && sentence.length <= 72) return sentence;
  const cut = head.length <= 72 ? head : head.slice(0, head.lastIndexOf(' ', 72));
  return `${cut.replace(/[,;:\s]+$/, '')}${head.length <= 72 && colon !== -1 ? ':' : ''} …`;
}

/** What `mnema switch` prints in a project that never switched anything, as the reference shows it. */
export function listing(): string {
  const width = Math.max(...SWITCHABLE_CHANNELS.map((channel) => channel.length));
  const lines = SWITCHABLE_CHANNELS.map((channel) => {
    const off = STARTS_OFF.includes(channel);
    const tail = off ? ` · ${neverSwitchedOn(channel)}` : '';
    const text = shortened(WHAT_STOPS[channel]);
    return `#>   ${channel.padEnd(width)}  ${(off ? 'off' : 'on').padEnd(3)}  ${text}${tail}`;
  });
  return [
    `#> ${SWITCHABLE_CHANNELS.length} channel(s), looked in public, private, global:`,
    ...lines,
  ].join('\n');
}

const NUMBER_WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six'] as const;

/** The sentence of the plugin page that names the channels beginning off. */
export function offSentence(): string {
  const names = STARTS_OFF.map((channel) => `\`${channel}\``);
  const count = NUMBER_WORDS[names.length] ?? String(names.length);
  const list =
    names.length === 1
      ? (names[0] as string)
      : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  const verb = names.length === 1 ? 'is' : 'are';
  const them = names.length === 1 ? 'it' : 'them';
  return `All are on to begin with but ${count}: ${list}, below, ${verb} off until you switch ${them} on.`;
}

/** `page` with its generated part rewritten; a page without the markers is an error. */
export function generatedSwitchPage(
  path: (typeof SWITCH_PAGES)[number],
  committed: string,
): string {
  const part = PARTS[path];
  const from = committed.indexOf(part.begin);
  const to = committed.indexOf(part.end, from + 1);
  if (from === -1 || to < from) throw new Error(`${path} has no generated switch part`);
  const middle = part.inline ? ` ${part.body()} ` : `\n\n${part.body()}\n\n`;
  return `${committed.slice(0, from)}${part.begin}${middle}${committed.slice(to)}`;
}
