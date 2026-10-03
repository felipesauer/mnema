/**
 * `mnema check declare` and `mnema check run` — a rule carries a program that checks it, and a
 * key that signs check results only records whether the rule held at a commit.
 *
 * Both work on the project's PUBLIC tree only. A check is declared beside a rule the team
 * shares, and it is run where the team's record is read — a CI runner holds the committed tree
 * and nothing else.
 *
 * THE PROGRAM IS STARTED WITHOUT A SHELL. A declaration is a program and its arguments, and
 * they reach the program as they were recorded: nothing in them is split, globbed or expanded.
 * A check that needs a shell says so by naming one as its program, which the record then shows.
 * It runs in the project's root, with this process's environment, under a timeout; what it
 * printed is bounded and its control bytes made visible before it is recorded (the core does
 * that, whatever runner it is handed).
 *
 * THE COMMIT IS THE WORKING TREE'S, AND ONLY WHEN THE TREE IS THAT COMMIT. A result says "this
 * rule held at this commit", so a tree with changes outside the record's own directory is
 * refused before anything runs: what would be checked is not what the result would name.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { catalogUpcasters, persistKeyPair, readPrivateKeyPair } from '@mnema/chain';
import { ruleIdsInForce } from '@mnema/context';
import { type DiscoveryEnv, type ResolvedTrees, resolveTrees } from '@mnema/core';
import {
  type CheckOutcome,
  type CheckResult,
  type DeclaredCheck,
  declareCheck,
  deferredWrite,
  openTreeForWriting,
  runRuleChecks,
} from '@mnema/core/write';
import { forwardReplacement, type Landed, type Replacement } from '../recorded-content.js';
import { withCache } from '../tree-sources.js';

/** What the check commands need — injected so they are testable. */
export interface CheckContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (`$HOME`, `$MNEMA_HOME`). */
  readonly env: DiscoveryEnv;
}

/** A refusal of either check command; nothing was written. */
export type CheckRefused =
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/** The check was declared on the rule. */
export interface CheckDeclared extends Replacement, Landed {
  readonly ok: true;
  readonly rule: string;
}

/** Declares the program that checks `rule`, in the project's public tree. */
export function runCheckDeclare(
  ctx: CheckContext,
  input: { rule: string; command: string; args: readonly string[]; which?: string },
): CheckDeclared | CheckRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) return { ok: false, reason: 'NO_PROJECT' };
  const writer = openTreeForWriting(trees, 'public');
  const declared = declareCheck(
    { writer, layout: { root: trees.projectPublic }, upcasters: catalogUpcasters() },
    {
      rule: input.rule,
      command: input.command,
      ...(input.args.length > 0 ? { args: input.args } : {}),
      ...(input.which !== undefined ? { which: input.which } : {}),
    },
  );
  if (!declared.ok) {
    return { ok: false, reason: 'REFUSED', code: declared.code, message: declared.message };
  }
  writer.checkpoint();
  return { ok: true, rule: declared.rule, scope: 'public', ...forwardReplacement(declared) };
}

/** Every check of a rule in force ran, and the results are in the public tree. */
export interface ChecksRan {
  readonly ok: true;
  /** The commit the results name. */
  readonly commit: string;
  /** The checker's anchor the results were signed under. */
  readonly checker: string;
  readonly results: readonly CheckResult[];
  /** The public tree the results were written to — to be committed or kept by the caller. */
  readonly root: string;
}

/**
 * Runs the declared check of every rule in force and records each result.
 *
 * `keyFile` names a private key to sign with INSTEAD of this machine's own — the form a CI
 * secret takes. It is staged in a key root of its own for the run and removed after, so it
 * is never installed; that key root's tail is new on every run, which is what keeps two runs
 * on two branches from writing one tail twice.
 */
