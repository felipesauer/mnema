/**
 * A REPORT OF AN INTERNAL ERROR IS BUILT FROM AN ALLOWLIST — the report carries a handful of
 * typed facts and nothing of what the error said, what was typed, or where this machine keeps
 * things; what is shown is the text that would be sent; and it is offered once per kind of
 * error and three times a day, to a person who can refuse it, from a file outside the record.
 *
 * Every case asserts on VALUE: the text does not contain the path, the credential, the address.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runReport } from '../src/commands/report.js';
import {
  appendDiagnostic,
  DAILY_LIMIT,
  LOG_FILE,
  LOG_LIMIT_BYTES,
  LOG_ROTATED_FILE,
  noteInternalError,
  readDiagnostics,
  readState,
  STATE_FILE,
  writeState,
} from '../src/diagnostic-log.js';
import { renderPlain } from '../src/presentation/plain.js';
import {
  asDiagnostic,
  type Diagnostic,
  diagnose,
  fingerprintOf,
  renderReport,
} from '../src/problem-report.js';
import { buildProgram, parseWith } from '../src/program.js';
import { VERSION } from '../src/version.js';

const TOKEN = `ghp_${'A1b2C3d4E5'.repeat(4)}`;
const PERSON_HOME = '/home/someone-else';
const EMAIL = 'a.person@example.com';

/** An error whose message, code and stack are as full of the person's things as a real one can be. */
function aFullOfPersonalThings(): TypeError {
  const error = new TypeError(
    `cannot read ${PERSON_HOME}/projects/secret-client/notes.md for ${EMAIL} with ${TOKEN}`,
  );
  error.stack = [
    `TypeError: ${error.message}`,
    `    at readIt (${PERSON_HOME}/projects/mnema/packages/code/src/commands/show.ts:41:9)`,
    `    at file://${PERSON_HOME}/.local/lib/node_modules/@mnema/code/dist/program.js:88:3`,
    `    at Object.<anonymous> (${PERSON_HOME}/projects/secret-client/app.js:3:1)`,
    '    at node:internal/modules/run_main:123:5',
  ].join('\n');
  return error;
}

const CONTEXT = {
  now: new Date('2026-10-08T12:00:00.000Z'),
  version: VERSION,
  node: 'v24.15.0',
  platform: 'linux',
  arch: 'x64',
  argv: ['show', `${PERSON_HOME}/projects/secret-client`],
  verbs: ['show', 'verify', 'report'],
};

function shown(diagnostic: Diagnostic | undefined, withheld: readonly string[] = []): string {
  expect(diagnostic).toBeDefined();
  const report = renderReport(diagnostic as Diagnostic, withheld);
  expect(report.refused).toBe(false);
  return report.refused ? '' : report.text;
}

