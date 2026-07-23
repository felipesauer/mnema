/**
 * `mnema init` — establish a project at the working directory.
 *
 * This is the command that CREATES a project's root: it makes the `.mnema/` tree
 * at the EXACT working directory (not by walking up — that is discovery, and
 * this is establishment), founds this installation's identity into it so the
 * chain is verifiable from its first event, and records it in the machine's
 * project index so a surface can find it later.
 *
 * It is a thin adapter: it observes whether a project already exists here,
 * routes to the core's own mechanisms (`ensureTree`, `foundIdentity`,
 * `registerProject`), and reports. It holds no domain logic — founding and the
 * index are the core's; init only decides WHERE (this cwd) and refuses a
 * double-init.
 */

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { catalogUpcasters, ensureTree } from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  PROJECT_DIR,
  registerProject,
  resolveTrees,
} from '@mnema/core';
import { foundIdentity, openTreeForWriting } from '@mnema/core/write';

/** What init needs from its environment — injected so it is testable. */
export interface InitContext {
  /** The directory to establish the project in (the CLI passes `process.cwd()`). */
  readonly cwd: string;
  /** The discovery environment (XDG/home), for the tree paths and the index. */
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
}

/**
 * Establishes a project at `cwd`. If a `.mnema/` already exists at this exact
 * directory, init does NOT re-found — running it twice is a mistake, not a fresh
 * start — but it still registers the project in the index (the index is a cache
 * that may have been lost, and re-asserting is idempotent). Otherwise it creates
 * the tree, founds the identity, checkpoints so the founding is signature-covered
 * at once, and registers.
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

  let anchor: string;
  if (alreadyHere) {
    anchor = writer.anchor;
  } else {
    const founded = foundIdentity({
      writer,
      layout: { root: chainRootForScope(trees, 'public') as string },
      upcasters: catalogUpcasters(),
    });
    // Checkpoint now so an anonymous verify sees the founding fully signed the
    // moment init returns — the tree is born proven, not pending a later write.
    writer.checkpoint();
    anchor = founded.anchor;
  }

  // Re-assert the index entry every time: the tree is real, the cache may have
  // lost it, and registering is idempotent.
  registerProject(root, ctx.env);

  return { created: !alreadyHere, root, anchor };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
