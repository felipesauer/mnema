/**
 * The gate is decided in one place, and every door to it passes through that place.
 *
 * Two doors ask what a write meets: the MCP tool Claude Code's hook calls
 * (`rules_before_an_edit`) and the verb the hooks of VS Code and of Cursor run (`mnema
 * before-a-write`). Each answers in its own host's shape, and that is all each may do on its
 * own: which rules refuse or ask at a path, and the text that says so, are `whatAWriteMeets`
 * (`what-a-write-meets.ts`), over `whatAWriteAsks` (`edit-asks-a-person.ts`) for the asking. A door that reached the
 * derivation or composed the notice itself would be a second reading of the rule — the shape in
 * which one host stops somebody and another does not, for the same file.
 *
 * READ AS CODE, NOT AS TEXT: comments and strings are blanked (`codeOnly`), so a doc-comment that
 * names the functions — this file's own subject — is not a caller.
 */

import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { codeOnly, sourceFiles } from './support/reading-source.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const PACKAGES = join(REPO, 'packages');

/**
 * Every non-test source of the workspace whose CODE calls `name(`, repository-relative. A
 * definition (`function name(`) is not a call — the first reading of this ruler counted the
 * modules that define both functions as their callers.
 */
function callersOf(name: string): string[] {
  const call = new RegExp(`(?<!function\\s+)\\b${name}\\s*\\(`);
  return ['chain', 'core', 'context', 'code']
    .flatMap((pkg) => sourceFiles(join(PACKAGES, pkg, 'src')))
    .filter((file) => call.test(codeOnly(readFileSync(file, 'utf-8'))))
    .map((file) => relative(REPO, file))
    .sort();
}

describe('the gate is decided once', () => {
  it('reaches the derivation and composes the notice in one module only', () => {
    // The derivation's own module defines it; the gate's module is the one caller. A door that
    // called either directly is red here by its path.
    expect(callersOf('readAsksForAPersonAt')).toEqual(['packages/code/src/edit-asks-a-person.ts']);
    expect(callersOf('editAsksNotice')).toEqual(['packages/code/src/edit-asks-a-person.ts']);
    // And the refusal's, one grade up: only the module that decides what a write meets reads
    // which rules refuse and composes what a refusal says.
    expect(callersOf('readRefusesAWriteAt')).toEqual(['packages/code/src/what-a-write-meets.ts']);
    expect(callersOf('editRefusesNotice')).toEqual(['packages/code/src/what-a-write-meets.ts']);
  });

  it('is asked by every door, and by nothing else', () => {
    // ONE CALLER, since every door answers a refusal too. `whatAWriteMeets` decides both grades,
    // refusal over asking, and calls this for the asking; a door that called it directly would
    // ask about a write a rule refuses.
    expect(callersOf('whatAWriteAsks')).toEqual(['packages/code/src/what-a-write-meets.ts']);
    // And the doors are the ones that decide what a write meets: the MCP tool and the command.
    expect(callersOf('whatAWriteMeets')).toEqual([
      'packages/code/src/commands/before-a-write.ts',
      'packages/code/src/mcp/tools.ts',
    ]);
  });
});