describe('the report is made of an allowlist', () => {
  it('keeps nothing of the message, the path, the address, the credential or the arguments', () => {
    const text = shown(diagnose(aFullOfPersonalThings(), CONTEXT), [PERSON_HOME]);
    for (const leaked of [PERSON_HOME, 'secret-client', EMAIL, TOKEN, 'cannot read', 'notes.md']) {
      expect(text, leaked).not.toContain(leaked);
    }
    expect(text).toContain('command: show');
    expect(text).toContain('error: TypeError');
    expect(text).toContain('@mnema/code/commands/show.ts:41');
    expect(text).toContain('@mnema/code/program.js:88');
    expect(text).not.toContain('app.js');
    expect(text).not.toContain('node:internal');
  });

  it('names the verb only when the program declares one by that name', () => {
    const typed = diagnose(new TypeError('x'), {
      ...CONTEXT,
      argv: ['--flag', 'nonsense', 'show'],
    });
    expect(typed?.command).toBe('unknown');
    expect(diagnose(new TypeError('x'), { ...CONTEXT, argv: ['--flag', 'show'] })?.command).toBe(
      'show',
    );
  });

  it('keeps an error code only when it is a constant, and a class otherwise', () => {
    const coded = Object.assign(new TypeError('x'), { code: 'ERR_INVALID_URL' });
    expect(diagnose(coded, CONTEXT)?.code).toBe('ERR_INVALID_URL');
    const spoken = Object.assign(new TypeError('x'), { code: `see ${PERSON_HOME}` });
    expect(diagnose(spoken, CONTEXT)?.code).toBe('TypeError');
    expect(diagnose('a thrown string', CONTEXT)?.code).toBe('NonError');
  });

  it('keeps a code or a class only from a closed set, and says `other` for the rest', () => {
    for (const hostile of [
      'GHP_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      'JOE_SMITH',
      'MCOWBQYDK2VWAYEA',
    ]) {
      const error = Object.assign(new TypeError('x'), { code: hostile });
      expect(diagnose(error, CONTEXT)?.code, hostile).toBe('TypeError');
    }
    for (const name of ['felipe', 'JoeSmith', 'ZXhhbXBsZXRva2VuMTIzNDU2Nzg5MGFiY2RlZjEyMzQ1Ng']) {
      const error = Object.assign(new Error('x'), { name });
      expect(diagnose(error, CONTEXT)?.code, name).toBe('other');
    }
    expect(diagnose(new RangeError('x'), CONTEXT)?.code).toBe('RangeError');
    const base = diagnose(new TypeError('x'), CONTEXT) as Diagnostic;
    expect(asDiagnostic({ ...base, code: 'JOE_SMITH' })).toBeUndefined();
  });

  it("keeps a frame only inside mnema's own packages, and never one that climbs out", () => {
    const framed = (line: string) => {
      const error = new TypeError('x');
      error.stack = `TypeError: x\n    at f (${line})`;
      return diagnose(error, CONTEXT)?.frames;
    };
    expect(
      framed('/home/joe/acme/packages/billing-secret/src/clients/joe-smith/acme.ts:7:1'),
    ).toEqual([]);
    expect(framed('/opt/node_modules/@mnema/code/dist/../../../home/joe/.ssh/id.js:3:1')).toEqual(
      [],
    );
    expect(framed('/opt/node_modules/@mnema/core/dist/read.js:9:1')).toEqual([
      '@mnema/core/read.js:9',
    ]);
    const base = diagnose(new TypeError('x'), CONTEXT) as Diagnostic;
    expect(asDiagnostic({ ...base, frames: ['@mnema/billing-secret/x.ts:7'] })).toBeUndefined();
    expect(asDiagnostic({ ...base, frames: ['@mnema/code/../etc/passwd:1'] })).toBeUndefined();
  });

  it('refuses the whole report when a field turned out to carry what it must not', () => {
    const base = diagnose(new TypeError('x'), CONTEXT) as Diagnostic;
    const withCredential = renderReport({ ...base, code: TOKEN });
    expect(withCredential).toEqual({ refused: true, found: ['github-token'] });
    const withPlace = renderReport(base, ['TypeError']);
    expect(withPlace).toEqual({ refused: true, found: ['place'] });
  });

  it('refuses a text that carries an absolute path or an address, in any spelling', () => {
    const base = diagnose(new TypeError('x'), CONTEXT) as Diagnostic;
    // The shapes are not meant to pass `asDiagnostic`; the gate is the second line.
    const spelled = [
      { frames: ['/home/someone/x.ts:1'] },
      { code: 'a@example.com' },
      { frames: ['C:\\Users\\x\\y.ts:1'] },
      { frames: ['~/y.ts:1'] },
    ];
    for (const change of spelled) {
      expect(renderReport({ ...base, ...change }).refused, JSON.stringify(change)).toBe(true);
    }
  });

  it('gives the same fingerprint to the same fault wherever it happens, and another to another', () => {
    const here = diagnose(aFullOfPersonalThings(), CONTEXT) as Diagnostic;
    const elsewhere = new TypeError('a different message entirely');
    elsewhere.stack = [
      'TypeError: a different message entirely',
      '    at x (/opt/other/lib/node_modules/@mnema/code/src/commands/show.ts:41:2)',
    ].join('\n');
    expect(diagnose(elsewhere, { ...CONTEXT, version: '0.1.7' })?.fingerprint).toBe(
      here.fingerprint,
    );
    expect(diagnose(elsewhere, { ...CONTEXT, version: '0.2.0' })?.fingerprint).not.toBe(
      here.fingerprint,
    );
    expect(fingerprintOf('RangeError', here.frames, '0.1.0')).not.toBe(here.fingerprint);
    expect(here.fingerprint).toMatch(/^[0-9a-f]{8}$/);
  });

  it('does not read a line of the log that is out of its shape', () => {
    const good = diagnose(new TypeError('x'), CONTEXT) as Diagnostic;
    expect(asDiagnostic(JSON.parse(JSON.stringify(good)))).toEqual(good);
    expect(asDiagnostic({ ...good, command: `${PERSON_HOME}/x` })).toBeUndefined();
    expect(asDiagnostic({ ...good, frames: ['/etc/passwd:1'] })).toBeUndefined();
    expect(asDiagnostic({ ...good, extra: 1 })).toEqual(good);
    expect(asDiagnostic(null)).toBeUndefined();
  });
});

