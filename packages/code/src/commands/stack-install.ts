/**
 * Installing a stack, and removing one: from the files of a stack to a PLAN shown whole, from the
 * plan to the files in the folders each host reads, and the signed fact that says so.
 *
 * WHERE THE FILES GO IS READ OFF THE HOST TABLE (`host-names.ts`, `places`), never off a list of
 * this module's: a skill is copied byte for byte into every folder a host of the table documents
 * for skills, and an agent into every folder documented for agents in the format the stack's
 * `agents/<name>.md` already is — so compiling it is copying it. Folders two hosts share are
 * written once. A host with no folder for one kind is NAMED in the plan as receiving nothing of
 * that kind; nothing is pretended.
 *
 * WHAT IS NEVER DONE: run anything of the stack (the bytes are copied, nothing is opened, nothing
 * is made executable — every file is written without the execute bit, whatever it had, since the
 * digest does not cover the mode and the installer's mode is the only one that is known); turn a
 * hook on (the plan lists the hooks a stack declares, apart, and none is written at all: turning
 * one on is a separate act of a person); write over anything (a destination that exists, a link,
 * a folder where a file goes, a file where a folder goes, is refused before a byte is written).
 *
 * THE FOUR TARGETS. `public`, `private` and `global` are the three trees: the files go to the
 * project's folders (or the home's, for `global`), and the adoption is one `stack.adopted`
 * appended to that tree through the door of `stack-operations.ts`, in the same hold of the tail's
 * lock as the files are written and the name is checked, so two installations cannot both find
 * the name free. `public` is for the team: git is asked, and a destination it ignores is refused,
 * since a file that is not committed is not shared. `private` is the person's own: a destination
 * git would stage is refused, with the lines that keep it out. `--to <folder>` writes into a
 * folder of the person's and records nothing, because the record does not affirm what it does not
 * govern.
 *
 * WHAT WAS WRITTEN IS KEPT, so removing compares with it. A receipt beside the record of the tree
 * (`<tree>/stacks/<name>.json`; `<folder>/.mnema-stacks/` for `--to`) lists every file written
 * and its SHA-256, and nothing about the machine. Removing deletes a file only when its bytes are
 * still the ones written; a file the person changed stays where it is and is named.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { catalogUpcasters } from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  detectSecrets,
  type ResolvedTrees,
  resolveTrees,
} from '@mnema/core';
import { adoptStack, openTreeForWriting, removeStack } from '@mnema/core/write';
import {
  checkName,
  refusePath,
  type StackFile,
  type StackHook,
  validateStackFiles,
} from '@mnema/stacks';
import { HOST_NAMES, HOSTS, type Place } from '../host-names.js';
import type { SourceRead } from './stack-source.js';

/** The three trees a stack is adopted into. */
export type StackScope = 'public' | 'private' | 'global';

/** Where an installation goes: a tree, or a folder of the person's that records nothing. */
export type StackTarget = { readonly scope: StackScope } | { readonly to: string };

/** What every stack command reads from its surroundings. */
export interface StackContext {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
}

/** One file the plan writes. */
export interface PlannedFile {
  /** Relative to the plan's base folder, with `/`. */
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly kind: 'skill' | 'agent';
  /** What it belongs to, relative to the base: the skill's folder, or the agent's file. */
  readonly unit: string;
  /** The hosts that read it, by their title. */
  readonly hosts: readonly string[];
}

/** An installation, worked out and not yet written. */
export interface StackPlan {
  readonly ok: true;
  readonly name: string;
  /** The name it is installed under: `name`, or the one `--as` gave. */
  readonly installedAs: string;
  readonly version: string;
  readonly digest: string;
  readonly description: string;
  readonly license: string;
  readonly author: string;
  readonly source: string;
  readonly target: StackTarget;
  /** The folder every path of the plan is relative to. */
  readonly base: string;
  readonly files: readonly PlannedFile[];
  /** The hosts that receive no skill, and no agent, of this stack. */
  readonly unserved: { readonly skills: readonly string[]; readonly agents: readonly string[] };
  /** The hooks the stack declares — listed, never written, never on. */
  readonly hooks: readonly StackHook[];
}