export function runCheckRun(
  ctx: CheckContext,
  input: { keyFile?: string; timeoutMs: number },
): ChecksRan | CheckRefused {
  const resolved = resolveTrees(ctx.cwd, ctx.env);
  const publicTree = resolved.projectPublic;
  if (publicTree === undefined) return { ok: false, reason: 'NO_PROJECT' };
  const projectRoot = dirname(publicTree);

  const at = commitOfCleanTree(projectRoot, publicTree);
  if (!at.ok) return at;

  let staged: string | undefined;
  let trees: ResolvedTrees = resolved;
  if (input.keyFile !== undefined) {
    const pair = readKey(input.keyFile);
    if (pair === null) {
      return {
        ok: false,
        reason: 'REFUSED',
        code: 'UNREADABLE_KEY',
        message: `${input.keyFile} could not be read as a private key`,
      };
    }
    staged = mkdtempSync(join(tmpdir(), 'mnema-checker-'));
    persistKeyPair({ root: staged }, pair);
    trees = { ...resolved, keyRoot: staged };
  }
  try {
    const upcasters = catalogUpcasters();
    const rulesInForce = withCache(publicTree, upcasters, (cache) => ruleIdsInForce([cache]));
    const write = deferredWrite(trees, 'public');
    const ran = runRuleChecks(write, {
      commit: at.commit,
      rulesInForce,
      run: (check) => runOne(check, projectRoot, input.timeoutMs),
    });
    if (!ran.ok) return { ok: false, reason: 'REFUSED', code: ran.code, message: ran.message };
    // The results sign their own checkpoint, under the checker's key; this is a no-op unless
    // the write was opened and left something above it.
    write.checkpoint();
    return {
      ok: true,
      commit: at.commit,
      checker: ran.checker,
      results: ran.results,
      root: publicTree,
    };
  } finally {
    if (staged !== undefined) rmSync(staged, { recursive: true, force: true });
  }
}

/** The commit HEAD names, when the working tree outside the record is exactly it. */
function commitOfCleanTree(
  projectRoot: string,
  publicTree: string,
): { ok: true; commit: string } | CheckRefused {
  const head = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf-8',
  });
  if (head.status !== 0) {
    return {
      ok: false,
      reason: 'REFUSED',
      code: 'NO_COMMIT',
      message: 'this project is not at a commit — a check result names the commit it ran at',
    };
  }
  const record = relative(projectRoot, publicTree) || '.';
  const status = spawnSync('git', ['status', '--porcelain', '--', '.', `:(exclude)${record}`], {
    cwd: projectRoot,
    encoding: 'utf-8',
  });
  if (status.status !== 0 || status.stdout.trim() !== '') {
    return {
      ok: false,
      reason: 'REFUSED',
      code: 'DIRTY_TREE',
      message:
        'the working tree has changes outside the record — a check result names a commit, and ' +
        'what would be checked is not that commit. Commit or stash them, then run again',
    };
  }
  return { ok: true, commit: head.stdout.trim() };
}

/** The key pair a PEM file holds, or null when it is not a readable private key. */
function readKey(path: string): ReturnType<typeof readPrivateKeyPair> | null {
  try {
    return readPrivateKeyPair(path, readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Runs one declared check: the program with its arguments, no shell, in the project root,
 * under the timeout. What it printed on both streams is handed back whole; the core bounds it.
 */
export function runOne(check: DeclaredCheck, cwd: string, timeoutMs: number): CheckOutcome {
  const ran = spawnSync(check.command, [...check.args], {
    cwd,
    shell: false,
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    maxBuffer: 16 * 1024 * 1024,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = `${ran.stdout ?? ''}${ran.stderr ?? ''}`;
  const error = ran.error as NodeJS.ErrnoException | undefined;
  if (error?.code === 'ENOBUFS') {
    return { passed: false, failure: 'printed more than 16 MiB', output };
  }
  if (error?.code === 'ETIMEDOUT') {
    return { passed: false, failure: `timed out after ${timeoutMs / 1000} s`, output };
  }
  if (error !== undefined) {
    return { passed: false, failure: `could not start: ${error.code ?? error.message}`, output };
  }
  if (ran.status === 0) return { passed: true, output };
  if (ran.status !== null)
    return { passed: false, failure: `exited with code ${ran.status}`, output };
  return { passed: false, failure: `killed by signal ${ran.signal ?? 'unknown'}`, output };
}
