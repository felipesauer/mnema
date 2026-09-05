/**
 * THE PLUGIN SPAWNS WHAT THIS WORKSPACE INSTALLS — one name, read off the manifest that
 * creates it, at every place that has to spell it.
 *
 * WHERE THIS COMES FROM. The plugin reaches the product through the PATH and through
 * nothing else: `session-start.mjs` spawns a bare `mnema`, and `plugin.json` tells the
 * host to start an MCP server by running a bare `mnema mcp`. Neither of those strings is
 * an import, so no module graph follows them, and the failure they produce is silent by
 * the handler's own design — "a failed spawn is silence", which is right for a hook and
 * wrong for a repository that would like to know. Rename the `bin` key of
 * `packages/code/package.json` and both surfaces of the plugin go mute with the whole
 * suite green.
 *
 * WHAT WAS ALREADY HELD, so this file adds the half that was not. The server name
 * (`plugin:mnema:mnema`), the tool name (`rules_before_an_edit`), the handler's path, the
 * marketplace's own two names and the `mcp` in `args` are ALL reconciled against their
 * sources already, by `the-record-arrives-unasked` and `the-rule-reaches-the-writing`.
 * What none of them reconciles is the EXECUTABLE: the manifest case asserts
 * `server.command` against the literal `'mnema'`, which is a second copy of the name
 * rather than a reading of it, and the hook's own constant is asserted by nothing at all.
 *
 * THE SITES WERE FOUND BY THE DISCRIMINANT — "a place that must spell the name of the
 * installed executable for it to run" — and not by a list. That found a THIRD site the
 * list did not have: `cli.ts` names the program to commander, which is the name printed
 * on every usage line the product publishes. A `bin` renamed without it tells every
 * reader of `--help` to type a command that does not exist. The word `mnema` appears in
 * a dozen other places in this workspace — the XDG directory, the MCP server's advertised
 * name, the REPL prompt, the export producer — and NONE of them is this rule: they are
 * other things that happen to share a word, and grepping the word rather than the rule
 * would have swept them in.
 *
 * WHAT IT DOES NOT COVER, said out loud rather than left to be discovered:
 *
 *   - the hook's constant is read from SOURCE TEXT, never imported, because importing
 *     that module runs the handler — `main()` is called at its top level. The extractor
 *     below refuses rather than returns nothing if the line ever changes shape, so a
 *     reformat is a red with a reason instead of a case that quietly asserts nothing;
 *   - it says nothing about whether `mnema` is on the PATH of any particular machine.
 *     That is the installer's business, and the handler is silent about it on purpose;
 *   - `.cmd` on Windows is npm's shim name and is INTENTION rather than measurement —
 *     the handler's own comment says so, and nothing here has run on Windows. What is
 *     held is that the two spellings stay derived from ONE name, not that the derivation
 *     is right for that platform.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildProgram } from '../src/cli.js';

/** The repository root: `packages/code/tests/` is three levels under it. */
const REPO = fileURLToPath(new URL('../../../', import.meta.url));

/** The manifest whose `bin` key npm turns into the executable. */
const INSTALLS = join(REPO, 'packages', 'code', 'package.json');

/** The handler the host spawns as a session opens. */
const HOOK = join(REPO, 'plugin', 'hooks', 'session-start.mjs');

/** The manifest that tells the host how to start the MCP server. */
const MANIFEST = join(REPO, 'plugin', '.claude-plugin', 'plugin.json');

/**
 * THE ONE EXECUTABLE THIS WORKSPACE INSTALLS, off the manifest that installs it.
 *
 * It refuses on anything but exactly one `bin` entry rather than picking the first,
 * because two executables would make "the name" a question this file cannot answer and
 * every assertion below would be about whichever one came out of the object first.
 */
export function theInstalledBinary(manifestText: string): string {
  const bin = (JSON.parse(manifestText) as { bin?: Record<string, string> }).bin ?? {};
  const names = Object.keys(bin);
  if (names.length !== 1) {
    throw new Error(
      `the package installs ${names.length} executables, not one: ${names.join(', ')}`,
    );
  }
  return names[0] as string;
}

