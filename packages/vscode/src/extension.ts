/**
 * The extension: the VS Code side of what the other modules read from the command line.
 *
 * `activate` is handed the `vscode` module by the bundle's entry (`build/bundle.mjs`), and this file
 * declares the few members of it that it uses. So the whole of it runs, in the tests, against a
 * stand-in, and nothing here imports `vscode`, which would need the editor to exist.
 *
 * Every read and every write goes through the `mnema` command line. A decision is judged with the
 * CLI's own verb and the note it requires; nothing about rules, state or proof is decided here.
 */

import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { type CliResult, createRun, type Run } from './cli.js';
import {
  detailText,
  type Judgment,
  judgeArgs,
  LIST_ARGS,
  newlyProposed,
  noteProblem,
  type Proposed,
  type ProposedDetail,
  readDetail,
  readProposed,
} from './proposed.js';
import { lensTitle, type RuleView, readRules, ruleLabel } from './rules.js';
import {
  type AdoptedStack,
  digestOf,
  exportArgs,
  folderProblem,
  HOOKS_NOTE,
  indexArgs,
  installArgs,
  type Look,
  lookArgs,
  planArgs,
  readIndex,
  readStacks,
  removeArgs,
  SCOPES,
  STACK_LIST_ARGS,
  type StackScope,
  showsHooks,
  sourceProblem,
  stackDescription,
  stackTooltip,
} from './stacks.js';
import { type Channel, describeBar, readChannels, readCli, readVerdict } from './status.js';

/** How long the record has to be quiet before it is read again. */
export const QUIET_MS = 1500;

interface Disposable {
  dispose(): void;
}
type Event<T> = (listener: (event: T) => unknown) => Disposable;

interface TreeItemLike {
  description?: string;
  tooltip?: string;
  contextValue?: string;
}

/** The members of the `vscode` module this extension uses. */
export interface VscodeApi {
  readonly workspace: {
    readonly workspaceFolders: readonly { readonly uri: { readonly fsPath: string } }[] | undefined;
    getConfiguration(section: string): { get<T>(key: string, fallback: T): T };
    onDidChangeConfiguration: Event<{ affectsConfiguration(section: string): boolean }>;
    createFileSystemWatcher(pattern: unknown): {
      onDidChange: Event<unknown>;
      onDidCreate: Event<unknown>;
      onDidDelete: Event<unknown>;
      dispose(): void;
    };
  };
  readonly RelativePattern: new (base: string, pattern: string) => unknown;
  readonly window: {
    createStatusBarItem(alignment: number): {
      text: string;
      tooltip: string;
      command: string | { command: string; title: string; arguments: unknown[] };
      accessibilityInformation: { label: string; role?: string } | undefined;
      show(): void;
      hide(): void;
      dispose(): void;
    };
    createTreeView<T>(viewId: string, options: { treeDataProvider: TreeProvider<T> }): TreeViewLike;
    createOutputChannel(name: string): OutputChannelLike;
    showInputBox(options: {
      title: string;
      prompt: string;
      placeHolder: string;
      ignoreFocusOut: boolean;
      validateInput: (value: string) => string | undefined;
    }): PromiseLike<string | undefined>;
    showQuickPick<T extends { label: string }>(
      items: readonly T[],
      options: { title: string; placeHolder: string; ignoreFocusOut?: boolean },
    ): PromiseLike<T | undefined>;
    showInformationMessage(message: string, ...actions: string[]): PromiseLike<string | undefined>;
    showErrorMessage(message: string): PromiseLike<string | undefined>;
    readonly activeTextEditor: { readonly document: DocumentLike } | undefined;
  };
  readonly commands: {
    registerCommand(id: string, callback: (...args: never[]) => unknown): Disposable;
    executeCommand(id: string, ...args: unknown[]): PromiseLike<unknown>;
  };
  readonly languages: {
    registerCodeLensProvider(
      selector: { scheme: string },
      provider: {
        onDidChangeCodeLenses: Event<void>;
        provideCodeLenses(document: DocumentLike): Promise<unknown[]>;
      },
    ): Disposable;
  };
  readonly EventEmitter: new <T>() => { event: Event<T>; fire(event: T): void; dispose(): void };
  readonly CodeLens: new (
    range: unknown,
    command: { title: string; command: string; arguments: string[] },
  ) => unknown;
  readonly Range: new (a: number, b: number, c: number, d: number) => unknown;
  readonly TreeItem: new (label: string, state: number) => TreeItemLike;
  readonly TreeItemCollapsibleState: { readonly None: number };
  readonly StatusBarAlignment: { readonly Left: number };
}

