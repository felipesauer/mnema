/**
 * What a write MEETS: the one decision every host's hook asks before a file is written — a
 * refusal, a pause for a person, or nothing.
 *
 * Two relations of the record can stop a write, and they are two powers: `asks-for-a-person`
 * holds it until somebody decides, `refuses-a-write` does not let it happen. Where both apply
 * — at one path, or at two paths of one write — the refusal is what the write meets, and that
 * is decided in ONE function (`what-a-write-meets.ts`) so a host cannot ask where another
 * refuses for the same file. These cases drive that function over a project the command line
 * built, through the assembly the process-hook door uses (`withScopedCaches`), so the switches
 * and the rules are read from a real record rather than a fixture.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { whatAWriteAsks } from '../src/edit-asks-a-person.js';
import { ourWordsInRefusing } from '../src/edit-refuses-a-write.js';
import { tellsWhatToDo } from '../src/record-framing.js';
import { withScopedCaches } from '../src/tree-sources.js';
import { type WriteVerdict, whatAWriteMeets } from '../src/what-a-write-meets.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;

interface Said {
  readonly out: string[];
  readonly err: string[];
  readonly failed: boolean;
}

async function mnema(...argv: string[]): Promise<Said> {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fail: () => {
      failed = true;
    },
  };
  await run(argv, io);
  return { out, err, failed };
}

async function did(...argv: string[]): Promise<Said> {
  const said = await mnema(...argv);
  expect(said.failed, `mnema ${argv.join(' ')}: ${said.err.join(' / ')}`).toBe(false);
  return said;
}

function idIn(said: Said): string {
  const id = said.out.join('\n').match(/\(([0-9a-f-]{20,})\)/)?.[1];
  if (id === undefined) throw new Error(`setup: no id in ${said.out.join(' / ')}`);
  return id;
}

/** A decision in force, linked to `path` under `rel`. */
async function ruleAt(title: string, path: string, rel: string): Promise<string> {
  const id = idIn(await did('decision', 'record', title, `why ${title}`));
  await did('decision', 'move', 'accept', id, '--note', 'agreed');
  await did('link', id, path, '--rel', rel);
  return id;
}

