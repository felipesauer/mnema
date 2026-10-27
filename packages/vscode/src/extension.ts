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
import { relative } from 'node:path';
import { oneLine } from '@mnema/chain/one-line';
import { type CliResult, createRun, type Run } from './cli.js';
import {
  awaitsJudgment,
  DECISION_SCHEME,
  decisionPath,
  decisionQuery,
  idOfQuery,
  readDecision,
  showArgs,
} from './decision.js';
import {
  acceptStamp,
  type Judgment,
  judgeArgs,
  judgedText,
  judgeLabel,
  LIST_ARGS,
  noteProblem,
  type Proposed,
  proposedTooltip,
  readProposed,
  readStatus,
  STATUS_ARGS,
  wasCut,
  withAdrs,
} from './proposed.js';
import { decorationFor, recordFolderOf } from './record-mark.js';
import { lensTitle, type RuleView, readRules, ruleLabel, rulesArgs } from './rules.js';
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
  scopeLabel,
  showsHooks,
  sourceProblem,
  stackDescription,
  stackIcon,
  stackSpoken,
  stackTooltip,
} from './stacks.js';
import {
  awaitingPhrase,
  type Channel,
  type CliState,
  CONTAINER_COMMAND,
  describeBar,
  readChannels,
  readCli,
  readVerdict,
  TOOLTIP_COMMANDS,
  type Verdict,
} from './status.js';
import { pathOfQuery, WHY_SCHEME, whyArgs, whyDocument, whyPath, whyQuery } from './why.js';

/** How long the record has to be quiet before it is read again. */
export const QUIET_MS = 1500;

/**
 * The most often the record's verification is run again because the record changed: `mnema verify`
 * (twice) and `mnema switch` are three processes, and an agent that writes every few seconds keeps
 * the quiet period above from ever being long. A write inside the interval is verified at its end.
 */
export const VERIFY_EVERY_MS = 10_000;

interface Disposable {
  dispose(): void;
}
type Event<T> = (listener: (event: T) => unknown) => Disposable;

interface TreeItemLike {
  description?: string;
  tooltip?: string;
  contextValue?: string;
  iconPath?: unknown;
  command?: { command: string; title: string; arguments: unknown[] };
  accessibilityInformation?: { label: string; role?: string };
}

/** An address, as far as this extension reads one. */
interface UriLike {
  readonly scheme: string;
  readonly path: string;
  readonly query: string;
  readonly fsPath: string;
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
    registerTextDocumentContentProvider(
      scheme: string,
      provider: {
        onDidChange: Event<UriLike>;
        provideTextDocumentContent(uri: UriLike): PromiseLike<string>;
      },
    ): Disposable;
    openTextDocument(uri: UriLike): PromiseLike<unknown>;
    onDidCloseTextDocument: Event<{ readonly uri: UriLike }>;
  };
  readonly Uri: {
    from(parts: { scheme: string; path: string; query: string }): UriLike;
    file(path: string): UriLike;
  };
  readonly RelativePattern: new (base: string, pattern: string) => unknown;
  readonly window: {
    createStatusBarItem(alignment: number): {
      name: string | undefined;
      text: string;
      tooltip: MarkdownLike | string;
      command: string;
      backgroundColor: unknown;
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
      value?: string;
      valueSelection?: [number, number];
    }): PromiseLike<string | undefined>;
    showQuickPick<T extends { label: string }>(
      items: readonly T[],
      options: { title: string; placeHolder: string; ignoreFocusOut?: boolean },
    ): PromiseLike<T | undefined>;
    registerFileDecorationProvider(provider: {
      onDidChangeFileDecorations: Event<UriLike>;
      provideFileDecoration(uri: UriLike): unknown;
    }): Disposable;
    showInformationMessage(message: string, ...actions: string[]): PromiseLike<string | undefined>;
    showErrorMessage(message: string): PromiseLike<string | undefined>;
    readonly activeTextEditor: { readonly document: DocumentLike } | undefined;
    onDidChangeActiveTextEditor: Event<unknown>;
    showTextDocument(document: unknown, options: { preview: boolean }): PromiseLike<unknown>;
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
  readonly MarkdownString: new (value: string) => MarkdownLike;
  readonly ThemeColor: new (id: string) => unknown;
  readonly FileDecoration: new (badge: string, tooltip: string, color: unknown) => unknown;
  readonly ThemeIcon: new (id: string, color?: unknown) => unknown;
}

