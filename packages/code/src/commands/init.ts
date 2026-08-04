/**
 * `mnema init` — establish a project at the working directory.
 *
 * This is the command that CREATES a project's root: it makes the `.mnema/` tree
 * at the EXACT working directory (not by walking up — that is discovery, and
 * this is establishment) and establishes this installation's identity into it, so
 * the chain is verifiable from its first event.
 *
 * It USED TO also record the project in a machine-local index (`registerProject`,
 * writing `<app data>/projects.json`) so a surface could find it later. Nothing
 * ever read it: what a read covers comes from the trees the client announces, and
 * a project is discovered by walking up from a working directory — so the index
 * was written on every founding, read by nobody, and reported to the person as if
 * it mattered. It is gone, and this file is the record of why; `init.test.ts` holds
 * the absence, at the literal path the file used to take.
 *
 * It is a thin adapter: it observes whether a project already exists here, routes
 * to the core's own mechanisms (`ensureTree`, `establishIdentity`), and reports.
 * It holds no domain logic — establishing an identity (its anchor, its cold backup
 * key, its whole key roster) is the core's; init only decides WHERE (this cwd) and
 * refuses a double-init.
 */

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { catalogUpcasters, ensureTree } from '@mnema/chain';
import { chainRootForScope, type DiscoveryEnv, PROJECT_DIR, resolveTrees } from '@mnema/core';
import {
  authorizingAnchor,
  type EstablishedIdentity,
  establishIdentity,
  openTreeForWriting,
} from '@mnema/core/write';

/** What init needs from its environment — injected so it is testable. */
export interface InitContext {
  /** The directory to establish the project in (the CLI passes `process.cwd()`). */
  readonly cwd: string;
  /** The discovery environment (XDG/home), for the global tree and the key root. */
  readonly env: DiscoveryEnv;
}

/** A project was established (or was already here). */
export interface InitResult {
  /** Whether init created the tree this run (false when it already existed). */
  readonly created: boolean;
  /** The absolute path of the project's public tree. */
  readonly root: string;
  /** The identity anchor this installation founded (or already serves). */
  readonly anchor: string;
  /**
   * What establishing the identity produced — the cold backup key and the keys
   * enrolled into the new tree. Present only when this run founded the tree: a
   * second init appends nothing, so there is nothing to report.
   */
  readonly identity?: EstablishedIdentity;
}

/**
 * Establishes a project at `cwd`. If a `.mnema/` already exists at this exact
 * directory, init does NOT re-found — running it twice is a mistake, not a fresh
 * start — and answers with the anchor this machine writes as here. Otherwise it
 * creates the tree, establishes the identity into it (anchor, cold backup key, and
 * every key of the identity enrolled), and checkpoints so all of that is
 * signature-covered at once.
 *
 * A second init therefore WRITES NOTHING, anywhere: it reads an anchor and returns.
 * That is not a claim about calls — `init.test.ts` digests every file of the project
 * tree and of the app data directory before and after, and requires both maps to be
 * unchanged.
 */
export function runInit(ctx: InitContext): InitResult {
  const root = join(ctx.cwd, PROJECT_DIR);
  const alreadyHere = isDirectory(root);

  // Create the tree at the EXACT cwd (its own `.gitignore` comes with it) unless
  // one is already here — a second init must not re-found. Either way, opening
  // the public writer surfaces the anchor (opening appends nothing).
  if (!alreadyHere) ensureTree({ root });

  const trees = resolveTrees(ctx.cwd, ctx.env);
  const writer = openTreeForWriting(trees, 'public');

  if (alreadyHere) {
    // The anchor this machine WILL write as here — not the one its key derives.
    // On a machine another has enrolled, those differ until its first write in
    // this tree: reading the derived one would report an identity that the very
    // next write corrects, and this is the command a person runs to check that
    // joining worked.
    return {
      created: false,
      root,
      anchor: authorizingAnchor({
        writer,
        layout: { root: chainRootForScope(trees, 'public') as string },
        upcasters: catalogUpcasters(),
      }),
    };
  }

  const identity = establishIdentity(
    {
      writer,
      layout: { root: chainRootForScope(trees, 'public') as string },
      upcasters: catalogUpcasters(),
    },
    { keyRoot: trees.keyRoot },
  );
  // Checkpoint now so an anonymous verify sees the founding fully signed the
  // moment init returns — the tree is born proven, not pending a later write.
  // (An enrollment checkpoints itself, so this covers the founding when the
  // roster added nothing.)
  writer.checkpoint();

  return { created: true, root, anchor: identity.anchor, identity };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