interface DocumentLike {
  readonly uri: { readonly scheme: string; readonly fsPath: string };
}

/** The number on the side bar icon of the extension, and what it says when hovered. */
interface BadgeLike {
  readonly value: number;
  readonly tooltip: string;
}

interface TreeViewLike extends Disposable {
  badge: BadgeLike | undefined;
}

interface TreeProvider<T> {
  onDidChangeTreeData: Event<void>;
  getChildren(): T[];
  getTreeItem(element: T): TreeItemLike;
}

/** A place to show text that is longer than a message: the plan of a stack, whole. */
interface OutputChannelLike {
  clear(): void;
  appendLine(line: string): void;
  show(preserveFocus?: boolean): void;
  dispose(): void;
}

/** What the extension holds between one reading of the record and the next. */
interface Session {
  readonly details: Map<string, ProposedDetail>;
  readonly rules: Map<string, RuleView[]>;
  proposed: Proposed[];
  stacks: AdoptedStack[];
  total: number;
  seen: Set<string> | undefined;
  channels: Channel[] | undefined;
}

/** What the extension hands to whoever activated it: what it shows now, read only. */
export interface Shown {
  readonly text: string;
  readonly tooltip: string;
  /** Whether the status bar item is shown: it is not in a folder with no `.mnema`. */
  readonly visible: boolean;
  /** What the side bar icon carries: the decisions awaiting a judgment, or nothing. */
  readonly badge: BadgeLike | undefined;
}

/** What is said, once, to a person who asks the extension for what it reads in a folder with no record. */
export const NO_RECORD = 'This folder holds no .mnema record. Run mnema init in a terminal here.';

/** The badge for a number of decisions awaiting a judgment; nothing to count is no badge at all. */
function badgeFor(total: number | undefined): BadgeLike | undefined {
  if (total === undefined || total <= 0) return undefined;
  return {
    value: total,
    tooltip: total === 1 ? '1 decision awaits a judgment' : `${total} decisions await a judgment`,
  };
}