/** The markdown of a tooltip: trusted for the commands listed, and without HTML. */
interface MarkdownLike {
  readonly value: string;
  isTrusted?: boolean | { readonly enabledCommands: readonly string[] };
  supportHtml?: boolean;
}

interface DocumentLike {
  readonly uri: UriLike;
}

/** The number on the side bar icon of the extension, and what it says when hovered. */
interface BadgeLike {
  readonly value: number;
  readonly tooltip: string;
}

interface TreeViewLike extends Disposable {
  badge: BadgeLike | undefined;
  /** Whether the view is on screen: a view that is not is not read for. */
  readonly visible: boolean;
  onDidChangeVisibility: Event<{ readonly visible: boolean }>;
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
  /** What the last look at `mnema --version` said; undefined before the first. */
  cli: CliState | undefined;
  /** What the last run of `mnema verify` and `mnema switch` said, and when. */
  bar:
    | {
        readonly verdict: Verdict;
        readonly channels: Channel[] | undefined;
        readonly printed: string[];
        readonly readAt: Date;
      }
    | undefined;
  /** Whether the stacks listed are older than the view: it was hidden when the record last changed. */
  stacksStale: boolean;
  /** What the last read of each decision opened whole said: its ADR, its title and its state. */
  readonly known: Map<
    string,
    { adr: string | undefined; title: string | undefined; state: string | undefined }
  >;
  readonly rules: Map<string, RuleView[]>;
  proposed: Proposed[];
  stacks: AdoptedStack[];
  /** How many decisions await a judgment, as the command line counted them; undefined when not read. */
  total: number | undefined;
}

