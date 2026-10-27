import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  awaitingPhrase,
  CONTAINER_COMMAND,
  describeBar,
  MIN_CLI_VERSION,
  readChannels,
  readCli,
  readVerdict,
  SWITCHES_PAGE,
  TOOLTIP_COMMANDS,
  type Verdict,
} from './status.js';

/** What `mnema verify --json` really printed (HOME in a temp folder): an intact record, one with a line altered, and an empty `.mnema`. */
const printed = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8');

const SWITCH = [
  '9 channel(s), looked in public, private, global:',
  '  brief-document         on   the document `mnema brief` prints',
  '  edit-first-write-gate  off  the hold on the first write  ·  off until switched on: `mnema switch on edit-first-write-gate`',
  '  user-corrections       off  the proposals recorded from what a person typed',
  '  session-tally          on   the line a session prints',
].join('\n');

describe('the verdict of the record, as `mnema verify --json` says it', () => {
  it('reads a record that verifies, with its level', () => {
    const json = JSON.stringify({ ok: true, record: { ok: true, level: 'fully-signed' } });
    expect(readVerdict(json)).toEqual({ kind: 'verified', level: 'fully-signed' });
  });

  it('reads a record that does not verify, with the level when there is one', () => {
    expect(readVerdict('{"ok": false, "record": {"ok": false, "level": "chained"}}')).toEqual({
      kind: 'failed',
      level: 'chained',
    });
    expect(readVerdict('{"ok": false}')).toEqual({ kind: 'failed', level: undefined });
  });

  it("reads what the command really printed: the verdict is the record's, not the top ok", () => {
    expect(readVerdict(printed('verify-intact'))).toEqual({
      kind: 'verified',
      level: 'fully-signed',
    });
    // Both of these have a top-level ok: true, and `mnema verify` exits 1 on them.
    expect(readVerdict(printed('verify-tampered'))).toEqual({
      kind: 'failed',
      level: 'unreadable',
    });
    expect(readVerdict(printed('verify-empty-folder'))).toEqual({
      kind: 'failed',
      level: 'broken',
    });
  });

  it('never reads a verdict out of what is not one', () => {
    expect(readVerdict('')).toEqual({ kind: 'unreadable' });
    expect(readVerdict('{"ok": "yes"}')).toEqual({ kind: 'unreadable' });
    expect(readVerdict('{"ok": true}')).toEqual({ kind: 'unreadable' });
    expect(readVerdict('null')).toEqual({ kind: 'unreadable' });
  });
});

describe('the channels, as `mnema switch` lists them', () => {
  it('reads each line that is a channel and nothing else', () => {
    expect(readChannels(SWITCH)).toEqual([
      { name: 'brief-document', on: true },
      { name: 'edit-first-write-gate', on: false },
      { name: 'user-corrections', on: false },
      { name: 'session-tally', on: true },
    ]);
  });

  it('reads none out of a refusal', () => {
    expect(readChannels('No mnema record here.\n')).toEqual([]);
  });
});

const COVERAGE =
  'public: local integrity verified (T1/T2/T4); external witness (T3): not covered, nothing outside this machine attests this record';
const READY = { kind: 'ready' } as const;
const channelsOn = readChannels(SWITCH);
const AT = new Date(2026, 9, 27, 14, 3, 9);

