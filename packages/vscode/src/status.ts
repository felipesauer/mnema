/**
 * The status bar: what `mnema verify --json` says of the record and what `mnema switch` says of
 * the channels. The verdict is the CLI's; nothing is re-derived, and a CLI that cannot be read is
 * shown as unreadable rather than as fine.
 */

import { TIMEOUT_SECONDS } from './cli.js';

/** What the record's verification says, as far as it could be read. */
export type Verdict =
  | { readonly kind: 'verified'; readonly level: string }
  | { readonly kind: 'failed'; readonly level: string | undefined }
  | { readonly kind: 'unreadable' };

/**
 * The reading of `mnema verify --json`. The top `ok` says the command ran and found a project; the
 * verdict on the record is `record.ok` (the exit code of `mnema verify` follows it), so that is the
 * one read. Only an answer with no `record.ok` falls back to the top `ok`.
 */
export function readVerdict(stdout: string): Verdict {
  let answer: unknown;
  try {
    answer = JSON.parse(stdout);
  } catch {
    return { kind: 'unreadable' };
  }
  if (typeof answer !== 'object' || answer === null) return { kind: 'unreadable' };
  const { ok: top, record } = answer as { ok?: unknown; record?: unknown };
  const rec =
    typeof record === 'object' && record !== null ? (record as Record<string, unknown>) : {};
  const ok = typeof rec.ok === 'boolean' ? rec.ok : top;
  if (typeof ok !== 'boolean') return { kind: 'unreadable' };
  const level = typeof rec.level === 'string' ? rec.level : undefined;
  if (ok && level !== undefined) return { kind: 'verified', level };
  return ok ? { kind: 'unreadable' } : { kind: 'failed', level };
}

/** One channel of `mnema switch`, with whether it is on. */
export interface Channel {
  readonly name: string;
  readonly on: boolean;
}

const CHANNEL_LINE = /^ {2}(\S+) +(on|off)(?: |$)/;

/** The channels in the text of `mnema switch`: a line is `  <name>  on|off  <what it carries>`. */
export function readChannels(stdout: string): Channel[] {
  const channels: Channel[] = [];
  for (const line of stdout.split('\n')) {
    const match = CHANNEL_LINE.exec(line);
    if (match?.[1] !== undefined) channels.push({ name: match[1], on: match[2] === 'on' });
  }
  return channels;
}

/**
 * The oldest `mnema` the extension is written against: the commands it starts (`verify --json`,
 * `switch`, `rules --json`, `stack list --json`, `search ... --json`) are the ones that version
 * has. An older one is treated as not there, because its answers are not read back correctly.
 */
export const MIN_CLI_VERSION = '0.1.2';

/** Whether the command line can be run at all, and if not, in what words. */
export type CliState =
  | { readonly kind: 'ready' }
  | { readonly kind: 'missing'; readonly reason: string };

const VERSION_LINE = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.+-]*)?$/;

const parts = (version: string): number[] | undefined => {
  const match = VERSION_LINE.exec(version);
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
};

/** The reading of `mnema --version`: not started, not a mnema, or older than the floor, is missing. */
export function readCli(result: {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut?: true;
}): CliState {
  if (result.timedOut === true) {
    return { kind: 'missing', reason: `it did not answer in ${TIMEOUT_SECONDS} s` };
  }
  if (result.code === null) {
    const why = result.stderr.trim().split('\n')[0] ?? '';
    return { kind: 'missing', reason: why === '' ? 'it could not be started' : why };
  }
  const first = result.stdout.trim().split('\n')[0] ?? '';
  const found = result.code === 0 ? parts(first) : undefined;
  const floor = parts(MIN_CLI_VERSION) ?? [0, 0, 0];
  if (found === undefined) {
    return { kind: 'missing', reason: 'it did not answer `--version` as mnema does' };
  }
  for (let i = 0; i < 3; i++) {
    if ((found[i] ?? 0) !== (floor[i] ?? 0)) {
      if ((found[i] ?? 0) > (floor[i] ?? 0)) return { kind: 'ready' };
      return { kind: 'missing', reason: `version ${first} is older than ${MIN_CLI_VERSION}` };
    }
  }
  return { kind: 'ready' };
}

/** The command that opens the extension's container in the side bar: what a click on the bar does. */
export const CONTAINER_COMMAND = 'workbench.view.extension.mnema';

/**
 * The commands a link in the tooltip may run. The list is closed and holds no verb that judges a
 * decision: the tooltip is the one trusted markdown the extension shows, and part of what it
 * carries was written by the command line, which in turn carries what an agent wrote.
 */
export const TOOLTIP_COMMANDS: readonly string[] = [
  CONTAINER_COMMAND,
  'mnema.refresh',
  'workbench.action.openSettings',
];

/** The page that says what each channel carries. */
export const SWITCHES_PAGE = 'https://github.com/felipesauer/mnema/blob/main/docs/switches.md';

