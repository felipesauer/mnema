// Attack 3: delete an event from the middle and re-chain seq and hashes.
const { entryHash, writtenAsStored } = await import('/home/felipe/Documents/Personal/Me/.projects/mnema/packages/chain/dist/chain/hash.js');
const { readFileSync, writeFileSync } = await import('node:fs');
const seg = process.argv[2];
const lines = readFileSync(seg, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
lines.splice(4, 1);
let prev = null, seq = 1;
for (const e of lines) {
  e.link.seq = seq++; e.link.prev = prev;
  e.link.hash = entryHash({ event: writtenAsStored(e.event), tail: e.link.tail, seq: e.link.seq, prev });
  prev = e.link.hash;
}
writeFileSync(seg, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
