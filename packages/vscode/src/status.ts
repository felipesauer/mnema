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

/** The text of the status bar item. */
export function statusText(verdict: Verdict, channels: readonly Channel[] | undefined): string {
  const proof =
    verdict.kind === 'verified'
      ? verdict.level
      : verdict.kind === 'failed'
        ? 'verify failed'
        : 'verify unreadable';
  if (channels === undefined || channels.length === 0) return `mnema: ${proof}`;
  const off = channels.filter((c) => !c.on).length;
  return `mnema: ${proof} · ${off} of ${channels.length} channels off`;
}

/** What the status bar says when hovered: the channels off, by name. */
export function statusTooltip(channels: readonly Channel[] | undefined): string {
  if (channels === undefined || channels.length === 0) return 'channels: not read';
  const off = channels.filter((c) => !c.on).map((c) => c.name);
  return off.length === 0 ? 'every channel is on' : `off: ${off.join(', ')}`;
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

/** What the status bar item shows and what a click on it does. */
export interface Bar {
  readonly text: string;
  readonly tooltip: string;
  readonly accessibility: { readonly label: string; readonly role: 'button' };
  readonly action: 'refresh' | 'settings';
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
 * The item as a whole. The words about the record are the command line's: the level is what
 * `verify --json` reports and the tooltip's first part is the text `mnema verify` printed, lines
 * and all. The extension's own words are only about itself (the command is missing, the coverage
 * was not read).
 */
export function describeBar(input: {
  readonly cli: CliState;
  readonly verdict: Verdict;
  readonly channels: readonly Channel[] | undefined;
  readonly coverage: string | undefined;
}): Bar {
  if (input.cli.kind === 'missing') {
    return {
      text: '$(warning) mnema: command not found',
      tooltip: `The mnema command could not be used: ${input.cli.reason}. Install @mnema/code, or set mnema.command to the executable. Click to open that setting.`,
      accessibility: { label: 'mnema: command not found', role: 'button' },
      action: 'settings',
    };
  }
  const text = statusText(input.verdict, input.channels);
  const coverage = (input.coverage ?? '').trim();
  return {
    text: `$(${iconFor(input.verdict)}) ${text}`,
    tooltip: `${coverage === '' ? 'what this level covers: not read' : coverage}\n\n${statusTooltip(input.channels)}`,
    accessibility: { label: text.replace(' · ', ', '), role: 'button' },
    action: 'refresh',
  };
}