/** What is said of the decisions awaiting a judgment, for the badge, the tooltip and the screen reader. */
export const awaitingPhrase = (total: number): string =>
  total === 1 ? '1 decision awaits a judgment' : `${total} decisions await a judgment`;

/** What the status bar item shows and what a click on it does. */
export interface Bar {
  readonly text: string;
  /** Markdown, shown trusted for `TOOLTIP_COMMANDS` only and without HTML. */
  readonly tooltip: string;
  readonly accessibility: { readonly label: string; readonly role: 'button' };
  /** True when `mnema verify` failed: the bar then wears the theme's warning background. */
  readonly warning: boolean;
  readonly command: typeof CONTAINER_COMMAND;
}

const STRONG = new Set(['fully-signed', 'externally-witnessed']);

const iconFor = (verdict: Verdict): string =>
  verdict.kind === 'verified'
    ? STRONG.has(verdict.level)
      ? 'book'
      : 'info'
    : verdict.kind === 'failed'
      ? 'error'
      : 'question';

/**
 * Text that came from the command line or the record, made inert in markdown: every ASCII
 * punctuation mark is escaped (CommonMark allows it for all of them), so no `[x](command:...)`,
 * emphasis or tag survives, and a line break is a space.
 */
const plain = (text: string): string =>
  text.replace(/\r?\n/g, ' ').replace(/[!-/:-@[-`{-~]/g, '\\$&');

/** Lines as a code block, with a fence longer than any run of backticks inside them. */
function fenced(lines: readonly string[]): string {
  const longest = Math.max(0, ...(lines.join('\n').match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}\n${lines.join('\n')}\n${fence}`;
}

const two = (n: number): string => String(n).padStart(2, '0');

/** A link that opens the settings editor on one setting. */
const settingLink = (label: string, setting: string): string =>
  `[${label}](command:workbench.action.openSettings?${encodeURIComponent(JSON.stringify([setting]))})`;

/**
 * The item as a whole. The words about the record are the command line's: the level is what
 * `verify --json` reports, and the tooltip carries the lines `mnema verify` printed, in a code
 * block, as they came. The extension's own words are only about itself (the command is missing,
 * how many decisions await, when it read).
 */
export function describeBar(input: {
  readonly cli: CliState;
  readonly verdict: Verdict;
  readonly channels: readonly Channel[] | undefined;
  /** The lines `mnema verify` printed, and for a failure the issues it listed. */
  readonly printed: readonly string[];
  /** The decisions awaiting a judgment, as the command line counted them; undefined when not read. */
  readonly awaiting: number | undefined;
  readonly readAt: Date;
}): Bar {
  if (input.cli.kind === 'missing') {
    return {
      text: '$(warning) mnema not found',
      tooltip: [
        '**mnema** · command unavailable',
        `The mnema command could not be used: ${plain(input.cli.reason)}. Install @mnema/code, or set ${settingLink('mnema.command', 'mnema.command')} to the executable.`,
      ].join('\n\n'),
      accessibility: { label: 'mnema: command not found', role: 'button' },
      warning: false,
      command: CONTAINER_COMMAND,
    };
  }
  const { verdict } = input;
  const proof =
    verdict.kind === 'verified'
      ? verdict.level
      : verdict.kind === 'failed'
        ? 'verify failed'
        : 'verify unreadable';
  const awaiting = input.awaiting !== undefined && input.awaiting > 0 ? input.awaiting : undefined;
  const off = (input.channels ?? []).filter((c) => !c.on).map((c) => plain(c.name));
  const parts = [`**mnema** · ${plain(proof)}`];
  if (awaiting !== undefined) {
    parts.push(`[${awaitingPhrase(awaiting)}](command:${CONTAINER_COMMAND})`);
  }
  if (input.printed.length > 0) parts.push(fenced(input.printed));
  if (input.channels === undefined || input.channels.length === 0) {
    parts.push('Channels: not read.');
  } else if (off.length > 0) {
    parts.push(`Channels off: ${off.join(', ')} ([what they carry](${SWITCHES_PAGE}))`);
  } else {
    parts.push('Every channel is on.');
  }
  const at = `${two(input.readAt.getHours())}:${two(input.readAt.getMinutes())}:${two(input.readAt.getSeconds())}`;
  parts.push(
    `Read at ${at} · [Refresh](command:mnema.refresh) · ${settingLink('Settings', 'mnema.statusBar')}`,
  );
  const tail = awaiting === undefined ? '' : ` · ${awaiting} to judge`;
  return {
    text: `$(${iconFor(verdict)}) ${proof}${tail}`,
    tooltip: parts.join('\n\n'),
    accessibility: {
      label: `mnema: ${proof}${awaiting === undefined ? '' : `, ${awaitingPhrase(awaiting)}`}`,
      role: 'button',
    },
    warning: verdict.kind === 'failed',
    command: CONTAINER_COMMAND,
  };
}
