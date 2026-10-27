import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CliResult, createRun, type Run } from './cli.js';
import { activate, QUIET_MS, VERIFY_EVERY_MS, type VscodeApi } from './extension.js';
import { rulesArgs } from './rules.js';
import { CONTAINER_COMMAND, MIN_CLI_VERSION, TOOLTIP_COMMANDS } from './status.js';
import { whyArgs } from './why.js';

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
/** What the person sends by pressing Enter on a box, whatever it holds. */
const ENTER = '\u0000enter';
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
/** What the command line built for a sample project with two proposals: the shape of `status --json`. */
const statusFixture = (
  name: string,
): Record<string, unknown> & {
  awaitingJudgement: Record<string, unknown>[];
} => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
/** One decision of `awaitingJudgement`, in the shape the command line gives it. */
const decision = (id: string, title: string, adr: string) => ({
  ...(statusFixture('status-2-awaiting').awaitingJudgement[0] as Record<string, unknown>),
  id,
  title,
  adr,
});
/** An answer of `status --json` that says these await a judgment, and `total` in all. */
const awaiting = (...items: ReturnType<typeof decision>[]): CliResult =>
  ok(
    JSON.stringify({
      ...statusFixture('status-2-awaiting'),
      awaitingJudgement: items,
      awaitingJudgementTotal: items.length,
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
  hidden: readonly string[] = [],
) {
  const setting = { command: 'mnema', statusBarEnabled: true };
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
    name: undefined as string | undefined,
    text: '',
    tooltip: '' as unknown,
    command: '',
    backgroundColor: undefined as unknown,
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
    value?: string;
    valueSelection?: [number, number];
  }[] = [];
  let reply: string | undefined;
  type Tree = { getChildren(): never[]; getTreeItem(e: never): Record<string, unknown> };
  const trees = new Map<string, Tree>();
  type View = {
    badge: { value: number; tooltip: string } | undefined;
    visible: boolean;
    listeners: ((e: { visible: boolean }) => void)[];
  };
  const treeViews = new Map<string, View>();
  let decorations:
    | {
        onDidChangeFileDecorations: (l: (u: { fsPath: string }) => void) => unknown;
        provideFileDecoration(u: unknown): unknown;
      }
    | undefined;
  /** The addresses the extension told the Explorer to ask about again. */
  const redecorated: string[] = [];
  const channel: string[] = [];
  const picks: string[] = [];
  const picked: string[][] = [];
  const pickOptions: { title: string; ignoreFocusOut?: boolean }[] = [];
  let choice: string | undefined;
  let lenses: { provideCodeLenses(d: never): Promise<unknown[]> } | undefined;
  // The documents of the scheme the extension serves, as the editor holds them: read when opened,
  // and read again when the provider says it changed.
  type Address = { scheme: string; path: string; query: string; fsPath: string };
  type Content = {
    onDidChange: (l: (u: Address) => void) => unknown;
    provideTextDocumentContent(u: Address): Promise<string>;
  };
  const contents = new Map<string, Content>();
  const documents = new Map<string, { uri: Address; text: string }>();
  const opened: Address[] = [];
  let active: { document: { uri: Address } } | undefined;
  const activeListeners: (() => void)[] = [];
  /** The addresses the provider announced as changed: what the extension still thinks is open. */
  const announced: string[] = [];
  const closeListeners: ((d: { uri: Address }) => void)[] = [];
  const api = {
    workspace: {
      workspaceFolders: [{ uri: { fsPath: root } }],
      getConfiguration: () => ({
        get: <T>(k: string, d: T) =>
          k === 'command'
            ? (setting.command as T)
            : k === 'statusBar.enabled'
              ? (setting.statusBarEnabled as T)
              : d,
      }),
      onDidChangeConfiguration: (l: (e: { affectsConfiguration(s: string): boolean }) => void) => {
        settingListeners.push(l);
        return { dispose() {} };
      },
      registerTextDocumentContentProvider: (scheme: string, provider: Content) => {
        contents.set(scheme, provider);
        provider.onDidChange(async (uri) => {
          announced.push(uri.query);
          const known = documents.get(uri.query);
          if (known !== undefined) known.text = await provider.provideTextDocumentContent(uri);
        });
        return { dispose() {} };
      },
      onDidCloseTextDocument: (l: (d: { uri: Address }) => void) => {
        closeListeners.push(l);
        return { dispose() {} };
      },
      openTextDocument: async (uri: Address) => {
        opened.push(uri);
        const document = {
          uri,
          text: await (contents.get(uri.scheme) as Content).provideTextDocumentContent(uri),
        };
        documents.set(uri.query, document);
        return document;
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
    Uri: {
      from: (parts: { scheme: string; path: string; query: string }) => ({
        ...parts,
        fsPath: parts.path,
      }),
      file: (path: string) => ({ scheme: 'file', path, query: '', fsPath: path }),
    },
    window: {
      createStatusBarItem: () => bar,
      createTreeView: (id: string, options: { treeDataProvider: Tree }) => {
        trees.set(id, options.treeDataProvider);
        const listeners: View['listeners'] = [];
        const view = {
          badge: undefined,
          visible: !hidden.includes(id),
          listeners,
          onDidChangeVisibility: (l: View['listeners'][number]) => {
            listeners.push(l);
            return { dispose() {} };
          },
          dispose() {},
        };
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
        // Enter on a box that holds a value sends that value.
        return reply === ENTER ? (o as { value?: string }).value : reply;
      },
      showQuickPick: async (
        items: { label: string }[],
        options: { title: string; ignoreFocusOut?: boolean },
      ) => {
        pickOptions.push(options);
        picked.push(items.map((i) => i.label));
        const want = picks.shift();
        // A pick is made by the name a person reads: the codicon in front of it is not part of it.
        return items.find(
          (i) => i.label === want || i.label.replace(/^\$\([a-z-]+\) /, '') === want,
        );
      },
      registerFileDecorationProvider: (p: NonNullable<typeof decorations>) => {
        decorations = p;
        p.onDidChangeFileDecorations((u) => redecorated.push(u.fsPath));
        return { dispose() {} };
      },
      showInformationMessage: async (m: string, ...actions: string[]) => {
        shown.push(m);
        return actions.includes(choice ?? '') ? choice : undefined;
      },
      showErrorMessage: async (m: string) => {
        errors.push(m);
        return undefined;
      },
      get activeTextEditor() {
        return active;
      },
      onDidChangeActiveTextEditor: (l: () => void) => {
        activeListeners.push(l);
        return { dispose() {} };
      },
      showTextDocument: async (document: { uri: Address }) => {
        active = { document };
        for (const l of activeListeners) l();
        return undefined;
      },
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
      private listeners: ((e: unknown) => unknown)[] = [];
      event = (l: (e: unknown) => unknown) => {
        this.listeners.push(l);
        return { dispose() {} };
      };
      fire(e: unknown) {
        for (const l of this.listeners) l(e);
      }
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
    MarkdownString: class {
      isTrusted: unknown;
      supportHtml: unknown;
      constructor(readonly value: string) {}
    },
    ThemeColor: class {
      constructor(readonly id: string) {}
    },
    FileDecoration: class {
      constructor(
        readonly badge: string,
        readonly tooltip: string,
        readonly color: { id: string },
      ) {}
    },
    ThemeIcon: class {
      constructor(
        readonly id: string,
        readonly color?: { id: string },
      ) {}
    },
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
    redecorated,
    /** Brings a file to the front of the editor, as opening it does. */
    openInEditor: (uri: Address) => {
      active = { document: { uri } };
    },
    /** Shows or hides a view of the side bar, as the editor does: its listeners are told. */
    setVisible: (id: string, visible: boolean) => {
      const view = treeViews.get(id) as View;
      view.visible = visible;
      for (const l of view.listeners) l({ visible });
    },
    /** What the Explorer is told about an address: the decoration of the provider, or nothing. */
    decorate: (uri: { scheme: string; fsPath: string }) =>
      (decorations as NonNullable<typeof decorations>).provideFileDecoration(uri) as
        | { badge: string; tooltip: string; color: { id: string } }
        | undefined,
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
    /** The documents the extension serves that the editor has opened, and what each says now. */
    documents,
    opened,
    /** The editor in front: a document the extension served, as `showTextDocument` made it so. */
    active: () => active?.document.uri,
    announced,
    /** Closes a tab: the editor drops the document and tells the listeners. */
    close: (query: string) => {
      const document = documents.get(query) as NonNullable<ReturnType<typeof documents.get>>;
      documents.delete(query);
      for (const l of closeListeners) l(document);
    },
    /** Brings an already opened document to the front, as a click on its tab does. */
    focus: (query: string) => {
      active = { document: documents.get(query) as NonNullable<ReturnType<typeof documents.get>> };
      for (const l of activeListeners) l();
    },
    /** The markdown of the status bar tooltip, as the editor was handed it. */
    tooltip: () => (bar.tooltip as { value: string }).value,
    trust: () => (bar.tooltip as { isTrusted: unknown }).isTrusted,
    html: () => (bar.tooltip as { supportHtml: unknown }).supportHtml,
  };
}

const LIST = 'search --kind decision --state proposed --limit 200 --json';
const STATUS = 'status --json';
const STACK_LIST = 'stack list --json';
const COVERAGE = 'public: local integrity verified (T1/T2/T4); external witness (T3): not covered';
const base = (): Record<string, CliResult> => ({
  '--version': ok(`${MIN_CLI_VERSION}\n`),
  verify: ok(`${COVERAGE}\n`),
  [STACK_LIST]: ok(JSON.stringify({ stacks: [] })),
  [STATUS]: awaiting(decision('d1', 'Use X', 'ADR-1')),
  'verify --json': VERIFY,
  switch: SWITCH,
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
/** The commands a run started, one string each, in the order they were started. */
const calls = (w: { ran: string[][] }): string[] => w.ran.map((args) => args.join(' '));

describe('the extension reads the record through the command line', () => {
  it('shows the level and what awaits in the status bar, and the detail in its tooltip', async () => {
    const w = world(base());
    await settle();
    expect(w.bar.name).toBe('mnema');
    expect(w.bar.text).toBe('$(book) fully-signed · 1 to judge');
    expect(w.bar.accessibilityInformation).toEqual({
      label: 'mnema: fully-signed, 1 decision awaits a judgment',
      role: 'button',
    });
    expect(w.bar.backgroundColor).toBeUndefined();
    const tip = w.tooltip();
    expect(tip).toContain('[1 decision awaits a judgment](command:workbench.view.extension.mnema)');
    expect(tip).toContain(`\`\`\`\n${COVERAGE}\n\`\`\``);
    expect(tip).toContain('Channels off: user\\-corrections');
    expect(tip).toMatch(/Read at \d\d:\d\d:\d\d/);
    expect(w.executed).toContainEqual(['setContext', 'mnema.cliMissing', false]);
    expect(w.started?.shown()).toEqual({
      text: w.bar.text,
      tooltip: tip,
      command: CONTAINER_COMMAND,
      visible: true,
      badge: { value: 1, tooltip: '1 decision awaits a judgment' },
    });
  });

  it('trusts the commands the tooltip lists and no other, and never a verb that judges', async () => {
    const w = world(base());
    await settle();
    expect(w.trust()).toEqual({ enabledCommands: TOOLTIP_COMMANDS });
    expect(w.html()).toBe(false);
    expect(TOOLTIP_COMMANDS).not.toContain('mnema.accept');
    expect(TOOLTIP_COMMANDS).not.toContain('mnema.reject');
    // Every command a link in the tooltip runs is one the editor was told to trust.
    for (const link of w.tooltip().matchAll(/\(command:([^)?]+)/g)) {
      expect(TOOLTIP_COMMANDS).toContain(link[1]);
    }
  });

  it('opens the container on a click, in every state', async () => {
    const answers: Record<string, CliResult> = { ...base() };
    const w = world(answers);
    await settle();
    expect(w.bar.command).toBe('workbench.view.extension.mnema');
    answers['--version'] = { code: null, stdout: '', stderr: 'spawn mnema ENOENT' };
    await w.command('mnema.refresh')();
    expect(w.bar.text).toBe('$(warning) mnema not found');
    expect(w.bar.command).toBe('workbench.view.extension.mnema');
    answers['--version'] = ok(`${MIN_CLI_VERSION}\n`);
    answers['verify --json'] = ok('{"ok": false, "record": {"ok": false, "level": "broken"}}');
    await w.command('mnema.refresh')();
    expect(w.bar.command).toBe('workbench.view.extension.mnema');
  });

  it('wears the warning background of the theme when mnema verify failed, and says what failed', async () => {
    const answers: Record<string, CliResult> = {
      ...base(),
      'verify --json': ok('{"ok": true, "record": {"ok": false, "level": "broken"}}'),
    };
    const w = world(answers);
    await settle();
    expect(w.bar.text).toBe('$(error) verify failed · 1 to judge');
    expect(w.bar.backgroundColor).toEqual({ id: 'statusBarItem.warningBackground' });
    expect(w.tooltip()).toContain(COVERAGE);
    // A later reading that verifies takes the color away again.
    answers['verify --json'] = VERIFY;
    await w.command('mnema.refresh')();
    expect(w.bar.backgroundColor).toBeUndefined();
  });

  it('carries the issues mnema verify listed on its error output when it failed, as they came', async () => {
    const answers: Record<string, CliResult> = {
      ...base(),
      'verify --json': ok('{"ok": true, "record": {"ok": false, "level": "broken"}}'),
      verify: {
        code: 1,
        stdout: 'public: local integrity FAILED: see issues\n',
        stderr: '  issue [T1] public tail#3: entry hash mismatch\n',
      },
    };
    const w = world(answers);
    await settle();
    expect(w.tooltip()).toContain('public: local integrity FAILED: see issues');
    expect(w.tooltip()).toContain('issue [T1] public tail#3: entry hash mismatch');
  });

  it('shows a lens text that carries a command link as plain text, never as a link', async () => {
    const channel = '[judge](command:mnema.accept)';
    const hostile = `${channel} \`x\` <b>y</b>`;
    const answers: Record<string, CliResult> = {
      ...base(),
      switch: ok(`2 channel(s):\n  ${channel}  off  y\n  brief-document  on  x\n`),
      verify: ok(`${hostile}\n\`\`\`\n[z](command:mnema.reject)\n`),
    };
    const w = world(answers);
    await settle();
    const tip = w.tooltip();
    // Outside the code blocks there is no link left: every punctuation mark of the name is escaped.
    const outside = tip.replace(/(`{3,})\n[\s\S]*?\n\1/g, '');
    expect(outside).toContain('\\[judge\\]\\(command\\:mnema\\.accept\\)');
    expect(outside).not.toContain('[judge](command:mnema.accept)');
    // What `mnema verify` printed is in a fence longer than any run of backticks it carries.
    expect(tip).toContain('````\n' + `${hostile}\n\`\`\`\n[z](command:mnema.reject)` + '\n````');
  });

  it('is shown and hidden by the setting, without a reload, and no repository can hide it', async () => {
    const w = world(base());
    await settle();
    expect(w.bar.visible).toBe(true);
    w.setting.statusBarEnabled = false;
    for (const l of w.settingListeners)
      l({ affectsConfiguration: (s) => s === 'mnema.statusBar.enabled' });
    expect(w.bar.visible).toBe(false);
    // A reading while it is off does not bring it back.
    await w.command('mnema.refresh')();
    expect(w.bar.visible).toBe(false);
    expect(w.started?.shown().visible).toBe(false);
    w.setting.statusBarEnabled = true;
    for (const l of w.settingListeners)
      l({ affectsConfiguration: (s) => s === 'mnema.statusBar.enabled' });
    expect(w.bar.visible).toBe(true);
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(manifest.contributes.configuration.properties['mnema.statusBar.enabled'].scope).toBe(
      'machine',
    );
  });

  it('says the command is missing, apart from nothing pending, and keeps the click on the container', async () => {
    const w = world({
      ...base(),
      '--version': { code: null, stdout: '', stderr: 'spawn mnema ENOENT' },
    });
    await settle();
    expect(w.executed).toContainEqual(['setContext', 'mnema.cliMissing', true]);
    expect(w.bar.text).toBe('$(warning) mnema not found');
    expect(w.tooltip()).toContain('spawn mnema ENOENT');
    expect(w.tooltip()).toContain('mnema.command');
    expect(w.bar.accessibilityInformation).toEqual({
      label: 'mnema: command not found',
      role: 'button',
    });
    expect(w.bar.command).toBe(CONTAINER_COMMAND);
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
    expect(w.bar.text).toBe('$(book) fully-signed · 1 to judge');
    expect(w.bar.command).toBe(CONTAINER_COMMAND);
    expect(w.tree().getChildren()).toHaveLength(1);
  });

  it('reads the mnema.command setting again at every refresh, and when it changes, so a corrected setting clears "command not found" without a reload', async () => {
    const w = world(base(), undefined, undefined, true);
    w.setting.command = 'typo';
    await w.command('mnema.refresh')();
    expect(w.bar.text).toBe('$(warning) mnema not found');
    expect(w.tooltip()).toContain('spawn typo ENOENT');

    // Changing the setting is enough: the editor says so, and no Refresh is asked for.
    w.setting.command = 'good';
    const unrelated = { affectsConfiguration: (s: string) => s === 'editor.fontSize' };
    for (const l of w.settingListeners) l(unrelated);
    await settle();
    expect(w.bar.text).toBe('$(warning) mnema not found');
    for (const l of w.settingListeners) l({ affectsConfiguration: (s) => s === 'mnema.command' });
    await settle();
    expect(w.bar.text).toBe('$(book) fully-signed · 1 to judge');
    expect(w.makeRuns.at(-1)).toBe('good');

    // And a Refresh alone reads it too, with no event.
    w.setting.command = 'typo-again';
    await w.command('mnema.refresh')();
    expect(w.makeRuns.at(-1)).toBe('typo-again');
    expect(w.bar.text).toBe('$(warning) mnema not found');
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

  it('lists what waits for a judgment with its ADR, from one status and no show', async () => {
    const w = world(base());
    await settle();
    const [item] = w.tree().getChildren();
    const node = w.tree().getTreeItem(item as never);
    expect(node.label).toBe('Use X');
    expect(node.description).toBe('ADR-1');
    expect(node.tooltip).toBe('ADR-1: Use X');
    expect(w.ran.filter((args) => args[0] === 'show')).toEqual([]);
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
    expect(w.ran).toContainEqual(['rules', '--json', '--', 'src/a.ts']);
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
    expect(w.shown).toContain('ADR-1 accepted.');
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
    expect(w.inputs.map((i) => i.title)).toEqual(['Accept ADR-1', 'Add Stack', 'Export Stack']);
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
    for (const stdout of ['not json at all', '{"total":0}']) {
      const garbled = world({ ...withStack(), [STACK_LIST]: ok(stdout) });
      await settle();
      expect(garbled.executed, stdout).toContainEqual(['setContext', 'mnema.stacksRead', false]);
      expect(garbled.executed, stdout).not.toContainEqual(['setContext', 'mnema.stacksRead', true]);
    }
    const empty = world({ ...withStack(), [STACK_LIST]: ok('{"stacks":[]}') });
    await settle();
    expect(empty.executed).toContainEqual(['setContext', 'mnema.stacksRead', true]);
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

/** What the command line built for two decisions of a sample project: one proposed, one accepted. */
const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8');
const PROPOSED_ID = (JSON.parse(fixture('show-proposed')) as { id: string }).id;
const ACCEPTED_ID = (JSON.parse(fixture('show-accepted')) as { id: string }).id;
const STAMP = '2026-10-27, accepted in the VS Code extension, no reason typed';
/** The same answer of `show`, said again after another move: only the state differs. */
const movedTo = (name: string, state: string): CliResult => {
  const answer = JSON.parse(fixture(name)) as { record: Record<string, unknown> };
  answer.record.state = state;
  return ok(JSON.stringify(answer));
};
const sample = (): Record<string, CliResult> => ({
  ...base(),
  [STATUS]: awaiting(decision(PROPOSED_ID, 'Write migrations by hand', 'ADR-2')),
  [`show ${PROPOSED_ID} --json`]: ok(fixture('show-proposed')),
  [`show ${ACCEPTED_ID} --json`]: ok(fixture('show-accepted')),
  rules: ok(
    JSON.stringify({
      rules: [
        {
          rule: ACCEPTED_ID,
          kind: 'decision',
          name: 'Use SQLite for the cache',
          state: 'accepted',
          acceptance: { by: 'mnid:a' },
        },
      ],
    }),
  ),
});
const proposal = { id: PROPOSED_ID, title: 'Write migrations by hand', scope: 'public', at: '' };
/** The last value the extension set for a context key. */
const keyOf = (w: ReturnType<typeof world>, key: string): unknown =>
  w.executed.filter((call) => call[0] === 'setContext' && call[1] === key).at(-1)?.[2];

describe('a decision opens whole, as what mnema show said', () => {
  it('opens at the address of its id, named by its ADR, and asks the command line for it', async () => {
    const w = world(sample());
    await settle();
    w.ran.length = 0;
    await w.command('mnema.openDecision')(proposal);
    expect(w.ran).toEqual([['show', PROPOSED_ID, '--json']]);
    expect(w.opened).toHaveLength(1);
    expect(w.opened[0]).toMatchObject({
      scheme: 'mnema-decision',
      path: '/ADR-2',
      query: `id=${PROPOSED_ID}`,
    });
    const text = w.documents.get(`id=${PROPOSED_ID}`)?.text ?? '';
    expect(text).toContain('# ADR-2: Write migrations by hand');
    expect(text).toContain("The ORM's generator drifts from what we review.");
    expect(text).toContain('- State: proposed');
    expect(text).toContain(`\`mnema show ${PROPOSED_ID} --json\``);
  });

  it('is what a click on an item of the list runs, with that item', async () => {
    const w = world(sample());
    await settle();
    const [item] = w.tree().getChildren();
    const node = w.tree().getTreeItem(item as never);
    expect(node.command).toEqual({
      command: 'mnema.openDecision',
      title: 'Open Decision',
      arguments: [item],
    });
  });

  it('asks which decision, from the palette, and opens the one picked', async () => {
    const w = world(sample());
    await settle();
    w.picks.push('Write migrations by hand');
    await w.command('mnema.openDecision')(undefined);
    expect(w.picked.at(-1)).toEqual(['Write migrations by hand']);
    expect(w.opened.map((u) => u.query)).toEqual([`id=${PROPOSED_ID}`]);
  });

  it('shows the alternatives and the moves an accepted decision carries, and a justification with a link or a tag as plain text', async () => {
    const w = world(sample());
    await settle();
    w.picks.push('Use SQLite for the cache');
    await w.command('mnema.showRules')('src/a.ts');
    const text = w.documents.get(`id=${ACCEPTED_ID}`)?.text ?? '';
    expect(text).toContain('## Alternatives\n\nRedis: a server to run');
    expect(text).toContain('## Moves');
    expect(text).toContain('[x](command:mnema.accept) <b>bold</b>');
    expect(text).toContain('- State: accepted');
  });

  it('opens the rule a lens led to, whole, and shows no judgment button for one in force', async () => {
    const w = world(sample());
    await settle();
    w.picks.push('Use SQLite for the cache');
    await w.command('mnema.showRules')('src/a.ts');
    expect(w.opened.map((u) => u.query)).toEqual([`id=${ACCEPTED_ID}`]);
    expect(w.active()?.query).toBe(`id=${ACCEPTED_ID}`);
    expect(keyOf(w, 'mnema.activeDecisionProposed')).toBe(false);
  });

  it('reads again each time it is opened: a decision that moved shows its new state', async () => {
    const answers = sample();
    const w = world(answers);
    await settle();
    await w.command('mnema.openDecision')(proposal);
    expect(w.documents.get(`id=${PROPOSED_ID}`)?.text).toContain('- State: proposed');
    answers[`show ${PROPOSED_ID} --json`] = movedTo('show-proposed', 'accepted');
    await w.command('mnema.openDecision')(proposal);
    expect(w.documents.get(`id=${PROPOSED_ID}`)?.text).toContain('- State: accepted');
  });

  it('reads again the documents that stay open at each reading of the record', async () => {
    const answers = sample();
    const w = world(answers);
    await settle();
    await w.command('mnema.openDecision')(proposal);
    answers[`show ${PROPOSED_ID} --json`] = movedTo('show-proposed', 'accepted');
    await w.command('mnema.refresh')();
    await settle();
    expect(w.documents.get(`id=${PROPOSED_ID}`)?.text).toContain('- State: accepted');
    expect(keyOf(w, 'mnema.activeDecisionProposed')).toBe(false);
  });

  it('stops announcing a document that was closed as changed, and did announce it while it was open', async () => {
    const answers = sample();
    const w = world(answers);
    await settle();
    await w.command('mnema.openDecision')(proposal);
    await w.command('mnema.refresh')();
    await settle();
    expect(w.announced).toEqual([`id=${PROPOSED_ID}`]);
    w.close(`id=${PROPOSED_ID}`);
    w.announced.length = 0;
    await w.command('mnema.refresh')();
    await settle();
    expect(w.announced).toEqual([]);
    expect(w.documents.has(`id=${PROPOSED_ID}`)).toBe(false);
  });

  it('says whether the decision in front is proposed, for the buttons of the editor title', async () => {
    const w = world(sample());
    await settle();
    await w.command('mnema.openDecision')(proposal);
    expect(keyOf(w, 'mnema.activeDecisionProposed')).toBe(true);
    w.focus(`id=${PROPOSED_ID}`);
    expect(keyOf(w, 'mnema.activeDecisionProposed')).toBe(true);
  });

  it('shows the refusal of the command line when it cannot read the decision, and no field of one', async () => {
    const answers = sample();
    answers[`show ${PROPOSED_ID} --json`] = { code: 1, stdout: '', stderr: 'no such decision' };
    const w = world(answers);
    await settle();
    await w.command('mnema.openDecision')(proposal);
    const text = w.documents.get(`id=${PROPOSED_ID}`)?.text ?? '';
    expect(text).toContain('mnema refused: no such decision');
    expect(text).not.toContain('State');
    expect(keyOf(w, 'mnema.activeDecisionProposed')).toBe(false);
  });

  it('takes the scope from what show said, and the list of status carries none to take', async () => {
    const answers = sample();
    const w = world(answers);
    await settle();
    expect(w.tree().getChildren()[0]).not.toHaveProperty('scope');
    await w.command('mnema.openDecision')(proposal);
    expect(w.documents.get(`id=${PROPOSED_ID}`)?.text).toContain('- Scope: public');
    const noScope = JSON.parse(fixture('show-proposed')) as Record<string, unknown>;
    delete noScope.scope;
    answers[`show ${PROPOSED_ID} --json`] = ok(JSON.stringify(noScope));
    await w.command('mnema.openDecision')(proposal);
    expect(w.documents.get(`id=${PROPOSED_ID}`)?.text).not.toContain('Scope');
  });

  it('does not open in a folder with no record, and starts no process', async () => {
    const w = world(sample(), undefined, folderWith(false));
    await settle();
    await w.command('mnema.openDecision')(proposal);
    expect(w.opened).toEqual([]);
    expect(w.ran).toEqual([]);
    expect(w.shown).toContain(
      'This folder holds no .mnema record. Run mnema init in a terminal here.',
    );
  });
});

describe('a decision is judged from the title of its editor, with a note the person sends', () => {
  const accept = `decision move accept ${PROPOSED_ID} --note`;

  /** The address of the decision in front, as the title buttons hand it to the command. */
  async function opened(answers: Record<string, CliResult>) {
    const w = world(answers);
    await settle();
    await w.command('mnema.openDecision')(proposal);
    return { w, uri: w.active() };
  }

  it('accepts with the note typed, one decision, by the verb of the command line', async () => {
    const { w, uri } = await opened({
      ...sample(),
      [`${accept} It fits the review process`]: ok(`Decision ADR-2 (${PROPOSED_ID}) → accepted\n`),
    });
    w.setReply('It fits the review process');
    await w.command('mnema.accept')(uri);
    expect(w.ran).toContainEqual([
      'decision',
      'move',
      'accept',
      PROPOSED_ID,
      '--note',
      'It fits the review process',
    ]);
    expect(w.shown).toContain('ADR-2 accepted.');
    expect(w.inputs.at(-1)?.title).toBe('Accept ADR-2');
    expect(w.inputs.at(-1)?.prompt).toBe(
      '"Write migrations by hand". Enter keeps the stamp, or type a reason. The note is recorded with the verdict.',
    );
    expect(w.inputs.at(-1)?.placeHolder).toBe('Why? Required.');
  });

  it('rejects with the note typed, from the same buttons', async () => {
    const { w, uri } = await opened(sample());
    w.setReply('Conflicts with the review process');
    await w.command('mnema.reject')(uri);
    expect(w.ran).toContainEqual([
      'decision',
      'move',
      'reject',
      PROPOSED_ID,
      '--note',
      'Conflicts with the review process',
    ]);
    expect(w.inputs.at(-1)?.title).toBe('Reject ADR-2');
  });

  it('sends nothing when the note is empty, only spaces, or the box is cancelled', async () => {
    const { w, uri } = await opened(sample());
    for (const reply of ['', '   ', undefined]) {
      w.setReply(reply);
      await w.command('mnema.reject')(uri);
      await w.command('mnema.accept')(uri);
    }
    expect(w.ran.some((args) => args[0] === 'decision')).toBe(false);
  });

  it('offers a true stamp on an accept, kept as it stands when the person only presses Enter', async () => {
    vi.setSystemTime(new Date(2026, 9, 27, 10, 30));
    const { w, uri } = await opened({
      ...sample(),
      [`${accept} ${STAMP}`]: ok('Decision ADR-2 (x) → accepted'),
    });
    w.setReply(ENTER);
    await w.command('mnema.accept')(uri);
    expect(w.inputs.at(-1)?.value).toBe(STAMP);
    expect(w.inputs.at(-1)?.valueSelection).toEqual([0, STAMP.length]);
    expect(w.ran).toContainEqual(['decision', 'move', 'accept', PROPOSED_ID, '--note', STAMP]);
  });

  it('sends the reason the person typed in place of the stamp', async () => {
    vi.setSystemTime(new Date(2026, 9, 27, 10, 30));
    const { w, uri } = await opened(sample());
    w.setReply('Hand-written migrations are reviewed line by line');
    await w.command('mnema.accept')(uri);
    expect(w.ran).toContainEqual([
      'decision',
      'move',
      'accept',
      PROPOSED_ID,
      '--note',
      'Hand-written migrations are reviewed line by line',
    ]);
    expect(w.ran.flat()).not.toContain(STAMP);
  });

  it('offers no stamp on a reject: the box is empty and the reason has to be typed', async () => {
    const { w, uri } = await opened(sample());
    w.setReply(ENTER);
    await w.command('mnema.reject')(uri);
    expect(w.inputs.at(-1)?.value).toBeUndefined();
    expect(w.inputs.at(-1)?.valueSelection).toBeUndefined();
    expect(w.inputs.at(-1)?.validate('')).toBeDefined();
    expect(w.inputs.at(-1)?.validate(STAMP)).toBeUndefined();
    expect(w.ran.some((args) => args[0] === 'decision')).toBe(false);
  });

  it('never copies what the record says into the stamp: neither its justification nor its title', async () => {
    vi.setSystemTime(new Date(2026, 9, 27, 10, 30));
    const { w, uri } = await opened(sample());
    w.setReply(ENTER);
    await w.command('mnema.accept')(uri);
    await w.command('mnema.accept')(proposal);
    for (const input of w.inputs) {
      expect(input.value, input.title).toBe(STAMP);
      expect(input.value, input.title).not.toContain('ORM');
      expect(input.value, input.title).not.toContain('migrations');
    }
    const notes = w.ran.filter((args) => args[0] === 'decision').map((args) => args[5]);
    expect(notes).toEqual([STAMP, STAMP]);
  });

  it('judges one decision per act: every `decision move` has exactly one id', async () => {
    const { w, uri } = await opened(sample());
    w.setReply('a reason');
    await w.command('mnema.accept')(uri);
    await w.command('mnema.reject')(proposal);
    const moves = w.ran.filter((args) => args[0] === 'decision');
    expect(moves).toHaveLength(2);
    for (const args of moves) {
      expect(args).toHaveLength(6);
      expect(args.slice(0, 2)).toEqual(['decision', 'move']);
      expect(args[3]).toBe(PROPOSED_ID);
    }
  });

  it('builds `decision move` in one place only: judgeArgs', () => {
    const dir = new URL('.', import.meta.url);
    const holders = readdirSync(dir).filter(
      (name) =>
        name.endsWith('.ts') &&
        !name.endsWith('.test.ts') &&
        /'decision',\s*'move'/.test(readFileSync(new URL(name, dir), 'utf8')),
    );
    expect(holders).toEqual(['proposed.ts']);
    const source = readFileSync(new URL('./extension.ts', import.meta.url), 'utf8');
    expect(source.match(/judgeArgs\(/g)).toHaveLength(1);
  });

  it('shows what the command line refused, and never says accepted when it did not', async () => {
    const { w, uri } = await opened({
      ...sample(),
      [`${accept} n`]: { code: 1, stdout: '', stderr: 'Decision is not proposed.' },
    });
    w.setReply('n');
    await w.command('mnema.accept')(uri);
    expect(w.errors).toEqual(['mnema refused: Decision is not proposed.']);
    expect(w.shown.join('\n')).not.toMatch(/accepted/);
  });

  it('shows a line it does not recognize as it came', async () => {
    const { w, uri } = await opened({ ...sample(), [`${accept} n`]: ok('Recorded. Done.\n') });
    w.setReply('n');
    await w.command('mnema.accept')(uri);
    expect(w.shown).toContain('Recorded. Done.');
  });

  it('puts the buttons on the title of the editor of a decision, only while it is proposed', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      contributes: { menus: Record<string, { command: string; when: string; group: string }[]> };
    };
    const title = manifest.contributes.menus['editor/title'] ?? [];
    expect(title.map((item) => [item.command, item.group])).toEqual([
      ['mnema.accept', 'navigation@1'],
      ['mnema.reject', 'navigation@2'],
    ]);
    for (const item of title) {
      expect(item.when).toBe('resourceScheme == mnema-decision && mnema.activeDecisionProposed');
    }
  });
});

describe('every item of the views carries an icon for its state and a spoken name', () => {
  /** Icons that read as a verdict: an item that awaits one, or departs, must never wear them. */
  const VERDICT = /^(check|pass|pass-filled|verified|verified-filled|workspace-trusted|shield)$/;
  const icon = (node: Record<string, unknown>) =>
    node.iconPath as { id: string; color?: { id: string } };
  const READY = {
    name: 'hello-stack',
    scope: 'public',
    version: '1.0.0',
    digest: 'a'.repeat(64),
    files: 5,
    changed: 0,
    hooks: 0,
    hooksOn: 0,
    sound: true,
  };

  it('marks a proposal with a neutral icon and says it awaits a judgment', async () => {
    const w = world(sample());
    await settle();
    const [item] = w.tree().getChildren();
    const node = w.tree().getTreeItem(item as never);
    expect(icon(node).id).toBe('circle-outline');
    expect(icon(node).id).not.toMatch(VERDICT);
    expect(node.accessibilityInformation).toEqual({
      label: 'ADR-2, Write migrations by hand, awaits a judgment',
    });
  });

  it('shows a short tooltip: the ADR and the title, and the whole text opens on a click', async () => {
    const w = world(sample());
    await settle();
    const [item] = w.tree().getChildren();
    expect(w.tree().getTreeItem(item as never).tooltip).toBe('ADR-2: Write migrations by hand');
  });

  it('marks a stack by what the command line reported, and no state icon is a verdict', async () => {
    const departs = { ...READY, name: 'drifted', sound: false, changed: 2 };
    const refused = { name: 'broken', scope: 'private', refused: 'digest differs', sound: false };
    const w = world({
      ...sample(),
      [STACK_LIST]: ok(JSON.stringify({ stacks: [READY, departs, refused] })),
    });
    await settle();
    const nodes = w
      .stackTree()
      .getChildren()
      .map((stack) => w.stackTree().getTreeItem(stack));
    expect(nodes.map((n) => [icon(n).id, icon(n).color?.id])).toEqual([
      ['package', undefined],
      ['warning', 'list.warningForeground'],
      ['error', 'list.errorForeground'],
    ]);
    for (const node of nodes) expect(icon(node).id).not.toMatch(VERDICT);
    expect(nodes.map((n) => (n.accessibilityInformation as { label: string }).label)).toEqual([
      'hello-stack, public, sound',
      'drifted, public, departs from what was written',
      'broken, private, receipt refused',
    ]);
    // The colour is never the only sign: the text beside the icon says the state too.
    expect(nodes.map((n) => n.description)).toEqual([
      '1.0.0 · public · sound',
      '1.0.0 · public · DEPARTS',
      'private · receipt refused',
    ]);
  });

  it('puts a codicon before each scope when asking where to install, and sends the bare name', async () => {
    const w = world(sample());
    await settle();
    w.setReply('./my-stack');
    w.picks.push('private');
    w.choose(undefined);
    await w.command('mnema.stacks.add')();
    expect(w.picked.at(-1)).toEqual(['$(repo) public', '$(lock) private', '$(home) global']);
    expect(w.pickOptions.at(-1)?.title).toBe('Add Stack');
    expect(w.ran).toContainEqual(['stack', 'add', './my-stack', '--scope', 'private', '--dry-run']);
  });
});

describe('the record is watched, and a new proposal raises the badge and the bar and shows no notification', () => {
  it('moves the badge and the bar by one when a proposal arrives, and says nothing', async () => {
    const w = world(base());
    await settle();
    expect(w.shown).toEqual([]);
    expect(w.badge()?.value).toBe(1);
    w.answers[STATUS] = awaiting(
      decision('d1', 'Use X', 'ADR-1'),
      decision('d2', 'Use Y', 'ADR-2'),
    );
    w.watcher.change[0]?.();
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(w.shown).toEqual([]);
    expect(w.badge()?.value).toBe(2);
    expect(w.bar.text).toBe('$(book) fully-signed · 2 to judge');
    expect(w.bar.accessibilityInformation).toMatchObject({
      label: 'mnema: fully-signed, 2 decisions await a judgment',
    });
  });

  it('reads once for a burst of changes, not once per change', async () => {
    const w = world(base());
    await settle();
    const before = w.ran.filter((a) => a.join(' ') === STATUS).length;
    for (let i = 0; i < 20; i++) w.watcher.change[0]?.();
    await vi.advanceTimersByTimeAsync(QUIET_MS * 3);
    expect(w.ran.filter((a) => a.join(' ') === STATUS).length).toBe(before + 1);
  });
});

describe('what awaits a judgment is a number on the side bar icon', () => {
  const decisions = (n: number) =>
    Array.from({ length: n }, (_, i) => decision(`d${i}`, `Decision ${i}`, `ADR-${i + 1}`));
  const withList = (n: number): Record<string, CliResult> => ({
    ...base(),
    [STATUS]: awaiting(...decisions(n)),
  });
  /** What the command line built for 25 proposals: `status` served 20, `search` lists all 25. */
  const withTwentyFive = (): Record<string, CliResult> => ({
    ...base(),
    [STATUS]: ok(
      readFileSync(new URL('./fixtures/status-25-awaiting.json', import.meta.url), 'utf8'),
    ),
    [LIST]: ok(
      readFileSync(new URL('./fixtures/search-25-proposed.json', import.meta.url), 'utf8'),
    ),
  });

  it('is nothing at zero, never a badge that says 0', async () => {
    const w = world(withList(0));
    await settle();
    expect(w.badge()).toBeUndefined();
    expect(w.started?.shown().badge).toBeUndefined();
    expect(w.executed).toContainEqual(['setContext', 'mnema.proposedRead', true]);
  });

  it('is read only when the answer was understood: text that is not JSON or has no list is not an empty list', async () => {
    for (const stdout of [
      'not json at all',
      '{"awaitingJudgementTotal":3}',
      '{"awaitingJudgement":1}',
    ]) {
      const w = world({ ...base(), [STATUS]: ok(stdout) });
      await settle();
      expect(w.executed, stdout).toContainEqual(['setContext', 'mnema.proposedRead', false]);
      expect(w.executed, stdout).not.toContainEqual(['setContext', 'mnema.proposedRead', true]);
      expect(w.badge(), stdout).toBeUndefined();
      expect(w.tree().getChildren(), stdout).toEqual([]);
    }
    const empty = world({ ...base(), [STATUS]: ok(fixture('status-nothing-awaits')) });
    await settle();
    expect(empty.executed).toContainEqual(['setContext', 'mnema.proposedRead', true]);
  });

  it('says one decision awaits a judgment, and several await', async () => {
    const one = world(withList(1));
    await settle();
    expect(one.badge()).toEqual({ value: 1, tooltip: '1 decision awaits a judgment' });
    const three = world(withList(3));
    await settle();
    expect(three.badge()).toEqual({ value: 3, tooltip: '3 decisions await a judgment' });
  });

  it('lists all 25 when status served 20 and counted 25: the 20 with their ADR, the other 5 by their id', async () => {
    const w = world(withTwentyFive());
    await settle();
    const nodes = w
      .tree()
      .getChildren()
      .map((item) => w.tree().getTreeItem(item as never));
    expect(nodes).toHaveLength(25);
    expect(nodes.slice(0, 20).map((n) => n.description)).toEqual(
      Array.from({ length: 20 }, (_, i) => `ADR-${25 - i}`),
    );
    for (const node of nodes.slice(20)) expect(node.description).toMatch(/^[0-9a-f-]{36}$/);
    expect(w.badge()).toEqual({ value: 25, tooltip: '25 decisions await a judgment' });
    expect(w.bar.text).toBe('$(book) fully-signed · 25 to judge');
    expect(w.ran.filter((args) => args[0] === 'search')).toEqual([[...LIST.split(' ')]]);
  });

  it('asks search only when status cut its list, so 20 or fewer cost one process', async () => {
    const w = world(base());
    await settle();
    expect(w.ran.filter((args) => args[0] === 'search')).toEqual([]);
    expect(w.ran.filter((args) => args[0] === 'status')).toEqual([['status', '--json']]);
  });

  it('lists the 20 it was served, and counts what status counted, when search cannot be read', async () => {
    const w = world({ ...withTwentyFive(), [LIST]: { code: 1, stdout: '', stderr: 'boom' } });
    await settle();
    expect(w.tree().getChildren()).toHaveLength(20);
    expect(w.badge()?.value).toBe(25);
    const [item] = w.tree().getChildren();
    expect(String(w.tree().getTreeItem(item as never).tooltip)).toContain('(20 of 25 are listed)');
  });

  it('lists decisions only, and counts decisions only: a skill that awaits is not a decision to judge here', async () => {
    const skill = { ...decision('s1', 'A pattern', 'ADR-9'), kind: 'skill' };
    const w = world({
      ...base(),
      [STATUS]: awaiting(decision('d1', 'Use X', 'ADR-1'), skill as never),
    });
    await settle();
    expect(w.tree().getChildren()).toHaveLength(1);
    expect(w.badge()?.value).toBe(1);
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
    answers[STATUS] = { code: 1, stdout: '', stderr: 'boom' };
    await w.command('mnema.refresh')();
    expect(w.badge()).toBeUndefined();
    expect(w.bar.text).toBe('$(book) fully-signed');
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
  const argumentOf = (id: string, root: string): unknown =>
    id.startsWith('mnema.stacks.')
      ? stack
      : id === 'mnema.showRules'
        ? 'src/a.ts'
        : id === 'mnema.why'
          ? { scheme: 'file', path: `${root}/src/a.ts`, query: '', fsPath: `${root}/src/a.ts` }
          : proposal;

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
      await w.command(id)(argumentOf(id, w.root));
      if (id === 'mnema.whatToDo') {
        // The pick has one line: the folder has no record, and a terminal to start one. Nothing is run.
        expect(w.picked.at(-1), id).toEqual(['This folder holds no .mnema record']);
        continue;
      }
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
    expect(w.bar.text).toBe('$(book) fully-signed · 1 to judge');
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
    // Nothing else reaches the command line: the runner is built and read in the door's own
    // definition, and no other source file builds one.
    expect(source.match(/options\.run\b/g)).toHaveLength(1);
    expect(source.replace(/^import .*$/gm, '').match(/\bcreateRun\b/g)).toHaveLength(1);
    const others = readdirSync(new URL('.', import.meta.url)).filter(
      (name) =>
        name.endsWith('.ts') &&
        !name.endsWith('.test.ts') &&
        name !== 'cli.ts' &&
        name !== 'extension.ts',
    );
    for (const name of others) {
      const text = readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
      expect(text, name).not.toMatch(/\bcreateRun\b|options\.run\b/);
    }
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

/** What the command line built for the sample project with two proposals, ADR-1 and ADR-2. */
const withTwo = (): Record<string, CliResult> => ({
  ...base(),
  [STATUS]: ok(fixture('status-2-awaiting')),
});

describe('the record is read with few processes, and the work waits for what is on screen', () => {
  const AT_START = ['--version', 'status --json', 'verify --json', 'verify', 'switch'];
  const STACKS = 'stack list --json';
  const verifies = (w: { ran: string[][] }): number =>
    calls(w).filter((c) => c === 'verify --json').length;
  /** The extension reads the first time with the stacks view hidden, as it is until the container opens. */
  const hiddenStacks = ['mnema.stacks'];
  const started = async (answers: Record<string, CliResult> = withTwo(), hidden = hiddenStacks) => {
    const w = world(answers, undefined, undefined, false, hidden);
    await settle();
    return w;
  };

  it('starts five processes with two proposals when the stacks are not on screen, six when they are, and asks show for none', async () => {
    const hidden = await started();
    expect(calls(hidden).sort()).toEqual([...AT_START].sort());
    const visible = await started(withTwo(), []);
    expect(calls(visible).sort()).toEqual([...AT_START, STACKS].sort());
    expect(calls(visible).some((c) => c.startsWith('show'))).toBe(false);
  });

  it('asks only what awaits when the record changes and nothing else is due', async () => {
    const w = await started();
    w.ran.length = 0;
    w.watcher.change[0]?.();
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(calls(w)).toEqual([STATUS]);
  });

  it('asks the stacks too when their view is on screen', async () => {
    const w = await started(withTwo(), []);
    w.ran.length = 0;
    w.watcher.change[0]?.();
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(calls(w).sort()).toEqual([STACKS, STATUS].sort());
  });

  it('asks --version at the start, on a refresh and when the command setting changes, and not when the record changes', async () => {
    const w = await started();
    const versions = (): number => calls(w).filter((c) => c === '--version').length;
    expect(versions()).toBe(1);
    w.watcher.change[0]?.();
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(versions()).toBe(1);
    await w.command('mnema.refresh')();
    expect(versions()).toBe(2);
    for (const l of w.settingListeners) l({ affectsConfiguration: (s) => s === 'mnema.command' });
    await settle();
    expect(versions()).toBe(3);
  });

  it('says the command is gone in the same reading in which a call came back with no exit code', async () => {
    const answers = withTwo();
    const w = await started(answers);
    expect(w.bar.text).toBe('$(book) fully-signed · 2 to judge');
    const gone = { code: null, stdout: '', stderr: 'spawn mnema ENOENT' };
    answers[STATUS] = gone;
    answers['--version'] = gone;
    w.ran.length = 0;
    w.watcher.change[0]?.();
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(calls(w)).toEqual([STATUS, '--version']);
    expect(w.executed.filter((e) => e[1] === 'mnema.cliMissing').at(-1)?.[2]).toBe(true);
    expect(w.bar.text).toBe('$(warning) mnema not found');
    expect(w.badge()).toBeUndefined();
  });

  it('asks --version again at the next change while the last answer was that the command is missing', async () => {
    const answers: Record<string, CliResult> = {
      ...withTwo(),
      '--version': { code: null, stdout: '', stderr: 'spawn mnema ENOENT' },
    };
    const w = await started(answers);
    expect(w.bar.text).toBe('$(warning) mnema not found');
    answers['--version'] = ok(`${MIN_CLI_VERSION}\n`);
    w.watcher.change[0]?.();
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(w.bar.text).toBe('$(book) fully-signed · 2 to judge');
  });

  it('verifies at most once in ten seconds, and a write inside the interval is verified when it ends', async () => {
    const w = await started();
    expect(verifies(w)).toBe(1);
    for (let i = 0; i < 3; i++) {
      w.watcher.change[0]?.();
      await vi.advanceTimersByTimeAsync(2000);
    }
    // Six seconds in, three readings of the record, no second verification yet.
    expect(verifies(w)).toBe(1);
    await vi.advanceTimersByTimeAsync(VERIFY_EVERY_MS - 6000);
    expect(verifies(w)).toBe(2);
    expect(calls(w).filter((c) => c === 'verify').length).toBe(2);
    expect(calls(w).filter((c) => c === 'switch').length).toBe(2);
    // Nothing more is asked once nothing changes.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(verifies(w)).toBe(2);
  });

  it('verifies a change that comes after the interval at once', async () => {
    const w = await started();
    await vi.advanceTimersByTimeAsync(VERIFY_EVERY_MS + 1000);
    w.watcher.change[0]?.();
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(verifies(w)).toBe(2);
  });

  it('counts twenty changes in thirty seconds: five verifications with the first, the last one ten seconds after the last write', async () => {
    const w = await started();
    w.ran.length = 0;
    for (let i = 0; i < 20; i++) {
      w.watcher.change[0]?.();
      await vi.advanceTimersByTimeAsync(1600);
    }
    await vi.advanceTimersByTimeAsync(VERIFY_EVERY_MS);
    expect(calls(w).filter((c) => c === STATUS).length).toBe(20);
    expect(verifies(w)).toBe(4);
    expect(w.ran.length).toBe(20 + 4 * 3);
  });

  it('verifies at once on a refresh, inside the interval, and a refresh costs six processes, the stacks included', async () => {
    const w = await started();
    w.ran.length = 0;
    await w.command('mnema.refresh')();
    expect(calls(w).sort()).toEqual([...AT_START, STACKS].sort());
  });

  it('does not verify while the bar is off, and verifies as soon as it is on again', async () => {
    const w = await started();
    w.setting.statusBarEnabled = false;
    for (const l of w.settingListeners)
      l({ affectsConfiguration: (s) => s === 'mnema.statusBar.enabled' });
    w.ran.length = 0;
    w.watcher.change[0]?.();
    await vi.advanceTimersByTimeAsync(QUIET_MS + 3 * VERIFY_EVERY_MS);
    await w.command('mnema.refresh')();
    expect(calls(w).filter((c) => c.startsWith('verify') || c === 'switch')).toEqual([]);
    w.setting.statusBarEnabled = true;
    for (const l of w.settingListeners)
      l({ affectsConfiguration: (s) => s === 'mnema.statusBar.enabled' });
    await settle();
    expect(verifies(w)).toBe(1);
  });

  it('keeps the level it last read, with the count that is new, between two verifications', async () => {
    const answers = withTwo();
    const w = await started(answers);
    expect(w.bar.text).toBe('$(book) fully-signed · 2 to judge');
    answers[STATUS] = awaiting(decision('d1', 'Use X', 'ADR-1'));
    w.watcher.change[0]?.();
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(verifies(w)).toBe(1);
    expect(w.bar.text).toBe('$(book) fully-signed · 1 to judge');
  });

  it('does not read the stacks while their view is hidden, reads them when it appears, and says it has not read them until then', async () => {
    const w = await started();
    expect(calls(w)).not.toContain(STACKS);
    expect(keyOf(w, 'mnema.stacksRead')).toBe(false);
    w.setVisible('mnema.stacks', true);
    await settle();
    expect(calls(w).filter((c) => c === STACKS)).toHaveLength(1);
    expect(keyOf(w, 'mnema.stacksRead')).toBe(true);
    // Shown again with nothing new: not read again.
    w.setVisible('mnema.stacks', false);
    w.setVisible('mnema.stacks', true);
    await settle();
    expect(calls(w).filter((c) => c === STACKS)).toHaveLength(1);
    // Hidden, the record changes: the list is old, and it is read when the view comes back.
    w.setVisible('mnema.stacks', false);
    w.watcher.change[0]?.();
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(calls(w).filter((c) => c === STACKS)).toHaveLength(1);
    expect(keyOf(w, 'mnema.stacksRead')).toBe(false);
    w.setVisible('mnema.stacks', true);
    await settle();
    expect(calls(w).filter((c) => c === STACKS)).toHaveLength(2);
    expect(keyOf(w, 'mnema.stacksRead')).toBe(true);
  });

  it('reads the stacks on a refresh asked for, even when their view is hidden', async () => {
    const w = await started();
    await w.command('mnema.refresh')();
    expect(calls(w).filter((c) => c === STACKS)).toHaveLength(1);
  });

  it('counts what an act of the person costs as a refresh: the judgment is followed by a full reading', async () => {
    const w = await started({
      ...withTwo(),
      [`decision move accept ${ID_OF_ADR_1} --note ok`]: ok(
        `Decision ADR-1 (${ID_OF_ADR_1}) → accepted\n`,
      ),
    });
    w.setReply('ok');
    w.ran.length = 0;
    await w.command('mnema.accept')({ id: ID_OF_ADR_1, title: 'Use SQLite for the cache', at: '' });
    expect(calls(w).sort()).toEqual(
      [`decision move accept ${ID_OF_ADR_1} --note ok`, ...AT_START, STACKS].sort(),
    );
  });
});

const ID_OF_ADR_1 = (
  JSON.parse(fixture('status-2-awaiting')) as { awaitingJudgement: { id: string; adr: string }[] }
).awaitingJudgement.find((item) => item.adr === 'ADR-1')?.id as string;

describe('the what-to-do pick is made of one status, and judges nothing', () => {
  const labelsOf = (w: ReturnType<typeof world>) => w.picked.at(-1);
  const placeholderOf = (w: ReturnType<typeof world>) =>
    (w.pickOptions.at(-1) as unknown as { placeHolder: string }).placeHolder;

  it('lists what awaits in the order the command line gave it, each opening the decision whole', async () => {
    const w = world(withTwo());
    await settle();
    w.ran.length = 0;
    w.picks.push('ADR-1  Use SQLite for the cache');
    await w.command('mnema.whatToDo')();
    expect(labelsOf(w)).toEqual([
      'ADR-2  Keep the CLI free of a daemon',
      'ADR-1  Use SQLite for the cache',
    ]);
    // One status, then the `show` the document of the chosen decision asks for, and nothing else.
    expect(calls(w)).toEqual([STATUS, `show ${ID_OF_ADR_1} --json`]);
    expect(w.opened.map((u) => u.query)).toEqual([`id=${ID_OF_ADR_1}`]);
    expect(w.pickOptions.at(-1)).toMatchObject({ title: 'What To Do', ignoreFocusOut: true });
    expect(placeholderOf(w)).toBe('Pick a decision to read it whole.');
  });

  it('says nothing awaits in its placeholder, and has no item', async () => {
    const w = world({ ...base(), [STATUS]: ok(fixture('status-nothing-awaits')) });
    await settle();
    await w.command('mnema.whatToDo')();
    expect(labelsOf(w)).toEqual([]);
    expect(placeholderOf(w)).toBe('Nothing awaits a judgment, as mnema reads it.');
  });

  it('lists the 20 status served and a line for the 5 more, which opens the side bar', async () => {
    const w = world({
      ...base(),
      [STATUS]: ok(
        readFileSync(new URL('./fixtures/status-25-awaiting.json', import.meta.url), 'utf8'),
      ),
    });
    await settle();
    w.picks.push('5 more await a judgment');
    w.executed.length = 0;
    await w.command('mnema.whatToDo')();
    const labels = labelsOf(w) ?? [];
    expect(labels).toHaveLength(21);
    expect(labels.at(-1)).toBe('5 more await a judgment');
    expect(labels[0]).toBe('ADR-25  Decision number 25');
    expect(w.executed).toContainEqual([CONTAINER_COMMAND]);
  });

  it('lists only decisions, and says in one more line that something else awaits too', async () => {
    const skill = { ...decision('s1', 'A pattern', 'ADR-9'), kind: 'skill' };
    const w = world({
      ...base(),
      [STATUS]: awaiting(decision('d1', 'Use X', 'ADR-1'), skill as never),
    });
    await settle();
    await w.command('mnema.whatToDo')();
    expect(labelsOf(w)).toEqual(['ADR-1  Use X', '1 more awaits a judgment']);
  });

  it('shows a title from the record on one line, whatever it carries', async () => {
    const w = world({
      ...base(),
      [STATUS]: awaiting(
        decision('d1', 'Line one\nLine two\u0007 [x](command:mnema.accept)', 'ADR-1'),
      ),
    });
    await settle();
    await w.command('mnema.whatToDo')();
    const [label] = labelsOf(w) ?? [];
    expect(label).not.toContain('\n');
    expect(label).not.toContain('\u0007');
    expect(label).toContain('Line one');
  });

  it('has no line that accepts or rejects, and choosing any line never puts a judgment among the runs', async () => {
    const w = world(withTwo());
    await settle();
    for (const label of labelsOf(w) ?? []) expect(label).not.toMatch(/accept|reject/i);
    for (const pick of [
      'ADR-2  Keep the CLI free of a daemon',
      'ADR-1  Use SQLite for the cache',
    ]) {
      w.picks.push(pick);
      await w.command('mnema.whatToDo')();
    }
    expect(w.ran.some((args) => args[0] === 'decision')).toBe(false);
    expect(w.inputs).toEqual([]);
  });

  it('opens a terminal in a folder with no record, and runs nothing', async () => {
    const w = world(withTwo(), undefined, folderWith(false));
    await settle();
    w.picks.push('This folder holds no .mnema record');
    await w.command('mnema.whatToDo')();
    expect(w.executed).toContainEqual(['workbench.action.terminal.new']);
    expect(w.ran).toEqual([]);
  });

  it('opens the setting when the command is missing', async () => {
    const w = world({
      ...withTwo(),
      [STATUS]: { code: null, stdout: '', stderr: 'spawn mnema ENOENT' },
      '--version': { code: null, stdout: '', stderr: 'spawn mnema ENOENT' },
    });
    await settle();
    w.picks.push('The mnema command could not be used');
    await w.command('mnema.whatToDo')();
    expect(labelsOf(w)).toEqual(['The mnema command could not be used']);
    expect(w.executed).toContainEqual(['workbench.action.openSettings', 'mnema.command']);
  });

  it('says it did not read when status gave an answer it cannot read, and lists nothing', async () => {
    const w = world({ ...withTwo(), [STATUS]: ok('not json') });
    await settle();
    await w.command('mnema.whatToDo')();
    expect(labelsOf(w)).toEqual([]);
    expect(placeholderOf(w)).toBe('mnema did not say what awaits a judgment.');
  });
});

describe('why a file is the way it is opens as the words of the command line', () => {
  const WHY_A = readFileSync(new URL('./fixtures/why-a-file.txt', import.meta.url), 'utf8');
  const fileUri = (w: { root: string }, name: string) => ({
    scheme: 'file',
    path: `${w.root}/${name}`,
    query: '',
    fsPath: `${w.root}/${name}`,
  });
  const whyDocs = (w: ReturnType<typeof world>) => w.opened.filter((u) => u.scheme === 'mnema-why');

  it('asks mnema why with the path after --, and shows what it printed under a header that says when', async () => {
    vi.setSystemTime(new Date('2026-10-27T14:03:09Z'));
    const w = world({ ...base(), 'why -- src/a.ts': ok(WHY_A) });
    await settle();
    w.ran.length = 0;
    await w.command('mnema.why')(fileUri(w, 'src/a.ts'));
    expect(w.ran).toEqual([['why', '--', 'src/a.ts']]);
    const [doc] = whyDocs(w);
    expect(doc?.path).toBe('/Why a.ts');
    const text = w.documents.get(doc?.query ?? '')?.text ?? '';
    expect(text.startsWith('mnema why -- src/a.ts, read at 2026-10-27T14:03:09Z\n\n')).toBe(true);
    expect(text).toContain('rules in force that address this path: 0');
    expect(text).toContain('nothing was written to the record');
    expect(w.active()?.scheme).toBe('mnema-why');
  });

  it('uses the file open in the editor when the palette gives none', async () => {
    const w = world({ ...base(), 'why -- src/a.ts': ok(WHY_A) });
    await settle();
    w.openInEditor(fileUri(w, 'src/a.ts'));
    await w.command('mnema.why')(undefined);
    expect(w.ran).toContainEqual(['why', '--', 'src/a.ts']);
  });

  it('says what the command line refused, and no more', async () => {
    const w = world({
      ...base(),
      'why -- src/a.ts': { code: 1, stdout: '', stderr: 'Not a project.' },
    });
    await settle();
    await w.command('mnema.why')(fileUri(w, 'src/a.ts'));
    const text = w.documents.get(whyDocs(w)[0]?.query ?? '')?.text ?? '';
    expect(text).toContain('mnema refused: Not a project.');
    expect(text).not.toContain('rules in force');
  });

  it('is a new document at each opening, so a second look is never an old reading', async () => {
    const answers: Record<string, CliResult> = { ...base(), 'why -- src/a.ts': ok(WHY_A) };
    const w = world(answers);
    await settle();
    await w.command('mnema.why')(fileUri(w, 'src/a.ts'));
    vi.setSystemTime(Date.now() + 5000);
    answers['why -- src/a.ts'] = ok('changed\n');
    await w.command('mnema.why')(fileUri(w, 'src/a.ts'));
    const docs = whyDocs(w);
    expect(docs).toHaveLength(2);
    expect(docs[0]?.query).not.toBe(docs[1]?.query);
    expect(w.documents.get(docs[1]?.query ?? '')?.text).toContain('changed');
  });

  it('puts a file named like an option after --, and the lens does too', async () => {
    const w = world({
      ...base(),
      'why -- -x': ok('-x  ·  not in the working tree\n'),
      'why -- --json': ok('--json  ·  not in the working tree\n'),
    });
    await settle();
    await w.command('mnema.why')(fileUri(w, '-x'));
    await w.command('mnema.why')(fileUri(w, '--json'));
    expect(w.ran).toContainEqual(['why', '--', '-x']);
    expect(w.ran).toContainEqual(['why', '--', '--json']);
    await w.lenses().provideCodeLenses({ uri: fileUri(w, '-x') } as never);
    expect(w.ran).toContainEqual(['rules', '--json', '--', '-x']);
    expect(w.ran.filter((args) => args[0] === 'rules' && args[1] !== '--json')).toEqual([]);
  });

  it('keeps a line break in the name out of the header and the tab', async () => {
    const w = world({ ...base() });
    await settle();
    await w.command('mnema.why')(fileUri(w, 'a\nb.ts'));
    expect(w.ran).toContainEqual(['why', '--', 'a\nb.ts']);
    const [doc] = whyDocs(w);
    expect(doc?.path).not.toContain('\n');
    const header = (w.documents.get(doc?.query ?? '')?.text ?? '').split('\n\n')[0] ?? '';
    expect(header).not.toContain('\n');
  });

  it('asks nothing for a file outside the folder, or one that is not a file, and says so', async () => {
    const w = world(base());
    await settle();
    w.ran.length = 0;
    await w.command('mnema.why')({
      scheme: 'file',
      path: '/elsewhere/a.ts',
      query: '',
      fsPath: '/elsewhere/a.ts',
    });
    await w.command('mnema.why')({
      scheme: 'untitled',
      path: 'Untitled-1',
      query: '',
      fsPath: 'Untitled-1',
    });
    expect(w.ran).toEqual([]);
    expect(w.opened).toEqual([]);
    expect(w.shown).toEqual([
      'Pick a file inside the folder that is open.',
      'Pick a file inside the folder that is open.',
    ]);
  });

  it('places a path in one function: no verb of the extension writes the path itself', () => {
    const dir = new URL('.', import.meta.url);
    const holders = readdirSync(dir).filter(
      (name) =>
        name.endsWith('.ts') &&
        !name.endsWith('.test.ts') &&
        /'--',\s*path/.test(readFileSync(new URL(name, dir), 'utf8')),
    );
    expect(holders).toEqual(['rules.ts']);
    const source = readFileSync(new URL('./extension.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\['rules'/);
    expect(source).not.toMatch(/\['why'/);
  });
});

describe('the folder of the record wears a mark in the Explorer, and no file does', () => {
  it('marks the .mnema folder with the badge M, the accent colour and what the folder is', async () => {
    const w = world(base());
    await settle();
    const mark = w.decorate({ scheme: 'file', fsPath: join(w.root, '.mnema') });
    expect(mark).toEqual({
      badge: 'M',
      tooltip: 'The mnema record of this project. mnema verify reads it.',
      color: { id: 'mnema.recordFolder' },
    });
  });

  it('marks nothing else: not the folder that holds it, not what is inside it, not a governed file, not another scheme', async () => {
    const w = world({ ...base(), rules: RULES });
    await settle();
    for (const fsPath of [
      w.root,
      join(w.root, '.mnema', 'public'),
      join(w.root, '.mnema', 'public', 'tails', 'a.jsonl'),
      join(w.root, 'src', 'a.ts'),
      join(w.root, 'src', '.mnema'),
      join(w.root, '.mnema-old'),
      '/elsewhere/.mnema',
    ]) {
      expect(w.decorate({ scheme: 'file', fsPath }), fsPath).toBeUndefined();
    }
    expect(
      w.decorate({ scheme: 'mnema-decision', fsPath: join(w.root, '.mnema') }),
    ).toBeUndefined();
  });

  it('starts no process to answer, in a folder with a record or without', async () => {
    const withRecord = world(base());
    await settle();
    const before = withRecord.ran.length;
    withRecord.decorate({ scheme: 'file', fsPath: join(withRecord.root, '.mnema') });
    withRecord.decorate({ scheme: 'file', fsPath: join(withRecord.root, 'src', 'a.ts') });
    expect(withRecord.ran.length).toBe(before);
    const without = world(base(), undefined, folderWith(false));
    await settle();
    expect(without.decorate({ scheme: 'file', fsPath: join(without.root, '.mnema') })?.badge).toBe(
      'M',
    );
    expect(without.ran).toEqual([]);
  });

  it('asks the Explorer again about the folder when it is born or removed', async () => {
    const w = world(base());
    await settle();
    w.watcher.create[0]?.();
    expect(w.redecorated).toEqual([join(w.root, '.mnema')]);
  });

  it('imports nothing that could read the disk or start a process', () => {
    const source = readFileSync(new URL('./record-mark.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports).toEqual(['node:path']);
  });
});

describe('the same two commands against the built command line, with files named like options', () => {
  const CLI = fileURLToPath(new URL('../../code/dist/cli.js', import.meta.url));

  it('reads rules and why of a file named -x, which the order before -- could not', async () => {
    vi.useRealTimers();
    const sandbox = mkdtempSync(join(tmpdir(), 'mnema-extension-paths-'));
    const kept = process.env.HOME;
    const project = join(sandbox, 'project');
    mkdirSync(project);
    mkdirSync(join(sandbox, 'home'));
    process.env.HOME = join(sandbox, 'home');
    try {
      const real = createRun(CLI, project);
      expect((await real(['init'])).code).toBe(0);
      for (const name of ['-x', '--json']) {
        writeFileSync(join(project, name), 'x\n');
        const rules = await real(rulesArgs(name));
        expect(rules.code, `rules ${name}: ${rules.stderr}`).toBe(0);
        const why = await real(whyArgs(name));
        expect(why.code, `why ${name}: ${why.stderr}`).toBe(0);
        expect(why.stdout).toContain(name);
      }
      // The control: the order the extension used before is refused for the same file.
      expect((await real(['rules', '-x', '--json'])).code).not.toBe(0);
      const w = world({}, real, project);
      await vi.waitFor(() => expect(w.bar.text).not.toBe('mnema: reading'), { timeout: 20_000 });
      await w.command('mnema.why')({
        scheme: 'file',
        path: join(project, '-x'),
        query: '',
        fsPath: join(project, '-x'),
      });
      const [doc] = w.opened.filter((u) => u.scheme === 'mnema-why');
      expect(w.documents.get(doc?.query ?? '')?.text).toContain(
        'rules in force that address this path: 0',
      );
    } finally {
      if (kept === undefined) delete process.env.HOME;
      else process.env.HOME = kept;
      rmSync(sandbox, { recursive: true, force: true });
    }
  }, 120_000);
});