describe('the local log and the limits', () => {
  let dir: string;
  let env: { home: string; mnemaHome: string };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mnema-report-'));
    env = { home: join(dir, 'home'), mnemaHome: join(dir, 'data') };
    mkdirSync(env.home);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const globalDir = () => join(env.mnemaHome, 'global');
  const note = (error: unknown, now = CONTEXT.now) =>
    noteInternalError(error, {
      cwd: env.home,
      env,
      now,
      version: CONTEXT.version,
      argv: ['show'],
      verbs: CONTEXT.verbs,
    });
  /** A distinct fault: the code is what the fingerprint rests on. */
  const fault = (n: number) => Object.assign(new TypeError('x'), { code: `ERR_FAULT_${n}` });

  it('keeps its files in the global tree, outside the chain, and never a line the gate would refuse', () => {
    expect(note(aFullOfPersonalThings()).offer).toBe(true);
    const logged = readFileSync(join(globalDir(), LOG_FILE), 'utf8');
    for (const leaked of [PERSON_HOME, EMAIL, TOKEN, 'cannot read']) {
      expect(logged, leaked).not.toContain(leaked);
    }
    expect(readDiagnostics(globalDir())).toHaveLength(1);
    expect(readdirSync(globalDir()).sort()).toEqual([LOG_FILE, STATE_FILE]);
    expect(existsSync(join(globalDir(), 'tails'))).toBe(false);
  });

  it('offers a kind of error once, and three kinds in a day', () => {
    expect(note(fault(1)).offer).toBe(true);
    expect(note(fault(1)).offer).toBe(false);
    expect(note(fault(2)).offer).toBe(true);
    expect(note(fault(3)).offer).toBe(true);
    expect(DAILY_LIMIT).toBe(3);
    expect(note(fault(4)).offer).toBe(false);
    // the next day the budget is back, for a kind not offered yet
    expect(note(fault(4), new Date('2026-10-09T00:00:01.000Z')).offer).toBe(true);
    // every occurrence is in the log, offered or not
    expect(readDiagnostics(globalDir())).toHaveLength(6);
  });

  it('is silent and writes nothing once reporting is off, and for a kind that was declined', () => {
    expect(note(fault(1)).offer).toBe(true);
    const [first] = readDiagnostics(globalDir());
    mkdirSync(globalDir(), { recursive: true });
    const state = readState(globalDir());
    // declined: logged, not offered
    writeDeclined(globalDir(), [...state.declined, (first as Diagnostic).fingerprint]);
    expect(note(fault(1), new Date('2026-10-09T00:00:00.000Z')).offer).toBe(false);
    expect(readDiagnostics(globalDir())).toHaveLength(2);
    // off: nothing
    writeOff(globalDir());
    expect(note(fault(9)).offer).toBe(false);
    expect(readDiagnostics(globalDir())).toHaveLength(2);
  });

  it('rotates at its cap and keeps two files, never more', () => {
    const entry = diagnose(fault(1), CONTEXT) as Diagnostic;
    const lines = Math.ceil(LOG_LIMIT_BYTES / JSON.stringify(entry).length) + 5;
    for (let i = 0; i < lines * 2.5; i++) appendDiagnostic(globalDir(), entry);
    expect(readdirSync(globalDir()).sort()).toEqual([LOG_ROTATED_FILE, LOG_FILE].sort());
    for (const name of [LOG_FILE, LOG_ROTATED_FILE]) {
      expect(readFileSync(join(globalDir(), name)).length, name).toBeLessThanOrEqual(
        LOG_LIMIT_BYTES,
      );
    }
  });

  it('makes no report that carries a place of this machine, and leaves no draft', () => {
    const base = diagnose(fault(1), CONTEXT) as Diagnostic;
    appendDiagnostic(globalDir(), base);
    // a working directory that spells something the report says: the place is withheld
    const made = runReport({ cwd: env.home, env: { ...env, accountHome: 'linux-x64' } }, {});
    expect(made.refused).toBe(true);
    expect(made.lines.join(' ')).toContain('place');
    expect(existsSync(join(globalDir(), 'report-draft.md'))).toBe(false);
  });

  it('fails closed on a state it cannot read: off, untouched, and said by the verb', () => {
    expect(note(fault(1)).offer).toBe(true);
    writeState(globalDir(), { ...readState(globalDir()), declined: ['0123abcd'] });
    const file = join(globalDir(), STATE_FILE);
    writeFileSync(file, '{ not json');
    expect(readState(globalDir()).unreadable).toBe(true);
    expect(note(fault(2)).offer).toBe(false);
    expect(readDiagnostics(globalDir())).toHaveLength(1);
    for (const ask of [{}, { on: true }, { off: true }, { decline: true }]) {
      const said = runReport({ cwd: env.home, env }, ask);
      expect(said.refused, JSON.stringify(ask)).toBe(true);
      expect(said.lines.join(' ')).toContain('Delete that file');
    }
    expect(readFileSync(file, 'utf8')).toBe('{ not json');
    writeFileSync(file, '{"off":"yes"}');
    expect(readState(globalDir()).unreadable).toBe(true);
  });

  it('does not let a log it cannot write replace the error', () => {
    const blocked = { home: env.home, mnemaHome: join(env.home, 'not-a-directory') };
    mkdirSync(join(blocked.mnemaHome, 'global'), { recursive: true });
    rmSync(blocked.mnemaHome, { recursive: true });
    writeFileAt(blocked.mnemaHome);
    expect(
      noteInternalError(fault(1), {
        cwd: env.home,
        env: blocked,
        now: CONTEXT.now,
        version: CONTEXT.version,
        argv: [],
        verbs: [],
      }),
    ).toEqual({ offer: false });
  });
});

