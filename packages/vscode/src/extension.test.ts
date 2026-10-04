import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CliResult } from './cli.js';
import { activate, QUIET_MS, type VscodeApi } from './extension.js';

const ROOT = '/work/proj';
const ok = (stdout: string): CliResult => ({ code: 0, stdout, stderr: '' });
const hit = (id: string, title: string) => ({
  id,
  kind: 'decision',
  scope: 'public',
  title,
  at: '',
});
const listing = (...hits: ReturnType<typeof hit>[]) =>
  ok(JSON.stringify({ hits, total: hits.length }));
const RULES = ok(
  JSON.stringify({
    rules: [
      {
        rule: 'r1',
        kind: 'decision',
        name: 'Use X',
        state: 'accepted',
        acceptance: { by: 'mnid:a' },
      },
    ],
  }),
);
const VERIFY = ok(JSON.stringify({ ok: true, record: { ok: true, level: 'fully-signed' } }));
const SWITCH = ok('2 channel(s):\n  brief-document  on  x\n  user-corrections  off  y\n');

/** A stand-in for the members of `vscode` the extension uses, recording what it is asked. */
function world(answers: Record<string, CliResult>) {
  const ran: string[][] = [];
  const run = async (args: readonly string[]) => {
    ran.push([...args]);
    return (
      answers[args[0] === 'rules' ? 'rules' : args.join(' ')] ?? {
        code: 1,
        stdout: '',
        stderr: 'no answer',
      }
    );
  };
  const commands = new Map<string, (...args: never[]) => unknown>();
  const watcher = { change: [] as (() => void)[] };
  const bar = { text: '', tooltip: '', command: '', show() {}, dispose() {} };
  const shown: string[] = [];
  const errors: string[] = [];
  const inputs: { validate: (v: string) => string | undefined }[] = [];
  let reply: string | undefined;
  let tree: { getChildren(): never[]; getTreeItem(e: never): Record<string, unknown> } | undefined;
  let lenses: { provideCodeLenses(d: never): Promise<unknown[]> } | undefined;
  const api = {
    workspace: {
      workspaceFolders: [{ uri: { fsPath: ROOT } }],
      getConfiguration: () => ({ get: <T>(_k: string, d: T) => d }),
      createFileSystemWatcher: () => ({
        onDidChange: (l: () => void) => {
          watcher.change.push(l);
          return { dispose() {} };
        },
        onDidCreate: () => ({ dispose() {} }),
        onDidDelete: () => ({ dispose() {} }),
        dispose() {},
      }),
    },
    RelativePattern: class {},
    window: {
      createStatusBarItem: () => bar,
      registerTreeDataProvider: (_id: string, p: never) => {
        tree = p;
        return { dispose() {} };
      },
      showInputBox: async (o: { validateInput: (v: string) => string | undefined }) => {
        inputs.push({ validate: o.validateInput });
        return reply;
      },
      showQuickPick: async () => undefined,
      showInformationMessage: async (m: string) => {
        shown.push(m);
        return undefined;
      },
      showErrorMessage: async (m: string) => {
        errors.push(m);
        return undefined;
      },
      activeTextEditor: undefined,
    },
    commands: {
      registerCommand: (id: string, cb: (...args: never[]) => unknown) => {
        commands.set(id, cb);
        return { dispose() {} };
      },
      executeCommand: async () => undefined,
    },
    languages: {
      registerCodeLensProvider: (_s: unknown, p: never) => {
        lenses = p;
        return { dispose() {} };
      },
    },
    EventEmitter: class {
      event = () => ({ dispose() {} });
      fire() {}
      dispose() {}
    },
    CodeLens: class {
      constructor(
        readonly range: unknown,
        readonly command: unknown,
      ) {}
    },
    Range: class {},
    TreeItem: class {
      constructor(readonly label: string) {}
    },
    TreeItemCollapsibleState: { None: 0 },
    StatusBarAlignment: { Left: 1 },
  } as unknown as VscodeApi;
  activate({ subscriptions: [] }, api, { run });
  return {
    ran,
    bar,
    shown,
    errors,
    inputs,
    watcher,
    answers,
    setReply: (v: string | undefined) => {
      reply = v;
    },
    command: (id: string) => commands.get(id) as (...a: unknown[]) => Promise<void>,
    tree: () => tree as NonNullable<typeof tree>,
    lenses: () => lenses as NonNullable<typeof lenses>,
  };
}

const LIST = 'search --kind decision --state proposed --limit 200 --json';
const base = (): Record<string, CliResult> => ({
  [LIST]: listing(hit('d1', 'Use X')),
  'verify --json': VERIFY,
  switch: SWITCH,
  'show d1 --json': ok('{"record": {"adr": "ADR-1", "rationale": "because Y"}}'),
  rules: RULES,
});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const settle = () => vi.advanceTimersByTimeAsync(0);

