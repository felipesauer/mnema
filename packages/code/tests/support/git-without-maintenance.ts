/**
 * THE GLOBAL GIT CONFIGURATION EVERY TEST THAT WRITES A REPOSITORY HANDS ITS GIT — automatic
 * maintenance off — and the one channel that reaches the remote a push writes to.
 *
 * WHAT IT CLOSES. A case with a bare remote and a clone per machine failed once in sixty runs of
 * the suite, in its preparation: `git clone` of the remote died with *"failed to copy file to
 * '…/objects/17/679f…': No such file or directory"*. A local clone copies the remote's objects
 * file by file, and one went away under it. What took it, measured on git 2.55 with the remote's
 * directory watched: the `receive-pack` of the push before it starts `git maintenance run --auto
 * --detach`, whose default strategy is the geometric one, and its repack task estimates the loose
 * objects from `objects/17` alone — so TWO loose objects in that one directory repack the remote
 * in the background, in a remote that holds a few dozen: a pack, a multi-pack-index, and every
 * loose object deleted with its directory, about 30 ms after the push returned. A clone that
 * starts then loses the race. Reproduced by git alone, with git's defaults: a remote given 4,000
 * loose objects, a push putting two more in `objects/17`, and a clone after a random delay failed
 * with those words 9 times in 40; with this file, 0 in 40, and no remote repacked.
 *
 * WHY A FILE, AND NOT `-c`. Git clears `GIT_CONFIG_PARAMETERS` and `GIT_CONFIG_COUNT` from the
 * environment of the receiving side of a local push, so a `-c gc.auto=0` on the command that
 * pushes never reaches the remote that repacks — measured: the remote repacked behind `-c
 * gc.auto=0`, behind `-c maintenance.auto=false`, and behind `GIT_CONFIG_COUNT`. The file named
 * by `GIT_CONFIG_GLOBAL` is read by every git the case starts, `receive-pack` included.
 *
 * WHY BOTH LINES. Each alone stopped the repack, measured. `maintenance.auto = false` is the one
 * that says what is off: no command starts automatic maintenance. `gc.auto = 0` is the switch the
 * repack task reads too, and it is kept for a git that runs `gc --auto` itself, which reads
 * nothing else — an intention, not a measurement: git 2.55 is the only version this was run on.
 *
 * What holds every such test to it is `every-git-that-writes-runs-without-maintenance.test.ts`,
 * which also asks the file itself: behind it, a push that puts two loose objects in `objects/17`
 * leaves them there.
 */

import { fileURLToPath } from 'node:url';

/** The file to hand every git a test starts to write a repository, as `GIT_CONFIG_GLOBAL`. */
export const GIT_WITHOUT_MAINTENANCE = fileURLToPath(
  new URL('./without-maintenance.gitconfig', import.meta.url),
);
