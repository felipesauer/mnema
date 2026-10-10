/**
 * Stacks: what the editor asks `mnema stack` for, and how it reads the answer.
 *
 * Nothing here decides a rule. A plan is what `mnema stack add --dry-run` printed, a refusal is what
 * the command said, and the digest the person confirms is the one that plan printed, handed back
 * to `--expect` so the files written are the files shown. The extension adds no way to turn a hook
 * on: a hook is turned on by a person at a terminal, and {@link HOOKS_NOTE} says where.
 */

/** `mnema stack list --json`, the adopted stacks of the project's three trees. */
export const STACK_LIST_ARGS: readonly string[] = ['stack', 'list', '--json'];

/** The trees a stack is adopted into, as the command line names them. */
export type StackScope = 'public' | 'private' | 'global';

export const SCOPES: readonly { readonly label: StackScope; readonly description: string }[] = [
  { label: 'public', description: 'into the project, to be committed with it' },
  { label: 'private', description: 'into the project, kept out of git' },
  { label: 'global', description: 'into your home' },
];

/** One installed stack, as `mnema stack list --json` reports it. */
export interface AdoptedStack {
  readonly name: string;
  readonly scope: StackScope;
  readonly version?: string;
  readonly files?: number;
  readonly changed?: number;
  readonly hooks?: number;
  readonly hooksOn?: number;
  readonly sound: boolean;
  readonly refused?: string;
}

const isScope = (value: unknown): value is StackScope =>
  value === 'public' || value === 'private' || value === 'global';

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;

/** The adopted stacks the command line listed; an answer that cannot be read lists none. */
export function readStacks(stdout: string): AdoptedStack[] {
  let answer: unknown;
  try {
    answer = JSON.parse(stdout);
  } catch {
    return [];
  }
  const stacks = (answer as { stacks?: unknown } | null)?.stacks;
  if (!Array.isArray(stacks)) return [];
  const out: AdoptedStack[] = [];
  for (const raw of stacks as Record<string, unknown>[]) {
    if (typeof raw !== 'object' || raw === null) continue;
    // A stack written with `--to` has no scope and governs nothing: it is not listed here.
    if (typeof raw.name !== 'string' || !isScope(raw.scope)) continue;
    out.push({
      name: raw.name,
      scope: raw.scope,
      sound: raw.sound === true,
      ...(typeof raw.version === 'string' ? { version: raw.version } : {}),
      ...(typeof raw.refused === 'string' ? { refused: raw.refused } : {}),
      ...optional('files', count(raw.files)),
      ...optional('changed', count(raw.changed)),
      ...optional('hooks', count(raw.hooks)),
      ...optional('hooksOn', count(raw.hooksOn)),
    });
  }
  return out;
}

function optional<K extends string>(key: K, value: number | undefined): { [P in K]?: number } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: number });
}

/** What the tree shows beside a stack's name. */
export function stackDescription(stack: AdoptedStack): string {
  if (stack.refused !== undefined) return `${stack.scope} · receipt refused`;
  return [stack.version, stack.scope, stack.sound ? 'sound' : 'DEPARTS']
    .filter(Boolean)
    .join(' · ');
}

/** What the tooltip of a stack says: the facts the command line reported, and where hooks are turned on. */
export function stackTooltip(stack: AdoptedStack): string {
  if (stack.refused !== undefined) return `The receipt is refused: ${stack.refused}`;
  const lines = [
    `${stack.name} ${stack.version ?? ''}`.trim(),
    `${stack.files ?? 0} files, ${stack.changed ?? 0} changed or gone`,
    `${stack.hooks ?? 0} hooks declared, ${stack.hooksOn ?? 0} on`,
  ];
  if ((stack.hooks ?? 0) > 0) lines.push(HOOKS_NOTE);
  return lines.join('\n');
}

/**
 * What the extension says wherever a stack's hooks are shown. A hook a stack declares stays off
 * until a person, at a terminal, has read its script and typed its name; this extension has nothing
 * that turns one on.
 */
