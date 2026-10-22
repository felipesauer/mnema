/**
 * THE PLUGIN SPAWNS WHAT THIS WORKSPACE INSTALLS: one name, read off the manifest that
 * creates it, at every place that has to spell it.
 *
 * WHERE THIS COMES FROM. The plugin reaches the product through the PATH and through
 * nothing else: the handlers spawn a bare `mnema` (through the one module they share,
 * `hand-over.mjs`, which is the only hook file that spawns) and `plugin.json` tells the
 * host to start an MCP server through `server/launch.mjs`, which spawns a bare `mnema`. Neither string is
 * an import, so no module graph follows them, and the failure they produce is silent by
 * the handler's own design: "a failed spawn is silence", which is right for a hook and
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
 * THE SITES WERE FOUND BY THE DISCRIMINANT: "a place that must spell the name of the
 * installed executable for it to run", and not by a list. That found a THIRD site the
 * list did not have: `cli.ts` names the program to commander, which is the name printed
 * on every usage line the product publishes. A `bin` renamed without it tells every
 * reader of `--help` to type a command that does not exist. The word `mnema` appears in
 * a dozen other places in this workspace (the data directory, the MCP server's advertised
 * name, the REPL prompt, the export producer) and NONE of them is this rule: they are
 * other things that happen to share a word, and grepping the word rather than the rule
 * would have swept them in.
 *
 * WHAT IT DOES NOT COVER, said out loud rather than left to be discovered:
 *
 *   - the hook's constant is read from SOURCE TEXT, never imported. It used to live in
 *     the handler, where importing runs the hook; it lives in the module the two handlers
 *     share now, and reading the text is kept because it is the one form that asserts
 *     what the FILE says. The extractor below refuses rather than returns nothing if the
 *     line ever changes shape, so a reformat is a red with a reason instead of a case
 *     that quietly asserts nothing;
 *   - it says nothing about whether `mnema` is on the PATH of any particular machine.
 *     That is the installer's business, and the handler is silent about it on purpose;
 *   - `.cmd` on Windows is npm's shim name and is INTENTION rather than measurement:
 *     the handler's own comment says so, and nothing here has run on Windows. What is
 *     held is that the two spellings stay derived from ONE name, not that the derivation
 *     is right for that platform.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildProgram } from '../src/program.js';
import { codeOnly } from './support/reading-source.js';

/** The repository root: `packages/code/tests/` is three levels under it. */
const REPO = fileURLToPath(new URL('../../../', import.meta.url));

/** The manifest whose `bin` key npm turns into the executable. */
const INSTALLS = join(REPO, 'packages', 'code', 'package.json');

/**
 * The one module of the plugin that spawns the binary: both `SessionStart` handlers hand
 * a session what a verb prints through it.
 */
const HOOK = join(REPO, 'plugin', 'hooks', 'hand-over.mjs');
/** Every file the plugin's hooks are made of. */
const HOOKS_DIR = join(REPO, 'plugin', 'hooks');

/** The manifest that tells the host how to start the MCP server. */
const MANIFEST = join(REPO, 'plugin', '.claude-plugin', 'plugin.json');

/** The launcher the manifest starts: it spawns the product for the MCP server. */
const LAUNCHER = join(REPO, 'plugin', 'server', 'launch.mjs');

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
    throw new Error('hand-over.mjs no longer declares BINARY in the shape this reads');
  }
  return { win32: written[1] as string, otherwise: written[2] as string };
}

/**
 * The program `plugin.json` tells the host to start for the MCP server, and the file it hands
 * that program: a launcher, which spawns the product. The name the launcher spawns is read off
 * the launcher (see {@link whatTheHookSpawns}), not off the manifest.
 */
export function whatTheManifestRuns(manifestText: string): { command: string; script: string } {
  const servers = (
    JSON.parse(manifestText) as {
      mcpServers?: Record<string, { command?: string; args?: string[] }>;
    }
  ).mcpServers;
  const entries = Object.entries(servers ?? {});
  if (entries.length !== 1) {
    throw new Error(`the plugin declares ${entries.length} servers, not one`);
  }
  const server = (entries[0] as [string, { command?: string; args?: string[] }])[1];
  return { command: server.command ?? '', script: server.args?.[0] ?? '' };
}