/** What one write touching `paths` meets, over this project's record as it stands. */
function meets(...paths: string[]): WriteVerdict | undefined {
  return withScopedCaches(resolveTrees(repo, env), (sources) =>
    whatAWriteMeets(sources, { paths, root: repo, from: repo }),
  );
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-meets-'));
  repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'src', 'ledger'), { recursive: true });
  mkdirSync(join(repo, 'src', 'billing'), { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  originalXdg = process.env.XDG_DATA_HOME;
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  env = { home: join(sandbox, 'home') };
  process.chdir(repo);
  await did('init');
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('a rule that refuses a write', () => {
  it('refuses the write, citing the rule by id and saying where it opens', async () => {
    const rule = await ruleAt('Nobody writes the ledger by hand', 'src/ledger', 'refuses-a-write');

    const verdict = meets('src/ledger/posting.ts');
    expect(verdict?.grade).toBe('refuse');
    expect(verdict?.at.map((at) => at.relative)).toEqual(['src/ledger/posting.ts']);
    expect(verdict?.at[0]?.rules.map((one) => one.id)).toEqual([rule]);
    const reason = verdict?.reason ?? '';
    expect(reason).toContain(rule);
    expect(reason).toContain('“Nobody writes the ledger by hand” — refuses a write at src/ledger');
    expect(reason).toContain(`mnema show ${rule}`);
    expect(reason).toContain('whoever recorded it');
  });

  it('meets nothing where no rule addresses the path', async () => {
    await ruleAt('Nobody writes the ledger by hand', 'src/ledger', 'refuses-a-write');
    expect(meets('src/billing/invoice.ts')).toBeUndefined();
    // A sibling whose name merely starts the same is not under the address.
    expect(meets('src/ledger-notes.md')).toBeUndefined();
  });

  it('stops refusing when the rule is no longer in force', async () => {
    const first = await ruleAt('Nobody writes the ledger by hand', 'src/ledger', 'refuses-a-write');
    const second = idIn(await did('decision', 'record', 'The posting job writes it', 'why'));
    await did('decision', 'move', 'accept', second, '--note', 'agreed');
    await did('decision', 'supersede', first, second, '--reason', 'moved on');

    expect(meets('src/ledger/posting.ts')).toBeUndefined();
  });

  it('is not a rule that only governs or only asks: those keep their own meaning', async () => {
    await ruleAt('How the ledger is laid out', 'src/ledger', 'governs');
    expect(meets('src/ledger/posting.ts')).toBeUndefined();
  });
});

describe('where a refusal and a pause for a person meet, the refusal wins — decided here', () => {
  it('refuses at a path where one rule refuses and another asks', async () => {
    const refusing = await ruleAt('Nobody writes the ledger', 'src/ledger', 'refuses-a-write');
    const asking = await ruleAt('Somebody looks at source', 'src', 'asks-for-a-person');

    const verdict = meets('src/ledger/posting.ts');
    expect(verdict?.grade).toBe('refuse');
    // Only the refusal is carried: no person is asked about a write that will not happen, so
    // nothing here may later be recorded as an asking.
    expect(verdict?.at.flatMap((at) => at.rules.map((one) => one.id))).toEqual([refusing]);
    expect(verdict?.reason).not.toContain(asking);
    expect(verdict?.reason).not.toContain('asks that a person look');
  });

  it('refuses the whole write when one of its paths is refused and another only asks', async () => {
    const refusing = await ruleAt('Nobody writes the ledger', 'src/ledger', 'refuses-a-write');
    await ruleAt('Somebody looks at billing', 'src/billing', 'asks-for-a-person');

    const verdict = meets('src/billing/invoice.ts', 'src/ledger/posting.ts');
    expect(verdict?.grade).toBe('refuse');
    expect(verdict?.at.map((at) => at.relative)).toEqual(['src/ledger/posting.ts']);
    expect(verdict?.at[0]?.rules.map((one) => one.id)).toEqual([refusing]);
  });

  it('asks, with the asking’s own words, where nothing refuses', async () => {
    await ruleAt('Somebody looks at billing', 'src/billing', 'asks-for-a-person');

    const verdict = meets('src/billing/invoice.ts');
    expect(verdict?.grade).toBe('ask');
    // The same text the asking doors already send — this decision adds a grade above the
    // asking and changes nothing below it.
    const asked = withScopedCaches(resolveTrees(repo, env), (sources) =>
      whatAWriteAsks(sources, { path: 'src/billing/invoice.ts', root: repo, from: repo }),
    );
    expect(verdict?.reason).toBe(asked?.notice);
  });
});

describe('the switch is read before a refusal is decided', () => {
  it('lets the write through when the refusal is switched off, and refuses again when on', async () => {
    await ruleAt('Nobody writes the ledger', 'src/ledger', 'refuses-a-write');
    expect(meets('src/ledger/posting.ts')?.grade).toBe('refuse');

    await did('switch', 'off', 'edit-refuses-a-write', '--reason', 'porting the ledger');
    expect(meets('src/ledger/posting.ts')).toBeUndefined();

    await did('switch', 'on', 'edit-refuses-a-write');
    expect(meets('src/ledger/posting.ts')?.grade).toBe('refuse');
  });

  it('falls to the pause for a person, not to nothing, when only the refusal is off', async () => {
    await ruleAt('Nobody writes the ledger', 'src/ledger', 'refuses-a-write');
    await ruleAt('Somebody looks at source', 'src', 'asks-for-a-person');
    await did('switch', 'off', 'edit-refuses-a-write');

    expect(meets('src/ledger/posting.ts')?.grade).toBe('ask');
  });

  it('keeps refusing when only the pause for a person is off', async () => {
    await ruleAt('Nobody writes the ledger', 'src/ledger', 'refuses-a-write');
    await did('switch', 'off', 'edit-asks-a-person');

    expect(meets('src/ledger/posting.ts')?.grade).toBe('refuse');
  });
});

describe('what the refusal says is what the record says', () => {
  it('says whose text it is and what is refused, and never what to do about it', async () => {
    await ruleAt('Nobody writes the ledger', 'src/ledger', 'refuses-a-write');
    const verdict = meets('src/ledger/posting.ts');
    const at = verdict?.at[0];
    if (at === undefined) throw new Error('setup: nothing refused');
    const ours = ourWordsInRefusing(at);
    // Non-vacuity: the framing, the sentence, and the way to the rule are all in it.
    expect(ours.length).toBeGreaterThanOrEqual(3);
    for (const line of ours) expect(verdict?.reason).toContain(line);
    expect(ours.map(tellsWhatToDo).filter((word) => word !== undefined)).toEqual([]);
  });

  it('keeps a rule name holding a newline on one line', async () => {
    await ruleAt('Nobody writes\nthe ledger', 'src/ledger', 'refuses-a-write');
    const reason = meets('src/ledger/posting.ts')?.reason ?? '';
    const lines = reason.split('\n');
    // The framing, the sentence, ONE rule line, and the way to the rule: a fifth line would be
    // the second half of the name, read as a rule this project never made.
    expect(lines).toHaveLength(4);
    const line = lines.find((one) => one.includes('— refuses a write at src/ledger'));
    expect(line).toBeDefined();
    expect(line).toContain('Nobody writes');
    expect(line).toContain('the ledger');
  });
});

describe('a link does not step around a rule', () => {
  it('refuses a write through a link to a protected file, and still refuses the direct path', async () => {
    const rule = await ruleAt('Nobody writes the ledger by hand', 'src/ledger', 'refuses-a-write');
    writeFileSync(join(repo, 'src', 'ledger', 'posting.ts'), 'x');
    symlinkSync(
      join(repo, 'src', 'ledger', 'posting.ts'),
      join(repo, 'src', 'billing', 'alias.ts'),
    );

    const direct = meets('src/ledger/posting.ts');
    const linked = meets('src/billing/alias.ts');
    expect(direct?.grade).toBe('refuse');
    expect(linked?.grade).toBe('refuse');
    expect(linked?.at.flatMap((at) => at.rules.map((one) => one.id))).toEqual([rule]);
    expect(linked?.at.map((at) => at.relative)).toEqual(['src/ledger/posting.ts']);
  });

  it('refuses a new file inside a directory that is a link to a protected one', async () => {
    await ruleAt('Nobody writes the ledger by hand', 'src/ledger', 'refuses-a-write');
    symlinkSync(join(repo, 'src', 'ledger'), join(repo, 'src', 'billing', 'books'));

    expect(meets('src/billing/books/brand-new/deep.ts')?.grade).toBe('refuse');
  });

  it('asks for a person through a link, and a refusal still outranks the asking', async () => {
    await ruleAt('Look at the ledger', 'src/ledger', 'asks-for-a-person');
    symlinkSync(join(repo, 'src', 'ledger'), join(repo, 'src', 'billing', 'books'));
    expect(meets('src/billing/books/posting.ts')?.grade).toBe('ask');

    await ruleAt('Nobody writes the ledger by hand', 'src/ledger', 'refuses-a-write');
    expect(meets('src/billing/books/posting.ts')?.grade).toBe('refuse');
  });

  it('refuses a write through a dangling link whose target would be created inside a protected directory', async () => {
    await ruleAt('Nobody writes the ledger by hand', 'src/ledger', 'refuses-a-write');
    symlinkSync(join(repo, 'src', 'ledger', 'new.ts'), join(repo, 'src', 'billing', 'dangling.ts'));
    symlinkSync('../ledger/later.ts', join(repo, 'src', 'billing', 'relative.ts'));

    expect(meets('src/billing/dangling.ts')?.grade).toBe('refuse');
    expect(meets('src/billing/relative.ts')?.grade).toBe('refuse');
  });

  it('meets nothing through a link that leaves the project, whatever it points at', async () => {
    await ruleAt('Nobody writes the ledger by hand', 'src/ledger', 'refuses-a-write');
    const outside = join(sandbox, 'outside');
    mkdirSync(join(outside, 'src', 'ledger'), { recursive: true });
    symlinkSync(join(outside, 'src', 'ledger'), join(repo, 'src', 'billing', 'away'));

    expect(meets('src/billing/away/posting.ts')).toBeUndefined();
  });
});
