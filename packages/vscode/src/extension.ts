/**
 * The extension: the VS Code side of what the other modules read from the command line.
 *
 * `activate` is handed the `vscode` module by the bundle's entry (`build/bundle.mjs`), and this file
 * declares the few members of it that it uses. So the whole of it runs, in the tests, against a
 * stand-in — and nothing here imports `vscode`, which would need the editor to exist.
 *
 * Every read and every write goes through the `mnema` command line. A decision is judged with the
 * CLI's own verb and the note it requires; nothing about rules, state or proof is decided here.
 */

import { relative } from 'node:path';
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
import { type Channel, readChannels, readVerdict, statusText, statusTooltip } from './status.js';

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
      command: string;
      show(): void;
      dispose(): void;
    };
    registerTreeDataProvider<T>(viewId: string, provider: TreeProvider<T>): Disposable;
    createOutputChannel(name: string): OutputChannelLike;
    showInputBox(options: {
      prompt: string;
      validateInput: (value: string) => string | undefined;
    }): PromiseLike<string | undefined>;
    showQuickPick<T extends { label: string }>(
      items: readonly T[],
      options: { placeHolder: string },
    ): PromiseLike<T | undefined>;
    showInformationMessage(message: string, ...actions: string[]): PromiseLike<string | undefined>;
    showErrorMessage(message: string): PromiseLike<string | undefined>;
    readonly activeTextEditor: { readonly document: DocumentLike } | undefined;
  };
  readonly commands: {
    registerCommand(id: string, callback: (...args: never[]) => unknown): Disposable;
    executeCommand(id: string): PromiseLike<unknown>;
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
  read(args: readonly string[]): Promise<CliResult>;
}

