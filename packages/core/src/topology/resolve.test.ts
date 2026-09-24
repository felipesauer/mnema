import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DiscoveryEnv, discover, resolveTrees, whyNoProjectRootAt } from './resolve.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-resolve-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A home directory inside the sandbox, so the fallback resolves under it. */
function home(): string {
  const h = join(sandbox, 'home');
  mkdirSync(h, { recursive: true });
  return h;
}

describe('resolveTrees — global tree and key root', () => {
  it('keeps them in ~/.mnema, under HOME', () => {
    const h = home();
    const trees = resolveTrees(sandbox, { home: h });
    expect(trees.global).toBe(join(h, '.mnema', 'global'));
    expect(trees.keyRoot).toBe(join(h, '.mnema', 'identity'));
  });

  it('keeps them in $MNEMA_HOME itself when it is set — the directory, not a parent of one', () => {
    const relocated = join(sandbox, 'elsewhere', 'keys');
    const trees = resolveTrees(sandbox, { home: home(), mnemaHome: relocated });
    expect(trees.global).toBe(join(relocated, 'global'));
    expect(trees.keyRoot).toBe(join(relocated, 'identity'));
  });

  it('spells $MNEMA_HOME one way, whatever trailing or dotted segments it was written with', () => {
    const relocated = join(sandbox, 'elsewhere');
    for (const written of [`${relocated}/`, join(relocated, 'x', '..'), `${relocated}/./`]) {
      expect(resolveTrees(sandbox, { home: home(), mnemaHome: written }).keyRoot).toBe(
        join(relocated, 'identity'),
      );
    }
  });

  it('reads an empty $MNEMA_HOME as unset — the shell’s way of clearing a variable', () => {
    const h = home();
    expect(resolveTrees(sandbox, { home: h, mnemaHome: '' }).keyRoot).toBe(
      join(h, '.mnema', 'identity'),
    );
  });

  it('refuses a relative $MNEMA_HOME, rather than keep a key under the working directory', () => {
    // Resolving it against the working directory, as `GNUPGHOME` and `CARGO_HOME` are, would
    // give one identity per folder; ignoring it would found, in silence, a key in `~/.mnema`
    // the person asked to keep elsewhere. Both are values nothing can take back.
    for (const written of ['keys', './keys', '../keys']) {
      expect(() => resolveTrees(sandbox, { home: home(), mnemaHome: written })).toThrow(
        /MNEMA_HOME is .*a relative path/,
      );
    }
  });

  it('keeps them under the account’s home when HOME names no directory — never under the working directory', () => {
    // The case that was measured: an empty `HOME` used to give `join('', '.mnema')`, which is
    // `.mnema`, relative — one key minted in every folder the process ran from.
    const account = join(sandbox, 'account');
    for (const h of ['', 'relative/home', '.']) {
      const trees = resolveTrees(sandbox, { home: h, accountHome: account });
      expect(trees.keyRoot, `HOME=${JSON.stringify(h)}`).toBe(join(account, '.mnema', 'identity'));
    }
  });

  it('prefers HOME to the account’s home whenever HOME is an absolute path', () => {
    const h = home();
    const trees = resolveTrees(sandbox, { home: h, accountHome: join(sandbox, 'account') });
    expect(trees.keyRoot).toBe(join(h, '.mnema', 'identity'));
  });

  it('refuses when there is no home at all — no absolute HOME, no account home, no MNEMA_HOME', () => {
    for (const accountHome of [undefined, '', 'relative/account']) {
      expect(() => resolveTrees(sandbox, { home: '', accountHome })).toThrow(
        /no home to keep the key root in/,
      );
    }
    // And the variable is the way out, which is what the refusal says.
    const relocated = join(sandbox, 'relocated');
    expect(resolveTrees(sandbox, { home: '', mnemaHome: relocated }).keyRoot).toBe(
      join(relocated, 'identity'),
    );
  });
});

