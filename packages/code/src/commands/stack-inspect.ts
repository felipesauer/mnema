/**
 * Looking at installed stacks: which there are, what each one wrote, whether the files are still
 * what was written, and whether the record still says the same. Nothing here writes into a tree,
 * and nothing here runs anything of a stack.
 *
 * A RECEIPT IS A CLAIM, NEVER AN ORDER. The receipt of the public tree is committed, so it is read
 * as something somebody may have edited: every form is held (`readReceipt`), every path it names
 * is held to the folders a host reads and to no link on the way (`badReceiptPaths`) before a file
 * is opened, and what it says of the stack's digest is compared with the adoption the tree's
 * record stands on. A receipt that fails is REPORTED, with the reason, and never trusted to say
 * what its files are.
 *
 * THE TWO COMPARISONS. The files against the receipt: each is as written, changed, or gone. The
 * receipt against the fact: the digest the receipt keeps against the digest of the adoption the
 * record stands on. The fact carries a digest and not a file list, so it cannot judge a file
 * alone; what it can judge is whether the receipt is the receipt of what was adopted.
 */

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { catalogUpcasters } from '@mnema/chain';
import { chainRootForScope, orderedEvents } from '@mnema/core';
import { checkName } from '@mnema/stacks';
import { oneLine } from '../one-line.js';
import {
  badReceiptPaths,
  folders,
  type Receipt,
  readReceipt,
  refuse,
  type StackContext,
  type StackRefused,
  type StackScope,
  type StackTarget,
  sha256,
  short,
  standingAdoption,
  type Where,
  whereOf,
  writeNew,
} from './stack-install.js';

const SCOPES_IN_ORDER: readonly StackScope[] = ['public', 'private', 'global'];

/** One receipt found in a target: the stack it claims, or why it is not believed. */
export interface Entry {
  readonly name: string;
  readonly target: StackTarget;
  readonly where: Where;
  readonly receipt?: Receipt;
  readonly refused?: string;
}

/** The label a target is shown under. */
export const labelOf = (target: StackTarget): string =>
  'to' in target ? `--to ${oneLine(target.to)}` : target.scope;