describe('whether the mnema command line can be run at all', () => {
  const answer = (code: number | null, stdout = '', stderr = '') => ({ code, stdout, stderr });

  it('is ready when it answers a version at or above the floor', () => {
    expect(readCli(answer(0, `${MIN_CLI_VERSION}\n`))).toEqual({ kind: 'ready' });
    expect(readCli(answer(0, '0.9.0\n'))).toEqual({ kind: 'ready' });
    expect(readCli(answer(0, '1.0.0-beta.2\n'))).toEqual({ kind: 'ready' });
  });

  it('is missing when it could not be started, and says why in the words the system gave', () => {
    const missing = readCli(answer(null, '', 'spawn mnema ENOENT\n'));
    expect(missing.kind).toBe('missing');
    expect(missing.kind === 'missing' && missing.reason).toContain('spawn mnema ENOENT');
  });

  it('is missing when what ran is not a mnema that names its version', () => {
    expect(readCli(answer(1, '', 'nope')).kind).toBe('missing');
    expect(readCli(answer(0, 'hello\n')).kind).toBe('missing');
    expect(readCli(answer(0, '')).kind).toBe('missing');
  });

  it('says a command that did not answer in time did not answer, not that it was not found', () => {
    const slow = readCli({ code: null, stdout: '', stderr: 'Command failed', timedOut: true });
    expect(slow).toEqual({ kind: 'missing', reason: 'it did not answer in 60 s' });
    const bar = describeBar({
      cli: slow,
      verdict: { kind: 'unreadable' },
      channels: undefined,
      printed: [],
      awaiting: undefined,
      readAt: AT,
    });
    expect(bar.tooltip).toContain('it did not answer in 60 s');
    expect(bar.tooltip).not.toContain('not found');
  });

  it('is missing when the version is below the floor, naming both', () => {
    const old = readCli(answer(0, '0.0.9\n'));
    expect(old.kind).toBe('missing');
    expect(old.kind === 'missing' && old.reason).toContain('0.0.9');
    expect(old.kind === 'missing' && old.reason).toContain(MIN_CLI_VERSION);
  });
});

const bar = (
  verdict: Verdict,
  more: Partial<Parameters<typeof describeBar>[0]> = {},
): ReturnType<typeof describeBar> =>
  describeBar({
    cli: READY,
    verdict,
    channels: channelsOn,
    printed: [COVERAGE],
    awaiting: undefined,
    readAt: AT,
    ...more,
  });
const STRONG: Verdict = { kind: 'verified', level: 'fully-signed' };
const WEAK: Verdict = { kind: 'verified', level: 'hash-chain-only' };
const FAILED: Verdict = { kind: 'failed', level: 'broken' };
const UNREADABLE: Verdict = { kind: 'unreadable' };