/** Why a stack is not installed, or not removed. Nothing was written. */
export interface StackRefused {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
  /** One line per thing in the way, when there are several. */
  readonly lines?: readonly string[];
}

/** A version's characters, the form the record's door admits (`stack-operations.ts`). */
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;

const refuse = (code: string, message: string, lines?: readonly string[]): StackRefused =>
  lines === undefined ? { ok: false, code, message } : { ok: false, code, message, lines };

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** The folders of one kind the host table documents, each with the hosts that read it. */
function folders(
  kind: 'skills' | 'agents',
  side: 'project' | 'user',
): { readonly folders: ReadonlyMap<string, readonly string[]>; readonly none: readonly string[] } {
  const found = new Map<string, string[]>();
  const none: string[] = [];
  for (const host of HOST_NAMES) {
    const place: Place = HOSTS[host].places[kind];
    if (place.held === 'not ported') {
      none.push(HOSTS[host].title);
      continue;
    }
    const folder = place[side];
    found.set(folder, [...(found.get(folder) ?? []), HOSTS[host].title]);
  }
  return { folders: found, none };
}

/** Where a target's files go, where its receipts are, and which receipts share its folders. */
interface Where {
  readonly base: string;
  readonly side: 'project' | 'user';
  readonly receipts: string;
  /** Every receipt folder whose files land under the same base — a project's two trees. */
  readonly neighbours: readonly string[];
  readonly trees?: ResolvedTrees;
}

function whereOf(ctx: StackContext, target: StackTarget): Where | StackRefused {
  if ('to' in target) {
    const base = isAbsolute(target.to) ? target.to : resolve(ctx.cwd, target.to);
    const stat = lstatSync(base, { throwIfNoEntry: false });
    if (stat !== undefined && (stat.isSymbolicLink() || !stat.isDirectory())) {
      return refuse(
        'STACK_DESTINATION_TAKEN',
        `--to ${target.to} is ${stat.isSymbolicLink() ? 'a symbolic link' : 'not a folder'}; give a folder itself. Nothing was written.`,
      );
    }
    const receipts = join(base, '.mnema-stacks');
    return { base, side: 'project', receipts, neighbours: [receipts] };
  }
  const trees = resolveTrees(ctx.cwd, ctx.env);
  const receiptsOf = (scope: StackScope): string =>
    join(chainRootForScope(trees, scope) as string, 'stacks');
  if (target.scope === 'global') {
    const receipts = receiptsOf('global');
    return { base: ctx.env.home, side: 'user', receipts, neighbours: [receipts], trees };
  }
  if (trees.projectPublic === undefined) {
    return refuse(
      'NO_PROJECT',
      `there is no project here for a ${target.scope} stack: install it with --scope global, or into a folder with --to. Nothing was written.`,
    );
  }
  return {
    base: dirname(trees.projectPublic),
    side: 'project',
    receipts: receiptsOf(target.scope),
    neighbours: [receiptsOf('public'), receiptsOf('private')],
    trees,
  };
}

/** What a receipt keeps: what was installed, and every file written with its SHA-256. */
interface Receipt {
  readonly name: string;
  readonly installedAs: string;
  readonly version: string;
  readonly digest: string;
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
}

function readReceipt(path: string): Receipt | undefined {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Receipt;
    if (typeof value.name !== 'string' || !Array.isArray(value.files)) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

/** Every receipt in the given folders, by the name it is installed under. */
function receiptsIn(dirs: readonly string[]): Map<string, Receipt> {
  const all = new Map<string, Receipt>();
  for (const dir of dirs) {
    let names: string[] = [];
    try {
      names = readdirSync(dir).filter((n) => n.endsWith('.json'));
    } catch {
      continue;
    }
    for (const name of names) {
      const receipt = readReceipt(join(dir, name));
      if (receipt !== undefined) all.set(receipt.installedAs, receipt);
    }
  }
  return all;
}

const short = (digest: string): string => digest.slice(0, 12);
const called = (r: { name: string; installedAs: string; version: string; digest: string }) =>
  `${r.installedAs === r.name ? r.name : `${r.installedAs} (${r.name})`}@${r.version} (${short(r.digest)})`;

/**
 * What stands in the way of writing `path` under `base`: a link or a file on the way to it, or
 * anything at all where it goes. `undefined` when the way is clear.
 */
function inTheWay(base: string, path: string, owner: (p: string) => string | undefined) {
  const parts = path.split('/');
  for (let i = 1; i <= parts.length; i += 1) {
    const here = parts.slice(0, i).join('/');
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(join(base, here));
    } catch {
      return undefined;
    }
    const last = i === parts.length;
    if (stat.isSymbolicLink()) return `${here} is a symbolic link`;
    if (!last && !stat.isDirectory()) return `${here} is a file where a folder has to be`;
    if (last) {
      const of = owner(path);
      if (of !== undefined) return `${path} belongs to the stack ${of}`;
      if (stat.isDirectory()) return `${path} is a folder`;
      return `${path} is already there, and is not a stack's`;
    }
  }
  return undefined;
}

