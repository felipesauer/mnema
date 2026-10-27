import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CHECK = new URL('../build/check-the-vsix.mjs', import.meta.url).pathname;

/** Packs a file with only the parts the check reads of the container icon, and runs the check on it. */
function check(svg: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'vsix-check-'));
  try {
    mkdirSync(join(dir, 'extension/media'), { recursive: true });
    writeFileSync(
      join(dir, 'extension/package.json'),
      JSON.stringify({
        publisher: 'mnema',
        contributes: { viewsContainers: { activitybar: [{ icon: 'media/mnema.svg' }] } },
      }),
    );
    writeFileSync(join(dir, 'extension/media/mnema.svg'), svg);
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

const icon = (paint: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path ${paint} d="M0 0h1v1h-1z"/></svg>`;

describe('the vsix check refuses a paint the editor did not give', () => {
  it.each([
    'fill="red"',
    'fill="rgb(1,2,3)"',
    'fill="hsl(0 0% 0%)"',
    'fill="url(#g)"',
    'stroke="#fff"',
    "fill='blue'",
  ])('refuses %s', (paint) => {
    expect(check(icon(paint))).toContain('the container icon sets');
  });

  it.each(['fill="currentColor"', 'fill="none" stroke="currentColor"'])(
    'lets %s through',
    (paint) => {
      expect(check(icon(paint))).not.toContain('the container icon sets');
    },
  );
});