export const HOOKS_NOTE =
  'A hook a stack declares stays off until a person turns it on at a terminal: ' +
  '`mnema stack enable <stack> <hook> --from <source>`. This extension has no control that does it.';

/** One entry of the index, as `mnema stack index --json` reports it. */
export interface IndexedStack {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly link: string;
  readonly digest: string;
  readonly source?: string;
}

/** `mnema stack index <folder> --json`. */
export const indexArgs = (folder: string): string[] => ['stack', 'index', folder, '--json'];

/** The index entries the command line listed; an answer that cannot be read lists none. */
export function readIndex(stdout: string): IndexedStack[] {
  let answer: unknown;
  try {
    answer = JSON.parse(stdout);
  } catch {
    return [];
  }
  const stacks = (answer as { stacks?: unknown } | null)?.stacks;
  if (!Array.isArray(stacks)) return [];
  const out: IndexedStack[] = [];
  for (const raw of stacks as Record<string, unknown>[]) {
    if (typeof raw !== 'object' || raw === null) continue;
    const { name, version, description, link, digest, source } = raw;
    if (
      typeof name !== 'string' ||
      typeof version !== 'string' ||
      typeof description !== 'string' ||
      typeof link !== 'string' ||
      typeof digest !== 'string'
    ) {
      continue;
    }
    out.push({
      name,
      version,
      description,
      link,
      digest,
      ...(typeof source === 'string' ? { source } : {}),
    });
  }
  return out;
}

/** What is wrong with a source the person typed, or `undefined`. The command line judges the rest. */
export function sourceProblem(text: string): string | undefined {
  const source = text.trim();
  if (source === '') return 'Give a folder, a tar archive, or an https:// git address.';
  if (source.startsWith('-')) return 'A source does not begin with a dash.';
  if (/[\r\n]/.test(source)) return 'A source is one line.';
  return undefined;
}

/** What is wrong with the folder an export goes into, or `undefined`. */
export function folderProblem(text: string): string | undefined {
  const folder = text.trim();
  if (folder === '') return 'Give a folder that does not exist yet, or is empty.';
  if (folder.startsWith('-')) return 'A folder does not begin with a dash.';
  if (/[\r\n]/.test(folder)) return 'A folder is one line.';
  return undefined;
}

/** The plan of a stack: the command line shows it whole and writes nothing. */
export const planArgs = (source: string, scope: StackScope): string[] => [
  'stack',
  'add',
  source,
  '--scope',
  scope,
  '--dry-run',
];

/** The digest a plan printed, which is what the person is asked to confirm. */
export function digestOf(plan: string): string | undefined {
  return /^ {2}digest {3}([0-9a-f]{64})$/m.exec(plan)?.[1];
}

/** Writes the plan that was shown, and only if its digest is still the one shown. */
export const installArgs = (source: string, scope: StackScope, digest: string): string[] => [
  'stack',
  'add',
  source,
  '--scope',
  scope,
  '--expect',
  digest,
];

/** What `mnema stack remove` would remove, or removes. */
export const removeArgs = (name: string, scope: StackScope, dryRun: boolean): string[] => [
  'stack',
  'remove',
  name,
  '--scope',
  scope,
  ...(dryRun ? ['--dry-run'] : []),
];

/** The readings of one installed stack. */
export type Look = 'show' | 'diff' | 'check';

export const lookArgs = (look: Look, name: string, scope: StackScope): string[] => [
  'stack',
  look,
  name,
  '--scope',
  scope,
];

export const exportArgs = (name: string, scope: StackScope, folder: string): string[] => [
  'stack',
  'export',
  name,
  folder,
  '--scope',
  scope,
];

/** Whether a plan or a reading shows hooks, so that the note about where they are turned on is added. */
export const showsHooks = (text: string): boolean => /^Hooks \(\d+\)/m.test(text);
