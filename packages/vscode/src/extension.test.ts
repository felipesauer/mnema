import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CliResult, createRun, type Run } from './cli.js';
import { activate, QUIET_MS, type VscodeApi } from './extension.js';
import { MIN_CLI_VERSION } from './status.js';

/** The folders a test made: each holds a real `.mnema`, because the extension reads the disk for it. */
const made: string[] = [];
/** A folder like an opened project: with a record in it, or without. */
function folderWith(record: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'mnema-extension-folder-'));
  made.push(dir);
  if (record) mkdirSync(join(dir, '.mnema'));
  return dir;
}
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
function world(
  answers: Record<string, CliResult>,
  real?: Run,
  root: string = folderWith(true),
  rereadSetting = false,
) {
  const setting = { command: 'mnema' };
  const settingListeners: ((e: { affectsConfiguration(s: string): boolean }) => void)[] = [];
  const makeRuns: string[] = [];
  const ran: string[][] = [];
  const executed: unknown[][] = [];
  const run = async (args: readonly string[]) => {
    ran.push([...args]);
    if (real !== undefined) return real(args);
    return (
      answers[args[0] === 'rules' ? 'rules' : args.join(' ')] ?? {
        code: 1,
        stdout: '',
        stderr: 'no answer',
      }
    );
  };
  const commands = new Map<string, (...args: never[]) => unknown>();
  const watcher = { change: [] as (() => void)[], create: [] as (() => void)[] };
  const bar = {
    text: '',
    tooltip: '',
    command: '' as unknown,
    accessibilityInformation: undefined as unknown,
    visible: false,
    show() {
      bar.visible = true;
    },
    hide() {
      bar.visible = false;
    },
    dispose() {},
  };
  const shown: string[] = [];
  const errors: string[] = [];
  const inputs: {
    validate: (v: string) => string | undefined;
    title: string;
    prompt: string;
    placeHolder: string;
    ignoreFocusOut: boolean;
  }[] = [];
  let reply: string | undefined;
  type Tree = { getChildren(): never[]; getTreeItem(e: never): Record<string, unknown> };
  const trees = new Map<string, Tree>();
  const treeViews = new Map<string, { badge: { value: number; tooltip: string } | undefined }>();
  const channel: string[] = [];
  const picks: string[] = [];
  const picked: string[][] = [];
  const pickOptions: { title: string; ignoreFocusOut?: boolean }[] = [];
  let choice: string | undefined;
  let lenses: { provideCodeLenses(d: never): Promise<unknown[]> } | undefined;
  const api = {
    workspace: {
      workspaceFolders: [{ uri: { fsPath: root } }],
      getConfiguration: () => ({
        get: <T>(k: string, d: T) => (k === 'command' ? (setting.command as T) : d),
      }),
      onDidChangeConfiguration: (l: (e: { affectsConfiguration(s: string): boolean }) => void) => {
        settingListeners.push(l);
        return { dispose() {} };
      },
      createFileSystemWatcher: () => ({
        onDidChange: (l: () => void) => {
          watcher.change.push(l);
          return { dispose() {} };
        },
        onDidCreate: (l: () => void) => {
          watcher.create.push(l);
          return { dispose() {} };
        },
        onDidDelete: () => ({ dispose() {} }),
        dispose() {},
      }),
    },
    RelativePattern: class {},
    window: {
      createStatusBarItem: () => bar,
      createTreeView: (id: string, options: { treeDataProvider: Tree }) => {
        trees.set(id, options.treeDataProvider);
        const view = { badge: undefined, dispose() {} };
        treeViews.set(id, view);
        return view;
      },
      createOutputChannel: () => ({
        clear: () => channel.splice(0),
        appendLine: (line: string) => channel.push(line),
        show() {},
        dispose() {},
      }),
      showInputBox: async (o: {
        validateInput: (v: string) => string | undefined;
        title: string;
        prompt: string;
        placeHolder: string;
        ignoreFocusOut: boolean;
      }) => {
        inputs.push({ validate: o.validateInput, ...o });
        return reply;
      },
      showQuickPick: async (
        items: { label: string }[],
        options: { title: string; ignoreFocusOut?: boolean },
      ) => {
        pickOptions.push(options);
        picked.push(items.map((i) => i.label));
        const want = picks.shift();
        return items.find((i) => i.label === want);
      },
      showInformationMessage: async (m: string, ...actions: string[]) => {
        shown.push(m);
        return actions.includes(choice ?? '') ? choice : undefined;
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
      executeCommand: async (...args: unknown[]) => {
        executed.push(args);
        return undefined;
      },
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
  const started = activate(
    { subscriptions: [] },
    api,
    rereadSetting
      ? {
          // Only the command named `good` is there: the person fixes the setting from a wrong name.
          makeRun: (command) => {
            makeRuns.push(command);
            return command === 'good'
              ? run
              : async () => ({ code: null, stdout: '', stderr: `spawn ${command} ENOENT` });
          },
        }
      : { run },
  );
  return {
    started,
    ran,
    executed,
    bar,
    shown,
    errors,
    inputs,
    watcher,
    setting,
    settingListeners,
    root,
    makeRuns,
    treeViews,
    answers,
    setReply: (v: string | undefined) => {
      reply = v;
    },
    command: (id: string) => commands.get(id) as (...a: unknown[]) => Promise<void>,
    tree: () => trees.get('mnema.proposed') as Tree,
    stackTree: () => trees.get('mnema.stacks') as Tree,
    badge: () => treeViews.get('mnema.proposed')?.badge,
    channel,
    ids: () => [...commands.keys()],
    picks,
    picked,
    pickOptions,
    choose: (v: string | undefined) => {
      choice = v;
    },
    lenses: () => lenses as NonNullable<typeof lenses>,
  };
}

const LIST = 'search --kind decision --state proposed --limit 200 --json';
const STACK_LIST = 'stack list --json';
const COVERAGE = 'public: local integrity verified (T1/T2/T4); external witness (T3): not covered';
const base = (): Record<string, CliResult> => ({
  '--version': ok(`${MIN_CLI_VERSION}\n`),
  verify: ok(`${COVERAGE}\n`),
  [STACK_LIST]: ok(JSON.stringify({ stacks: [] })),
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
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const settle = () => vi.advanceTimersByTimeAsync(0);

describe('the extension reads the record through the command line', () => {
  it('shows the verdict and the channels in the status bar', async () => {
    const w = world(base());
    await settle();
    expect(w.bar.text).toBe('$(book) mnema: fully-signed · 1 of 2 channels off');
    expect(w.bar.tooltip).toBe(`${COVERAGE}\n\noff: user-corrections`);
    expect(w.bar.accessibilityInformation).toEqual({
      label: 'mnema: fully-signed, 1 of 2 channels off',
      role: 'button',
    });
    expect(w.bar.command).toBe('mnema.refresh');
    expect(w.executed).toContainEqual(['setContext', 'mnema.cliMissing', false]);
    expect(w.started?.shown()).toEqual({
      text: w.bar.text,
      tooltip: w.bar.tooltip,
      visible: true,
      badge: { value: 1, tooltip: '1 decision awaits a judgment' },
    });
  });

  it('says the command is missing, apart from nothing pending, and sends the bar to the setting', async () => {
    const w = world({
      ...base(),
      '--version': { code: null, stdout: '', stderr: 'spawn mnema ENOENT' },
    });
    await settle();
    expect(w.executed).toContainEqual(['setContext', 'mnema.cliMissing', true]);
    expect(w.bar.text).toBe('$(warning) mnema: command not found');
    expect(w.bar.tooltip).toContain('spawn mnema ENOENT');
    expect(w.bar.accessibilityInformation).toEqual({
      label: 'mnema: command not found',
      role: 'button',
    });
    expect(w.bar.command).toEqual({
      command: 'workbench.action.openSettings',
      title: 'mnema: Set the mnema command',
      arguments: ['mnema.command'],
    });
    // Nothing else is asked of a command that is not there, and no verdict is shown.
    expect(w.ran).toEqual([['--version']]);
    expect(w.tree().getChildren()).toEqual([]);
  });

  it('comes back from a missing command when it is there again, and the views are listed again', async () => {
    const answers: Record<string, CliResult> = {
      ...base(),
      '--version': { code: null, stdout: '', stderr: 'spawn mnema ENOENT' },
    };
    const w = world(answers);
    await settle();
    answers['--version'] = ok(`${MIN_CLI_VERSION}\n`);
    await w.command('mnema.refresh')();
    expect(w.executed.filter((e) => e[1] === 'mnema.cliMissing').map((e) => e[2])).toEqual([
      true,
      false,
    ]);
    expect(w.bar.text).toBe('$(book) mnema: fully-signed · 1 of 2 channels off');
    expect(w.bar.command).toBe('mnema.refresh');
    expect(w.tree().getChildren()).toHaveLength(1);
  });

  it('reads the mnema.command setting again at every refresh, and when it changes, so a corrected setting clears "command not found" without a reload', async () => {
    const w = world(base(), undefined, undefined, true);
    w.setting.command = 'typo';
    await w.command('mnema.refresh')();
    expect(w.bar.text).toBe('$(warning) mnema: command not found');
    expect(w.bar.tooltip).toContain('spawn typo ENOENT');

    // Changing the setting is enough: the editor says so, and no Refresh is asked for.
    w.setting.command = 'good';
    const unrelated = { affectsConfiguration: (s: string) => s === 'editor.fontSize' };
    for (const l of w.settingListeners) l(unrelated);
    await settle();
    expect(w.bar.text).toBe('$(warning) mnema: command not found');
    for (const l of w.settingListeners) l({ affectsConfiguration: (s) => s === 'mnema.command' });
    await settle();
    expect(w.bar.text).toBe('$(book) mnema: fully-signed · 1 of 2 channels off');
    expect(w.makeRuns.at(-1)).toBe('good');

    // And a Refresh alone reads it too, with no event.
    w.setting.command = 'typo-again';
    await w.command('mnema.refresh')();
    expect(w.makeRuns.at(-1)).toBe('typo-again');
    expect(w.bar.text).toBe('$(warning) mnema: command not found');
  });

  it('tells the empty views whether the folder holds a record, by what is on disk and not by what the command line said', async () => {
    const folder = folderWith(false);
    const without = world(base(), undefined, folder);
    await settle();
    expect(without.executed).toContainEqual(['setContext', 'mnema.hasRecord', false]);
    mkdirSync(join(folder, '.mnema'));
    await without.command('mnema.refresh')();
    expect(without.executed).toContainEqual(['setContext', 'mnema.hasRecord', true]);
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
    const lens = (await w.lenses().provideCodeLenses(doc(`${w.root}/src/a.ts`))) as {
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

  it('titles every input box, says what to type in its placeholder and keeps it open when focus moves', async () => {
    const w = world(withStack());
    await settle();
    w.setReply('--scope');
    await w.command('mnema.accept')({ id: 'd1', title: 'Use X', scope: 'public', at: '' });
    await w.command('mnema.stacks.add')();
    await w.command('mnema.stacks.export')({ name: 'hello-stack', scope: 'public' });
    expect(w.inputs.map((i) => i.title)).toEqual([
      'mnema: Accept Decision',
      'mnema: Add Stack (1 of 2)',
      'mnema: Export Stack',
    ]);
    for (const input of w.inputs) {
      expect(input.placeHolder, input.title).not.toBe('');
      expect(input.prompt, input.title).not.toBe('');
      expect(input.ignoreFocusOut, input.title).toBe(true);
    }
  });

  it('keeps every quick pick open when focus moves, as the input boxes are', async () => {
    const w = world(withStack());
    await settle();
    await w.command('mnema.accept')(undefined as never);
    await w.command('mnema.reject')(undefined as never);
    await w.command('mnema.stacks.show')(undefined as never);
    await w.command('mnema.showRules')('src/a.ts');
    expect(w.pickOptions.length).toBeGreaterThanOrEqual(4);
    for (const options of w.pickOptions) expect(options.ignoreFocusOut, options.title).toBe(true);
  });

  it('says whether mnema read the stacks, so the empty stacks view never claims what the command line did not say', async () => {
    const read = world(withStack());
    await settle();
    expect(read.executed).toContainEqual(['setContext', 'mnema.stacksRead', true]);
    const failed = world({ ...withStack(), [STACK_LIST]: { code: 1, stdout: '', stderr: 'boom' } });
    await settle();
    expect(failed.executed).toContainEqual(['setContext', 'mnema.stacksRead', false]);
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
    const before = w.ran.filter((a) => a.join(' ') === 'verify --json').length;
    for (let i = 0; i < 20; i++) w.watcher.change[0]?.();
    await vi.advanceTimersByTimeAsync(QUIET_MS * 3);
    expect(w.ran.filter((a) => a.join(' ') === 'verify --json').length).toBe(before + 1);
  });
});

describe('what awaits a judgment is a number on the side bar icon', () => {
  const hits = (n: number) => Array.from({ length: n }, (_, i) => hit(`d${i}`, `Decision ${i}`));
  const withList = (n: number, total = n): Record<string, CliResult> => ({
    ...base(),
    [LIST]: ok(JSON.stringify({ hits: hits(n), total })),
  });

  it('is nothing at zero, never a badge that says 0', async () => {
    const w = world(withList(0));
    await settle();
    expect(w.badge()).toBeUndefined();
    expect(w.started?.shown().badge).toBeUndefined();
    expect(w.executed).toContainEqual(['setContext', 'mnema.proposedRead', true]);
  });

  it('says one decision awaits a judgment, and several await', async () => {
    const one = world(withList(1));
    await settle();
    expect(one.badge()).toEqual({ value: 1, tooltip: '1 decision awaits a judgment' });
    const three = world(withList(3));
    await settle();
    expect(three.badge()).toEqual({ value: 3, tooltip: '3 decisions await a judgment' });
  });

  it('counts the total the command line said, not the decisions it listed', async () => {
    const w = world(withList(200, 250));
    await settle();
    expect(w.tree().getChildren()).toHaveLength(200);
    expect(w.badge()).toEqual({ value: 250, tooltip: '250 decisions await a judgment' });
  });

  it('is nothing when the command is missing, and again when it is back', async () => {
    const answers = withList(2);
    const w = world(answers);
    await settle();
    expect(w.badge()?.value).toBe(2);
    answers['--version'] = { code: null, stdout: '', stderr: 'spawn mnema ENOENT' };
    await w.command('mnema.refresh')();
    expect(w.badge()).toBeUndefined();
    answers['--version'] = ok(`${MIN_CLI_VERSION}\n`);
    await w.command('mnema.refresh')();
    expect(w.badge()?.value).toBe(2);
  });

  it('is nothing when the list was not read, and the view says it did not read rather than that nothing awaits', async () => {
    const answers = withList(2);
    const w = world(answers);
    await settle();
    answers[LIST] = { code: 1, stdout: '', stderr: 'boom' };
    await w.command('mnema.refresh')();
    expect(w.badge()).toBeUndefined();
    expect(w.tree().getChildren()).toEqual([]);
    expect(w.executed.filter((e) => e[1] === 'mnema.proposedRead').map((e) => e[2])).toEqual([
      true,
      false,
    ]);
  });
});

describe('in a folder with no .mnema the command line is never run', () => {
  const declared = (
    JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      contributes: { commands: { command: string }[] };
    }
  ).contributes.commands.map((c) => c.command);
  const proposal = { id: 'd1', title: 'Use X', scope: 'public', at: '' };
  const stack = { name: 'hello-stack', scope: 'public' };
  const argumentOf = (id: string): unknown =>
    id.startsWith('mnema.stacks.') ? stack : id === 'mnema.showRules' ? 'src/a.ts' : proposal;

  it('starts no process for a reading, the watcher, a changed setting, a lens or any command of the manifest, and says what is missing', async () => {
    const w = world(withStack(), undefined, folderWith(false));
    w.setReply('a note');
    w.choose('Write these files');
    await settle();
    w.watcher.change[0]?.();
    w.watcher.create[0]?.();
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    for (const l of w.settingListeners) l({ affectsConfiguration: (s) => s === 'mnema.command' });
    await settle();
    const doc = { uri: { scheme: 'file', fsPath: `${w.root}/src/a.ts` } } as never;
    expect(await w.lenses().provideCodeLenses(doc)).toEqual([]);
    expect(declared.length).toBeGreaterThan(5);
    for (const id of declared) {
      w.shown.length = 0;
      w.picks.push('hello-stack', 'public');
      await w.command(id)(argumentOf(id));
      expect(w.shown, id).toContain(
        'This folder holds no .mnema record. Run mnema init in a terminal here.',
      );
      expect(w.errors, id).toEqual([]);
    }
    expect(w.ran).toEqual([]);
    expect(w.executed.filter((e) => e[1] === 'mnema.cliMissing' && e[2] === true)).toEqual([]);
    expect(w.executed).toContainEqual(['setContext', 'mnema.hasRecord', false]);
    expect(w.bar.visible).toBe(false);
    expect(w.badge()).toBeUndefined();
    expect(w.started?.shown()).toMatchObject({ visible: false, badge: undefined });
    expect(w.tree().getChildren()).toEqual([]);
    expect(w.stackTree().getChildren()).toEqual([]);
  });

  it('reads the disk each time it is asked: a .mnema born later is read at the next change, and the bar comes back', async () => {
    const folder = folderWith(false);
    const w = world(base(), undefined, folder);
    await settle();
    expect(w.ran).toEqual([]);
    expect(w.bar.visible).toBe(false);
    mkdirSync(join(folder, '.mnema'));
    w.watcher.create[0]?.();
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(w.ran).toContainEqual(['--version']);
    expect(w.bar.visible).toBe(true);
    expect(w.bar.text).toBe('$(book) mnema: fully-signed · 1 of 2 channels off');
    expect(w.badge()?.value).toBe(1);
  });

  it('has one door: the only place that calls the runner is the one that checks for the record first', () => {
    const source = readFileSync(new URL('./extension.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source.match(/runner\(\)/g)).toHaveLength(1);
    expect(source).toMatch(/hasRecord\(\)\s*\?\s*runner\(\)\(args\)/);
    expect(source.match(/existsSync\(/g)).toHaveLength(1);
    expect(source).not.toMatch(/\.read\(/);
  });
});

const DIGEST = 'd8ef7d9252d24840adb4ac3804ed6fe1f525c25f477d7eca275aa7af7ad7f174';
const PLAN = [
  'Stack hello-stack 1.0.0: A hello.',
  `  digest   ${DIGEST}`,
  '  signed   no: there is no stack.sigstore.json, so only the digest vouches for these files:',
  'Hooks (1), declared by the stack and off: none is written, and turning one on is a separate act of yours:',
  '  format  on after-edit  hooks/format.sh  Formats.',
  '',
].join('\n');
const HELLO_ROW = {
  name: 'hello-stack',
  scope: 'public',
  version: '1.0.0',
  digest: DIGEST,
  files: 5,
  changed: 0,
  hooks: 1,
  hooksOn: 0,
  sound: true,
};
const PLAN_ARGS = 'stack add /src/hello --scope public --dry-run';
const WRITE_ARGS = `stack add /src/hello --scope public --expect ${DIGEST}`;
const withStack = (): Record<string, CliResult> => ({
  ...base(),
  [STACK_LIST]: ok(JSON.stringify({ stacks: [HELLO_ROW] })),
});

describe('the stacks adopted are listed from the command line', () => {
  it('shows each stack with its scope and whether it is sound, and says where a hook is turned on', async () => {
    const w = world(withStack());
    await settle();
    const [stack] = w.stackTree().getChildren();
    const node = w.stackTree().getTreeItem(stack as never);
    expect(node.label).toBe('hello-stack');
    expect(node.description).toBe('1.0.0 · public · sound');
    expect(String(node.tooltip)).toContain('1 hooks declared, 0 on');
    expect(String(node.tooltip)).toContain('mnema stack enable');
  });

  it('lists none when the command line cannot be read', async () => {
    const w = world({ ...base(), [STACK_LIST]: ok('not json') });
    await settle();
    expect(w.stackTree().getChildren()).toEqual([]);
  });
});

describe('a stack is added through the plan the command line shows', () => {
  it('shows the plan whole, asks once, and writes with the digest the plan printed', async () => {
    const w = world({
      ...withStack(),
      [PLAN_ARGS]: ok(PLAN),
      [WRITE_ARGS]: ok('Installed hello-stack 1.0.0: 5 files written.\n'),
    });
    await settle();
    w.setReply('/src/hello');
    w.picks.push('public');
    w.choose('Write these files');
    await w.command('mnema.stacks.add')();
    const planAt = w.ran.findIndex((a) => a.join(' ') === PLAN_ARGS);
    const writeAt = w.ran.findIndex((a) => a.join(' ') === WRITE_ARGS);
    expect(planAt).toBeGreaterThanOrEqual(0);
    expect(writeAt).toBeGreaterThan(planAt);
    // The plan reached the person whole, hooks and all, before the write was asked for.
    expect(w.channel.join('\n')).toContain(PLAN.trimEnd());
    expect(w.channel.join('\n')).toContain('This extension has no control that does it.');
    expect(w.shown[0]).toContain(`Digest ${DIGEST}`);
    expect(w.shown).toContain('Installed hello-stack 1.0.0: 5 files written.');
  });

  it('writes nothing when the person does not confirm', async () => {
    const w = world({ ...withStack(), [PLAN_ARGS]: ok(PLAN) });
    await settle();
    w.setReply('/src/hello');
    w.picks.push('public');
    w.choose(undefined);
    await w.command('mnema.stacks.add')();
    expect(w.ran.some((a) => a.includes('--expect'))).toBe(false);
    expect(w.channel.join('\n')).toContain(PLAN.trimEnd());
  });

  it('shows a refusal of the plan as the command line said it, and writes nothing', async () => {
    const w = world({
      ...withStack(),
      [PLAN_ARGS]: { code: 1, stdout: '', stderr: 'STACK_NAME_TAKEN: use --as' },
    });
    await settle();
    w.setReply('/src/hello');
    w.picks.push('public');
    w.choose('Write these files');
    await w.command('mnema.stacks.add')();
    expect(w.errors).toEqual(['mnema refused: STACK_NAME_TAKEN: use --as']);
    expect(w.ran.some((a) => a.includes('--expect'))).toBe(false);
  });

  it('does not ask a source that is empty or begins with a dash', async () => {
    const w = world(withStack());
    await settle();
    w.setReply('--scope');
    await w.command('mnema.stacks.add')();
    expect(w.inputs[0]?.validate('')).toBeDefined();
    expect(w.inputs[0]?.validate('--scope')).toBeDefined();
    expect(w.inputs[0]?.validate('/src/hello')).toBeUndefined();
    expect(w.ran.some((a) => a[0] === 'stack' && a[1] === 'add')).toBe(false);
  });
});

describe('a stack is added from the index', () => {
  const INDEX_ARGS = 'stack index stack-index --json';
  const entry = (over: Record<string, unknown> = {}) => ({
    name: 'hello-stack',
    version: '1.0.0',
    description: 'A hello.',
    link: 'https://example.com/hello',
    digest: DIGEST,
    source: '/src/hello',
    ...over,
  });

  it('plans the folder the entry names and writes only when the plan is the digest the index lists', async () => {
    const w = world({
      ...withStack(),
      [INDEX_ARGS]: ok(JSON.stringify({ stacks: [entry()] })),
      [PLAN_ARGS]: ok(PLAN),
      [WRITE_ARGS]: ok('Installed hello-stack 1.0.0: 5 files written.\n'),
    });
    await settle();
    w.picks.push('hello-stack 1.0.0', 'public');
    w.choose('Write these files');
    await w.command('mnema.stacks.addFromIndex')();
    expect(w.ran).toContainEqual([
      'stack',
      'add',
      '/src/hello',
      '--scope',
      'public',
      '--expect',
      DIGEST,
    ]);
  });

  it('refuses a folder whose plan is not the digest the index lists, and writes nothing', async () => {
    const other = 'a'.repeat(64);
    const w = world({
      ...withStack(),
      [INDEX_ARGS]: ok(JSON.stringify({ stacks: [entry({ digest: other })] })),
      [PLAN_ARGS]: ok(PLAN),
    });
    await settle();
    w.picks.push('hello-stack 1.0.0', 'public');
    w.choose('Write these files');
    await w.command('mnema.stacks.addFromIndex')();
    expect(w.errors[0]).toContain('is not the one the index lists');
    expect(w.ran.some((a) => a.includes('--expect'))).toBe(false);
  });

  it('sends an entry with no folder here to the terminal, with the digest to compare', async () => {
    const w = world({
      ...withStack(),
      [INDEX_ARGS]: ok(JSON.stringify({ stacks: [entry({ source: undefined })] })),
    });
    await settle();
    w.picks.push('hello-stack 1.0.0');
    await w.command('mnema.stacks.addFromIndex')();
    expect(w.shown.at(-1)).toContain('in a terminal');
    expect(w.shown.at(-1)).toContain(DIGEST);
    expect(w.ran.some((a) => a[1] === 'add')).toBe(false);
  });

  it('shows the command line refusing an index that is not there', async () => {
    const w = world({
      ...withStack(),
      [INDEX_ARGS]: { code: 1, stdout: '', stderr: 'STACK_INDEX_REFUSED: there is no index.json' },
    });
    await settle();
    await w.command('mnema.stacks.addFromIndex')();
    expect(w.errors[0]).toContain('STACK_INDEX_REFUSED');
  });
});

describe('an installed stack is looked at, removed and exported through the command line', () => {
  const stack = { name: 'hello-stack', scope: 'public' };

  it.each([
    ['show', 'Hooks (1), off unless you turned one on:\n  format  on after-edit  off\n'],
    ['diff', '= .claude/skills/hello/SKILL.md  as written\n'],
    ['check', '1 stacks checked: ok\n'],
  ])('%s prints what the command line printed', async (look, text) => {
    const w = world({ ...withStack(), [`stack ${look} hello-stack --scope public`]: ok(text) });
    await settle();
    await w.command(`mnema.stacks.${look}`)(stack);
    expect(w.channel.join('\n')).toContain(text.trimEnd());
  });

  it('shows the hooks a stack declares with the note that no control here turns one on', async () => {
    const w = world({
      ...withStack(),
      'stack show hello-stack --scope public': ok(
        'Hooks (1), off unless you turned one on:\n  format  on after-edit  off\n',
      ),
    });
    await settle();
    await w.command('mnema.stacks.show')(stack);
    expect(w.channel.join('\n')).toContain('format  on after-edit  off');
    expect(w.channel.join('\n')).toContain('`mnema stack enable <stack> <hook> --from <source>`');
  });

  it('shows what a departure prints though the command line exited 1', async () => {
    const w = world({
      ...withStack(),
      'stack check hello-stack --scope public': {
        code: 1,
        stdout: 'hello-stack (public): a.md is changed\n1 stacks checked: 1 departures.\n',
        stderr: '',
      },
    });
    await settle();
    await w.command('mnema.stacks.check')(stack);
    expect(w.channel.join('\n')).toContain('a.md is changed');
    expect(w.errors).toEqual([]);
  });

  it('removes only after showing what the dry run would remove, and asks once', async () => {
    const w = world({
      ...withStack(),
      'stack remove hello-stack --scope public --dry-run': ok(
        'Would remove hello-stack 1.0.0: 5 files.\n',
      ),
      'stack remove hello-stack --scope public': ok(
        'Removed hello-stack 1.0.0: 5 files.\nThe removal is recorded.\n',
      ),
    });
    await settle();
    w.choose('Remove');
    await w.command('mnema.stacks.remove')(stack);
    const dry = w.ran.findIndex((a) => a.includes('--dry-run') && a[1] === 'remove');
    const real = w.ran.findIndex((a) => a[1] === 'remove' && !a.includes('--dry-run'));
    expect(dry).toBeGreaterThanOrEqual(0);
    expect(real).toBeGreaterThan(dry);
    expect(w.shown).toContain('Removed hello-stack 1.0.0: 5 files.');
  });

  it('removes nothing when the person does not confirm', async () => {
    const w = world({
      ...withStack(),
      'stack remove hello-stack --scope public --dry-run': ok(
        'Would remove hello-stack 1.0.0: 5 files.\n',
      ),
    });
    await settle();
    w.choose(undefined);
    await w.command('mnema.stacks.remove')(stack);
    expect(w.ran.filter((a) => a[1] === 'remove' && !a.includes('--dry-run'))).toEqual([]);
  });

  it('exports into the folder the person typed', async () => {
    const w = world({
      ...withStack(),
      'stack export hello-stack /tmp/out --scope public': ok(
        'Exported hello-stack: 2 files into /tmp/out.\n',
      ),
    });
    await settle();
    w.setReply('/tmp/out');
    await w.command('mnema.stacks.export')(stack);
    expect(w.ran).toContainEqual([
      'stack',
      'export',
      'hello-stack',
      '/tmp/out',
      '--scope',
      'public',
    ]);
    expect(w.shown).toContain('Exported hello-stack: 2 files into /tmp/out.');
  });

  it('asks which stack when run from the palette', async () => {
    const w = world({ ...withStack(), 'stack show hello-stack --scope public': ok('x\n') });
    await settle();
    w.picks.push('hello-stack');
    await w.command('mnema.stacks.show')();
    expect(w.picked.at(-1)).toEqual(['hello-stack']);
    expect(w.ran).toContainEqual(['stack', 'show', 'hello-stack', '--scope', 'public']);
  });
});

describe('no control of the extension turns a hook on', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {
    contributes: {
      commands: { command: string; title: string }[];
      menus: Record<string, { command: string }[]>;
    };
  };

  it('declares exactly the commands it registers, and none of them is about turning a hook on or off', async () => {
    const w = world(withStack());
    await settle();
    const declared = manifest.contributes.commands.map((c) => c.command).sort();
    expect(w.ids().sort()).toEqual(declared);
    for (const command of manifest.contributes.commands) {
      expect(`${command.command} ${command.title}`, command.command).not.toMatch(
        /enable|disable|turn|hook/i,
      );
    }
    const menus = Object.values(manifest.contributes.menus).flat();
    expect(menus.every((item) => declared.includes(item.command))).toBe(true);
  });

  it('runs no `stack enable` or `stack disable` whatever is done with a stack that declares a hook', async () => {
    const w = world({
      ...withStack(),
      [PLAN_ARGS]: ok(PLAN),
      [WRITE_ARGS]: ok('Installed hello-stack 1.0.0: 5 files written.\n'),
      'stack index stack-index --json': ok(
        JSON.stringify({
          stacks: [
            {
              name: 'hello-stack',
              version: '1.0.0',
              description: 'A hello.',
              link: 'https://example.com/hello',
              digest: DIGEST,
              source: '/src/hello',
            },
          ],
        }),
      ),
    });
    await settle();
    const stack = { name: 'hello-stack', scope: 'public' };
    w.setReply('/src/hello');
    w.choose('Write these files');
    w.picks.push('public');
    await w.command('mnema.stacks.add')();
    w.picks.push('hello-stack 1.0.0', 'public');
    await w.command('mnema.stacks.addFromIndex')();
    for (const id of w.ids().filter((id) => id.startsWith('mnema.stacks.'))) {
      if (id === 'mnema.stacks.add' || id === 'mnema.stacks.addFromIndex') continue;
      w.choose('Remove');
      await w.command(id)(stack);
    }
    const stackActs = w.ran.filter((a) => a[0] === 'stack').map((a) => a[1]);
    expect(stackActs.length).toBeGreaterThan(5);
    expect(stackActs).not.toContain('enable');
    expect(stackActs).not.toContain('disable');
  });
});

describe('the same acts against the built command line, in a project of their own', () => {
  const CLI = fileURLToPath(new URL('../../code/dist/cli.js', import.meta.url));
  const HELLO = fileURLToPath(new URL('../../stacks/fixtures/hello-stack', import.meta.url));

  it('lists, adds from a folder and from the index, shows, checks, exports and removes', async () => {
    vi.useRealTimers();
    const sandbox = mkdtempSync(join(tmpdir(), 'mnema-extension-stacks-'));
    const kept = process.env.HOME;
    const project = join(sandbox, 'project');
    mkdirSync(project);
    mkdirSync(join(sandbox, 'home'));
    process.env.HOME = join(sandbox, 'home');
    try {
      const real = createRun(CLI, project);
      expect((await real(['init'])).code).toBe(0);
      const hello = join(project, 'stacks', 'hello');
      cpSync(HELLO, hello, { recursive: true });
      const plan = await real(['stack', 'add', hello, '--scope', 'public', '--dry-run']);
      const digest = /^ {2}digest {3}([0-9a-f]{64})$/m.exec(plan.stdout)?.[1] as string;
      expect(digest).toBeDefined();
      mkdirSync(join(project, 'stack-index'));
      writeFileSync(
        join(project, 'stack-index', 'index.json'),
        JSON.stringify({
          stacks: [
            {
              name: 'hello-stack',
              version: '1.0.0',
              description: 'A hello.',
              link: 'https://example.com/hello',
              digest,
              path: 'stacks/hello',
            },
          ],
        }),
      );
      const w = world({}, real, project);
      await vi.waitFor(() => expect(w.bar.text).not.toBe('mnema: reading'), { timeout: 20_000 });
      expect(w.stackTree().getChildren()).toEqual([]);

      // From the index: the plan the command line shows, then the write it was told to make.
      w.picks.push('hello-stack 1.0.0', 'public');
      w.choose('Write these files');
      await w.command('mnema.stacks.addFromIndex')();
      expect(w.channel.join('\n')).toContain(`  digest   ${digest}`);
      expect(w.channel.join('\n')).toContain('Hooks: none.');
      const [adopted] = w.stackTree().getChildren();
      expect(adopted).toMatchObject({ name: 'hello-stack', scope: 'public', sound: true });
      expect(w.stackTree().getTreeItem(adopted as never).description).toBe(
        '1.0.0 · public · sound',
      );

      await w.command('mnema.stacks.show')(adopted);
      expect(w.channel.join('\n')).toContain(`digest    ${digest}`);
      await w.command('mnema.stacks.check')(adopted);
      expect(w.channel.join('\n')).toContain('1 stacks checked: every file the receipts name');
      await w.command('mnema.stacks.diff')(adopted);
      expect(w.channel.join('\n')).toContain('as written');

      const out = join(sandbox, 'exported');
      w.setReply(out);
      await w.command('mnema.stacks.export')(adopted);
      expect(w.shown.at(-1)).toContain('Exported hello-stack');

      w.choose('Remove');
      await w.command('mnema.stacks.remove')(adopted);
      expect(w.shown.at(-1)).toContain('Removed hello-stack');
      expect(w.stackTree().getChildren()).toEqual([]);

      // A folder whose plan is not what the index lists is not written, and says so.
      appendFileSync(join(hello, 'skills', 'hello', 'SKILL.md'), '\nChanged.\n');
      w.picks.push('hello-stack 1.0.0', 'public');
      w.choose('Write these files');
      await w.command('mnema.stacks.addFromIndex')();
      expect(w.errors.at(-1)).toContain('is not the one the index lists');
      expect(w.stackTree().getChildren()).toEqual([]);
    } finally {
      if (kept === undefined) delete process.env.HOME;
      else process.env.HOME = kept;
      rmSync(sandbox, { recursive: true, force: true });
    }
  }, 120_000);
});
