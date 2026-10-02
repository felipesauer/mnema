// Marks `packages/code/dist/cli.js` executable after `tsc -b`.
//
// `tsc` writes every output file with the default mode (0664) and keeps no executable bit, so
// a clone that builds and then links `dist/cli.js` onto the PATH — the way to run mnema while
// it is not on the registry — got `Permission denied`, exit 126, on the very last step of the
// install. npm sets the bit itself when it installs a package's `bin`; a source build does not.
//
// It adds the execute bit for whoever may already read the file and touches nothing else, and
// it FAILS when the file is not there: a build that produced no binary is not a build.
// `packages/code/tests/the-built-binary-runs-from-a-symlink.test.ts` holds the result.

import { chmodSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const binary = fileURLToPath(new URL('../../packages/code/dist/cli.js', import.meta.url));
const { mode } = statSync(binary);
chmodSync(binary, mode | ((mode & 0o444) >> 2));
