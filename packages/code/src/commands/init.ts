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
 *
 * AND IT REFUSES WHERE THE WALK WILL NEVER FIND A PROJECT — the home directory, and a
 * directory whose `.mnema/` is a machine's data directory — by asking the walk's own rule
 * (`whyNoProjectRootAt`, `@mnema/core`) before anything is made. It used to found a tree
 * anywhere it was run, and the home was where that went wrong: measured in a sandbox
 * home, `mnema init` there with no `$XDG_DATA_HOME` put the project tree in the same
 * directory as the private key, and every folder under the home became that project. The
 * bare name offered it as its first door outside a project, the home included. Asked
 * AFTER the walk learned to pass those directories over, a founding there would go wrong
 * in two ways the lines below cannot see: in the home it makes the tree and then resolves
 * no project from it — a half-made `.mnema/` and a refusal about something else; at a data
 * directory it finds a `.mnema/` already there and answers "Already a mnema project",
 * about a directory that is none, with the anchor of whatever project lies above it.
 */

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { catalogUpcasters, ensureTree } from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  type NoProjectRoot,
  PROJECT_DIR,
  resolveTrees,
  whyNoProjectRootAt,
} from '@mnema/core';
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

/** A project could not be established here: the directory can be no project's root. */
export interface InitRefused {
  /** Why — the core's rule, the same one the walk-up passes such a directory by. */
  readonly refused: NoProjectRoot;
  /** The `.mnema/` a founding would have made. Nothing was made. */
  readonly root: string;
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
 *
 * Nor does a REFUSED one: in a directory that can be no project's root it answers
 * {@link InitRefused} before any directory is made, and `init.test.ts` holds that the
 * same way — every file under the home, digested before and after.
 */
export function runInit(ctx: InitContext): InitResult | InitRefused {
  const root = join(ctx.cwd, PROJECT_DIR);
  // FIRST, before a directory is made: the walk's own rule. Asked of the same function
  // the walk-up asks, so init cannot found a project the walk would pass over — see the
  // header for what each of the two would have done.
  const refused = whyNoProjectRootAt(ctx.cwd, ctx.env);
  if (refused !== undefined) return { refused, root };
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
