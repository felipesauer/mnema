import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THE_BLOCKS } from '../../code/src/presentation/banner.js';
import { drawIconFont } from '../build/icon-font.mjs';

const CHECK = new URL('../build/check-the-vsix.mjs', import.meta.url).pathname;

/** Packs a file with only the parts the check reads of the status bar's font, and runs the check on it. */
function check(font: Buffer | undefined, fontCharacter = '\\E000'): string {
  const dir = mkdtempSync(join(tmpdir(), 'vsix-font-'));
  try {
    mkdirSync(join(dir, 'extension/media'), { recursive: true });
    writeFileSync(
      join(dir, 'extension/package.json'),
      JSON.stringify({
        publisher: 'mnema',
        contributes: {
          viewsContainers: { activitybar: [{ icon: 'media/mnema.svg' }] },
          icons: {
            'mnema-m': {
              description: 'The mnema mark',
              default: { fontPath: 'media/mnema-icons.ttf', fontCharacter },
            },
          },
        },
      }),
    );
    writeFileSync(
      join(dir, 'extension/media/mnema.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M0 0h1v1h-1z"/></svg>',
    );
    if (font !== undefined) writeFileSync(join(dir, 'extension/media/mnema-icons.ttf'), font);
    writeFileSync(join(dir, 'extension.vsixmanifest'), '<Identity Publisher="mnema" />');
    const file = join(dir, 'a.vsix');
    const packed = spawnSync('zip', ['-q', '-r', file, 'extension', 'extension.vsixmanifest'], {
      cwd: dir,
    });
    expect(packed.status).toBe(0);
    return spawnSync(process.execPath, [CHECK, file], { encoding: 'utf8' }).stderr;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const good = drawIconFont(THE_BLOCKS);

/** The font with the tag of one table renamed, every offset intact: the table is "not there". */
const without = (tag: string): Buffer => {
  const font = Buffer.from(good);
  for (let i = 0; i < font.readUInt16BE(4); i++) {
    if (font.toString('latin1', 12 + 16 * i, 16 + 16 * i) === tag)
      font.write('XXXX', 12 + 16 * i, 'latin1');
  }
  return font;
};

describe('the vsix check refuses a font the editor would drop without a word', () => {
  it('lets the font the packer writes through', () => {
    expect(check(good)).not.toMatch(/font|table|TrueType|character/);
  });

  it.each(['OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post'])(
    'refuses a font with no %s table',
    (tag) => {
      expect(check(without(tag))).toContain(`has no ${tag} table`);
    },
  );

  it('refuses a file that is not TrueType, a font that is not in the file, and a character outside the private use area', () => {
    expect(check(Buffer.from('wOFF0000000000000000'))).toContain(
      'does not begin as a TrueType file',
    );
    expect(check(undefined)).toContain('the font media/mnema-icons.ttf is not in the file');
    expect(check(good, 'A')).toContain('is not a private-use escape');
  });
});