/** Starts the extension against one workspace folder: the first one open. */
export function activate(
  context: { subscriptions: Disposable[] },
  api: VscodeApi,
  options: { run?: Run } = {},
): void {
  const folder = api.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (folder === undefined) return;
  const command = api.workspace.getConfiguration('mnema').get<string>('command', 'mnema');
  const run = options.run ?? createRun(command, folder);
  const session: Session = {
    details: new Map(),
    rules: new Map(),
    proposed: [],
    stacks: [],
    total: 0,
    seen: undefined,
    channels: undefined,
    read: run,
  };
  const keep = <T extends Disposable>(d: T): T => {
    context.subscriptions.push(d);
    return d;
  };

  const treeChanged = keep(new api.EventEmitter<void>());
  const stacksChanged = keep(new api.EventEmitter<void>());
  const lensesChanged = keep(new api.EventEmitter<void>());
  const bar = keep(api.window.createStatusBarItem(api.StatusBarAlignment.Left));
  bar.command = 'mnema.refresh';
  bar.text = 'mnema: reading';
  bar.tooltip = '';
  bar.show();

  async function refresh(): Promise<void> {
    session.rules.clear();
    lensesChanged.fire();
    const [list, verify, channels, stacks] = await Promise.all([
      session.read(LIST_ARGS),
      session.read(['verify', '--json']),
      session.read(['switch']),
      session.read(STACK_LIST_ARGS),
    ]);
    session.stacks = stacks.code === 0 ? readStacks(stacks.stdout) : [];
    stacksChanged.fire();
    session.channels = channels.code === 0 ? readChannels(channels.stdout) : undefined;
    bar.text = statusText(readVerdict(verify.stdout), session.channels);
    bar.tooltip = statusTooltip(session.channels);
    if (list.code !== 0) return;
    const { items, total } = readProposed(list.stdout);
    const fresh = newlyProposed(session.seen, items);
    session.seen = new Set(items.map((item) => item.id));
    session.proposed = items;
    session.total = total;
    await Promise.all(
      items
        .filter((item) => !session.details.has(item.id))
        .map(async (item) => {
          const shown = await session.read(['show', item.id, '--json']);
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
    const answer = await session.read(['rules', path, '--json']);
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
  keep(api.window.registerTreeDataProvider('mnema.proposed', provider));

  async function judge(verdict: Judgment, element: Proposed | undefined): Promise<void> {
    const item =
      element ??
      (
        await api.window.showQuickPick(
          session.proposed.map((p) => ({ label: p.title, description: p.id, item: p })),
          { placeHolder: `Which decision to ${verdict}?` },
        )
      )?.item;
    if (item === undefined) return;
    const note = await api.window.showInputBox({
      prompt: `Why ${verdict} "${item.title}"? The note is recorded with the verdict.`,
      validateInput: noteProblem,
    });
    if (note === undefined || noteProblem(note) !== undefined) return;
    const result = await session.read(judgeArgs(verdict, item.id, note));
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
  keep(api.commands.registerCommand('mnema.refresh', () => refresh()));
  keep(
    api.commands.registerCommand('mnema.showRules', async (given?: string) => {
      const document = api.window.activeTextEditor?.document;
      const path = given ?? (document === undefined ? undefined : relativePath(document));
      if (path === undefined) return;
      const rules = await rulesOver(path);
      await api.window.showQuickPick(
        rules.map((rule) => ({ ...ruleLabel(rule), rule })),
        { placeHolder: `Rules in force over ${path}` },
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
  keep(api.window.registerTreeDataProvider('mnema.stacks', stacksProvider));

  async function pickScope(): Promise<StackScope | undefined> {
    return (await api.window.showQuickPick(SCOPES, { placeHolder: 'Where is the stack adopted?' }))
      ?.label;
  }

  async function pickStack(element: AdoptedStack | undefined): Promise<AdoptedStack | undefined> {
    if (element !== undefined) return element;
    return (
      await api.window.showQuickPick(
        session.stacks.map((s) => ({ label: s.name, description: s.scope, stack: s })),
        { placeHolder: 'Which stack?' },
      )
    )?.stack;
  }

  /** Shows the plan, asks once, and writes what was shown: the same two calls as the terminal's. */
  async function adopt(source: string, scope: StackScope, listedDigest?: string): Promise<void> {
    const plan = await session.read(planArgs(source, scope));
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
    const done = await session.read(installArgs(source, scope, digest));
    if (done.code === 0) {
      void api.window.showInformationMessage(done.stdout.trim().split('\n')[0] ?? 'Installed.');
    } else {
      void api.window.showErrorMessage(refusalOf(done));
    }
    await refresh();
  }

  keep(
    api.commands.registerCommand('mnema.stacks.add', async () => {
      const typed = await api.window.showInputBox({
        prompt: 'A folder, a tar archive, or an https:// git address of a stack',
        validateInput: sourceProblem,
      });
      if (typed === undefined || sourceProblem(typed) !== undefined) return;
      const scope = await pickScope();
      if (scope === undefined) return;
      await adopt(typed.trim(), scope);
    }),
  );

  keep(
    api.commands.registerCommand('mnema.stacks.addFromIndex', async () => {
      const where = api.workspace
        .getConfiguration('mnema')
        .get<string>('stackIndex', 'stack-index');
      const index = await session.read(indexArgs(where));
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
          { placeHolder: 'Which stack of the index?' },
        )
      )?.entry;
      if (entry === undefined) return;
      if (entry.source === undefined) {
        void api.window.showInformationMessage(
          `mnema: ${entry.name} is listed with no folder in this checkout (${entry.link}). Add it from its own address in a terminal with "mnema stack add <address> --dry-run", and compare the digest the plan shows with ${entry.digest}.`,
        );
        return;
      }
      const scope = await pickScope();
      if (scope === undefined) return;
      await adopt(entry.source, scope, entry.digest);
    }),
  );

  for (const look of ['show', 'diff', 'check'] as const satisfies readonly Look[]) {
    keep(
      api.commands.registerCommand(`mnema.stacks.${look}`, async (element?: AdoptedStack) => {
        const stack = await pickStack(element);
        if (stack === undefined) return;
        const result = await session.read(lookArgs(look, stack.name, stack.scope));
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
      const stack = await pickStack(element);
      if (stack === undefined) return;
      const plan = await session.read(removeArgs(stack.name, stack.scope, true));
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
      const done = await session.read(removeArgs(stack.name, stack.scope, false));
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
      const stack = await pickStack(element);
      if (stack === undefined) return;
      const folder = await api.window.showInputBox({
        prompt: `A folder that does not exist yet, or is empty, to export ${stack.name} into`,
        validateInput: folderProblem,
      });
      if (folder === undefined || folderProblem(folder) !== undefined) return;
      const done = await session.read(exportArgs(stack.name, stack.scope, folder.trim()));
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
  keep({ dispose: () => timer !== undefined && clearTimeout(timer) } as Disposable);

  void refresh();
}

/** Nothing to release: everything `activate` made is on the context's subscriptions. */
export function deactivate(): void {}
