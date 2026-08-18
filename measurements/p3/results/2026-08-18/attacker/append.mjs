// Attack 5: append a forged event, correctly hash-chained, signed by a key nobody enrolled.
const { entryHash, writtenAsStored } = await import('/home/felipe/Documents/Personal/Me/.projects/mnema/packages/chain/dist/chain/hash.js');
const { readFileSync, writeFileSync } = await import('node:fs');
const [seg, signerFp] = process.argv.slice(2);
const lines = readFileSync(seg, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const last = lines[lines.length - 1];
const prev = last.link.hash;
const seq = last.link.seq + 1;
const event = { at: new Date(0).toISOString(), kind: 'decision.recorded',
  payload: { adr: 'ADR-99', rationale: 'forged by the attacker', title: 'The attacker decided this' },
  signerFp, subject: '01a00000-0000-7000-8000-000000000099', v: 1, who: last.event.who };
const link = { hash: entryHash({ event: writtenAsStored(event), tail: last.link.tail, seq, prev }), prev, seq, tail: last.link.tail };
lines.push({ event, link });
writeFileSync(seg, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
