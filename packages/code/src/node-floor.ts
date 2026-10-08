/**
 * The Node this runs on is checked FIRST, before anything that needs it is loaded.
 *
 * THE DEFECT. The package declares `engines.node`, but `engines` is advice to the
 * installer: npm prints `EBADENGINE` and installs anyway, and the consumer does not inherit the
 * workspace's `engine-strict`. A person on a runtime the package says it does not support then
 * gets whatever the first module that needs a newer one throws — a stack trace out of an import,
 * which looks like the product's fault. The floor is where `node:sqlite` is a release candidate
 * and where `@sigstore/verify` and the Ed25519 rule of the verifier start to hold.
 *
 * THE GUARD. `cli.ts` imports this module before every other import, and an ES module's
 * dependencies are evaluated in the order they are written, so this runs before `@mnema/core`
 * (which imports `node:sqlite`) and before `commander` (which has a floor of its own). Below
 * the floor it says one line and exits 1.
 *
 * THE NUMBER IS NOT HERE. It is `engines.node` in this package's own `package.json`, read at run
 * time — the one place the floor is declared (`the-runtime-floor-is-declared-once.test.ts`), so
 * raising it there is raising it here. `node-floor.test.ts` holds that the declaration is a shape
 * this reads: a floor written in a form it cannot parse would switch the guard off, and that case
 * goes red instead.
 */

import { readFileSync } from 'node:fs';

/** A version as the numbers that order it. */
type Version = readonly [number, number, number];

/** One alternative of a range: the lowest Node it takes, the first it no longer takes, and how it is said. */
export interface Accepted {
  readonly from: Version;
  /** Exclusive: `^24.15.0` takes no 25. Absent when the alternative has no ceiling. */
  readonly before?: Version;
  readonly said: string;
}

const ALTERNATIVE = /^\s*(>=|\^|~)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?\s*$/;

/** A version as its three numbers, or undefined when it is not one. */
function versionOf(text: string): Version | undefined {
  const said = ALTERNATIVE.exec(text);
  if (said === null || said[1] !== undefined) return undefined;
  return [Number(said[2]), Number(said[3] ?? '0'), Number(said[4] ?? '0')];
}

/**
 * The Nodes a range takes, one entry per `||` alternative — or undefined when any alternative is
 * written in a shape not read. `^` and `~` carry the ceiling semver gives them; `>=` and a bare
 * version are a floor with none.
 */
export function acceptedBy(range: string): readonly Accepted[] | undefined {
  const accepted: Accepted[] = [];
  for (const alternative of range.split('||')) {
    const said = ALTERNATIVE.exec(alternative);
    if (said === null) return undefined;
    const from: Version = [Number(said[2]), Number(said[3] ?? '0'), Number(said[4] ?? '0')];
    const shown = from.join('.');
    if (said[1] === '^') {
      accepted.push({ from, before: [from[0] + 1, 0, 0], said: `${shown} or a later ${from[0]}` });
    } else if (said[1] === '~') {
      accepted.push({
        from,
        before: [from[0], from[1] + 1, 0],
        said: `${shown} or a later ${from[0]}.${from[1]}`,
      });
    } else {
      accepted.push({ from, said: `${shown} or later` });
    }
  }
  return accepted;
}

/** Whether `running` is at or above `floor`. */
function reaches(running: Version, floor: Version): boolean {
  for (let i = 0; i < 3; i += 1) {
    if ((running[i] as number) !== (floor[i] as number)) {
      return (running[i] as number) > (floor[i] as number);
    }
  }
  return true;
}

/**
 * The one line to say when `running` is a Node `range` does not take, or undefined when it is
 * taken (or when either cannot be read — a guard that refuses on a reading it cannot make would
 * refuse a runtime nobody has measured to be wrong).
 */
export function floorRefusal(running: string, range: string): string | undefined {
  const accepted = acceptedBy(range);
  const have = versionOf(running);
  if (accepted === undefined || have === undefined) return undefined;
  const taken = accepted.some(
    (a) => reaches(have, a.from) && (a.before === undefined || !reaches(have, a.before)),
  );
  if (taken) return undefined;
  return `mnema needs Node ${accepted.map((a) => a.said).join(', or ')}; this is Node ${running}. Install a newer Node and run it again.`;
}

/** The range `engines.node` declares in this package's `package.json`, or undefined. */
export function declaredRange(): string | undefined {
  try {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
    ) as { engines?: { node?: unknown } };
    const range = manifest.engines?.node;
    return typeof range === 'string' ? range : undefined;
  } catch {
    return undefined;
  }
}

const range = declaredRange();
const refusal = range === undefined ? undefined : floorRefusal(process.versions.node, range);
if (refusal !== undefined) {
  process.stderr.write(`${refusal}\n`);
  process.exit(1);
}
