// `node build/finish.mjs`: after `astro build`, adds what Astro does not make. /record/ is written by the
// binary of this commit with the head `theHeadOfTheRecord` hands it, and gets its line in the sitemap; `og.png` is the social card; `llms.txt` and `robots.txt` come from the same sources as the pages.
import { join } from 'node:path';
import { completeTheSitemap, ROOT, SITE, theFacts, theHeadOfTheRecord, writeTheCard, writeTheRest } from './the-build.mjs';
import { recordBackLink } from './the-pages.mjs';
import { writeTheRecord } from './the-record.mjs';

const out = join(SITE, 'dist');
console.log(
  writeTheRecord({
    root: ROOT,
    out: join(out, 'record'),
    backLink: recordBackLink(theFacts(ROOT)),
    head: theHeadOfTheRecord({ root: ROOT }),
  }).trimEnd(),
);
completeTheSitemap({ root: ROOT, out });
const card = await writeTheCard({ root: ROOT, out });
console.log(`wrote og.png, ${card.length} bytes`);
writeTheRest({ root: ROOT, out });
