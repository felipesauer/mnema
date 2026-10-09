/**
 * Turning a stack's hook on, and off: the one act a stack cannot do for itself.
 *
 * A hook is declared by the stack, never written at installation, and never on until a PERSON, at
 * a terminal, has read it and said so for that hook alone. This module is what that act does once
 * the wiring has found the person; the wiring owns the terminal.
 *
 * WHAT "ON" IS. The person's approval, kept with the script it was an approval of: the stack's
 * script is read again from a source whose digest is the digest the receipt keeps (so the bytes
 * are the ones installed), shown whole, and — once the person has typed the hook's name — written
 * non-executable beside an approvals file in the person's own tree (the private tree for a project
 * stack, the global tree for a global one; never the public tree, which is committed and shared,
 * since an approval is one person's). MNEMA REGISTERS NOTHING WITH ANY HOST AND RUNS NOTHING: the
 * approval says "this exact script, for this exact stack, was read and accepted here", and wiring
 * it into a host's configuration remains the person's own act. `stack check` holds the stored
 * script and the approval to the receipt, so a script or a stack that changed since is `stale` or
 * `altered`, never on.
 *
 * A HOOK NAME IS DATA, NEVER A PATH. It is matched, byte for byte, against the hooks the receipt
 * declares; the folder the script lives in comes from the receipt's `file`, which the receipt's
 * reader has already held to `hooks/` and to a relative path with nothing that climbs.
 */

import { lstatSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateStackFiles } from '@mnema/stacks';
import { oneLine } from '../one-line.js';
import {
  type Approvals,
  approvalsOf,
  type Entry,
  readApprovals,
  scriptPath,
} from './stack-inspect.js';
import { type ReceiptHook, refuse, type StackRefused, sha256, writeNew } from './stack-install.js';
import type { SourceRead } from './stack-source.js';

/** What a person is shown before they say yes. */
export interface HookOffer {
  readonly ok: true;
  readonly hook: ReceiptHook;
  readonly script: Uint8Array;
  /** The hook's own words, from the stack's manifest. */
  readonly description: string;
}

/**
 * Works out what turning `hookName` on would approve, writing nothing: the receipt must declare
 * it, and the source must be the very stack the receipt keeps the digest of.
 */
export function offerHook(
  entry: Entry,
  hookName: string,
  read: SourceRead,
): HookOffer | StackRefused {
  const receipt = entry.receipt;
  if (receipt === undefined) {
    return refuse(
      'STACK_RECEIPT_REFUSED',
      `the receipt of ${oneLine(entry.name)} is refused (${oneLine(entry.refused ?? '')}). No hook was turned on.`,
    );
  }
  if (approvalsOf(entry.where, entry.target) === undefined) {
    return refuse(
      'STACK_HOOK_NEEDS_A_TREE',
      'a stack written with --to governs nothing and has no tree to keep an approval in. No hook was turned on.',
    );
  }
  const declared = receipt.hooks ?? [];
  const hook = declared.find((h) => h.name === hookName);
  if (hook === undefined) {
    return refuse(
      'STACK_HOOK_UNKNOWN',
      `${oneLine(entry.name)} declares no hook called ${JSON.stringify(oneLine(hookName))}` +
        (declared.length === 0
          ? ', or none at all.'
          : `; it declares ${declared.map((h) => oneLine(h.name)).join(', ')}.`) +
        ' No hook was turned on.',
    );
  }
  const report = validateStackFiles(read.files, read.problems);
  if (!report.ok || report.manifest === undefined || report.digest === undefined) {
    return refuse(
      'STACK_INVALID',
      'the source does not keep to the contract. No hook was turned on.',
      report.problems.map((p) => p.message),
    );
  }
  if (report.digest !== receipt.digest) {
    return refuse(
      'STACK_HOOK_SOURCE_DIFFERS',
      `the source is ${report.digest} and ${oneLine(entry.name)} was installed as ${receipt.digest}: ` +
        'a hook is approved only as the very bytes that were installed. No hook was turned on.',
    );
  }
  const file = read.files.find((f) => f.path === hook.file);
  if (file === undefined || sha256(file.bytes) !== hook.sha256) {
    return refuse(
      'STACK_HOOK_SOURCE_DIFFERS',
      `the source's ${oneLine(hook.file)} is not the script the receipt keeps. No hook was turned on.`,
    );
  }
  const declaredBy = report.manifest.hooks?.find((h) => h.name === hook.name);
  return {
    ok: true,
    hook,
    script: file.bytes,
    description: declaredBy?.description ?? '',
  };
}

