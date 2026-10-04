/**
 * The status bar: what `mnema verify --json` says of the record and what `mnema switch` says of
 * the channels. The verdict is the CLI's; nothing is re-derived, and a CLI that cannot be read is
 * shown as unreadable rather than as fine.
 */

/** What the record's verification says, as far as it could be read. */
export type Verdict =
  | { readonly kind: 'verified'; readonly level: string }
  | { readonly kind: 'failed'; readonly level: string | undefined }
  | { readonly kind: 'unreadable' };

/** The reading of `mnema verify --json`; its exit code is not needed, the answer carries `ok`. */
export function readVerdict(stdout: string): Verdict {
  let answer: unknown;
  try {
    answer = JSON.parse(stdout);
  } catch {
    return { kind: 'unreadable' };
  }
  if (typeof answer !== 'object' || answer === null) return { kind: 'unreadable' };
  const { ok, record } = answer as { ok?: unknown; record?: unknown };
  if (typeof ok !== 'boolean') return { kind: 'unreadable' };
  const level =
    typeof record === 'object' &&
    record !== null &&
    typeof (record as { level?: unknown }).level === 'string'
      ? (record as { level: string }).level
      : undefined;
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
