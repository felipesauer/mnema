/**
 * What a store reads of a `.vsix`, read from the file itself: `node build/check-the-vsix.mjs <file>`.
 *
 * It opens the packed file (with the system `unzip`, which a runner has) and fails unless the
 * manifest inside is the one a store takes: published by `mnema`, not `private`, with its icon, its
 * changelog and its readme in the file, the icon a 128 by 128 PNG. It needs no token and sends
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
const identity = read('extension.vsixmanifest').toString('utf8').match(/<Identity [^>]*>/)?.[0] ?? '';
if (!/Publisher="mnema"/.test(identity)) refusals.push(`the vsix manifest says ${identity}`);

if (refusals.length > 0) {
  for (const refusal of refusals) console.error(`refused: ${refusal}`);
  process.exit(1);
}
console.log(`${file}: mnema.${manifest.name ?? 'mnema'} ${manifest.version} is what a store takes.`);