/** The lines shown before the question: the hook, then its script whole. */
export function offerLines(entry: Entry, offer: HookOffer): string[] {
  const text = Buffer.from(offer.script).toString('utf8');
  return [
    `Hook ${oneLine(offer.hook.name)} of ${oneLine(entry.name)}, on ${oneLine(offer.hook.event)}: ${oneLine(offer.description)}`,
    `script ${oneLine(offer.hook.file)}  sha256 ${offer.hook.sha256}`,
    '----- the script, whole -----',
    ...text.split('\n'),
    '----- end of the script -----',
  ];
}

/** Writes the approval and the script it is of. Call it only after the person has said yes. */
export function turnHookOn(
  entry: Entry,
  offer: HookOffer,
): { ok: true; script: string } | StackRefused {
  const dir = approvalsOf(entry.where, entry.target);
  const receipt = entry.receipt;
  if (dir === undefined || receipt === undefined) {
    return refuse('STACK_HOOK_NEEDS_A_TREE', 'there is no tree to keep the approval in.');
  }
  mkdirSync(dir, { recursive: true });
  const stat = lstatSync(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    return refuse(
      'STACK_HOOK_NEEDS_A_TREE',
      'the approvals folder is not a folder. No hook was turned on.',
    );
  }
  const at = scriptPath(dir, entry.name, offer.hook.file);
  const stored = lstatSync(at, { throwIfNoEntry: false });
  if (stored !== undefined) {
    if (!stored.isFile()) {
      return refuse(
        'STACK_HOOK_NEEDS_A_TREE',
        'something that is not a file is where the script goes. No hook was turned on.',
      );
    }
    unlinkSync(at);
  }
  writeNew(dir, `${entry.name}/${offer.hook.file.slice('hooks/'.length)}`, offer.script, []);
  const before = readApprovals(dir, entry.name);
  const kept =
    before !== undefined && before !== 'refused' && before.digest === receipt.digest
      ? before.hooks
      : {};
  const approvals: Approvals = {
    digest: receipt.digest,
    hooks: { ...kept, [offer.hook.name]: { file: offer.hook.file, sha256: offer.hook.sha256 } },
  };
  const temp = join(dir, `${entry.name}.json.part`);
  writeFileSync(temp, `${JSON.stringify(approvals, null, 2)}\n`);
  renameSync(temp, join(dir, `${entry.name}.json`));
  return { ok: true, script: at };
}

/** Takes the approval of one hook back, and the script kept with it. */
export function turnHookOff(
  entry: Entry,
  hookName: string,
): { ok: true; was: 'on' | 'off' } | StackRefused {
  const dir = approvalsOf(entry.where, entry.target);
  const declared = (entry.receipt?.hooks ?? []).find((h) => h.name === hookName);
  if (dir === undefined || declared === undefined) {
    return refuse(
      'STACK_HOOK_UNKNOWN',
      `${oneLine(entry.name)} declares no hook called ${JSON.stringify(oneLine(hookName))}. Nothing was changed.`,
    );
  }
  const approvals = readApprovals(dir, entry.name);
  const at = scriptPath(dir, entry.name, declared.file);
  const stored = lstatSync(at, { throwIfNoEntry: false });
  if (stored?.isFile() === true) unlinkSync(at);
  if (approvals === undefined || approvals === 'refused') {
    if (approvals === 'refused') unlinkSync(join(dir, `${entry.name}.json`));
    return { ok: true, was: 'off' };
  }
  const { [declared.name]: was, ...rest } = approvals.hooks;
  if (Object.keys(rest).length === 0) unlinkSync(join(dir, `${entry.name}.json`));
  else {
    const temp = join(dir, `${entry.name}.json.part`);
    writeFileSync(temp, `${JSON.stringify({ digest: approvals.digest, hooks: rest }, null, 2)}\n`);
    renameSync(temp, join(dir, `${entry.name}.json`));
  }
  return { ok: true, was: was === undefined ? 'off' : 'on' };
}
