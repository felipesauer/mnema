// Attack 6: generate a real key, forge its enrolment with a VALID reverse signature, sign with it.
const K = await import('/home/felipe/Documents/Personal/Me/.projects/mnema/packages/chain/dist/chain/keys.js');
const { entryHash, writtenAsStored } = await import('/home/felipe/Documents/Personal/Me/.projects/mnema/packages/chain/dist/chain/hash.js');
const { readFileSync, writeFileSync } = await import('node:fs');
const seg = process.argv[2];
const lines = readFileSync(seg, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const last = lines[lines.length - 1];
const who = last.event.who;
const pair = K.generateKeyPair();
const newFp = K.fingerprintOf(pair.publicKey);
const reverseSig = Buffer.from(K.sign(new TextEncoder().encode(`enroll:${who}:${newFp}`), pair.privateKey)).toString('hex');
const mk = (event) => {
  const tip = lines[lines.length - 1];
  const prev = tip.link.hash, seq = tip.link.seq + 1;
  const link = { hash: entryHash({ event: writtenAsStored(event), tail: tip.link.tail, seq, prev }), prev, seq, tail: tip.link.tail };
  lines.push({ event, link });
};
mk({ at: new Date(0).toISOString(), kind: 'key.enrolled', payload: { newFp, reverseSig }, signerFp: newFp, subject: who, v: 1, who });
mk({ at: new Date(0).toISOString(), kind: 'decision.recorded',
  payload: { adr: 'ADR-99', rationale: 'forged by the attacker', title: 'The attacker decided this' },
  signerFp: newFp, subject: '01a00000-0000-7000-8000-000000000099', v: 1, who });
writeFileSync(seg, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