/** Every API of `node:child_process` that starts a program, by the name it is called by. */
const CHILD_PROCESS_APIS = 'spawn|spawnSync|exec|execSync|execFile|execFileSync|fork';

/**
 * WHAT A MODULE DOES WITH CHILD PROCESSES, read off its CODE (comments, strings and regular
 * expressions blanked, so a comment cannot satisfy it and cannot accuse it).
 *
 * `calls` is every call of one of the APIs by its bare name, with its first argument; `other` is
 * what would start a program some other way: a method call of one of them, a namespace or default
 * import, a `require` or a dynamic `import()`, and a named import of any API but `spawnSync`.
 * `.exec(` as a method is a regular expression's and is not one of them.
 */
export function theKitsChildProcessCalls(source: string): { calls: string[]; other: string[] } {
  const code = codeOnly(source);
  const calls = [
    ...code.matchAll(
      new RegExp(`(?<![.\\w])(?:${CHILD_PROCESS_APIS})\\s*\\(\\s*[\\w$]*\\s*[,)]`, 'g'),
    ),
  ].map((found) => found[0].replace(/\s+/g, ''));
  const other: string[] = [];
  for (const found of code.matchAll(
    /\.(?:spawn|spawnSync|execSync|execFile|execFileSync|fork)\s*\(/g,
  )) {
    other.push(found[0]);
  }
  for (const found of code.matchAll(
    /\b(?:require\s*\(|import\s*\(|import\s*\*|import\s+\w+\s*[,\s]\s*from\b)/g,
  )) {
    other.push(found[0]);
  }
  for (const found of code.matchAll(/\bimport\s*\{([^}]*)\}/g)) {
    for (const name of (found[1] as string).split(',')) {
      const bare = name.trim().split(/\s+as\s+/)[0] as string;
      if (new RegExp(`^(?:${CHILD_PROCESS_APIS})$`).test(bare) && bare !== 'spawnSync') {
        other.push(`import ${bare}`);
      }
    }
  }
  return { calls, other };
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

  it('spawns from ONE module, so the name is spelled in one place', () => {
    // Two handlers run a verb as a session opens, and the rule that decides what reaches
    // the session is written once (`hand-over.mjs`). A handler that grew a spawn of its
    // own would be a second spelling of the executable this file exists to keep single,
    // and a second copy of the silence rule beside it, so every other file of the plugin
    // is asked, and none may spawn.
    // `the-gate-kit.mjs` spawns too, and what it spawns is a `node`, to ask it its version: it
    // is the one other module allowed a spawn, on the condition that its one spawn is of the
    // `node` it was given and not of the executable (asked after the scan). A regular expression's `.exec(` is a method, not a spawn.
    const KIT = 'the-gate-kit.mjs';
    const others = readdirSync(HOOKS_DIR).filter(
      (name) => name.endsWith('.mjs') && join(HOOKS_DIR, name) !== HOOK && name !== KIT,
    );
    expect(others.length).toBeGreaterThan(1);
    // CODE ONLY, and a first version of this scan is why: over raw text it accused a
    // handler whose doc comment says the rule "lives in `hand-over.mjs`, beside the spawn".
    // A spawn is a call, so what is read is the code with every comment and literal blanked.
    const spawning = others.filter((name) =>
      /(?<![.\w])(spawn(Sync)?|exec(File)?(Sync)?)\b/.test(
        codeOnly(readFileSync(join(HOOKS_DIR, name), 'utf-8')),
      ),
    );
    expect(spawning).toEqual([]);
    expect(theKitsChildProcessCalls(readFileSync(join(HOOKS_DIR, KIT), 'utf-8'))).toEqual({
      calls: ['spawnSync(node,'],
      other: [],
    });
    // And the module that does spawn is where the name is: the case above reads it there.
    expect(codeOnly(readFileSync(HOOK, 'utf-8'))).toMatch(/\bspawnSync\(/);
  });

  it('lights where the kit spawns anything but a node, however it is written', () => {
    // THE MUTATIONS, AS CASES: strings fed to the reading, the real file untouched.
    const kitText = readFileSync(join(HOOKS_DIR, 'the-gate-kit.mjs'), 'utf-8');
    expect(theKitsChildProcessCalls(kitText).calls).toEqual(['spawnSync(node,']);
    const lit = (text: string) => theKitsChildProcessCalls(text);
    expect(lit(`${kitText}\nexecFileSync('mnema', []);`).calls).toHaveLength(2);
    expect(lit(`${kitText}\nexecSync('mnema');`).calls).toHaveLength(2);
    expect(lit(`${kitText}\nspawn('mnema', []);`).calls).toHaveLength(2);
    expect(lit(`${kitText}\nexec('mnema');`).calls).toHaveLength(2);
    expect(lit(`${kitText}\nfork('x.js');`).calls).toHaveLength(2);
    expect(lit(`${kitText}\ncp.execFileSync('mnema');`).other).toHaveLength(1);
    expect(lit("import { execFileSync } from 'node:child_process';").other).toHaveLength(1);
    expect(lit("import * as cp from 'node:child_process';").other).toHaveLength(1);
    expect(lit("const cp = require('node:child_process');").other).toHaveLength(1);
    expect(lit("const cp = await import('node:child_process');").other).toHaveLength(1);
    // The one spawn aimed at something that is not the node it was given.
    expect(lit(kitText.replace('spawnSync(node,', 'spawnSync(binary,')).calls).toEqual([
      'spawnSync(binary,',
    ]);
    // A comment cannot satisfy the reading, and a regular expression's .exec( is not a spawn.
    const bare = kitText.replace('spawnSync(node,', 'spawnSync(binary,');
    expect(lit(`// spawnSync(node,\n${bare}`).calls).toEqual(['spawnSync(binary,']);
    expect(lit('const m = /a/.exec(text);\nspawnSync(node, []);').calls).toEqual([
      'spawnSync(node,',
    ]);
  });

  it('starts the MCP server through a launcher that spawns it, off the same name', () => {
    const runs = whatTheManifestRuns(readFileSync(MANIFEST, 'utf-8'));
    expect(runs.command).toBe('node');
    expect(runs.script).toBe(`\${CLAUDE_PLUGIN_ROOT}/server/launch.mjs`);
    const spawns = whatTheHookSpawns(readFileSync(LAUNCHER, 'utf-8'));
    expect(spawns.otherwise).toBe(installed);
    expect(spawns.win32).toBe(`${installed}.cmd`);
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
    // comparison has to come apart: otherwise the four above are assertions about
    // nothing. The real files are never touched: these are strings.
    const hook = readFileSync(HOOK, 'utf-8');
    const drifted = hook.replace(
      `'${installed}.cmd' : '${installed}'`,
      `'mnema-next.cmd' : 'mnema-next'`,
    );
    expect(drifted).not.toBe(hook);
    expect(whatTheHookSpawns(drifted).otherwise).not.toBe(installed);
    expect(whatTheHookSpawns(drifted).win32).not.toBe(`${installed}.cmd`);

    expect(
      whatTheHookSpawns(
        readFileSync(LAUNCHER, 'utf-8').replace(
          `'${installed}.cmd' : '${installed}'`,
          `'mnema-next.cmd' : 'mnema-next'`,
        ),
      ).otherwise,
    ).not.toBe(installed);
    expect(theInstalledBinary('{"bin":{"mnema-next":"./dist/cli.js"}}')).not.toBe(installed);

    // And the extractor refuses over a hook that no longer declares the constant, rather
    // than reporting a name it did not find.
    expect(() => whatTheHookSpawns('const BINARY = someOtherWay();')).toThrow(/no longer declares/);
  });
});
