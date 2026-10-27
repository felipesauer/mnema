// `node build/prepare.mjs`: writes the pages the site renders, from the tree, before `astro build`.
import { prepare } from './the-build.mjs';

const facts = await prepare();
console.log(`prepared the site pages for ${facts.version} at ${facts.sha.slice(0, 12)}`);