describe('the status bar item: the level and what awaits, short, with the detail in the tooltip', () => {
  it('says the level, then what awaits a judgment, by the same number as the badge', () => {
    expect(bar(STRONG).text).toBe('$(book) fully-signed');
    expect(bar(STRONG, { awaiting: 2 }).text).toBe('$(book) fully-signed · 2 to judge');
    expect(bar({ kind: 'verified', level: 'externally-witnessed' }, { awaiting: 1 }).text).toBe(
      '$(book) externally-witnessed · 1 to judge',
    );
    expect(bar(WEAK, { awaiting: 3 }).text).toBe('$(info) hash-chain-only · 3 to judge');
    expect(bar(FAILED).text).toBe('$(error) verify failed');
    expect(bar(FAILED, { awaiting: 2 }).text).toBe('$(error) verify failed · 2 to judge');
    expect(bar(UNREADABLE).text).toBe('$(question) verify unreadable');
    expect(bar(UNREADABLE, { awaiting: 1 }).text).toBe(
      '$(question) verify unreadable · 1 to judge',
    );
    // Nothing to count, or not counted: no suffix.
    expect(bar(STRONG, { awaiting: 0 }).text).toBe('$(book) fully-signed');
  });

  it('keeps the text short whatever the state: no channel count, at most 40 characters before the icon is drawn', () => {
    const longest = [STRONG, WEAK, FAILED, UNREADABLE]
      .flatMap((v) => [bar(v), bar(v, { awaiting: 250 })])
      .map((b) => b.text.replace(/^\$\([a-z-]+\) /, ''));
    for (const text of longest) expect(text).not.toMatch(/channels? off/);
    expect(Math.max(...longest.map((t) => t.length))).toBeLessThanOrEqual(40);
  });

  it('shows a codicon that follows the verdict, and never a seal of verification', () => {
    expect(bar(STRONG).text).toMatch(/^\$\(book\) /);
    expect(bar(WEAK).text).toMatch(/^\$\(info\) /);
    for (const name of ['verify-tampered', 'verify-empty-folder']) {
      expect(bar(readVerdict(printed(name))).text).toMatch(/^\$\(error\) verify failed/);
    }
    expect(bar(UNREADABLE).text).toMatch(/^\$\(question\) /);
    for (const verdict of [
      STRONG,
      { kind: 'verified', level: 'externally-witnessed' },
      FAILED,
      UNREADABLE,
    ] as const) {
      expect(bar(verdict).text).not.toMatch(/\$\((verified|pass|shield|check|workspace-trusted)/);
    }
  });

  it('wears the warning background only when mnema verify failed', () => {
    expect(bar(FAILED).warning).toBe(true);
    expect(bar(readVerdict(printed('verify-tampered'))).warning).toBe(true);
    for (const verdict of [STRONG, WEAK, UNREADABLE]) expect(bar(verdict).warning).toBe(false);
  });

  it('opens the container on a click, in every state, the missing command included', () => {
    for (const verdict of [STRONG, WEAK, FAILED, UNREADABLE]) {
      expect(bar(verdict).command).toBe('workbench.view.extension.mnema');
    }
    const missing = describeBar({
      cli: { kind: 'missing', reason: 'spawn mnema ENOENT' },
      verdict: UNREADABLE,
      channels: undefined,
      printed: [],
      awaiting: undefined,
      readAt: AT,
    });
    expect(missing.command).toBe(CONTAINER_COMMAND);
    expect(missing.warning).toBe(false);
  });

  it('gives a screen reader the whole sentence, not the abbreviation', () => {
    expect(bar(STRONG).accessibility).toEqual({ label: 'mnema: fully-signed', role: 'button' });
    expect(bar(STRONG, { awaiting: 2 }).accessibility.label).toBe(
      'mnema: fully-signed, 2 decisions await a judgment',
    );
    expect(bar(WEAK, { awaiting: 1 }).accessibility.label).toBe(
      'mnema: hash-chain-only, 1 decision awaits a judgment',
    );
    expect(bar(FAILED).accessibility.label).toBe('mnema: verify failed');
    expect(bar(UNREADABLE, { awaiting: 3 }).accessibility.label).toBe(
      'mnema: verify unreadable, 3 decisions await a judgment',
    );
  });

  it('says the command is missing instead of a verdict, and says why and what to set', () => {
    const missing = describeBar({
      cli: { kind: 'missing', reason: 'spawn mnema ENOENT' },
      verdict: UNREADABLE,
      channels: undefined,
      printed: [],
      awaiting: undefined,
      readAt: AT,
    });
    expect(missing.text).toBe('$(warning) mnema not found');
    expect(missing.tooltip).toContain('spawn mnema ENOENT');
    expect(missing.tooltip).toContain('command:workbench.action.openSettings?');
    expect(missing.tooltip).toContain(encodeURIComponent('["mnema.command"]'));
    expect(missing.accessibility.label).toBe('mnema: command not found');
  });
});

describe('the tooltip', () => {
  it('lays out the level, what awaits, what mnema verify printed, the channels off, when it was read and the links', () => {
    expect(bar(STRONG, { awaiting: 2 }).tooltip).toBe(
      [
        '**mnema** · fully\\-signed',
        `[2 decisions await a judgment](command:${CONTAINER_COMMAND}) · [What to do](command:mnema.whatToDo)`,
        `\`\`\`\n${COVERAGE}\n\`\`\``,
        `Channels off: edit\\-first\\-write\\-gate, user\\-corrections ([what they carry](${SWITCHES_PAGE}))`,
        `Read at 14:03:09 · [Refresh](command:mnema.refresh) · [Settings](command:workbench.action.openSettings?${encodeURIComponent('["mnema.statusBar"]')})`,
      ].join('\n\n'),
    );
  });

  it('says a failure with the lines the command line printed, and no line of its own that judges', () => {
    const lines = [
      'public: local integrity FAILED: see issues',
      'issue [T1] tail#3: entry hash mismatch',
    ];
    const tip = bar(FAILED, { printed: lines }).tooltip;
    expect(tip).toContain('**mnema** · verify failed');
    expect(tip).toContain(`\`\`\`\n${lines.join('\n')}\n\`\`\``);
  });

  it('says the channels were not read, or that every one is on, and invents nothing', () => {
    expect(bar(STRONG, { channels: undefined }).tooltip).toContain('Channels: not read.');
    expect(
      bar(STRONG, { channels: channelsOn.map((c) => ({ ...c, on: true })) }).tooltip,
    ).toContain('Every channel is on.');
    expect(bar(STRONG, { printed: [] }).tooltip).not.toContain('```');
  });

  it('makes text from the command line inert: a channel or a line that carries a command link is not a link', () => {
    const hostile = '[judge](command:mnema.accept)';
    const tip = bar(STRONG, {
      channels: [{ name: hostile, on: false }],
      printed: [`${hostile} \`\`\` <b>x</b>`],
    }).tooltip;
    const outside = tip.replace(/(`{3,})\n[\s\S]*?\n\1/g, '');
    expect(outside).toContain('\\[judge\\]\\(command\\:mnema\\.accept\\)');
    expect(outside).not.toContain('[judge](command:mnema.accept)');
    // The fence is longer than the run of backticks inside it, so the block does not end early.
    expect(tip).toContain(`\`\`\`\`\n${hostile} \`\`\` <b>x</b>\n\`\`\`\``);
    const reason = describeBar({
      cli: { kind: 'missing', reason: `${hostile} <i>x</i>\nsecond line` },
      verdict: UNREADABLE,
      channels: undefined,
      printed: [],
      awaiting: undefined,
      readAt: AT,
    }).tooltip;
    expect(reason).not.toContain('[judge](command:mnema.accept)');
    expect(reason).not.toContain('<i>');
  });

  it('lists the commands its links may run, closed, and never one that judges a decision', () => {
    expect(TOOLTIP_COMMANDS).toEqual([
      'workbench.view.extension.mnema',
      'mnema.whatToDo',
      'mnema.refresh',
      'workbench.action.openSettings',
    ]);
    const all = [
      bar(STRONG, { awaiting: 2 }).tooltip,
      bar(FAILED).tooltip,
      describeBar({
        cli: { kind: 'missing', reason: 'x' },
        verdict: UNREADABLE,
        channels: undefined,
        printed: [],
        awaiting: undefined,
        readAt: AT,
      }).tooltip,
    ];
    for (const tip of all) {
      for (const link of tip.matchAll(/\(command:([^)?]+)/g)) {
        expect(TOOLTIP_COMMANDS).toContain(link[1]);
      }
    }
  });

  it('claims nothing the command line did not say: no word of verification outside what it printed', () => {
    const claim = /\b(verified|secure|safe|trusted|proven)\b|\byour record is\b/i;
    const states = [
      bar(STRONG, { awaiting: 2, printed: [] }),
      bar(WEAK, { printed: [] }),
      bar(FAILED, { printed: [] }),
      bar(UNREADABLE, { awaiting: 1, printed: [] }),
      describeBar({
        cli: { kind: 'missing', reason: 'spawn mnema ENOENT' },
        verdict: UNREADABLE,
        channels: undefined,
        printed: [],
        awaiting: undefined,
        readAt: AT,
      }),
    ];
    for (const shown of states) {
      expect(shown.text).not.toMatch(claim);
      expect(shown.tooltip).not.toMatch(claim);
      expect(shown.accessibility.label).not.toMatch(claim);
    }
    // What `mnema verify` printed says "verified" itself, inside its own block.
    expect(bar(STRONG).tooltip).toMatch(claim);
  });

  it('says the same words as the badge for what awaits', () => {
    expect(awaitingPhrase(1)).toBe('1 decision awaits a judgment');
    expect(awaitingPhrase(250)).toBe('250 decisions await a judgment');
  });
});