/** The receipts of a target, each read as a claim. A target that cannot be reached is `undefined`. */
export function entriesOf(ctx: StackContext, target: StackTarget): Entry[] | undefined {
  const where = whereOf(ctx, target);
  if ('ok' in where) return undefined;
  let names: string[];
  try {
    names = readdirSync(where.receipts)
      .filter((n) => n.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
  return names.map((file): Entry => {
    const name = file.slice(0, -'.json'.length);
    const read = readReceipt(join(where.receipts, file), name);
    if (read === undefined) return { name, target, where, refused: 'it vanished while being read' };
    if ('refused' in read) return { name, target, where, refused: read.refused };
    return { name, target, where, receipt: read };
  });
}

/** Every entry of the targets named — the three trees when none is. */
export function allEntries(ctx: StackContext, target: StackTarget | undefined): Entry[] {
  const targets: StackTarget[] =
    target === undefined ? SCOPES_IN_ORDER.map((scope) => ({ scope })) : [target];
  return targets.flatMap((t) => entriesOf(ctx, t) ?? []);
}

/** The one entry called `name`, or the refusal that says there is none, or more than one. */
export function findEntry(
  ctx: StackContext,
  name: string,
  target: StackTarget | undefined,
): Entry | StackRefused {
  if (checkName(name) !== undefined) {
    return refuse('STACK_NOT_INSTALLED', `${JSON.stringify(oneLine(name))} is not a stack name.`);
  }
  const found = allEntries(ctx, target).filter((e) => e.name === name);
  if (found.length === 0) {
    return refuse(
      'STACK_NOT_INSTALLED',
      `no stack is installed here as ${JSON.stringify(name)}${target === undefined ? '' : ` in ${labelOf(target)}`}.`,
    );
  }
  if (found.length > 1) {
    return refuse(
      'STACK_AMBIGUOUS',
      `${JSON.stringify(name)} is installed in ${found.map((e) => labelOf(e.target)).join(' and ')}; name one with --scope.`,
    );
  }
  return found[0] as Entry;
}

/** A file against what the receipt says was written. */
export type FileState = 'as written' | 'changed' | 'gone';

/** The record against the receipt, for a tree. */
export type FactState =
  | { readonly kind: 'agrees' }
  | { readonly kind: 'no adoption' }
  | { readonly kind: 'differs'; readonly adopted: string }
  | { readonly kind: 'not recorded' };

/** Where a person's approvals of hooks are kept, or `undefined` for a folder of one's own. */
export function approvalsOf(where: Where, target: StackTarget): string | undefined {
  if ('to' in target || where.trees === undefined) return undefined;
  const tree = target.scope === 'global' ? 'global' : 'private';
  const root = chainRootForScope(where.trees, tree);
  return root === undefined ? undefined : join(root, 'stack-hooks');
}

/** What a person approved of one stack: the digest it was of, and each hook with its script's hash. */
export interface Approvals {
  readonly digest: string;
  readonly hooks: Readonly<Record<string, { readonly file: string; readonly sha256: string }>>;
}

const HEX64 = /^[0-9a-f]{64}$/;

/** The approvals file of a stack, as written by `stack enable` — or `refused` when it is not. */
export function readApprovals(dir: string, name: string): Approvals | 'refused' | undefined {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : 'refused';
  }
  const v = value as { digest?: unknown; hooks?: unknown } | null;
  if (typeof v !== 'object' || v === null) return 'refused';
  if (typeof v.digest !== 'string' || !HEX64.test(v.digest)) return 'refused';
  if (typeof v.hooks !== 'object' || v.hooks === null || Array.isArray(v.hooks)) return 'refused';
  for (const h of Object.values(v.hooks as Record<string, unknown>)) {
    const hook = h as { file?: unknown; sha256?: unknown } | null;
    if (
      typeof hook !== 'object' ||
      hook === null ||
      typeof hook.file !== 'string' ||
      typeof hook.sha256 !== 'string' ||
      !HEX64.test(hook.sha256)
    ) {
      return 'refused';
    }
  }
  return value as Approvals;
}

/** The place an approved hook's script is kept. */
export const scriptPath = (dir: string, stack: string, file: string): string =>
  join(dir, stack, file.slice('hooks/'.length));

/** A declared hook, and whether the person turned it on. */
export interface HookState {
  readonly name: string;
  readonly event: string;
  readonly file: string;
  readonly state: 'off' | 'on' | 'stale' | 'altered';
}

/** What looking at one entry found. */
export interface Inspection {
  readonly entry: Entry;
  readonly files: readonly { readonly path: string; readonly state: FileState }[];
  readonly fact: FactState;
  readonly hooks: readonly HookState[];
  /** Why the receipt is not believed, when it is not; nothing else is then judged. */
  readonly refused?: string;
}

function hookStates(entry: Entry, receipt: Receipt): HookState[] {
  const dir = approvalsOf(entry.where, entry.target);
  const approvals = dir === undefined ? undefined : readApprovals(dir, entry.name);
  return (receipt.hooks ?? []).map((h) => {
    const base = { name: h.name, event: h.event, file: h.file };
    if (dir === undefined || approvals === undefined) return { ...base, state: 'off' as const };
    if (approvals === 'refused') return { ...base, state: 'altered' as const };
    const approved = approvals.hooks[h.name];
    if (approved === undefined) return { ...base, state: 'off' as const };
    if (approvals.digest !== receipt.digest || approved.sha256 !== h.sha256) {
      return { ...base, state: 'stale' as const };
    }
    try {
      const stored = readFileSync(scriptPath(dir, entry.name, h.file));
      return {
        ...base,
        state: sha256(stored) === h.sha256 ? ('on' as const) : ('altered' as const),
      };
    } catch {
      return { ...base, state: 'altered' as const };
    }
  });
}

function factOf(entry: Entry, receipt: Receipt): FactState {
  const { where, target } = entry;
  if ('to' in target || where.trees === undefined) return { kind: 'not recorded' };
  const root = chainRootForScope(where.trees, target.scope);
  const standing = root === undefined ? undefined : standingAdoption(root, entry.name);
  if (standing === undefined) return { kind: 'no adoption' };
  return standing.digest === receipt.digest
    ? { kind: 'agrees' }
    : { kind: 'differs', adopted: standing.digest };
}

/** Looks at one entry: its files against its receipt, its receipt against the record. */
export function inspect(entry: Entry): Inspection {
  const none = { files: [], fact: { kind: 'not recorded' } as FactState, hooks: [] };
  if (entry.receipt === undefined) {
    return { entry, ...none, refused: entry.refused ?? 'it is not a receipt' };
  }
  const receipt = entry.receipt;
  const bad = badReceiptPaths(entry.where, receipt);
  if (bad.length > 0) {
    return {
      entry,
      ...none,
      refused: `it names files outside the folders a host reads, or through a link: ${bad.map(oneLine).join('; ')}`,
    };
  }
  const files = receipt.files.map((f) => {
    const at = join(entry.where.base, f.path);
    let state: FileState;
    try {
      const stat = lstatSync(at);
      state = stat.isFile() && sha256(readFileSync(at)) === f.sha256 ? 'as written' : 'changed';
    } catch {
      state = 'gone';
    }
    return { path: f.path, state };
  });
  return { entry, files, fact: factOf(entry, receipt), hooks: hookStates(entry, receipt) };
}

/** True when nothing about the inspection departs from what was written and recorded. */
export function isSound(i: Inspection): boolean {
  return (
    i.refused === undefined &&
    i.files.every((f) => f.state === 'as written') &&
    (i.fact.kind === 'agrees' || i.fact.kind === 'not recorded') &&
    i.hooks.every((h) => h.state === 'off' || h.state === 'on')
  );
}

const called = (e: Entry, r: Receipt): string =>
  `${oneLine(e.name)}@${oneLine(r.version)} (${short(r.digest)})`;

const factWords = (fact: FactState): string => {
  switch (fact.kind) {
    case 'agrees':
      return 'the record adopted this digest';
    case 'no adoption':
      return "the record has no adoption of it: the receipt is nobody's";
    case 'differs':
      return `the record adopted ${short(fact.adopted)}, not the receipt's digest`;
    case 'not recorded':
      return 'nothing is recorded: a folder of your own governs nothing';
  }
};

const hookWords = (h: HookState): string =>
  `  ${oneLine(h.name)}  on ${oneLine(h.event)}  ${h.state}`;

/** The summary lines of `stack list`. */
export function listLines(ctx: StackContext, target: StackTarget | undefined): string[] {
  const lines: string[] = [];
  for (const entry of allEntries(ctx, target)) {
    const i = inspect(entry);
    const where = labelOf(entry.target);
    if (i.refused !== undefined || entry.receipt === undefined) {
      lines.push(`${oneLine(entry.name)}  ${where}  receipt refused: ${oneLine(i.refused ?? '')}`);
      continue;
    }
    const departed = i.files.filter((f) => f.state !== 'as written').length;
    const on = i.hooks.filter((h) => h.state === 'on').length;
    lines.push(
      [
        called(entry, entry.receipt),
        where,
        `${i.files.length} files${departed === 0 ? '' : `, ${departed} changed or gone`}`,
        `${i.hooks.length} hooks declared, ${on} on`,
        isSound(i) ? 'sound' : 'DEPARTS',
      ].join('  '),
    );
  }
  return lines.length === 0 ? ['No stack is installed.'] : lines;
}

/** The lines of `stack show`: everything the receipt, the files and the record say of one stack. */
export function showLines(i: Inspection): string[] {
  const { entry } = i;
  const header = `${oneLine(entry.name)}  ${labelOf(entry.target)}`;
  if (i.refused !== undefined || entry.receipt === undefined) {
    return [header, `The receipt is refused: ${oneLine(i.refused ?? '')}.`];
  }
  const r = entry.receipt;
  const lines = [
    header,
    `name      ${oneLine(r.name)}${r.installedAs === r.name ? '' : ` (installed as ${oneLine(r.installedAs)})`}`,
    `version   ${oneLine(r.version)}`,
    `digest    ${r.digest}`,
    `record    ${factWords(i.fact)}`,
    `Files (${i.files.length}):`,
    ...i.files.map((f) => `  ${oneLine(f.path)}  ${f.state}`),
  ];
  if (i.hooks.length === 0) lines.push('Hooks: none declared.');
  else
    lines.push(
      `Hooks (${i.hooks.length}), off unless you turned one on:`,
      ...i.hooks.map(hookWords),
    );
  return lines;
}

const MARK: Record<FileState, string> = { 'as written': '=', changed: '~', gone: '-' };

/** The lines of `stack diff`: each file against the receipt, and the receipt against the fact. */
export function diffLines(i: Inspection): string[] {
  const { entry } = i;
  if (i.refused !== undefined || entry.receipt === undefined) {
    return [`${oneLine(entry.name)}: the receipt is refused: ${oneLine(i.refused ?? '')}.`];
  }
  return [
    `${called(entry, entry.receipt)}  ${labelOf(entry.target)}`,
    ...i.files.map((f) => `  ${MARK[f.state]} ${oneLine(f.path)}  ${f.state}`),
    `Against the record: ${factWords(i.fact)}.`,
  ];
}

/** Every thing wrong with one inspection, as lines; empty when it is sound. */
export function problemsOf(i: Inspection): string[] {
  const name = oneLine(i.entry.name);
  const where = labelOf(i.entry.target);
  if (i.refused !== undefined)
    return [`${name} (${where}): receipt refused: ${oneLine(i.refused)}`];
  const out: string[] = [];
  for (const f of i.files) {
    if (f.state !== 'as written') out.push(`${name} (${where}): ${oneLine(f.path)} is ${f.state}`);
  }
  if (i.fact.kind === 'no adoption' || i.fact.kind === 'differs') {
    out.push(`${name} (${where}): ${factWords(i.fact)}`);
  }
  for (const h of i.hooks) {
    if (h.state === 'stale' || h.state === 'altered') {
      out.push(
        `${name} (${where}): hook ${oneLine(h.name)} is ${h.state}: its approval no longer holds`,
      );
    }
  }
  return out;
}

/**
 * The adoptions a tree's record stands on that no receipt answers for — a clone that has the
 * record and not the files, or a receipt deleted by hand.
 */
export function unreceipted(ctx: StackContext, target: StackTarget | undefined): string[] {
  const out: string[] = [];
  const targets: StackTarget[] =
    target === undefined ? SCOPES_IN_ORDER.map((scope) => ({ scope })) : [target];
  for (const t of targets) {
    if ('to' in t) continue;
    const where = whereOf(ctx, t);
    if ('ok' in where || where.trees === undefined) continue;
    const root = chainRootForScope(where.trees, t.scope);
    if (root === undefined || !existsSync(root)) continue;
    const standing = new Set<string>();
    for (const event of orderedEvents({ root }, catalogUpcasters())) {
      if (event.kind === 'stack.adopted') standing.add(event.subject);
      else if (event.kind === 'stack.removed') standing.delete(event.subject);
    }
    const have = new Set((entriesOf(ctx, t) ?? []).map((e) => e.name));
    for (const name of [...standing].sort()) {
      if (!have.has(name)) {
        out.push(`${oneLine(name)} (${t.scope}): the record adopted it and no receipt is here`);
      }
    }
  }
  return out;
}

/** What exporting did, or why it did not. */
export interface Exported {
  readonly ok: true;
  readonly written: readonly string[];
  readonly skipped: readonly string[];
}

/**
 * Copies an installed stack's skills and agents into a folder in the stack's own layout
 * (`skills/<name>/…`, `agents/<name>.md`), taking only files still as written, once each however
 * many hosts hold them. It is NOT the stack: `stack.json`, `LICENSE` and the hooks are not part of
 * an installation and are not recreated, so the folder's digest is not the stack's. The folder
 * must not exist or must be empty, and nothing is written over.
 */
export function exportInstalled(
  ctx: StackContext,
  i: Inspection,
  folder: string,
): Exported | StackRefused {
  const { entry } = i;
  if (i.refused !== undefined || entry.receipt === undefined) {
    return refuse(
      'STACK_RECEIPT_REFUSED',
      `the receipt of ${oneLine(entry.name)} is refused (${oneLine(i.refused ?? '')}). Nothing was exported.`,
    );
  }
  const into = resolve(ctx.cwd, folder);
  const stat = lstatSync(into, { throwIfNoEntry: false });
  if (
    stat !== undefined &&
    (stat.isSymbolicLink() || !stat.isDirectory() || readdirSync(into).length > 0)
  ) {
    return refuse(
      'STACK_DESTINATION_TAKEN',
      `${oneLine(folder)} exists and is not an empty folder; give a new one. Nothing was exported.`,
    );
  }
  const side = entry.where.side;
  const skills = [...folders('skills', side).folders.keys()];
  const agents = [...folders('agents', side).folders.keys()];
  const planned = new Map<string, Uint8Array>();
  const skipped: string[] = [];
  for (const f of i.files) {
    const skill = skills.find((s) => f.path.startsWith(`${s}/`));
    const agent = agents.find((a) => f.path.startsWith(`${a}/`));
    const inside =
      skill !== undefined
        ? `skills/${f.path.slice(skill.length + 1)}`
        : agent !== undefined
          ? `agents/${f.path.slice(agent.length + 1)}`
          : undefined;
    if (inside === undefined) continue;
    if (f.state !== 'as written') {
      skipped.push(f.path);
      continue;
    }
    if (!planned.has(inside)) planned.set(inside, readFileSync(join(entry.where.base, f.path)));
  }
  mkdirSync(into, { recursive: true });
  const written: string[] = [];
  const made: string[] = [];
  for (const [path, bytes] of [...planned].sort(([a], [b]) => (a < b ? -1 : 1))) {
    writeNew(into, path, bytes, made);
    written.push(path);
  }
  return { ok: true, written, skipped };
}