describe('the extension reads the record through the command line', () => {
  it('shows the verdict and the channels in the status bar', async () => {
    const w = world(base());
    await settle();
    expect(w.bar.text).toBe('mnema: fully-signed · 1 of 2 channels off');
    expect(w.bar.tooltip).toBe('off: user-corrections');
  });

  it('lists what waits for a judgment, with its justification', async () => {
    const w = world(base());
    await settle();
    const [item] = w.tree().getChildren();
    const node = w.tree().getTreeItem(item as never);
    expect(node.label).toBe('Use X');
    expect(node.description).toBe('ADR-1');
    expect(node.tooltip).toContain('because Y');
  });

  it('puts a lens on a file a rule addresses, and none on a file outside the folder', async () => {
    const w = world(base());
    await settle();
    const doc = (fsPath: string) => ({ uri: { scheme: 'file', fsPath } }) as never;
    const lens = (await w.lenses().provideCodeLenses(doc(`${ROOT}/src/a.ts`))) as {
      command: { title: string; command: string; arguments: string[] };
    }[];
    expect(lens[0]?.command).toEqual({
      title: 'mnema: 1 governs',
      command: 'mnema.showRules',
      arguments: ['src/a.ts'],
    });
    expect(w.ran).toContainEqual(['rules', 'src/a.ts', '--json']);
    expect(await w.lenses().provideCodeLenses(doc('/elsewhere/a.ts'))).toEqual([]);
  });
});

describe('a judgment goes through the verb of the command line, with a note', () => {
  it('accepts with the note the person typed', async () => {
    const w = world({
      ...base(),
      'decision move accept d1 --note looks right': ok('Decision ADR-1 (d1) → accepted\n'),
    });
    await settle();
    w.setReply('looks right');
    await w.command('mnema.accept')({ id: 'd1', title: 'Use X', scope: 'public', at: '' });
    expect(w.ran).toContainEqual(['decision', 'move', 'accept', 'd1', '--note', 'looks right']);
    expect(w.shown).toContain('Decision ADR-1 (d1) → accepted');
  });

  it('rejects with the verb reject', async () => {
    const w = world({ ...base(), 'decision move reject d1 --note no': ok('rejected\n') });
    await settle();
    w.setReply('no');
    await w.command('mnema.reject')({ id: 'd1', title: 'Use X', scope: 'public', at: '' });
    expect(w.ran).toContainEqual(['decision', 'move', 'reject', 'd1', '--note', 'no']);
  });

  it('gives the input box a validator that refuses an empty note, and sends nothing without one', async () => {
    const w = world(base());
    await settle();
    w.setReply('');
    await w.command('mnema.accept')({ id: 'd1', title: 'Use X', scope: 'public', at: '' });
    expect(w.inputs[0]?.validate('')).toBeDefined();
    expect(w.inputs[0]?.validate('   ')).toBeDefined();
    expect(w.inputs[0]?.validate('because')).toBeUndefined();
    expect(w.ran.some((args) => args[0] === 'decision')).toBe(false);
  });

  it('sends nothing when the person cancels the box', async () => {
    const w = world(base());
    await settle();
    w.setReply(undefined);
    await w.command('mnema.accept')({ id: 'd1', title: 'Use X', scope: 'public', at: '' });
    expect(w.ran.some((args) => args[0] === 'decision')).toBe(false);
  });

  it('shows the CLI refusal as it is said', async () => {
    const w = world({
      ...base(),
      'decision move accept d1 --note n': { code: 1, stdout: '', stderr: 'Agents may not accept.' },
    });
    await settle();
    w.setReply('n');
    await w.command('mnema.accept')({ id: 'd1', title: 'Use X', scope: 'public', at: '' });
    expect(w.errors).toEqual(['mnema refused: Agents may not accept.']);
  });
});

describe('the record is watched, and a new proposal is announced once', () => {
  it('says nothing at the first reading, then announces the one that arrived', async () => {
    const w = world(base());
    await settle();
    expect(w.shown).toEqual([]);
    w.answers[LIST] = listing(hit('d1', 'Use X'), hit('d2', 'Use Y'));
    w.watcher.change[0]?.();
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(w.shown).toEqual(['mnema: a decision was proposed: Use Y']);
    w.watcher.change[0]?.();
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(w.shown).toHaveLength(1);
  });

  it('reads once for a burst of changes, not once per change', async () => {
    const w = world(base());
    await settle();
    const before = w.ran.filter((a) => a[0] === 'verify').length;
    for (let i = 0; i < 20; i++) w.watcher.change[0]?.();
    await vi.advanceTimersByTimeAsync(QUIET_MS * 3);
    expect(w.ran.filter((a) => a[0] === 'verify').length).toBe(before + 1);
  });
});