describe('resolveTrees — project discovery', () => {
  it('finds .mnema in the cwd itself', () => {
    mkdirSync(join(sandbox, '.mnema'), { recursive: true });
    const trees = resolveTrees(sandbox, { home: home() });
    expect(trees.projectPublic).toBe(join(sandbox, '.mnema'));
    expect(trees.projectPrivate).toBe(join(sandbox, '.mnema', 'private'));
  });

  it('finds .mnema by walking up from a deep subdirectory', () => {
    const repo = join(sandbox, 'repo');
    mkdirSync(join(repo, '.mnema'), { recursive: true });
    const deep = join(repo, 'a', 'b', 'c', 'd');
    mkdirSync(deep, { recursive: true });
    const trees = resolveTrees(deep, { home: home() });
    expect(trees.projectPublic).toBe(join(repo, '.mnema'));
    expect(trees.projectPrivate).toBe(join(repo, '.mnema', 'private'));
  });

  it('stops at the NEAREST .mnema when nested projects exist', () => {
    const outer = join(sandbox, 'outer');
    const inner = join(outer, 'inner');
    mkdirSync(join(outer, '.mnema'), { recursive: true });
    mkdirSync(join(inner, '.mnema'), { recursive: true });
    const deep = join(inner, 'x', 'y');
    mkdirSync(deep, { recursive: true });
    const trees = resolveTrees(deep, { home: home() });
    expect(trees.projectPublic).toBe(join(inner, '.mnema'));
  });

  it('has no project trees outside any project', () => {
    const trees = resolveTrees(sandbox, { home: home() });
    expect(trees.projectPublic).toBeUndefined();
    expect(trees.projectPrivate).toBeUndefined();
    // The global tree and key root still resolve — a person can capture with no project.
    expect(trees.global).toBeDefined();
    expect(trees.keyRoot).toBeDefined();
  });

  it('does not treat a .mnema FILE as a project tree', () => {
    // A file named `.mnema` is not a tree; discovery must walk past it.
    writeFileSync(join(sandbox, '.mnema'), 'not a tree', 'utf-8');
    const trees = resolveTrees(sandbox, { home: home() });
    expect(trees.projectPublic).toBeUndefined();
  });
});

/**
 * The two kinds of `.mnema/` the walk passes over — and the directories it still finds.
 *
 * Each rule is asserted beside the case that would pass if the rule refused too much: a
 * walk that took no project anywhere under the home would pass every "is not taken" case
 * below by serving nothing, so every one of them has a neighbour that must still find one.
 */
describe('resolveTrees — the home directory is never a project’s root', () => {
  it('does not take the home’s own `.mnema/` — from the home, or from a folder under it', () => {
    const h = home();
    mkdirSync(join(h, '.mnema', 'tails'), { recursive: true });
    const folder = join(h, 'Downloads', 'x');
    mkdirSync(folder, { recursive: true });
    for (const cwd of [h, folder]) {
      // The data directory elsewhere, so the home's `.mnema/` stays the shape a walk from before
      // left it in — a project's tails and no key root.
      const trees = resolveTrees(cwd, { home: h, mnemaHome: join(sandbox, 'data') });
      expect(trees.projectPublic, `from ${cwd}`).toBeUndefined();
      expect(trees.projectPrivate, `from ${cwd}`).toBeUndefined();
    }
  });

  it('does not take this machine’s data directory either — `~/.mnema`, which holds the key root', () => {
    // The case the data directory makes: it IS `~/.mnema`, named exactly what the walk looks
    // for, and it holds the key root.
    const h = home();
    mkdirSync(join(h, '.mnema', 'identity', 'keys'), { recursive: true });
    mkdirSync(join(h, '.mnema', 'global'), { recursive: true });
    const folder = join(h, 'code', 'never-initialized');
    mkdirSync(folder, { recursive: true });
    const trees = resolveTrees(folder, { home: h });
    expect(trees.projectPublic).toBeUndefined();
    expect(trees.global).toBe(join(h, '.mnema', 'global'));
  });

  it('does not look ABOVE the home — anything there would contain it', () => {
    const h = home();
    mkdirSync(join(sandbox, '.mnema'), { recursive: true });
    const folder = join(h, 'work');
    mkdirSync(folder, { recursive: true });
    expect(resolveTrees(folder, { home: h }).projectPublic).toBeUndefined();
    // Non-vacuity: the same `.mnema/` IS found by a walk that never passes the home.
    const outside = join(sandbox, 'elsewhere', 'deep');
    mkdirSync(outside, { recursive: true });
    expect(resolveTrees(outside, { home: h }).projectPublic).toBe(join(sandbox, '.mnema'));
  });

  it('still finds a project UNDER the home — the rule is about the home, not what is in it', () => {
    const h = home();
    mkdirSync(join(h, '.mnema', 'tails'), { recursive: true });
    const app = join(h, 'code', 'app');
    mkdirSync(join(app, '.mnema'), { recursive: true });
    const deep = join(app, 'src', 'lib');
    mkdirSync(deep, { recursive: true });
    expect(resolveTrees(deep, { home: h }).projectPublic).toBe(join(app, '.mnema'));
  });

  it('knows the home through a symlink — the walk climbs resolved paths, `HOME` may not be one', () => {
    const real = join(sandbox, 'disk', 'someone');
    mkdirSync(join(real, '.mnema', 'tails'), { recursive: true });
    mkdirSync(join(real, 'work'), { recursive: true });
    const link = join(sandbox, 'home-link');
    symlinkSync(real, link);
    expect(resolveTrees(join(real, 'work'), { home: link }).projectPublic).toBeUndefined();
  });

  it('reads a relative or empty home as no home at all — it names no directory', () => {
    // A relative home resolved against the working directory would make whatever directory
    // the process stands in "the home" — so the case stands IN the project: there, an empty or
    // `.` home read that way is the project itself, and its `.mnema/` would be passed over as a
    // home's. The data directory reads such a home the same way, as no home, and goes under the
    // account's instead — which is why the case hands it one.
    const repo = join(sandbox, 'repo');
    mkdirSync(join(repo, '.mnema'), { recursive: true });
    const before = process.cwd();
    process.chdir(repo);
    try {
      for (const h of ['', 'relative/home', '.']) {
        const env = { home: h, accountHome: join(sandbox, 'account') };
        expect(resolveTrees(repo, env).projectPublic, `home=${JSON.stringify(h)}`).toBe(
          join(repo, '.mnema'),
        );
      }
    } finally {
      process.chdir(before);
    }
  });
});

