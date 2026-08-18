// Attack 2: edit an event's content, then repair every entry hash so T1 links cleanly.
const { entryHash, writtenAsStored } = await import('/home/felipe/Documents/Personal/Me/.projects/mnema/packages/chain/dist/chain/hash.js');
const { readFileSync, writeFileSync } = await import('node:fs');
const seg = process.argv[2];
const raw = readFileSync(seg, 'utf-8').split('\n').filter(Boolean);
const lines = raw.map((l) => JSON.parse(l.includes('Decision number 2') ? l.replace('Decision number 2', 'Decision number X') : l));
let prev = null;
for (const entry of lines) {
  entry.link.prev = prev;
  entry.link.hash = entryHash({ event: writtenAsStored(entry.event), tail: entry.link.tail, seq: entry.link.seq, prev });
  prev = entry.link.hash;
}
writeFileSync(seg, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
