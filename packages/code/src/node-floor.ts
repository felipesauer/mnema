/**
 * The Node this runs on is checked FIRST, before anything that needs it is loaded.
 *
 * THE DEFECT. The package declares `engines.node` (`>=22.12.0`), but `engines` is advice to the
 * installer: npm prints `EBADENGINE` and installs anyway, and the consumer does not inherit the
 * workspace's `engine-strict`. Measured on Node 20.20.2: `mnema init`, `decision record` and
 * `verify` ran, and `mnema search` — the first verb to open the SQLite projection, whose native
 * addon is built for the ABI of Node 22 and later — died with `Segmentation fault`, exit 139, and
 * not one word. A person on a runtime the package says it does not support got a crash that looks
 * like the product's.
 *
 * THE GUARD. `cli.ts` imports this module before every other import, and an ES module's
 * dependencies are evaluated in the order they are written, so this runs before `@mnema/core`
 * (which reaches the native addon) and before `commander` (which has a floor of its own). Below
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

const FLOOR = /^\s*(?:>=|\^|~)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?\s*$/;

/** The lowest Node a range accepts, or undefined when the range is written in a shape not read. */
export function floorOf(range: string): Version | undefined {
  const said = FLOOR.exec(range);
  if (said === null) return undefined;
  return [Number(said[1]), Number(said[2] ?? '0'), Number(said[3] ?? '0')];
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
 * The one line to say when `running` is below what `range` asks for, or undefined when it is not
 * (or when either cannot be read — a guard that refuses on a reading it cannot make would refuse
 * a runtime nobody has measured to be wrong).
 */
export function floorRefusal(running: string, range: string): string | undefined {
  const floor = floorOf(range);
  const have = floorOf(running);
  if (floor === undefined || have === undefined || reaches(have, floor)) return undefined;
  return `mnema needs Node ${floor.join('.')} or later; this is Node ${running}. Install a newer Node and run it again.`;
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
