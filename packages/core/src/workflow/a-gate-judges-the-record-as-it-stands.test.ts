/**
 * Every move a state machine's gate authorizes is judged on the record as it stands under the
 * tail's lock — the structural half of `the-second-move-sees-the-first.test.ts`.
 *
 * The behavioural cases there race one operation of each machine. This one asks the SOURCE: a
 * call of one of the three gates — anywhere under `packages/`, tests included — that is not inside an
 * {@link onTheRecordAsItStands} call judges a reading the lock does not vouch for, which is the
 * shape that let two sessions both move a `proposed` decision. A gate called from a new place
 * fails here until it is put inside one, or named below with the reason it appends nothing.
 *
 * The scan is lexical, and the instrument is tested on its own: it says it broke
 * (`RULER BROKEN`) when it finds no gate call at all, and the last case feeds it a source it
 * must accuse and one it must not.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const GATES = ['gate', 'decisionGate', 'skillGate'] as const;

/**
 * Gate calls no second session can race, each with the reason. Tests are scanned too — a
 * fixture that judges and appends is a site of the rule like any other — and named here when
 * the reason holds.
 */
const EXEMPT: Readonly<Record<string, string>> = {
  'packages/context/tests/support/chain.ts':
    'a fixture builder: one process writing a tree it made, that no other session opens',
};

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      out.push(path);
    }
  }
  return out;
}

/** Blanks comments and string/template literals, keeping offsets, so a scan reads only code. */
function codeOnly(text: string): string {
  return text.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g,
    (m) => m.replace(/[^\n]/g, ' '),
  );
}

/** The [start, end) spans of every `onTheRecordAsItStands(...)` call, by paren matching. */
function lockedSpans(code: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const re = /\bonTheRecordAsItStands\(/g;
  for (let m = re.exec(code); m !== null; m = re.exec(code)) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < code.length; i += 1) {
      if (code[i] === '(') depth += 1;
      else if (code[i] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    spans.push([m.index, i]);
  }
  return spans;
}

interface GateCall {
  readonly file: string;
  readonly line: number;
  readonly gate: string;
  readonly locked: boolean;
}

/** Every call of a gate in `text` (definitions excluded), and whether a locked span holds it. */
function gateCallsIn(file: string, text: string): GateCall[] {
  const code = codeOnly(text);
  // A file that appends nothing judges nothing a stale reading could let through: a gate's own
  // cases, a pure reading. Only a file that can append is a site of the rule.
  if (!/\bappendEvents?\(|\.append(?:All)?\(/.test(code)) return [];
  const spans = lockedSpans(code);
  const calls: GateCall[] = [];
  const re = new RegExp(`(?<![\\w.])(${GATES.join('|')})\\(`, 'g');
  for (let m = re.exec(code); m !== null; m = re.exec(code)) {
    if (/function\s+$/.test(code.slice(Math.max(0, m.index - 12), m.index))) continue;
    calls.push({
      file,
      line: code.slice(0, m.index).split('\n').length,
      gate: m[1] as string,
      locked: spans.some(([a, b]) => m !== null && m.index > a && m.index < b),
    });
  }
  return calls;
}

/**
 * This file, which the scan skips: its gate calls are its own instrument cases, and its own
 * regular expressions hold quote characters a lexical scan without a regex grammar misreads.
 */
const SELF = relative(REPO, fileURLToPath(import.meta.url));

function everyGateCall(): GateCall[] {
  return sources(join(REPO, 'packages'))
    .filter((path) => relative(REPO, path) !== SELF)
    .flatMap((path) => gateCallsIn(relative(REPO, path), readFileSync(path, 'utf-8')));
}

describe('a gate judges the record as it stands under the lock', () => {
  it('every call of a gate that can lead to an append is inside onTheRecordAsItStands', () => {
    const calls = everyGateCall();
    if (calls.length === 0) throw new Error('RULER BROKEN: no gate call found in packages/');
    const unlocked = calls.filter((c) => !c.locked && EXEMPT[c.file] === undefined);
    expect(unlocked.map((c) => `${c.file}:${c.line} ${c.gate}`)).toEqual([]);
    // Non-vacuity: the three machines' operations are among what was found, locked.
    expect(
      calls
        .filter((c) => c.locked)
        .map((c) => `${c.file} ${c.gate}`)
        .sort(),
    ).toEqual([
      'packages/core/src/workflow/decision-operations.ts decisionGate',
      'packages/core/src/workflow/operations.ts gate',
      'packages/core/src/workflow/skill-operations.ts skillGate',
    ]);
  });

  it('names no exemption that no longer calls a gate', () => {
    const files = new Set(everyGateCall().map((c) => c.file));
    expect(Object.keys(EXEMPT).filter((f) => !files.has(f))).toEqual([]);
  });

  it('the instrument accuses a gate called outside the helper and clears one inside it', () => {
    const outside = `function move() {\n  const v = gate({ from });\n  appendEvent(w, e);\n}`;
    const inside = `function move() {\n  return onTheRecordAsItStands(ctx, read, (s) => {\n    const v = gate({ from: s });\n    return { write: () => appendEvent(w, e) };\n  });\n}`;
    const inAString = `const text = 'gate(';\n// decisionGate( in a comment\nw.append(e);\n`;
    expect(gateCallsIn('x.ts', outside)).toMatchObject([{ gate: 'gate', locked: false, line: 2 }]);
    expect(gateCallsIn('y.ts', inside)).toMatchObject([{ gate: 'gate', locked: true, line: 3 }]);
    expect(gateCallsIn('z.ts', inAString)).toEqual([]);
    expect(gateCallsIn('d.ts', 'export function gate(request) {}\nw.append(e);')).toEqual([]);
    // A file that appends nothing is a pure judgement, whatever it calls.
    expect(gateCallsIn('p.ts', 'const v = gate({ from });')).toEqual([]);
  });
});