/** What git says of the paths: which it ignores, or `unknown` when it cannot say. */
function ignoredByGit(base: string, paths: readonly string[]): Set<string> | 'unknown' {
  if (paths.length === 0) return new Set();
  const asked = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], {
    cwd: base,
    input: `${paths.join('\n')}\n`,
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  if (asked.error !== undefined || (asked.status !== 0 && asked.status !== 1)) return 'unknown';
  return new Set((asked.stdout ?? '').split('\n').filter((l) => l !== ''));
}

/** The line of `.git/info/exclude` that keeps a planned file out: its skill's folder, or itself. */
const excludeLine = (file: PlannedFile): string =>
  `/${file.unit}${file.kind === 'skill' ? '/' : ''}`;

/**
 * Works out an installation from a stack's files, writing nothing: validates the stack, holds its
 * version to the record's form and its text to the credential screen, maps every file to the
 * folders each host reads, and refuses every collision — a name already installed in the target
 * (with `--as` offered), a destination that is anything at all, a file git would place on the
 * wrong side of a commit.
 */
export function planStackInstall(
  ctx: StackContext,
  read: SourceRead,
  input: { readonly target: StackTarget; readonly as?: string },
): StackPlan | StackRefused {
  const report = validateStackFiles(read.files, read.problems);
  if (!report.ok || report.manifest === undefined || report.digest === undefined) {
    return refuse(
      'STACK_INVALID',
      'the stack does not keep to the contract. Nothing was written.',
      report.problems.map((p) => p.message),
    );
  }
  const manifest = report.manifest;
  if (!VERSION.test(manifest.version)) {
    return refuse(
      'STACK_VERSION_REFUSED',
      'the stack\'s "version" is not one the record admits: ASCII letters, digits, ".", "+" and "-", ' +
        'starting with a letter or a digit, at most 64 characters. Nothing was written.',
    );
  }
  const texts: [string, string][] = [
    ['name', manifest.name],
    ['version', manifest.version],
    ['description', manifest.description],
    ['license', manifest.license],
    ['author.name', manifest.author.name],
    ...(manifest.author.url !== undefined
      ? [['author.url', manifest.author.url] as [string, string]]
      : []),
    ...(manifest.hosts ?? []).map((h, i) => [`hosts[${i}]`, h] as [string, string]),
    ...(manifest.hooks ?? []).flatMap((h, i) =>
      (['name', 'event', 'file', 'description'] as const).map(
        (k) => [`hooks[${i}].${k}`, h[k]] as [string, string],
      ),
    ),
  ];
  for (const [field, text] of texts) {
    const classes = detectSecrets(text);
    if (classes.length > 0) {
      return refuse(
        'STACK_TEXT_HOLDS_A_SECRET',
        `stack.json's ${field} holds what reads as a credential (${classes.join(', ')}); a stack is ` +
          'shown whole and copied into folders others read, so it is refused. Nothing was written.',
      );
    }
  }
  const installedAs = input.as ?? manifest.name;
  if (input.as !== undefined) {
    const why = checkName(input.as);
    if (why !== undefined) {
      return refuse(
        'STACK_NAME_REFUSED',
        `--as ${JSON.stringify(input.as)}: ${why}. Nothing was written.`,
      );
    }
  }
  const where = whereOf(ctx, input.target);
  if ('ok' in where) return where;

  const skills = folders('skills', where.side);
  const agents = folders('agents', where.side);
  const files: PlannedFile[] = [];
  for (const file of read.files) {
    const [top, name, ...rest] = file.path.split('/');
    if (top === 'skills' && name !== undefined && rest.length > 0) {
      for (const [folder, hosts] of skills.folders) {
        files.push({
          path: `${folder}/${name}/${rest.join('/')}`,
          bytes: file.bytes,
          kind: 'skill',
          unit: `${folder}/${name}`,
          hosts,
        });
      }
    } else if (top === 'agents' && name !== undefined && rest.length === 0) {
      for (const [folder, hosts] of agents.folders) {
        files.push({
          path: `${folder}/${name}`,
          bytes: compileAgent(file),
          kind: 'agent',
          unit: `${folder}/${name}`,
          hosts,
        });
      }
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const plan: StackPlan = {
    ok: true,
    name: manifest.name,
    installedAs,
    version: manifest.version,
    digest: report.digest,
    description: manifest.description,
    license: manifest.license,
    author:
      manifest.author.url === undefined
        ? manifest.author.name
        : `${manifest.author.name} (${manifest.author.url})`,
    source: read.shown,
    target: input.target,
    base: where.base,
    files,
    unserved: { skills: skills.none, agents: agents.none },
    hooks: manifest.hooks ?? [],
  };
  return checkTheWay(plan, where) ?? plan;
}

/**
 * The agent as the hosts of the table read it. The neutral format of a stack's
 * `agents/<name>.md` (`name`, `description`, `tools`, `model`, then the prompt) is the one those
 * hosts document, so the compiled agent is the same bytes; a host that reads another format has
 * no agent folder in the table and receives none.
 */
const compileAgent = (file: StackFile): Uint8Array => file.bytes;

/** The collisions of a plan, as the disk and the receipts stand now; `undefined` when none. */
function checkTheWay(plan: StackPlan, where: Where): StackRefused | undefined {
  const receipts = receiptsIn(where.neighbours);
  const standing = receipts.get(plan.installedAs);
  if (standing !== undefined && existsSync(join(where.receipts, `${plan.installedAs}.json`))) {
    if (standing.digest === plan.digest) {
      return refuse(
        'STACK_ALREADY_INSTALLED',
        `${called(standing)} is already installed here, these same bytes. Nothing was written.`,
      );
    }
    return refuse(
      'STACK_NAME_TAKEN',
      `a stack is already installed here as "${plan.installedAs}": ${called(standing)}, and this is ` +
        `${called(plan)}. Install this one under another name with --as <name>, or remove the other first. ` +
        'Nothing was written.',
    );
  }
  const owners = new Map<string, string>();
  for (const r of receipts.values()) for (const f of r.files) owners.set(f.path, called(r));
  const blocked = plan.files
    .map((f) => inTheWay(plan.base, f.path, (p) => owners.get(p)))
    .filter((why): why is string => why !== undefined);
  if (blocked.length > 0) {
    return refuse(
      'STACK_DESTINATION_TAKEN',
      `${called(plan)} would write where something already is; nothing is written over. Remove what is ` +
        'in the way, or the stack it belongs to, and run again. Nothing was written.',
      blocked,
    );
  }
  if ('scope' in plan.target && plan.target.scope !== 'global') {
    const paths = plan.files.map((f) => f.path);
    const ignored = ignoredByGit(plan.base, paths);
    if (ignored !== 'unknown' && plan.target.scope === 'public') {
      const hidden = paths.filter((p) => ignored.has(p));
      if (hidden.length > 0) {
        return refuse(
          'STACK_NOT_COMMITTABLE',
          'a public stack is committed with the repository so the team has it, and git ignores ' +
            'these, so they would not travel. Install it with --scope private, or change the rule ' +
            'that ignores them. Nothing was written.',
          hidden,
        );
      }
    }
    if (ignored !== 'unknown' && plan.target.scope === 'private') {
      const seen = plan.files.filter((f) => !ignored.has(f.path));
      if (seen.length > 0) {
        return refuse(
          'STACK_WOULD_BE_COMMITTED',
          'a private stack is yours alone, and git would stage these files, so the next commit could ' +
            'publish them. Add these lines to .git/info/exclude and run again. Nothing was written.',
          [...new Set(seen.map(excludeLine))],
        );
      }
    }
  }
  return undefined;
}

/** What an installation wrote. */
export interface StackInstalled {
  readonly ok: true;
  readonly plan: StackPlan;
  /** Whether a `stack.adopted` was recorded: never for `--to`. */
  readonly recorded: boolean;
}

/** Creates the folders on the way to `path` under `base`, one at a time, never through a link. */
function makeTheWay(base: string, path: string, made: string[]): void {
  const parts = path.split('/').slice(0, -1);
  for (let i = 1; i <= parts.length; i += 1) {
    const here = join(base, ...parts.slice(0, i));
    try {
      const stat = lstatSync(here);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`${parts.slice(0, i).join('/')} is not a folder`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      mkdirSync(here, { mode: 0o755 });
      made.push(here);
    }
  }
}

/** Writes new bytes at `path` under `base`: never over anything, never through a link, never executable. */
function writeNew(base: string, path: string, bytes: Uint8Array, made: string[]): void {
  makeTheWay(base, path, made);
  const at = join(base, path);
  const fd = openSync(
    at,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o644,
  );
  made.push(at);
  try {
    writeSync(fd, bytes);
  } finally {
    closeSync(fd);
  }
}

/** Takes back, newest first, every file and folder an installation made. */
function undo(made: readonly string[]): void {
  for (const at of [...made].reverse()) {
    try {
      const stat = lstatSync(at);
      if (stat.isDirectory()) rmdirSync(at);
      else unlinkSync(at);
    } catch {
      // Already gone, or a folder something else wrote into since: left as it is.
    }
  }
}

/** Writes the files and the receipt; on any failure, takes back what it made and throws. */
function writePlan(plan: StackPlan, where: Where): void {
  const made: string[] = [];
  mkdirSync(plan.base, { recursive: true });
  try {
    for (const file of plan.files) writeNew(plan.base, file.path, file.bytes, made);
    const receipt: Receipt = {
      name: plan.name,
      installedAs: plan.installedAs,
      version: plan.version,
      digest: plan.digest,
      files: plan.files.map((f) => ({ path: f.path, sha256: sha256(f.bytes) })),
    };
    mkdirSync(where.receipts, { recursive: true });
    writeNew(
      where.receipts,
      `${plan.installedAs}.json`,
      Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`),
      made,
    );
  } catch (error) {
    undo(made);
    throw error;
  }
}

/**
 * Writes a plan, if its digest is the one the person expects — the digest the plan showed them,
 * so what is written is what was shown even when the source was fetched again. For a tree, the
 * name and the destinations are checked again, the files written and the adoption appended in one
 * hold of the tree's lock; a refused adoption takes the files back.
 */
export function applyStackInstall(
  ctx: StackContext,
  plan: StackPlan,
  expect: string,
): StackInstalled | StackRefused {
  if (expect !== plan.digest) {
    return refuse(
      'STACK_DIGEST_DIFFERS',
      `the stack's digest is ${plan.digest}, and --expect says ${expect}: the bytes are not the ones ` +
        'that were shown. Nothing was written.',
    );
  }
  const where = whereOf(ctx, plan.target);
  if ('ok' in where) return where;
  if ('to' in plan.target || where.trees === undefined) {
    const blocked = checkTheWay(plan, where);
    if (blocked !== undefined) return blocked;
    writePlan(plan, where);
    return { ok: true, plan, recorded: false };
  }
  const scope = plan.target.scope;
  const trees = where.trees;
  const writer = openTreeForWriting(trees, scope);
  return writer.exclusively((): StackInstalled | StackRefused => {
    const blocked = checkTheWay(plan, where);
    if (blocked !== undefined) return blocked;
    writePlan(plan, where);
    const adopted = adoptStack(
      {
        writer,
        layout: { root: chainRootForScope(trees, scope) as string },
        upcasters: catalogUpcasters(),
      },
      {
        name: plan.name,
        ...(plan.installedAs !== plan.name ? { as: plan.installedAs } : {}),
        version: plan.version,
        digest: plan.digest,
        scope,
      },
    );
    if (!adopted.ok) {
      undo([
        ...plan.files.map((f) => join(plan.base, f.path)),
        join(where.receipts, `${plan.installedAs}.json`),
      ]);
      return refuse(adopted.code, `${adopted.message} The files were taken back.`);
    }
    return { ok: true, plan, recorded: true };
  });
}

/** What removing a stack did, or would do. */
export interface StackRemoval {
  readonly ok: true;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
  /** Deleted (or, on a dry run, to be deleted): the bytes were still the ones written. */
  readonly removed: readonly string[];
  /** Left in place: changed since, or no longer a file. */
  readonly kept: readonly string[];
  /** Already gone. */
  readonly missing: readonly string[];
  readonly recorded: boolean;
}

/** Every folder a target may hold a stack's files in — what a receipt's path has to sit under. */
function placeFolders(side: 'project' | 'user'): string[] {
  return [...folders('skills', side).folders.keys(), ...folders('agents', side).folders.keys()];
}

/**
 * Removes an installed stack: deletes every file whose bytes are still the ones written, keeps and
 * names every other, removes the folders that end up empty, and — for a tree — appends one
 * `stack.removed` first, in the same hold. A receipt is read as a claim, not as an order: a path
 * that is not under a host's folder, that climbs out, or that reaches through a link is refused
 * whole, so a receipt edited in a commit cannot point the removal at anything else.
 */
export function removeInstalledStack(
  ctx: StackContext,
  input: { readonly name: string; readonly target: StackTarget; readonly dryRun?: boolean },
): StackRemoval | StackRefused {
  const where = whereOf(ctx, input.target);
  if ('ok' in where) return where;
  const receiptPath = join(where.receipts, `${input.name}.json`);
  const receipt = checkName(input.name) === undefined ? readReceipt(receiptPath) : undefined;
  if (receipt === undefined) {
    return refuse(
      'STACK_NOT_INSTALLED',
      `no stack is installed here as ${JSON.stringify(input.name)}. Nothing was removed.`,
    );
  }
  const allowed = placeFolders(where.side);
  const bad = receipt.files
    .map((f) => f.path)
    .filter(
      (p) =>
        typeof p !== 'string' ||
        refusePath(p) !== undefined ||
        !allowed.some((folder) => p.startsWith(`${folder}/`)) ||
        inTheWay(where.base, p, () => undefined)?.includes('symbolic link') === true,
    );
  if (bad.length > 0) {
    return refuse(
      'STACK_RECEIPT_REFUSED',
      `the receipt of ${input.name} names files outside the folders a host reads, or through a link; ` +
        'nothing is deleted on its word. Nothing was removed.',
      bad.map(String),
    );
  }
  const removed: string[] = [];
  const kept: string[] = [];
  const missing: string[] = [];
  for (const file of receipt.files) {
    const at = join(where.base, file.path);
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(at);
    } catch {
      missing.push(file.path);
      continue;
    }
    if (stat.isFile() && sha256(readFileSync(at)) === file.sha256) removed.push(file.path);
    else kept.push(file.path);
  }
  const report = (recorded: boolean): StackRemoval => ({
    ok: true,
    name: receipt.installedAs,
    version: receipt.version,
    digest: receipt.digest,
    removed,
    kept,
    missing,
    recorded,
  });
  if (input.dryRun === true) return report(false);

  const deleteFiles = (): void => {
    for (const path of removed) unlinkSync(join(where.base, path));
    const roots = new Set(allowed.map((f) => join(where.base, f)));
    for (const path of removed) {
      let dir = dirname(join(where.base, path));
      while (!roots.has(dir) && dir.startsWith(`${where.base}/`)) {
        try {
          rmdirSync(dir);
        } catch {
          break;
        }
        dir = dirname(dir);
      }
    }
    unlinkSync(receiptPath);
  };
  if ('to' in input.target || where.trees === undefined) {
    deleteFiles();
    return report(false);
  }
  const scope = input.target.scope;
  const trees = where.trees;
  const writer = openTreeForWriting(trees, scope);
  return writer.exclusively((): StackRemoval | StackRefused => {
    const removedFact = removeStack(
      {
        writer,
        layout: { root: chainRootForScope(trees, scope) as string },
        upcasters: catalogUpcasters(),
      },
      { name: receipt.installedAs },
    );
    if (!removedFact.ok) return refuse(removedFact.code, removedFact.message);
    deleteFiles();
    return report(true);
  });
}
