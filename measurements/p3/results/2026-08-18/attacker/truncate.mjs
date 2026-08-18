// Attacks 9 and 10: truncate to a consistent prefix — on an append-only chain, a rollback is this.
const { readFileSync, writeFileSync } = await import('node:fs');
const [seg, cps] = process.argv.slice(2);
writeFileSync(seg, readFileSync(seg, 'utf-8').split('\n').filter(Boolean).slice(0, 6).join('\n') + '\n');
writeFileSync(cps, readFileSync(cps, 'utf-8').split('\n').filter(Boolean)
  .filter((l) => (JSON.parse(l).fromSeq ?? 0) < 6).join('\n') + '\n');
