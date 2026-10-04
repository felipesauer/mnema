/**
 * The extension: the VS Code side of what the other modules read from the command line.
 *
 * `activate` is handed the `vscode` module by the CommonJS entry (`extension.cjs`), and this file
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
    registerTreeDataProvider(viewId: string, provider: TreeProvider): Disposable;
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

interface TreeProvider {
  onDidChangeTreeData: Event<void>;
  getChildren(): Proposed[];
  getTreeItem(element: Proposed): TreeItemLike;
}

/** What the extension holds between one reading of the record and the next. */
interface Session {
  readonly details: Map<string, ProposedDetail>;
  readonly rules: Map<string, RuleView[]>;
  proposed: Proposed[];
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
  const lensesChanged = keep(new api.EventEmitter<void>());
  const bar = keep(api.window.createStatusBarItem(api.StatusBarAlignment.Left));
  bar.command = 'mnema.refresh';
  bar.text = 'mnema: reading';
  bar.tooltip = '';
  bar.show();

  async function refresh(): Promise<void> {
    session.rules.clear();
    lensesChanged.fire();
    const [list, verify, channels] = await Promise.all([
      session.read(LIST_ARGS),
      session.read(['verify', '--json']),
      session.read(['switch']),
    ]);
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

  const provider: TreeProvider = {
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