/** Starts the extension against one workspace folder: the first one open. */
export function activate(
  context: { subscriptions: Disposable[] },
  api: VscodeApi,
  options: { run?: Run; makeRun?: (command: string, cwd: string) => Run } = {},
): { readonly shown: () => Shown } | undefined {
  const folder = api.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (folder === undefined) return undefined;
  const recordFolder = join(folder, '.mnema');
  // The setting is read again at every call: a corrected `mnema.command` is not kept from the
  // activation, so the person does not have to reload the window for it.
  const runner = (): Run =>
    options.run ??
    (options.makeRun ?? createRun)(
      api.workspace.getConfiguration('mnema').get<string>('command', 'mnema'),
      folder,
    );
  // Whether the folder holds a record is read from the disk every time it is asked, never kept:
  // a `.mnema` can be born later, by `mnema init` in a terminal, and the watcher then reads again.
  const hasRecord = (): boolean => existsSync(recordFolder);
  /**
   * The one door to the command line. The side bar container is there in every folder, and opening
   * its view starts the extension, so in a folder with no `.mnema` nothing may start a `mnema`
   * process: this is the only place that calls `runner()`, and it answers with a refusal, without
   * starting anything, when there is no record. (`the-command-line-is-never-run-without-a-record`.)
   */
  const read: Run = async (args) =>
    hasRecord() ? runner()(args) : { code: 1, stdout: '', stderr: NO_RECORD };
  /** Whether a command that needs the command line can go on: if not, says why, once. */
  const needsRecord = (): boolean => {
    if (hasRecord()) return true;
    void api.window.showInformationMessage(NO_RECORD);
    return false;
  };
  const session: Session = {
    details: new Map(),
    rules: new Map(),
    proposed: [],
    stacks: [],
    total: 0,
    seen: undefined,
    channels: undefined,
  };
  const keep = <T extends Disposable>(d: T): T => {
    context.subscriptions.push(d);
    return d;
  };

  const treeChanged = keep(new api.EventEmitter<void>());
  const stacksChanged = keep(new api.EventEmitter<void>());
  const lensesChanged = keep(new api.EventEmitter<void>());
  const bar = keep(api.window.createStatusBarItem(api.StatusBarAlignment.Left));
  let barVisible = false;
  const showBar = (): void => {
    barVisible = true;
    bar.show();
  };
  const hideBar = (): void => {
    barVisible = false;
    bar.hide();
  };
  bar.command = 'mnema.refresh';
  bar.text = 'mnema: reading';
  bar.tooltip = '';
  bar.accessibilityInformation = { label: 'mnema: reading', role: 'button' };
  // A folder with no record shows no bar item: there is nothing for it to say.
  if (hasRecord()) showBar();

  /** The view that lists what awaits a judgment carries the number on the side bar icon. */
  let proposedView: TreeViewLike | undefined;
  /** The total the command line counted; undefined, and no badge, when there is nothing to count. */
  const setAwaiting = (total: number | undefined): void => {
    if (proposedView !== undefined) proposedView.badge = badgeFor(total);
  };

  function applyBar(shown: ReturnType<typeof describeBar>): void {
    showBar();
    bar.text = shown.text;
    bar.tooltip = shown.tooltip;
    bar.accessibilityInformation = shown.accessibility;
    bar.command =
      shown.action === 'settings'
        ? {
            command: 'workbench.action.openSettings',
            title: 'mnema: Set the mnema command',
            arguments: ['mnema.command'],
          }
        : 'mnema.refresh';
  }

  async function refresh(): Promise<void> {
    // The empty views say one thing with a record in the folder and another without; the key is
    // whether the folder holds a `.mnema`, nothing the command line said.
    const record = hasRecord();
    void api.commands.executeCommand('setContext', 'mnema.hasRecord', record);
    session.rules.clear();
    lensesChanged.fire();
    if (!record) {
      // No record is not "command not found": nothing is asked of the command line, the bar is
      // hidden, and the views say how to start a record.
      session.proposed = [];
      session.stacks = [];
      session.total = 0;
      session.channels = undefined;
      session.seen = undefined;
      void api.commands.executeCommand('setContext', 'mnema.cliMissing', false);
      void api.commands.executeCommand('setContext', 'mnema.proposedRead', false);
      void api.commands.executeCommand('setContext', 'mnema.stacksRead', false);
      hideBar();
      setAwaiting(undefined);
      stacksChanged.fire();
      treeChanged.fire();
      return;
    }
    // Whether the command can be run at all comes first: a command that is not there is not
    // "nothing pending", and nothing else is asked of it.
    const cli = readCli(await read(['--version']));
    void api.commands.executeCommand('setContext', 'mnema.cliMissing', cli.kind === 'missing');
    if (cli.kind === 'missing') {
      session.proposed = [];
      session.stacks = [];
      session.total = 0;
      session.channels = undefined;
      void api.commands.executeCommand('setContext', 'mnema.proposedRead', false);
      void api.commands.executeCommand('setContext', 'mnema.stacksRead', false);
      setAwaiting(undefined);
      applyBar(
        describeBar({
          cli,
          verdict: { kind: 'unreadable' },
          channels: undefined,
          coverage: undefined,
        }),
      );
      stacksChanged.fire();
      treeChanged.fire();
      return;
    }
    const [list, verify, coverage, channels, stacks] = await Promise.all([
      read(LIST_ARGS),
      read(['verify', '--json']),
      read(['verify']),
      read(['switch']),
      read(STACK_LIST_ARGS),
    ]);
    session.stacks = stacks.code === 0 ? readStacks(stacks.stdout) : [];
    void api.commands.executeCommand('setContext', 'mnema.stacksRead', stacks.code === 0);
    stacksChanged.fire();
    session.channels = channels.code === 0 ? readChannels(channels.stdout) : undefined;
    applyBar(
      describeBar({
        cli,
        verdict: readVerdict(verify.stdout),
        channels: session.channels,
        // The words are the command line's own, as many lines as it printed up to a few.
        coverage: coverage.stdout.trim().split('\n').slice(0, 6).join('\n') || undefined,
      }),
    );
    void api.commands.executeCommand('setContext', 'mnema.proposedRead', list.code === 0);
    if (list.code !== 0) {
      // A list that was not read is not an empty one: the view says it did not read, and no number is shown.
      session.proposed = [];
      session.total = 0;
      setAwaiting(undefined);
      treeChanged.fire();
      return;
    }
    const { items, total } = readProposed(list.stdout);
    setAwaiting(total);
    const fresh = newlyProposed(session.seen, items);
    session.seen = new Set(items.map((item) => item.id));
    session.proposed = items;
    session.total = total;
    await Promise.all(
      items
        .filter((item) => !session.details.has(item.id))
        .map(async (item) => {
          const shown = await read(['show', item.id, '--json']);
          if (shown.code === 0) session.details.set(item.id, readDetail(shown.stdout));
        }),
    );
    treeChanged.fire();
    if (fresh.length > 0) {
      const first = fresh[0];
      const what =
        fresh.length === 1 && first !== undefined
          ? `a decision was proposed: ${first.title}`
          : `${fresh.length} decisions were proposed`;
      void api.window.showInformationMessage(`mnema: ${what}`, 'Review').then((choice) => {
        if (choice === 'Review') void api.commands.executeCommand('mnema.proposed.focus');
      });
    }
  }

  async function rulesOver(path: string): Promise<RuleView[]> {
    const known = session.rules.get(path);
    if (known !== undefined) return known;
    const answer = await read(['rules', path, '--json']);
    const rules = answer.code === 0 ? readRules(answer.stdout) : [];
    session.rules.set(path, rules);
    return rules;
  }

  const relativePath = (document: DocumentLike): string | undefined => {
    if (document.uri.scheme !== 'file') return undefined;
    const path = relative(folder, document.uri.fsPath);
    return path === '' || path.startsWith('..') ? undefined : path;
  };

  keep(
    api.languages.registerCodeLensProvider(
      { scheme: 'file' },
      {
        onDidChangeCodeLenses: lensesChanged.event,
        async provideCodeLenses(document) {
          const path = relativePath(document);
          if (path === undefined) return [];
          const title = lensTitle(await rulesOver(path));
          if (title === undefined) return [];
          return [
            new api.CodeLens(new api.Range(0, 0, 0, 0), {
              title,
              command: 'mnema.showRules',
              arguments: [path],
            }),
          ];
        },
      },
    ),
  );

  const provider: TreeProvider<Proposed> = {
    onDidChangeTreeData: treeChanged.event,
    getChildren: () => session.proposed,
    getTreeItem(item) {
      const node = new api.TreeItem(item.title, api.TreeItemCollapsibleState.None);
      node.description = session.details.get(item.id)?.adr ?? item.id;
      node.tooltip =
        detailText(item, session.details.get(item.id)) +
        (session.total > session.proposed.length
          ? `\n\n(${session.proposed.length} of ${session.total} are listed)`
          : '');
      node.contextValue = 'proposed';
      return node;
    },
  };
  proposedView = keep(api.window.createTreeView('mnema.proposed', { treeDataProvider: provider }));

  async function judge(verdict: Judgment, element: Proposed | undefined): Promise<void> {
    if (!needsRecord()) return;
    const item =
      element ??
      (
        await api.window.showQuickPick(
          session.proposed.map((p) => ({ label: p.title, description: p.id, item: p })),
          {
            title: `mnema: ${verdict === 'accept' ? 'Accept' : 'Reject'} Decision`,
            placeHolder: `Pick the decision to ${verdict}`,
            ignoreFocusOut: true,
          },
        )
      )?.item;
    if (item === undefined) return;
    const note = await api.window.showInputBox({
      title: `mnema: ${verdict === 'accept' ? 'Accept' : 'Reject'} Decision`,
      prompt: `Why ${verdict} "${item.title}"? The note is recorded with the verdict.`,
      placeHolder: 'The reason, in a sentence (required)',
      ignoreFocusOut: true,
      validateInput: noteProblem,
    });
    if (note === undefined || noteProblem(note) !== undefined) return;
    const result = await read(judgeArgs(verdict, item.id, note));
    if (result.code === 0) {
      void api.window.showInformationMessage(result.stdout.trim().split('\n')[0] ?? 'Recorded.');
    } else {
      void api.window.showErrorMessage(
        `mnema refused: ${(result.stderr || result.stdout).trim() || 'no reason given'}`,
      );
    }
    await refresh();
  }

  keep(
    api.commands.registerCommand('mnema.accept', (element?: Proposed) => judge('accept', element)),
  );
  keep(
    api.commands.registerCommand('mnema.reject', (element?: Proposed) => judge('reject', element)),
  );
  keep(
    api.commands.registerCommand('mnema.refresh', async () => {
      // Reading again in a folder with no record reads nothing: it says so, and shows no bar.
      needsRecord();
      await refresh();
    }),
  );
  keep(
    api.commands.registerCommand('mnema.showRules', async (given?: string) => {
      if (!needsRecord()) return;
      const document = api.window.activeTextEditor?.document;
      const path = given ?? (document === undefined ? undefined : relativePath(document));
      if (path === undefined) return;
      const rules = await rulesOver(path);
      await api.window.showQuickPick(
        rules.map((rule) => ({ ...ruleLabel(rule), rule })),
        {
          title: 'mnema: Rules over This File',
          placeHolder: `Rules in force over ${path}`,
          ignoreFocusOut: true,
        },
      );
    }),
  );

  // ---- Stacks ---------------------------------------------------------------------------------
  // Every act is `mnema stack` with an argument array. A plan is shown whole, in the output channel,
  // before anything is written, and what is written is the plan whose digest the person confirmed.
  // Nothing here turns a hook on: that is done by a person at a terminal, and the note says so.
  const channel = keep(api.window.createOutputChannel('mnema stacks'));
  /** Shows what a run printed under the command that made it, so the person sees what was asked. */
  const shownAs = (args: readonly string[], text: string): void => {
    channel.clear();
    channel.appendLine(['mnema', ...args].join(' '));
    for (const line of text.trimEnd().split('\n')) channel.appendLine(line);
    if (showsHooks(text)) channel.appendLine(HOOKS_NOTE);
    channel.show(true);
  };
  const refusalOf = (result: CliResult): string =>
    `mnema refused: ${(result.stderr || result.stdout).trim() || 'no reason given'}`;
  const WRITE = 'Write these files';
  const REMOVE = 'Remove';

  const stacksProvider: TreeProvider<AdoptedStack> = {
    onDidChangeTreeData: stacksChanged.event,
    getChildren: () => session.stacks,
    getTreeItem(stack) {
      const node = new api.TreeItem(stack.name, api.TreeItemCollapsibleState.None);
      node.description = stackDescription(stack);
      node.tooltip = stackTooltip(stack);
      node.contextValue = 'stack';
      return node;
    },
  };
  keep(api.window.createTreeView('mnema.stacks', { treeDataProvider: stacksProvider }));

  async function pickScope(title: string): Promise<StackScope | undefined> {
    return (
      await api.window.showQuickPick(SCOPES, {
        title,
        placeHolder: 'Where is the stack adopted?',
        ignoreFocusOut: true,
      })
    )?.label;
  }

  async function pickStack(element: AdoptedStack | undefined): Promise<AdoptedStack | undefined> {
    if (element !== undefined) return element;
    return (
      await api.window.showQuickPick(
        session.stacks.map((s) => ({ label: s.name, description: s.scope, stack: s })),
        { title: 'mnema: Pick Stack', placeHolder: 'Which stack?', ignoreFocusOut: true },
      )
    )?.stack;
  }

  /** Shows the plan, asks once, and writes what was shown: the same two calls as the terminal's. */
  async function adopt(source: string, scope: StackScope, listedDigest?: string): Promise<void> {
    const plan = await read(planArgs(source, scope));
    if (plan.code !== 0) {
      void api.window.showErrorMessage(refusalOf(plan));
      return;
    }
    shownAs(planArgs(source, scope), plan.stdout);
    const digest = digestOf(plan.stdout);
    if (digest === undefined) {
      void api.window.showErrorMessage(
        'mnema: the plan did not carry a digest this extension can read. Nothing was written.',
      );
      return;
    }
    if (listedDigest !== undefined && digest !== listedDigest) {
      void api.window.showErrorMessage(
        `mnema: the plan's digest ${digest} is not the one the index lists, ${listedDigest}. Nothing was written.`,
      );
      return;
    }
    const choice = await api.window.showInformationMessage(
      `mnema: write the files of this plan into the ${scope} tree? Digest ${digest}; the plan is in the "mnema stacks" output.`,
      WRITE,
    );
    if (choice !== WRITE) return;
    const done = await read(installArgs(source, scope, digest));
    if (done.code === 0) {
      void api.window.showInformationMessage(done.stdout.trim().split('\n')[0] ?? 'Installed.');
    } else {
      void api.window.showErrorMessage(refusalOf(done));
    }
    await refresh();
  }

  keep(
    api.commands.registerCommand('mnema.stacks.add', async () => {
      if (!needsRecord()) return;
      const typed = await api.window.showInputBox({
        title: 'mnema: Add Stack (1 of 2)',
        prompt:
          'A folder, a tar archive, or an https:// git address of a stack. The plan is shown before anything is written.',
        placeHolder: 'e.g. ./my-stack or https://github.com/owner/my-stack.git',
        ignoreFocusOut: true,
        validateInput: sourceProblem,
      });
      if (typed === undefined || sourceProblem(typed) !== undefined) return;
      const scope = await pickScope('mnema: Add Stack (2 of 2)');
      if (scope === undefined) return;
      await adopt(typed.trim(), scope);
    }),
  );

  keep(
    api.commands.registerCommand('mnema.stacks.addFromIndex', async () => {
      if (!needsRecord()) return;
      const where = api.workspace
        .getConfiguration('mnema')
        .get<string>('stackIndex', 'stack-index');
      const index = await read(indexArgs(where));
      if (index.code !== 0) {
        void api.window.showErrorMessage(refusalOf(index));
        return;
      }
      const entries = readIndex(index.stdout);
      const entry = (
        await api.window.showQuickPick(
          entries.map((e) => ({
            label: `${e.name} ${e.version}`,
            description: e.description,
            entry: e,
          })),
          {
            title: 'mnema: Add from Index (1 of 2)',
            placeHolder: 'Which stack of the index?',
            ignoreFocusOut: true,
          },
        )
      )?.entry;
      if (entry === undefined) return;
      if (entry.source === undefined) {
        void api.window.showInformationMessage(
          `mnema: ${entry.name} is listed with no folder in this checkout (${entry.link}). Add it from its own address in a terminal with "mnema stack add <address> --dry-run", and compare the digest the plan shows with ${entry.digest}.`,
        );
        return;
      }
      const scope = await pickScope('mnema: Add from Index (2 of 2)');
      if (scope === undefined) return;
      await adopt(entry.source, scope, entry.digest);
    }),
  );

  for (const look of ['show', 'diff', 'check'] as const satisfies readonly Look[]) {
    keep(
      api.commands.registerCommand(`mnema.stacks.${look}`, async (element?: AdoptedStack) => {
        if (!needsRecord()) return;
        const stack = await pickStack(element);
        if (stack === undefined) return;
        const result = await read(lookArgs(look, stack.name, stack.scope));
        // `diff` and `check` exit 1 when something departs and still print what they found.
        if (result.stdout.trim() === '') {
          void api.window.showErrorMessage(refusalOf(result));
          return;
        }
        shownAs(lookArgs(look, stack.name, stack.scope), result.stdout);
      }),
    );
  }

  keep(
    api.commands.registerCommand('mnema.stacks.remove', async (element?: AdoptedStack) => {
      if (!needsRecord()) return;
      const stack = await pickStack(element);
      if (stack === undefined) return;
      const plan = await read(removeArgs(stack.name, stack.scope, true));
      if (plan.code !== 0) {
        void api.window.showErrorMessage(refusalOf(plan));
        return;
      }
      shownAs(removeArgs(stack.name, stack.scope, true), plan.stdout);
      const choice = await api.window.showInformationMessage(
        `mnema: remove ${stack.name} from the ${stack.scope} tree? What this would do is in the "mnema stacks" output.`,
        REMOVE,
      );
      if (choice !== REMOVE) return;
      const done = await read(removeArgs(stack.name, stack.scope, false));
      if (done.code === 0) {
        shownAs(removeArgs(stack.name, stack.scope, false), done.stdout);
        void api.window.showInformationMessage(done.stdout.trim().split('\n')[0] ?? 'Removed.');
      } else {
        void api.window.showErrorMessage(refusalOf(done));
      }
      await refresh();
    }),
  );

  keep(
    api.commands.registerCommand('mnema.stacks.export', async (element?: AdoptedStack) => {
      if (!needsRecord()) return;
      const stack = await pickStack(element);
      if (stack === undefined) return;
      const folder = await api.window.showInputBox({
        title: 'mnema: Export Stack',
        prompt: `A folder that does not exist yet, or is empty, to export ${stack.name} into`,
        placeHolder: `e.g. ./${stack.name}`,
        ignoreFocusOut: true,
        validateInput: folderProblem,
      });
      if (folder === undefined || folderProblem(folder) !== undefined) return;
      const done = await read(exportArgs(stack.name, stack.scope, folder.trim()));
      if (done.code === 0) {
        shownAs(exportArgs(stack.name, stack.scope, folder.trim()), done.stdout);
        void api.window.showInformationMessage(done.stdout.trim().split('\n')[0] ?? 'Exported.');
      } else {
        void api.window.showErrorMessage(refusalOf(done));
      }
    }),
  );

  const watcher = keep(
    api.workspace.createFileSystemWatcher(new api.RelativePattern(folder, '.mnema/**')),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => void refresh(), QUIET_MS);
  };
  keep(watcher.onDidChange(changed));
  keep(watcher.onDidCreate(changed));
  keep(watcher.onDidDelete(changed));
  keep(
    api.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('mnema.command')) void refresh();
    }),
  );
  keep({ dispose: () => timer !== undefined && clearTimeout(timer) } as Disposable);

  void refresh();
  return {
    shown: () => ({
      text: bar.text,
      tooltip: bar.tooltip,
      visible: barVisible,
      badge: proposedView?.badge,
    }),
  };
}

/** Nothing to release: everything `activate` made is on the context's subscriptions. */
export function deactivate(): void {}
