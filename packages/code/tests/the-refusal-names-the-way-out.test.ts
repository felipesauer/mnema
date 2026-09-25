/**
 * A key the record proves in two identities is refused — and the refusal names the ways out the
 * record shows, each of which works when it is done to the letter, with git doing what git does.
 *
 * WHAT WAS WRONG, TWICE. The refusal first stopped at "which one it should speak for here is not a
 * choice to make on its behalf", and the page promised the write was refused "until you say
 * which" — with no command that says which. Then it named a revocation by the identity that should
 * not have the key, and said that where the key is an identity's last there was no other way: a
 * key that founded an identity by writing "can only go back to speaking for" it, and a key that is
 * the only key of both had "no revocation here" that separates them. Simulated on the binary, with
 * git clones, both were false: another key brought into the identity the key founded, from the
 * checkout that founded it, lets this key leave it — and that checkout, whose anchor is local, is
 * the installation that still writes as that identity.
 *
 * WHAT IS ASSERTED, with a bare remote and a clone per machine, the way a team works:
 *
 *   - in each shape a record reaches this in, the refusal says which ways out the record names —
 *     and where it names none, it says so and hands over no command;
 *   - each way out, followed to the letter — the commands copied out of the words WHOLE, each
 *     marker filled with what the words say fills it, run where the words say, and the pull, the
 *     commit and the share done where the words say them and nowhere else — is accepted, and a
 *     fresh clone then writes as the identity the words said, read from the stored events;
 *   - the checkout a key left an identity from writes as the one the key is left in once it ran
 *     the restore the words name, the record then verifies, and the clone after the way out is not
 *     told that its key founded an identity of its own;
 *   - the revocation of a machine's own key says what the record leaves it: a restore and the file
 *     it takes, where the record still proves the key in one identity, and a warning where it
 *     proves none;
 *   - and the agent is told the same words, from the same sentence.
 *
 * THIS FILE USED TO FINISH THE COMMAND ITSELF, and then to share the record for the words. The
 * refusal named `mnema key revoke <fingerprint>`, the verb requires `--reason`, and both cases that
 * ran the words appended `'--reason', '…'` before running them; the words now carry `--reason
 * "<why>"`, and nothing is added. And every clone here was a clone of the WORKING DIRECTORY the
 * revocation was committed in, so "commits" reached it with no push: with a remote in between, a
 * fresh clone of the team's record would not hold the revocation. The words say "commits and
 * shares the record" now, and the cases below share only where the words say it.
 *
 * The key that leaves an identity lives under a home whose path holds a SPACE, so the file the
 * words tell a person to hand to `mnema key restore` is one that breaks an unquoted marker.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { catalogUpcasters } from '@mnema/chain';
import { orderedEvents } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { argvOf } from './support/reading-a-shell-line.js';

/** The built binary — what a person runs. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

const REFUSED = 'Refused (AMBIGUOUS_MEMBERSHIP): ';

/** The words every founding sentence starts with — `a-new-identity.ts`. */
const FOUNDED = 'This key founded an identity of its own';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-the-refusal-names-the-way-out-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A machine: a home of its own, so a key of its own. */
function home(name: string): string {
  const dir = join(sandbox, `home ${name}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** `mnema <argv>` in `dir`, as the key under `homeDir`. */
function mnema(
  dir: string,
  homeDir: string,
  ...argv: string[]
): { status: number | null; stdout: string; stderr: string } {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: dir,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: homeDir },
  });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

/** `git <args>` in `dir`, with a home of the sandbox's and no configuration of the machine's. */
function git(dir: string, ...args: string[]): string {
  const ran = spawnSync(
    'git',
    [
      '-c',
      'user.name=mnema test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'init.defaultBranch=main',
      '-c',
      'pull.rebase=false',
      ...args,
    ],
    {
      cwd: dir,
      encoding: 'utf-8',
      env: { PATH: process.env.PATH ?? '', HOME: join(sandbox, 'git'), GIT_CONFIG_NOSYSTEM: '1' },
    },
  );
  if (ran.status !== 0) throw new Error(`setup: git ${args.join(' ')} in ${dir}: ${ran.stderr}`);
  return ran.stdout;
}

/** A clone of the team's remote — a checkout of its own, as a machine keeps one. */
function checkout(remote: string, name: string): string {
  const to = join(sandbox, 'checkouts', name);
  mkdirSync(join(sandbox, 'checkouts'), { recursive: true });
  git(sandbox, 'clone', '-q', remote, to);
  return to;
}

/** Brings what the others pushed into `dir`. */
function pull(dir: string): void {
  git(dir, 'pull', '-q', '--no-edit', 'origin', 'main');
}

/** Commits what the record holds in `dir`, and pushes it where the others read it. */
function share(dir: string): void {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'the record');
  if (git(dir, 'ls-remote', '--heads', 'origin', 'main').trim() !== '') pull(dir);
  git(dir, 'push', '-q', 'origin', 'HEAD:main');
}

/** The team's remote, founded by the key under `founder` from the checkout it returns. */
function team(founder: string): { remote: string; founding: string } {
  const remote = join(sandbox, 'origin.git');
  git(sandbox, 'init', '-q', '--bare', remote);
  const founding = checkout(remote, 'founding');
  expect(mnema(founding, founder, 'init').status).toBe(0);
  share(founding);
  return { remote, founding };
}

/** The fingerprint of the key under `homeDir` — the one signing key its key root holds. */
function keyOf(homeDir: string): string {
  const [key] = readdirSync(join(homeDir, '.mnema', 'identity', 'keys')).filter((name) =>
    name.endsWith('.key'),
  );
  expect(key).toBeDefined();
  return (key as string).slice(0, -'.key'.length);
}

/** The identity the installation of `fingerprint` in `dir` recorded it writes as. */
function anchorIn(dir: string, fingerprint: string): string {
  return readFileSync(join(dir, '.mnema', 'keys', `${fingerprint}.anchor`), 'utf-8').trim();
}

/** A request, made outside every project, for the key under `homeDir` to join `anchor`. */
function requestFrom(homeDir: string, anchor: string): string {
  const asked = mnema(sandbox, homeDir, 'key', 'request', '--anchor', anchor);
  expect(asked.status, asked.stderr).toBe(0);
  const line = asked.stdout.split('\n').find((one) => one.startsWith('mnema-key-request:'));
  expect(line).toBeDefined();
  return line as string;
}

/** Writes `content` in `dir` as the key under `homeDir`, and says whom it spoke for. */
function writeAs(dir: string, homeDir: string, content: string): { who: string; stderr: string } {
  const wrote = mnema(dir, homeDir, 'memory', content);
  expect(wrote.status, wrote.stderr).toBe(0);
  const who = orderedEvents({ root: join(dir, '.mnema') }, catalogUpcasters())
    .filter((event) => event.kind === 'memory.captured' && event.payload.content === content)
    .at(-1)?.who;
  expect(who, `no memory "${content}" in ${dir}`).toBeDefined();
  return { who: who as string, stderr: wrote.stderr };
}

/** The refusal's own sentence, as the command line printed it. */
function refusalIn(stderr: string): string {
  const line = stderr.split('\n').find((one) => one.startsWith(REFUSED));
  expect(line, stderr).toBeDefined();
  return (line as string).slice(REFUSED.length);
}

/** The refusal a fresh clone of `remote` gives the key under `homeDir`. */
function refusedIn(remote: string, homeDir: string, name: string): string {
  const refused = mnema(checkout(remote, name), homeDir, 'memory', 'which identity is this?');
  expect(refused.status).toBe(1);
  return refusalIn(refused.stderr);
}

/** What a person writes where the words put `<why>`. */
const WRITTEN_FOR_THE_MARKER = 'this identity should not have that key';

/** Every command the words hand over, in the order they say them, copied out of the backticks. */
function commandsIn(words: string): string[] {
  return [...words.matchAll(/`(mnema [^`]*)`/g)].map((match) => match[1] as string);
}

/**
 * A command as a person runs it: each MARKER replaced, BEFORE the line is read, by what the words
 * say fills it — and a marker this case was not handed a value for fails by name, so words that
 * grow a marker nobody can fill are red here. Then the line is read as a shell reads it
 * (`argvOf`), so a quoted marker is one word and an unquoted one falls apart into several, as it
 * would for the person. Nothing is added.
 */
function argvFor(command: string, fills: Readonly<Record<string, string>>): string[] {
  const filled = command.replace(/<[^<>]*>/g, (marker) => {
    const value = fills[marker];
    if (value === undefined) {
      throw new Error(
        `the words hand over a marker this case has no value for: ${marker} in ${command}`,
      );
    }
    return value;
  });
  const [program, ...words] = argvOf(filled);
  expect(program).toBe('mnema');
  return words;
}

/** The part of the words that is the way out of `left`, and the identity it says the key is left in. */
function theWayOutOf(words: string, left: string): { clause: string; leftIn: string } {
  const from = words.indexOf(`can leave ${left}`);
  expect(from, `the words name no way out of ${left}: ${words}`).toBeGreaterThan(-1);
  const rest = words.slice(from);
  const end = /a fresh clone then writes as (mnid:[0-9a-f]+)/.exec(rest);
  expect(
    end,
    `the way out of ${left} does not say where it leaves the key: ${rest}`,
  ).not.toBeNull();
  const ended = end as RegExpExecArray;
  return { clause: rest.slice(0, ended.index + ended[0].length), leftIn: ended[1] as string };
}

/** Where each step of a way out runs, as this case knows the places. */
interface Places {
  /** Checkouts by the words that name them — each one writes as the identity the words say. */
  readonly checkouts: Readonly<Record<string, string>>;
  /** The home of the key that leaves, which is the key the refusal is about. */
  readonly leaving: string;
  /** The home of the key that joins in its place — "where that key lives". */
  readonly joining: string;
}

/**
 * Takes the key out of `left` the way the words say, and returns the identity they say it is then
 * left in, the checkout it was done from, and what the revocation printed.
 *
 * THE PLACES ARE READ OFF THE WORDS. The checkout the words send the way out to is looked up in
 * {@link Places}, and one this case does not know fails by name — whoever changes where the words
 * send a person has to come here and say it. So is each step that is not a command: the pull, and
 * the commit and share, are done where the words say them, and a way out whose words lose one is a
 * way out this case does not do.
 */
function leave(
  words: string,
  left: string,
  at: Places,
): { leftIn: string; there: string; revoked: string } {
  const { clause, leftIn } = theWayOutOf(words, left);
  const place = Object.keys(at.checkouts).find((one) => clause.includes(`in ${one} ${left} from`));
  expect(
    place,
    `the words send the way out of ${left} where this case cannot follow: ${clause}`,
  ).toBeDefined();
  const there = at.checkouts[place as string] as string;
  if (clause.includes('pull the record')) pull(there);

  const commands = commandsIn(clause);
  const request = commands.find((one) => one.startsWith('mnema key request '));
  expect(request, clause).toBeDefined();
  expect(clause).toContain(`\`${request}\` prints where that key lives`);
  // Where that key lives: its own home, outside every project.
  const asked = mnema(sandbox, at.joining, ...argvFor(request as string, {}));
  expect(asked.status, asked.stderr).toBe(0);
  const line = asked.stdout.split('\n').find((one) => one.startsWith('mnema-key-request:'));
  expect(line, asked.stdout).toBeDefined();

  const fills: Record<string, string> = {
    '<the line>': line as string,
    '<why>': WRITTEN_FOR_THE_MARKER,
  };
  let revoked = '';
  for (const command of commands.filter((one) => one !== request)) {
    const ran = mnema(there, at.leaving, ...argvFor(command, fills));
    expect(ran.status, `${command}: ${ran.stderr}${ran.stdout}`).toBe(0);
    if (command.startsWith('mnema key revoke ')) {
      revoked = ran.stdout;
      // What the words say the revocation prints, run there: where that machine keeps the file.
      if (clause.includes('prints where that machine keeps the key file')) {
        const file = /this machine keeps the key file at (.+)$/m.exec(ran.stdout)?.[1];
        if (file !== undefined) fills['<the key file>'] = file;
      }
    }
  }
  if (clause.includes('then commit and share the record')) share(there);
  return { leftIn, there, revoked };
}

/**
 * Lets the key go from the identity the words name, the way they say: the machine that writes as
 * it runs the revocation copied out of the words, and commits and shares only where they say so.
 */
function letGo(words: string, by: { checkout: string; home: string }): void {
  const [command] = commandsIn(words).filter((one) => one.startsWith('mnema key revoke '));
  expect(command, words).toBeDefined();
  const ran = mnema(
    by.checkout,
    by.home,
    ...argvFor(command as string, { '<why>': WRITTEN_FOR_THE_MARKER }),
  );
  expect(ran.status, ran.stderr).toBe(0);
  if (words.includes('inside this project, and commits and shares the record')) share(by.checkout);
}

/** `mnema verify` over a fresh clone of the team's record, as a home that holds no key of the case. */
function verifiedIn(remote: string, name: string): number | null {
  return mnema(checkout(remote, name), home(`auditor ${name}`), 'verify').status;
}

describe('a key enrolled into two identities, having founded neither', () => {
  /** X is A's identity, Y is C's; D asks to join both and both vouch. D never writes. */
  function twoVouches() {
    const [a, c, d] = [home('a'), home('c'), home('d')];
    const { remote, founding } = team(a);
    const atC = checkout(remote, 'c');
    writeAs(atC, c, 'C founds an identity of its own');
    share(atC);
    const x = anchorIn(founding, keyOf(a));
    const y = anchorIn(atC, keyOf(c));
    pull(founding);
    expect(mnema(founding, a, 'key', 'enroll', requestFrom(d, x)).status).toBe(0);
    share(founding);
    pull(atC);
    expect(mnema(atC, c, 'key', 'enroll', requestFrom(d, y)).status).toBe(0);
    share(atC);
    pull(founding);
    return { a, d, remote, founding, y, fp: keyOf(d) };
  }

  it('the refusal says either can let it go, and the one that does, sharing it, leaves the key to the other', () => {
    const { a, d, remote, founding, y, fp } = twoVouches();
    const said = refusedIn(remote, d, 'first');
    expect(said).toContain('It speaks for one of them again once the other lets it go');
    expect(said).toContain('inside this project, and commits and shares the record');
    expect(said).toContain('the key then speaks for the identity left');
    const [command] = commandsIn(said);
    expect(argvFor(command as string, { '<why>': WRITTEN_FOR_THE_MARKER }).slice(0, 3)).toEqual([
      'key',
      'revoke',
      fp,
    ]);
    // The key's own fresh installation cannot be the one: it is nobody here until this is settled.
    expect(
      mnema(checkout(remote, 'itself'), d, 'key', 'revoke', fp, '--reason', 'choosing').stderr,
    ).toContain('Refused (AMBIGUOUS_MEMBERSHIP)');

    // Done to the letter, by the machine whose writes speak for X, the identity that lets it go.
    letGo(said, { checkout: founding, home: a });
    expect(writeAs(checkout(remote, 'after'), d, 'written after X let go').who).toBe(y);
  }, 90_000);
});

describe('a key that founded an identity by writing, and was enrolled into another', () => {
  /** A founds X with `init`; B writes and founds its own; A vouches for B into X. */
  function foundedThenEnrolled() {
    const [a, b, n] = [home('a'), home('b the laptop'), home('n')];
    const { remote, founding } = team(a);
    const atB = checkout(remote, 'b');
    const foundingSaid = writeAs(atB, b, 'B founds beside A').stderr;
    share(atB);
    const fp = keyOf(b);
    const theirs = anchorIn(founding, keyOf(a));
    const founded = anchorIn(atB, fp);
    pull(founding);
    // The words the founding said, before they named where not to enroll: B's key into A's identity.
    expect(mnema(founding, a, 'key', 'enroll', requestFrom(b, theirs)).status).toBe(0);
    share(founding);
    return { a, b, n, remote, founding, atB, fp, theirs, founded, foundingSaid };
  }

  it('the refusal names both ways out: the other lets it go, or it leaves the one it founded', () => {
    const { b, remote, fp, theirs, founded } = foundedThenEnrolled();
    const said = refusedIn(remote, b, 'first');
    expect(said).toContain(`It speaks for ${founded} again once ${theirs} lets it go`);
    expect(said).toContain(`a machine whose writes here speak for ${theirs} runs`);
    expect(said).toContain(
      `Or it can leave ${founded} instead — the identity it founded here, whose only key it is, so another key joins it first`,
    );
    expect(said).not.toContain('can only go back');
    expect(theWayOutOf(said, founded).leftIn).toBe(theirs);
    expect(
      commandsIn(said).filter((one) => one.startsWith(`mnema key revoke ${fp} `)),
    ).toHaveLength(2);
  }, 90_000);

  it('the first, done to the letter: the other identity lets it go, and the key speaks for the one it founded', () => {
    const { a, b, remote, founding, atB, fp, founded } = foundedThenEnrolled();
    const said = refusedIn(remote, b, 'first');
    // The identity it founded cannot retire it — its only key — which is why the words say so.
    pull(atB);
    expect(
      mnema(atB, b, 'key', 'revoke', fp, '--reason', 'leave the one I founded').stderr,
    ).toContain('Refused (LAST_KEY)');
    letGo(said.split('. Or it can leave')[0] as string, { checkout: founding, home: a });
    expect(writeAs(checkout(remote, 'after'), b, 'written after A let go').who).toBe(founded);
  }, 90_000);

  it('the second, done to the letter from the checkout that founded it: the key speaks for the other, and verifies', () => {
    const { b, n, remote, atB, founded, foundingSaid } = foundedThenEnrolled();
    // The founding said an enrollment ALONE joins nothing here — every fresh clone refusing the
    // key meanwhile, which the refusal below is — until another key takes this one's place in the
    // identity it founded, which the way out below does.
    expect(foundingSaid).toContain(
      'Not in this project by an enrollment alone: here it joins nothing until another key takes this one’s place in the identity it just founded',
    );
    const said = refusedIn(remote, b, 'first');
    const out = leave(said, founded, {
      checkouts: { 'the checkout it founded': atB },
      leaving: b,
      joining: n,
    });
    const after = writeAs(checkout(remote, 'after'), b, 'a fresh clone after the way out');
    expect(after.who).toBe(out.leftIn);
    expect(after.stderr).not.toContain(FOUNDED);
    expect(writeAs(atB, b, 'the founding checkout, restored').who).toBe(out.leftIn);
    share(atB);
    expect(verifiedIn(remote, 'verified')).toBe(0);
  }, 120_000);
});

describe('a key that is the only key of both identities', () => {
  /**
   * The shape a migration reaches: C (the old laptop) founds Y by writing; B (the new one) writes
   * and founds its own; C vouches for B into Y and then retires itself. The checkout B founded from
   * last pulled BEFORE the vouch — a checkout left alone — which is what makes the words' pull a
   * step the way out cannot skip.
   */
  function theOnlyKeyOfBoth() {
    const [o, c, b, n] = [home('o'), home('c'), home('b the laptop'), home('n')];
    const { remote } = team(o);
    const atC = checkout(remote, 'c');
    writeAs(atC, c, 'C founds Y');
    share(atC);
    const y = anchorIn(atC, keyOf(c));
    const atB = checkout(remote, 'b');
    writeAs(atB, b, 'B founds its own');
    share(atB);
    const fp = keyOf(b);
    const founded = anchorIn(atB, fp);
    pull(atC);
    expect(mnema(atC, c, 'key', 'enroll', requestFrom(b, y)).status).toBe(0);
    share(atC);
    expect(mnema(atC, c, 'key', 'revoke', keyOf(c), '--reason', 'C leaves Y').status).toBe(0);
    share(atC);
    return { b, n, remote, atB, fp, y, founded };
  }

  it('the refusal names the way out of the one it founded, and no checkout for the other', () => {
    const { b, remote, y, founded } = theOnlyKeyOfBoth();
    const said = refusedIn(remote, b, 'first');
    expect(said).toContain(`It is the only key ${founded} and ${y} have`);
    expect(said).toContain(
      `It can leave ${founded}, the identity it founded here: in the checkout it founded ${founded} from`,
    );
    expect(said).toContain(
      `The record names no checkout that could take it out of ${y}: this key has not written here as ${y}`,
    );
    expect(said).not.toContain('no revocation here separates them');
    expect(theWayOutOf(said, founded).leftIn).toBe(y);
  }, 90_000);

  it('done to the letter from the checkout that founded it — which had not pulled — the key speaks for the other, and verifies', () => {
    const { b, n, remote, atB, fp, founded, y } = theOnlyKeyOfBoth();
    const said = refusedIn(remote, b, 'first');
    // Before the way out, the checkout that founded goes on writing as the identity it founded.
    expect(writeAs(atB, b, 'the founding checkout, before').who).toBe(founded);

    const out = leave(said, founded, {
      checkouts: { 'the checkout it founded': atB },
      leaving: b,
      joining: n,
    });
    expect(out.leftIn).toBe(y);
    // The revocation of this machine's own key said what the record leaves it, and where the file is.
    expect(out.revoked).toContain(
      "That is THIS machine's key: this checkout still records the identity it left, and anything it writes as that identity fails verification.",
    );
    expect(out.revoked).toContain(`The record proves the key a member of ${y}:`);
    expect(out.revoked).toContain(
      `this machine keeps the key file at ${join(b, '.mnema', 'identity', 'keys', `${fp}.key`)}`,
    );

    const after = writeAs(checkout(remote, 'after'), b, 'a fresh clone after the way out');
    expect(after.who).toBe(y);
    expect(after.stderr).not.toContain(FOUNDED);
    expect(writeAs(atB, b, 'the founding checkout, restored').who).toBe(y);
    share(atB);
    expect(verifiedIn(remote, 'verified')).toBe(0);
  }, 120_000);
});

describe('a key that is the only key of two identities, and wrote as both', () => {
  /**
   * Two checkouts of one key speak for two identities: B founds its own in one checkout without
   * sharing it, asks to join Y at once, and a second checkout adopts Y and writes as it before the
   * first shares its founding. Then C leaves Y.
   */
  function twoCheckouts() {
    const [o, c, b, n] = [home('o'), home('c'), home('b the laptop'), home('n')];
    const { remote } = team(o);
    const atC = checkout(remote, 'c');
    writeAs(atC, c, 'C founds Y');
    share(atC);
    const y = anchorIn(atC, keyOf(c));
    const first = checkout(remote, 'b-first');
    writeAs(first, b, 'B founds its own, and does not share it yet');
    const fp = keyOf(b);
    const founded = anchorIn(first, fp);
    pull(atC);
    expect(mnema(atC, c, 'key', 'enroll', requestFrom(b, y)).status).toBe(0);
    share(atC);
    const second = checkout(remote, 'b-second');
    expect(writeAs(second, b, 'the second checkout adopts Y').who).toBe(y);
    share(second);
    share(first);
    pull(atC);
    expect(mnema(atC, c, 'key', 'revoke', keyOf(c), '--reason', 'C leaves Y').status).toBe(0);
    share(atC);
    return { b, n, remote, second, founded, y };
  }

  it('names a way out of each, and the one out of the identity it wrote as works to the letter', () => {
    const { b, n, remote, second, founded, y } = twoCheckouts();
    const said = refusedIn(remote, b, 'first');
    expect(theWayOutOf(said, founded).leftIn).toBe(y);
    expect(said).toContain(
      `It can leave ${y}, an identity it has written here as: in a checkout it wrote here as ${y} from`,
    );
    expect(theWayOutOf(said, y).leftIn).toBe(founded);
    expect(said).not.toContain('The record names no checkout');

    const out = leave(said, y, {
      checkouts: { 'a checkout it wrote here as': second },
      leaving: b,
      joining: n,
    });
    expect(out.leftIn).toBe(founded);
    expect(writeAs(checkout(remote, 'after'), b, 'a fresh clone after the way out').who).toBe(
      founded,
    );
    expect(writeAs(second, b, 'the second checkout, restored').who).toBe(founded);
    share(second);
    expect(verifiedIn(remote, 'verified')).toBe(0);
  }, 150_000);
});

describe('a key that is the only key of two identities it never wrote as', () => {
  it('the refusal says the record names no checkout that could separate them, and names no command', () => {
    const [o, c, e, d] = [home('o'), home('c'), home('e'), home('d')];
    const { remote } = team(o);
    const atC = checkout(remote, 'c');
    writeAs(atC, c, 'C founds Y');
    share(atC);
    const atE = checkout(remote, 'e');
    writeAs(atE, e, 'E founds W');
    share(atE);
    pull(atC);
    expect(mnema(atC, c, 'key', 'enroll', requestFrom(d, anchorIn(atC, keyOf(c)))).status).toBe(0);
    share(atC);
    pull(atE);
    expect(mnema(atE, e, 'key', 'enroll', requestFrom(d, anchorIn(atE, keyOf(e)))).status).toBe(0);
    share(atE);
    pull(atC);
    expect(mnema(atC, c, 'key', 'revoke', keyOf(c), '--reason', 'C leaves Y').status).toBe(0);
    share(atC);
    pull(atE);
    expect(mnema(atE, e, 'key', 'revoke', keyOf(e), '--reason', 'E leaves W').status).toBe(0);
    share(atE);

    const said = refusedIn(remote, d, 'first');
    expect(said).toContain(
      'This key has not written here as either, so the record names no checkout that could separate them',
    );
    expect(commandsIn(said)).toEqual([]);
    expect(said).not.toContain('mnema key');
  }, 90_000);
});

describe('the revocation of this machine’s own key says what the record leaves it', () => {
  it('where the record proves the key in no other identity: it must not write here again, and no restore is offered', () => {
    const a = home('a');
    const { founding } = team(a);
    // `init` enrolled a backup key beside this one, so this machine's key is not the last.
    const revoked = mnema(
      founding,
      a,
      'key',
      'revoke',
      keyOf(a),
      '--reason',
      'this laptop retires',
    );
    expect(revoked.status, revoked.stderr).toBe(0);
    expect(revoked.stdout).toContain(
      "That is THIS machine's key: it must not write to this project again.",
    );
    expect(revoked.stdout).toContain(
      'Bring another key in first if this machine is to keep working here.',
    );
    expect(revoked.stdout).not.toContain('mnema key restore');
    expect(revoked.stdout).not.toContain('keeps the key file');
  }, 60_000);
});

describe('the agent is told the same words', () => {
  it('in the refusal of the write that the key cannot make, from the same sentence', async () => {
    const [a, c, d] = [home('a'), home('c'), home('d')];
    const { remote, founding } = team(a);
    const atC = checkout(remote, 'c');
    writeAs(atC, c, 'C founds Y');
    share(atC);
    pull(founding);
    expect(
      mnema(founding, a, 'key', 'enroll', requestFrom(d, anchorIn(founding, keyOf(a)))).status,
    ).toBe(0);
    share(founding);
    pull(atC);
    expect(mnema(atC, c, 'key', 'enroll', requestFrom(d, anchorIn(atC, keyOf(c)))).status).toBe(0);
    share(atC);
    const clone = checkout(remote, 'clone');
    const printed = refusalIn(mnema(clone, d, 'memory', 'from the command line').stderr);

    const { server } = buildMcpServer({ cwd: sandbox, env: { home: d }, log: () => {} });
    const client = new Client(
      { name: 'claude-code', version: '1.0.0' },
      { capabilities: { roots: {} } },
    );
    client.setRequestHandler(ListRootsRequestSchema, () => ({
      roots: [{ uri: pathToFileURL(clone).href }],
    }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const reply = (await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'from the agent', scope: 'public' },
    })) as { isError?: boolean; content: { text: string }[] };
    await client.close();

    expect(reply.isError).toBe(true);
    const told = reply.content.map((block) => block.text).join('\n');
    expect(printed).toContain('It speaks for one of them again once the other lets it go');
    expect(told).toContain(printed);
  }, 90_000);
});