describe('resolveTrees — a machine’s data directory is never a project’s tree', () => {
  it('passes over a `.mnema/` holding a key root that is NOT this home’s — and walks on', () => {
    // Another environment's data directory: a sandboxed `HOME` standing under a real one,
    // `sudo`, a data directory left from before `$MNEMA_HOME` was set. It holds no
    // project, so whatever lies above it is still the nearest project.
    const project = join(sandbox, 'proj');
    mkdirSync(join(project, '.mnema'), { recursive: true });
    const theirs = join(project, 'their-home');
    mkdirSync(join(theirs, '.mnema', 'identity', 'keys'), { recursive: true });
    const cwd = join(theirs, 'x');
    mkdirSync(cwd, { recursive: true });
    const found = discover(cwd, { home: home() });
    expect(found.trees.projectPublic).toBe(join(project, '.mnema'));
    expect(found.passedOver).toEqual([{ tree: join(theirs, '.mnema'), why: 'data-directory' }]);
  });

  it('is found as a project when it holds no key root — the reading is the key root, not the name', () => {
    const repo = join(sandbox, 'repo');
    mkdirSync(join(repo, '.mnema', 'tails'), { recursive: true });
    expect(resolveTrees(repo, { home: home() }).projectPublic).toBe(join(repo, '.mnema'));
  });
});

describe('discover — what the walk passed over, from the same walk', () => {
  it('names the home’s `.mnema/` it passed over, and why', () => {
    const h = home();
    mkdirSync(join(h, '.mnema'), { recursive: true });
    const folder = join(h, 'a', 'b');
    mkdirSync(folder, { recursive: true });
    expect(discover(folder, { home: h }).passedOver).toEqual([
      { tree: join(h, '.mnema'), why: 'home' },
    ]);
  });

  it('names nothing when the walk met no `.mnema/` it refused — the ordinary case', () => {
    const h = home();
    const folder = join(h, 'a');
    mkdirSync(folder, { recursive: true });
    expect(discover(folder, { home: h }).passedOver).toEqual([]);
    const repo = join(h, 'repo');
    mkdirSync(join(repo, '.mnema'), { recursive: true });
    expect(discover(repo, { home: h }).passedOver).toEqual([]);
  });

  it('answers the trees resolveTrees answers — one walk, not two', () => {
    const h = home();
    mkdirSync(join(h, '.mnema'), { recursive: true });
    const repo = join(h, 'repo');
    mkdirSync(join(repo, '.mnema'), { recursive: true });
    for (const cwd of [h, repo, join(sandbox)]) {
      const env: DiscoveryEnv = { home: h, mnemaHome: join(sandbox, 'data') };
      expect(discover(cwd, env).trees, `from ${cwd}`).toEqual(resolveTrees(cwd, env));
    }
  });
});

describe('whyNoProjectRootAt — the rule `mnema init` asks before founding', () => {
  it('answers `home` for the home, `data-directory` for a key root, and nothing elsewhere', () => {
    const h = home();
    const theirs = join(sandbox, 'theirs');
    mkdirSync(join(theirs, '.mnema', 'identity'), { recursive: true });
    const plain = join(sandbox, 'plain');
    mkdirSync(plain, { recursive: true });
    expect(whyNoProjectRootAt(h, { home: h })).toBe('home');
    expect(whyNoProjectRootAt(`${h}/`, { home: h })).toBe('home');
    expect(whyNoProjectRootAt(theirs, { home: h })).toBe('data-directory');
    expect(whyNoProjectRootAt(plain, { home: h })).toBeUndefined();
    // Under the home is not the home.
    expect(whyNoProjectRootAt(join(h, 'code'), { home: h })).toBeUndefined();
  });
});