/** What the extension hands to whoever activated it: what it shows now, read only. */
export interface Shown {
  readonly text: string;
  /** The markdown of the tooltip, as it was handed to the editor. */
  readonly tooltip: string;
  /** What a click on the status bar item runs. */
  readonly command: string;
  /** Whether the status bar item is shown: it is not in a folder with no `.mnema`, nor when the setting hides it. */
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
    tooltip: awaitingPhrase(total),
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
  const recordFolder = recordFolderOf(folder);
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
   * starting anything, when there is no record. The describe "in a folder with no .mnema the command line is never run" holds it.
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
    cli: undefined,
    bar: undefined,
    stacksStale: true,
    known: new Map(),
    rules: new Map(),
    proposed: [],
    stacks: [],
    total: undefined,
  };
  const keep = <T extends Disposable>(d: T): T => {
    context.subscriptions.push(d);
    return d;
  };

  const treeChanged = keep(new api.EventEmitter<void>());
  const stacksChanged = keep(new api.EventEmitter<void>());
  const lensesChanged = keep(new api.EventEmitter<void>());
  const decisionsChanged = keep(new api.EventEmitter<UriLike>());
  /** The decisions opened as documents, so a new reading of the record refreshes them. */
  const openDecisions = new Map<string, UriLike>();
  const bar = keep(api.window.createStatusBarItem(api.StatusBarAlignment.Left));
  let barVisible = false;
  // The setting is the person's, on this machine: it is read each time the bar is placed.
  const barEnabled = (): boolean =>
    api.workspace.getConfiguration('mnema').get<boolean>('statusBar.enabled', true);
  // A folder with no record shows no bar item (there is nothing for it to say), and neither does
  // a person who switched it off.
  const placeBar = (): void => {
    barVisible = hasRecord() && barEnabled();
    if (barVisible) bar.show();
    else bar.hide();
  };
  bar.name = 'mnema';
  bar.command = CONTAINER_COMMAND;
  bar.text = 'mnema: reading';
  bar.tooltip = '';
  bar.accessibilityInformation = { label: 'mnema: reading', role: 'button' };
  placeBar();

  /** The view that lists what awaits a judgment carries the number on the side bar icon. */
  let proposedView: TreeViewLike | undefined;
  /** The total the command line counted; undefined, and no badge, when there is nothing to count. */
  const setAwaiting = (total: number | undefined): void => {
    if (proposedView !== undefined) proposedView.badge = badgeFor(total);
  };

  function applyBar(shown: ReturnType<typeof describeBar>): void {
    placeBar();
    bar.text = shown.text;
    const tooltip = new api.MarkdownString(shown.tooltip);
    tooltip.isTrusted = { enabledCommands: TOOLTIP_COMMANDS };
    tooltip.supportHtml = false;
    bar.tooltip = tooltip;
    bar.accessibilityInformation = shown.accessibility;
    bar.command = shown.command;
    bar.backgroundColor = shown.warning
      ? new api.ThemeColor('statusBarItem.warningBackground')
      : undefined;
  }

  /** The stacks view, once it is made: a view that is not on screen is not read for. */
  let stacksView: TreeViewLike | undefined;
  const stacksVisible = (): boolean => stacksView?.visible === true;

  /** When the record's verification last ran, and the timer that runs it at the end of a burst. */
  let verifiedAt = Number.NEGATIVE_INFINITY;
  let trailing: ReturnType<typeof setTimeout> | undefined;
  const verifyDue = (): boolean => Date.now() - verifiedAt >= VERIFY_EVERY_MS;

  /** Paints the bar from what was last read of the verification and of what awaits a judgment. */
  function paintBar(): void {
    const { cli, bar: read } = session;
    if (cli?.kind !== 'ready' || read === undefined) return;
    applyBar(describeBar({ cli, ...read, awaiting: session.total }));
  }

  /** `mnema --version`: whether the command line can be run at all, kept for the reads that follow. */
  async function lookAtCli(): Promise<CliState> {
    const cli = readCli(await read(['--version']));
    session.cli = cli;
    void api.commands.executeCommand('setContext', 'mnema.cliMissing', cli.kind === 'missing');
    return cli;
  }

  /** A command that is not there is not "nothing pending": nothing is listed and the bar says so. */
  function showMissing(cli: CliState): void {
    session.proposed = [];
    session.stacks = [];
    session.total = undefined;
    session.bar = undefined;
    session.stacksStale = true;
    void api.commands.executeCommand('setContext', 'mnema.proposedRead', false);
    void api.commands.executeCommand('setContext', 'mnema.stacksRead', false);
    setAwaiting(undefined);
    applyBar(
      describeBar({
        cli,
        verdict: { kind: 'unreadable' },
        channels: undefined,
        printed: [],
        awaiting: undefined,
        readAt: new Date(),
      }),
    );
    stacksChanged.fire();
    treeChanged.fire();
  }

  /** A call came back with no exit code at all: the command may be gone, and only `--version` says. */
  async function afterLost(): Promise<void> {
    const cli = await lookAtCli();
    if (cli.kind === 'missing') showMissing(cli);
  }

  const settleLost = async (lost: boolean): Promise<void> => {
    if (lost) await afterLost();
  };

  /** The verification: `mnema verify --json`, `mnema verify` and `mnema switch`. True when a call was lost. */
  async function readBar(): Promise<boolean> {
    verifiedAt = Date.now();
    if (trailing !== undefined) clearTimeout(trailing);
    trailing = undefined;
    const [verify, coverage, channels] = await Promise.all([
      read(['verify', '--json']),
      read(['verify']),
      read(['switch']),
    ]);
    const verdict = readVerdict(verify.stdout);
    const lines = (text: string, most: number): string[] =>
      text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .slice(0, most);
    session.bar = {
      verdict,
      channels: channels.code === 0 ? readChannels(channels.stdout) : undefined,
      // The words are the command line's own: what `mnema verify` printed, up to a few lines,
      // and when it failed, the first issues it listed on its error output.
      printed: [
        ...lines(coverage.stdout, 6),
        ...(verdict.kind === 'failed' ? lines(coverage.stderr, 3) : []),
      ],
      readAt: new Date(),
    };
    paintBar();
    return [verify, coverage, channels].some((result) => result.code === null);
  }

  /** The verification of a record that changed inside the interval, run once the interval is over. */
  function verifyAtTheEndOfTheBurst(): void {
    if (trailing !== undefined) return;
    trailing = setTimeout(
      () => {
        trailing = undefined;
        if (!hasRecord() || !barEnabled() || session.cli?.kind !== 'ready') return;
        void readBar().then(settleLost);
      },
      Math.max(0, verifiedAt + VERIFY_EVERY_MS - Date.now()),
    );
  }

  /** What awaits a judgment: one `mnema status --json`, and `mnema search` too only when status cut its list. */
  async function readProposals(): Promise<boolean> {
    const status = await read(STATUS_ARGS);
    let lost = status.code === null;
    const awaiting = status.code === 0 ? readStatus(status.stdout) : undefined;
    let listed: { items: Proposed[]; total: number } | undefined;
    if (awaiting !== undefined) {
      listed = { items: awaiting.items, total: awaiting.items.length };
      if (wasCut(awaiting)) {
        const more = await read(LIST_ARGS);
        lost ||= more.code === null;
        const searched = more.code === 0 ? readProposed(more.stdout) : undefined;
        // When the longer list cannot be read, the ones `status` served are listed, and the count
        // is the one it gave for all of them.
        listed =
          searched === undefined
            ? { items: awaiting.items, total: awaiting.total }
            : withAdrs(searched, awaiting.items);
      }
    }
    // A list that was not read is not an empty one: the view says it did not read, and no number is shown.
    void api.commands.executeCommand('setContext', 'mnema.proposedRead', listed !== undefined);
    session.proposed = listed?.items ?? [];
    session.total = listed?.total;
    setAwaiting(session.total);
    paintBar();
    treeChanged.fire();
    return lost;
  }

  /** The stacks adopted: `mnema stack list --json`. Read means the answer was understood. */
  async function readStackList(): Promise<boolean> {
    const stacks = await read(STACK_LIST_ARGS);
    const listed = stacks.code === 0 ? readStacks(stacks.stdout) : undefined;
    session.stacks = listed ?? [];
    session.stacksStale = false;
    void api.commands.executeCommand('setContext', 'mnema.stacksRead', listed !== undefined);
    stacksChanged.fire();
    return stacks.code === null;
  }

  /**
   * Why the record is being read: when the extension starts, when the person asks (and after an act
   * of theirs), when the command setting changes, or because the record changed on disk. Only the
   * last is spared work: it neither asks `--version` again nor verifies more than once in an
   * interval, and the stacks are read only when their view is on screen.
   */
  type Reading = 'start' | 'explicit' | 'setting' | 'watch';

  async function readRecord(reading: Reading): Promise<void> {
    // The empty views say one thing with a record in the folder and another without; the key is
    // whether the folder holds a `.mnema`, nothing the command line said.
    const record = hasRecord();
    void api.commands.executeCommand('setContext', 'mnema.hasRecord', record);
    session.rules.clear();
    lensesChanged.fire();
    if (!record) {
      // No record is not "command not found": nothing is asked of the command line, the bar is
      // hidden, and the views say how to start a record.
      session.cli = undefined;
      session.bar = undefined;
      session.proposed = [];
      session.stacks = [];
      session.total = undefined;
      session.stacksStale = true;
      void api.commands.executeCommand('setContext', 'mnema.cliMissing', false);
      void api.commands.executeCommand('setContext', 'mnema.proposedRead', false);
      void api.commands.executeCommand('setContext', 'mnema.stacksRead', false);
      placeBar();
      setAwaiting(undefined);
      stacksChanged.fire();
      treeChanged.fire();
      return;
    }
    // Whether the command can be run at all comes first: a command that is not there is not
    // "nothing pending", and nothing else is asked of it. A watcher reading does not ask again
    // while the last answer was that it is there; one that lost a call asks at the end.
    if (reading !== 'watch' || session.cli?.kind !== 'ready') {
      const cli = await lookAtCli();
      if (cli.kind === 'missing') {
        showMissing(cli);
        return;
      }
    }
    const barOn = barEnabled();
    const verifyNow = barOn && (reading !== 'watch' || verifyDue());
    if (barOn && !verifyNow) verifyAtTheEndOfTheBurst();
    const stacksNow = reading === 'explicit' || stacksVisible();
    if (!stacksNow) {
      session.stacksStale = true;
      void api.commands.executeCommand('setContext', 'mnema.stacksRead', false);
    }
    const lost = await Promise.all([
      verifyNow ? readBar() : false,
      readProposals(),
      stacksNow ? readStackList() : false,
    ]);
    if (lost.some(Boolean)) await afterLost();
  }

  /** A reading of the record, and then the decisions open as documents are read again. */
  async function refresh(reading: Reading): Promise<void> {
    await readRecord(reading);
    for (const uri of openDecisions.values()) decisionsChanged.fire(uri);
  }

  async function rulesOver(path: string): Promise<RuleView[]> {
    const known = session.rules.get(path);
    if (known !== undefined) return known;
    const answer = await read(rulesArgs(path));
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

  /** Whether the decision of the editor in front was `proposed` when it was last read: the title buttons ask. */
  const syncActiveDecision = (): void => {
    const uri = api.window.activeTextEditor?.document.uri;
    const id = uri?.scheme === DECISION_SCHEME ? idOfQuery(uri.query) : undefined;
    const proposed = id !== undefined && awaitsJudgment(session.known.get(id)?.state);
    void api.commands.executeCommand('setContext', 'mnema.activeDecisionProposed', proposed);
  };
  keep(api.window.onDidChangeActiveTextEditor(syncActiveDecision));

  // A decision opened whole is `mnema show <id> --json`, laid out as text and read again each time
  // the editor asks (when it opens, and after each reading of the record): nothing is kept of it
  // but what the last read said about its state, which decides whether the title buttons show.
  keep(
    api.workspace.registerTextDocumentContentProvider(DECISION_SCHEME, {
      onDidChange: decisionsChanged.event,
      async provideTextDocumentContent(uri) {
        const id = idOfQuery(uri.query);
        if (id === undefined) return 'This address carries no decision id.\n';
        openDecisions.set(uri.query, uri);
        const answer = await read(showArgs(id));
        const decision = readDecision(id, answer, new Date());
        session.known.set(id, { adr: decision.adr, title: decision.title, state: decision.state });
        syncActiveDecision();
        return decision.text;
      },
    }),
  );

  // A tab that was closed is no longer refreshed: it leaves the map when the editor says it closed.
  keep(
    api.workspace.onDidCloseTextDocument((document) => {
      if (document.uri.scheme === DECISION_SCHEME) openDecisions.delete(document.uri.query);
    }),
  );

  /** The `ADR-n` of a decision, when the list that served it or the document that opened it said one. */
  const adrOf = (id: string): string | undefined =>
    session.proposed.find((item) => item.id === id)?.adr ?? session.known.get(id)?.adr;

  async function openDecision(id: string): Promise<void> {
    const adr = adrOf(id);
    const uri = api.Uri.from({
      scheme: DECISION_SCHEME,
      path: decisionPath(adr, id),
      query: decisionQuery(id),
    });
    await api.window.showTextDocument(await api.workspace.openTextDocument(uri), { preview: true });
  }

  const provider: TreeProvider<Proposed> = {
    onDidChangeTreeData: treeChanged.event,
    getChildren: () => session.proposed,
    getTreeItem(item) {
      const node = new api.TreeItem(item.title, api.TreeItemCollapsibleState.None);
      const adr = item.adr;
      node.description = adr ?? item.id;
      node.tooltip =
        proposedTooltip(item) +
        (session.total !== undefined && session.total > session.proposed.length
          ? `\n\n(${session.proposed.length} of ${session.total} are listed)`
          : '');
      node.contextValue = 'proposed';
      // The icon is neutral on purpose: a decision that awaits a judgment has not been checked.
      node.iconPath = new api.ThemeIcon('circle-outline');
      node.accessibilityInformation = {
        label: `${adr ?? item.id}, ${item.title}, awaits a judgment`,
      };
      node.command = { command: 'mnema.openDecision', title: 'Open Decision', arguments: [item] };
      return node;
    },
  };
  proposedView = keep(api.window.createTreeView('mnema.proposed', { treeDataProvider: provider }));

  /**
   * What `judge` is handed: an item of the list, or the address of the decision open in the editor
   * (from the buttons of its title). Either way it is one decision, and the note is typed.
   */
  type Target = { readonly id: string; readonly title: string | undefined };
  const targetOf = (element: Proposed | UriLike | undefined): Target | undefined => {
    if (element === undefined) return undefined;
    if ('scheme' in element) {
      const id = idOfQuery(element.query);
      return id === undefined ? undefined : { id, title: session.known.get(id)?.title };
    }
    return { id: element.id, title: element.title };
  };

  async function judge(verdict: Judgment, element: Proposed | UriLike | undefined): Promise<void> {
    if (!needsRecord()) return;
    const given = targetOf(element);
    const item =
      given ??
      (
        await api.window.showQuickPick(
          session.proposed.map((p) => ({ label: p.title, description: p.id, item: p })),
          {
            title: `${verdict === 'accept' ? 'Accept' : 'Reject'} Decision`,
            placeHolder: 'Which decision?',
            ignoreFocusOut: true,
          },
        )
      )?.item;
    if (item === undefined) return;
    const adr = adrOf(item.id);
    // An accept offers a true stamp, kept as typed text the person can replace by a reason; the
    // note is still required and still the person's to send. A rejection offers nothing: the
    // reason is typed.
    const stamp = verdict === 'accept' ? acceptStamp(new Date()) : undefined;
    const note = await api.window.showInputBox({
      title: judgeLabel(verdict, adr, item.id),
      prompt: `"${item.title ?? item.id}". ${stamp === undefined ? '' : 'Enter keeps the stamp, or type a reason. '}The note is recorded with the verdict.`,
      placeHolder: 'Why? Required.',
      ignoreFocusOut: true,
      validateInput: noteProblem,
      ...(stamp === undefined
        ? {}
        : { value: stamp, valueSelection: [0, stamp.length] as [number, number] }),
    });
    if (note === undefined || noteProblem(note) !== undefined) return;
    const result = await read(judgeArgs(verdict, item.id, note));
    if (result.code === 0) {
      void api.window.showInformationMessage(judgedText(result.stdout));
    } else {
      void api.window.showErrorMessage(
        `mnema refused: ${(result.stderr || result.stdout).trim() || 'no reason given'}`,
      );
    }
    await refresh('explicit');
  }

  keep(
    api.commands.registerCommand('mnema.accept', (element?: Proposed | UriLike) =>
      judge('accept', element),
    ),
  );
  keep(
    api.commands.registerCommand('mnema.reject', (element?: Proposed | UriLike) =>
      judge('reject', element),
    ),
  );
  keep(
    api.commands.registerCommand('mnema.openDecision', async (element?: Proposed) => {
      if (!needsRecord()) return;
      const item =
        element ??
        (
          await api.window.showQuickPick(
            session.proposed.map((p) => ({ label: p.title, description: p.id, item: p })),
            { title: 'Open Decision', placeHolder: 'Which decision?', ignoreFocusOut: true },
          )
        )?.item;
      if (item !== undefined) await openDecision(item.id);
    }),
  );
  keep(
    api.commands.registerCommand('mnema.refresh', async () => {
      // Reading again in a folder with no record reads nothing: it says so, and shows no bar.
      needsRecord();
      await refresh('explicit');
    }),
  );
  keep(
    api.commands.registerCommand('mnema.showRules', async (given?: string) => {
      if (!needsRecord()) return;
      const document = api.window.activeTextEditor?.document;
      const path = given ?? (document === undefined ? undefined : relativePath(document));
      if (path === undefined) return;
      const rules = await rulesOver(path);
      const chosen = await api.window.showQuickPick(
        rules.map((rule) => ({ ...ruleLabel(rule), rule })),
        {
          title: 'Rules over This File',
          placeHolder: `Rules in force over ${path}`,
          ignoreFocusOut: true,
        },
      );
      // The rule picked opens whole, as the decision it is; one in force shows no judgment button.
      if (chosen !== undefined) await openDecision(chosen.rule.id);
    }),
  );

  // ---- What to do now, and why a file is the way it is ----------------------------------------
  /** One line of the pick: what it says, and what choosing it does. It never judges a decision. */
  interface Step {
    readonly label: string;
    readonly description?: string;
    readonly run: () => unknown;
  }
  const choose = async (items: readonly Step[], placeHolder: string): Promise<void> => {
    const chosen = await api.window.showQuickPick(items, {
      title: 'What To Do',
      placeHolder,
      ignoreFocusOut: true,
    });
    await chosen?.run();
  };

  // The pick is made of one `mnema status --json`, read when it opens, and of nothing else: what
  // awaits a judgment, in the order the command line gave it, each opening the decision whole.
  keep(
    api.commands.registerCommand('mnema.whatToDo', async () => {
      if (!hasRecord()) {
        await choose(
          [
            {
              label: 'This folder holds no .mnema record',
              description: 'Open a terminal to run mnema init',
              run: () => api.commands.executeCommand('workbench.action.terminal.new'),
            },
          ],
          'Nothing was run.',
        );
        return;
      }
      const answer = await read(STATUS_ARGS);
      if (answer.code === null) {
        await afterLost();
        await choose(
          [
            {
              label: 'The mnema command could not be used',
              description: 'Open the mnema.command setting',
              run: () =>
                api.commands.executeCommand('workbench.action.openSettings', 'mnema.command'),
            },
          ],
          'mnema did not answer.',
        );
        return;
      }
      const awaiting = answer.code === 0 ? readStatus(answer.stdout) : undefined;
      if (awaiting === undefined) {
        await choose([], 'mnema did not say what awaits a judgment.');
        return;
      }
      // What the command line says awaits and the decisions it served are not always the same
      // number: its count also holds skills and tasks, and its list is cut at 20.
      const more = awaiting.total - awaiting.items.length;
      const steps: Step[] = awaiting.items.map((item) => ({
        label: `${oneLine(item.adr ?? item.id.slice(0, 8))}  ${oneLine(item.title)}`,
        description: 'awaits a judgment',
        run: () => openDecision(item.id),
      }));
      if (more > 0) {
        steps.push({
          label: more === 1 ? '1 more awaits a judgment' : `${more} more await a judgment`,
          description: 'Open the mnema side bar',
          run: () => api.commands.executeCommand(CONTAINER_COMMAND),
        });
      }
      await choose(
        steps,
        steps.length === 0
          ? 'Nothing awaits a judgment, as mnema reads it.'
          : 'Pick a decision to read it whole.',
      );
    }),
  );

  // A file's `mnema why` opens as a document of its own, the words of the command line under a
  // header that says what was asked and when. Each opening is a new document.
  const whyChanged = keep(new api.EventEmitter<UriLike>());
  keep(
    api.workspace.registerTextDocumentContentProvider(WHY_SCHEME, {
      onDidChange: whyChanged.event,
      async provideTextDocumentContent(uri) {
        const path = pathOfQuery(uri.query);
        if (path === undefined) return 'This address carries no path.\n';
        return whyDocument(path, await read(whyArgs(path)), new Date());
      },
    }),
  );
  keep(
    api.commands.registerCommand('mnema.why', async (given?: UriLike) => {
      if (!needsRecord()) return;
      const uri = given ?? api.window.activeTextEditor?.document.uri;
      const path = uri === undefined ? undefined : relativePath({ uri });
      if (path === undefined) {
        void api.window.showInformationMessage(
          'mnema why reads a file inside the folder that is open.',
        );
        return;
      }
      const document = await api.workspace.openTextDocument(
        api.Uri.from({
          scheme: WHY_SCHEME,
          path: whyPath(path),
          query: whyQuery(path, Date.now()),
        }),
      );
      await api.window.showTextDocument(document, { preview: true });
    }),
  );

  // The record's own folder wears a badge and the accent in the Explorer, and no file does: the
  // answer is a comparison of two paths, so it starts no process and reads nothing.
  const markChanged = keep(new api.EventEmitter<UriLike>());
  keep(
    api.window.registerFileDecorationProvider({
      onDidChangeFileDecorations: markChanged.event,
      provideFileDecoration(uri) {
        const mark = decorationFor(uri, folder);
        return mark === undefined
          ? undefined
          : new api.FileDecoration(mark.badge, mark.tooltip, new api.ThemeColor(mark.color));
      },
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
      const icon = stackIcon(stack);
      node.iconPath = new api.ThemeIcon(
        icon.id,
        icon.color === undefined ? undefined : new api.ThemeColor(icon.color),
      );
      node.accessibilityInformation = { label: stackSpoken(stack) };
      return node;
    },
  };
  stacksView = keep(
    api.window.createTreeView('mnema.stacks', { treeDataProvider: stacksProvider }),
  );
  // The stacks are not read while their view is hidden: they are read when it appears, if they are old.
  keep(
    stacksView.onDidChangeVisibility((e) => {
      if (!e.visible || !session.stacksStale || !hasRecord() || session.cli?.kind !== 'ready')
        return;
      void readStackList().then(settleLost);
    }),
  );

  async function pickScope(title: string): Promise<StackScope | undefined> {
    return (
      await api.window.showQuickPick(
        SCOPES.map((entry) => ({
          label: scopeLabel(entry),
          description: entry.description,
          scope: entry.scope,
        })),
        { title, placeHolder: 'Install where?', ignoreFocusOut: true },
      )
    )?.scope;
  }

  async function pickStack(element: AdoptedStack | undefined): Promise<AdoptedStack | undefined> {
    if (element !== undefined) return element;
    return (
      await api.window.showQuickPick(
        session.stacks.map((s) => ({ label: s.name, description: s.scope, stack: s })),
        { title: 'Pick Stack', placeHolder: 'Stack', ignoreFocusOut: true },
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
      `Write these files into the ${scope} tree? Digest ${digest}; the plan is in the "mnema stacks" output.`,
      WRITE,
    );
    if (choice !== WRITE) return;
    const done = await read(installArgs(source, scope, digest));
    if (done.code === 0) {
      void api.window.showInformationMessage(done.stdout.trim().split('\n')[0] ?? 'Installed.');
    } else {
      void api.window.showErrorMessage(refusalOf(done));
    }
    await refresh('explicit');
  }

  keep(
    api.commands.registerCommand('mnema.stacks.add', async () => {
      if (!needsRecord()) return;
      const typed = await api.window.showInputBox({
        title: 'Add Stack',
        prompt: 'The plan is shown before anything is written.',
        placeHolder: 'Folder, .tar or https:// git address',
        ignoreFocusOut: true,
        validateInput: sourceProblem,
      });
      if (typed === undefined || sourceProblem(typed) !== undefined) return;
      const scope = await pickScope('Add Stack');
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
            title: 'Add from Index',
            placeHolder: 'Stack',
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
      const scope = await pickScope('Add from Index');
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
        `Remove ${stack.name} from the ${stack.scope} tree? What it would do is in the "mnema stacks" output.`,
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
      await refresh('explicit');
    }),
  );

  keep(
    api.commands.registerCommand('mnema.stacks.export', async (element?: AdoptedStack) => {
      if (!needsRecord()) return;
      const stack = await pickStack(element);
      if (stack === undefined) return;
      const folder = await api.window.showInputBox({
        title: 'Export Stack',
        prompt: `A folder that does not exist yet, or is empty, to export ${stack.name} into.`,
        placeHolder: `./${stack.name}`,
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
    timer = setTimeout(() => void refresh('watch'), QUIET_MS);
  };
  // The folder itself may be born or removed while the window is open: the Explorer asks again.
  const recordChanged = () => {
    markChanged.fire(api.Uri.file(recordFolder));
    changed();
  };
  keep(watcher.onDidChange(changed));
  keep(watcher.onDidCreate(recordChanged));
  keep(watcher.onDidDelete(recordChanged));
  keep(
    api.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('mnema.command')) void refresh('setting');
      else if (e.affectsConfiguration('mnema.statusBar.enabled')) {
        placeBar();
        // The bar was not being read while it was off: turned on, it reads the verification at once.
        if (barEnabled() && hasRecord() && session.cli?.kind === 'ready') {
          void readBar().then(settleLost);
        }
      }
    }),
  );
  keep({
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer);
      if (trailing !== undefined) clearTimeout(trailing);
    },
  });

  void refresh('start');
  return {
    shown: () => ({
      text: bar.text,
      tooltip: typeof bar.tooltip === 'string' ? bar.tooltip : bar.tooltip.value,
      command: bar.command,
      visible: barVisible,
      badge: proposedView?.badge,
    }),
  };
}

/** Nothing to release: everything `activate` made is on the context's subscriptions. */
export function deactivate(): void {}
