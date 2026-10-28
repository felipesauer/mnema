/**
 * What a store reads of a `.vsix`, read from the file itself: `node build/check-the-vsix.mjs <file>`.
 *
 * It opens the packed file (with the system `unzip`, which a runner has) and fails unless the
 * manifest inside is the one a store takes: published by `mnema`, not `private`, with its icon, its
 * changelog and its readme in the file, the icon a 128 by 128 PNG, and the side bar's icon the
 * monochrome SVG the manifest names and the status bar's icon font a real TrueType file with the
 * tables a browser sanitizer asks for. It needs no token and sends
 * nothing: it is the proof, before any store is asked, that the file is acceptable as it stands.
 */

import { execFileSync } from 'node:child_process';

const file = process.argv[2];
if (!file) throw new Error('usage: node check-the-vsix.mjs <file.vsix>');

const read = (inside) =>
  execFileSync('unzip', ['-p', file, inside], { maxBuffer: 16 * 1024 * 1024 });

const manifest = JSON.parse(read('extension/package.json').toString('utf8'));
const listing = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).split('\n');

const refusals = [];
if (manifest.publisher !== 'mnema') refusals.push(`publisher is ${manifest.publisher}, not mnema`);
if ('private' in manifest) refusals.push('the manifest is still private');
if (manifest.preview !== true) refusals.push('the manifest is not marked preview');
if (!Array.isArray(manifest.categories) || manifest.categories.length === 0)
  refusals.push('no category');
if (/not published/i.test(manifest.description ?? '')) refusals.push('the description says it is not published');
for (const inside of ['extension/icon.png', 'extension/changelog.md', 'extension/readme.md', 'extension/extension.cjs']) {
  if (!listing.includes(inside)) refusals.push(`${inside} is not in the file`);
}
if (listing.includes('extension/icon.png')) {
  const icon = read('extension/icon.png');
  const isPng = icon.subarray(1, 4).toString('latin1') === 'PNG';
  if (!isPng || icon.readUInt32BE(16) < 128 || icon.readUInt32BE(20) < 128)
    refusals.push('the icon is not a PNG of at least 128 by 128');
}
// The side bar's icon is what the manifest names, in the file: a monochrome SVG the editor paints
// with its own colour, with nothing in it that runs, loads or sets a colour of its own.
const container = manifest.contributes?.viewsContainers?.activitybar?.[0];
if (container === undefined) refusals.push('the manifest holds no container for the activity bar');
else {
  const inside = `extension/${container.icon}`;
  if (!listing.includes(inside)) refusals.push(`${inside}, the icon of the container, is not in the file`);
  else {
    const svg = read(inside).toString('utf8');
    if (!/viewBox="0 0 24 24"/.test(svg)) refusals.push('the container icon has no 24 by 24 viewBox');
    if (/<script|<image|href|style/i.test(svg))
      refusals.push('the container icon holds a script, an image, a link or a style');
    // Any paint the icon sets is the editor's own colour or none: a name, a function or a hex is refused.
    for (const [, name, value] of svg.matchAll(/\b(fill|stroke)\s*=\s*["']([^"']*)["']/gi)) {
      if (!['currentcolor', 'none'].includes(value.trim().toLowerCase()))
        refusals.push(`the container icon sets ${name}="${value}", not currentColor or none`);
    }
  }
}
// The status bar's M is a glyph of a font the manifest names: the file is in the vsix, is TrueType, and
// holds the tables the editor's sanitizer asks of a web font (one it refuses draws nothing, silently).
const FONT_TABLES = ['OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post'];
const icons = Object.entries(manifest.contributes?.icons ?? {});
if (icons.length === 0) refusals.push('the manifest names no icon font in contributes.icons');
for (const [id, icon] of icons) {
  const fontPath = icon?.default?.fontPath;
  const inside = `extension/${fontPath}`;
  if (typeof fontPath !== 'string' || !listing.includes(inside)) {
    refusals.push(`${id}: the font ${fontPath} is not in the file`);
    continue;
  }
  const font = read(inside);
  if (font.length < 12 || font.readUInt32BE(0) !== 0x00010000) {
    refusals.push(`${id}: ${fontPath} does not begin as a TrueType file`);
    continue;
  }
  const found = new Set();
  for (let i = 0; i < font.readUInt16BE(4); i++) found.add(font.toString('latin1', 12 + 16 * i, 16 + 16 * i));
  for (const table of FONT_TABLES)
    if (!found.has(table)) refusals.push(`${id}: ${fontPath} has no ${table} table`);
  // A table whose bytes do not sum to the checksum its record carries, or a file that does not sum to
  // 0xB1B0AFBA once `checkSumAdjustment` is in, is damaged: the editor's sanitizer drops it and draws a square.
  const sum = (bytes, skip = -1) => {
    let total = 0;
    for (let at = 0; at < bytes.length; at += 4) {
      let word = 0;
      for (let k = 0; k < 4; k++) word = word * 256 + (at + k < bytes.length && at !== skip ? bytes[at + k] : 0);
      total = (total + word) % 0x100000000;
    }
    return total;
  };
  for (let i = 0; i < font.readUInt16BE(4); i++) {
    const at = 12 + 16 * i;
    const tag = font.toString('latin1', at, at + 4);
    const start = font.readUInt32BE(at + 8);
    const length = font.readUInt32BE(at + 12);
    if (start + length > font.length) {
      refusals.push(`${id}: ${fontPath} has a ${tag} table that runs past the end of the file`);
      continue;
    }
    const bytes = font.subarray(start, start + length);
    if (sum(bytes, tag === 'head' ? 8 : -1) !== font.readUInt32BE(at + 4))
      refusals.push(`${id}: ${fontPath} has a ${tag} table whose checksum does not match its bytes`);
  }
  if (sum(font) !== 0xb1b0afba)
    refusals.push(`${id}: ${fontPath} does not sum to 0xB1B0AFBA, its checkSumAdjustment is wrong`);
  if (!/^\\E[0-9A-F]{3}$/i.test(icon.default.fontCharacter ?? ''))
    refusals.push(`${id}: the character ${icon.default.fontCharacter} is not a private-use escape`);
}
const identity = read('extension.vsixmanifest').toString('utf8').match(/<Identity [^>]*>/)?.[0] ?? '';
if (!/Publisher="mnema"/.test(identity)) refusals.push(`the vsix manifest says ${identity}`);

if (refusals.length > 0) {
  for (const refusal of refusals) console.error(`refused: ${refusal}`);
  process.exit(1);
}
console.log(`${file}: mnema.${manifest.name ?? 'mnema'} ${manifest.version} is what a store takes.`);