/**
 * THE TWO NAMES THE HOOK WILL SPAWN, read off its source.
 *
 * Not imported: the module calls `main()` as it loads, so importing it would spawn a
 * subprocess from inside a test. It THROWS when the line is not there, which is what
 * keeps this from becoming a case that passes over a file it could not read.
 */
export function whatTheHookSpawns(source: string): { win32: string; otherwise: string } {
  const written = /const BINARY =\s*process\.platform === 'win32' \? '([^']+)' : '([^']+)';/.exec(
    source,
  );
  if (written === null) {
    throw new Error('session-start.mjs no longer declares BINARY in the shape this reads');
  }
  return { win32: written[1] as string, otherwise: written[2] as string };
}

/** What `plugin.json` tells the host to run for the MCP server. */
export function whatTheManifestRuns(manifestText: string): string {
  const servers = (
    JSON.parse(manifestText) as { mcpServers?: Record<string, { command?: string }> }
  ).mcpServers;
  const entries = Object.entries(servers ?? {});
  if (entries.length !== 1) {
    throw new Error(`the plugin declares ${entries.length} servers, not one`);
  }
  return (entries[0] as [string, { command?: string }])[1].command ?? '';
}

describe('every place that spells the executable spells the one the package installs', () => {
  const installed = theInstalledBinary(readFileSync(INSTALLS, 'utf-8'));

  it('reads a name off the package rather than carrying one', () => {
    // THE NON-VACUITY OF EVERY CASE BELOW, and it is asked first. Each of them compares
    // against `installed`, so each is worth exactly what this reading is worth: a reader
    // that returned a constant would make all four green forever.
    expect(installed).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(theInstalledBinary('{"bin":{"something-else":"./dist/cli.js"}}')).toBe('something-else');
    expect(() => theInstalledBinary('{}')).toThrow(/installs 0 executables/);
    expect(() => theInstalledBinary('{"bin":{"a":"x","b":"y"}}')).toThrow(/installs 2 executables/);
  });

  it('spawns it from the session hook, on both platforms, off one name', () => {
    const spawns = whatTheHookSpawns(readFileSync(HOOK, 'utf-8'));
    expect(spawns.otherwise).toBe(installed);
    // npm's own shim name on Windows is the bin key with `.cmd` after it. What is held is
    // that the Windows spelling stays DERIVED from the same name, never that it is right.
    expect(spawns.win32).toBe(`${installed}.cmd`);
  });

  it('starts the MCP server by running it', () => {
    expect(whatTheManifestRuns(readFileSync(MANIFEST, 'utf-8'))).toBe(installed);
  });

  it('prints it on every usage line the product publishes', () => {
    // The third site, which the handoff's list did not have. commander puts this name at
    // the head of every `Usage:` line, so a `bin` renamed without it hands the reader of
    // `--help` a command that is not installed.
    const program = buildProgram({
      out: () => undefined,
      err: () => undefined,
      fail: () => undefined,
    }).program;
    expect(program.name()).toBe(installed);
  });

  it('accuses a name that drifted, on each of the three sides', () => {
    // THE MUTATION, AS A CASE. Each side is fed a copy that says something else and the
    // comparison has to come apart — otherwise the four above are assertions about
    // nothing. The real files are never touched: these are strings.
    const hook = readFileSync(HOOK, 'utf-8');
    const drifted = hook.replace(
      `'${installed}.cmd' : '${installed}'`,
      `'mnema-next.cmd' : 'mnema-next'`,
    );
    expect(drifted).not.toBe(hook);
    expect(whatTheHookSpawns(drifted).otherwise).not.toBe(installed);
    expect(whatTheHookSpawns(drifted).win32).not.toBe(`${installed}.cmd`);

    expect(whatTheManifestRuns('{"mcpServers":{"mnema":{"command":"mnema-next"}}}')).not.toBe(
      installed,
    );
    expect(theInstalledBinary('{"bin":{"mnema-next":"./dist/cli.js"}}')).not.toBe(installed);

    // And the extractor refuses over a hook that no longer declares the constant, rather
    // than reporting a name it did not find.
    expect(() => whatTheHookSpawns('const BINARY = someOtherWay();')).toThrow(/no longer declares/);
  });
});