function writeDeclined(dir: string, declined: readonly string[]): void {
  writeState(dir, { ...readState(dir), declined });
}
function writeOff(dir: string): void {
  writeState(dir, { ...readState(dir), off: true });
}
function writeFileAt(path: string): void {
  writeFileSync(path, 'a file where a directory should be');
}

describe('the verb, end to end through the program', () => {
  let dir: string;
  const saved = { HOME: process.env.HOME, MNEMA_HOME: process.env.MNEMA_HOME };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mnema-report-verb-'));
    process.env.HOME = dir;
    process.env.MNEMA_HOME = join(dir, 'data');
  });
  afterEach(() => {
    process.env.HOME = saved.HOME;
    if (saved.MNEMA_HOME === undefined) delete process.env.MNEMA_HOME;
    else process.env.MNEMA_HOME = saved.MNEMA_HOME;
    rmSync(dir, { recursive: true, force: true });
  });

  async function run(argv: string[], thrown?: () => unknown) {
    const out: string[] = [];
    const err: string[] = [];
    let exit: number | undefined;
    const built = buildProgram(
      {
        out: (line) => out.push(line),
        err: (line) => err.push(line),
        fail: (code) => {
          exit = code ?? 1;
        },
      },
      [],
      renderPlain,
    );
    if (thrown !== undefined) {
      built.program.command('boom').action(() => {
        throw thrown();
      });
    }
    await parseWith(built, argv);
    return { out, err, exit };
  }

  it('offers once after an internal error, shows the whole report, and keeps the refusal', async () => {
    const bug = () => aFullOfPersonalThings();
    const first = await run(['boom'], bug);
    expect(first.exit).toBe(70);
    expect(first.err.some((line) => line.includes('mnema report'))).toBe(true);
    const again = await run(['boom'], bug);
    expect(again.err.some((line) => line.includes('mnema report'))).toBe(false);

    const shownToThePerson = await run(['report']);
    expect(shownToThePerson.exit).toBeUndefined();
    const text = shownToThePerson.out.join('\n');
    for (const leaked of [PERSON_HOME, EMAIL, TOKEN, 'cannot read']) {
      expect(text, leaked).not.toContain(leaked);
    }
    const draft = readFileSync(join(dir, 'data', 'global', 'report-draft.md'), 'utf8');
    expect(text).toContain(draft.trimEnd());

    const declined = await run(['report', '--decline']);
    expect(declined.out.join(' ')).toContain('will not offer');
    const off = await run(['report', '--off']);
    expect(off.out.join(' ')).toContain('off');
    expect(readState(join(dir, 'data', 'global')).off).toBe(true);
    const two = await run(['report', '--on', '--off']);
    expect(two.exit).toBe(1);
  });

  it('says so when there is nothing on record', async () => {
    const said = await run(['report']);
    expect(said.out).toEqual(['No internal error is on record on this machine.']);
    expect(said.exit).toBeUndefined();
  });
});
