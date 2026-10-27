// `node build/finish.mjs`: after `astro build`, adds what Astro does not make. /record/ is written by the
// binary of this commit; `llms.txt` and `robots.txt` come from the same sources as the pages.
import { join } from 'node:path';
import { ROOT, SITE, theFacts, writeTheRest } from './the-build.mjs';
import { recordBackLink } from './the-pages.mjs';
import { writeTheRecord } from './the-record.mjs';

const out = join(SITE, 'dist');
console.log(writeTheRecord({ root: ROOT, out: join(out, 'record'), backLink: recordBackLink(theFacts(ROOT)) }).trimEnd());
writeTheRest({ root: ROOT, out });
