/**
 * Real bytes from the two worlds this layer has to meet, kept as vectors.
 *
 * They are CAPTURED, not constructed, and that is the whole reason they exist. A
 * test that builds an OpenTimestamps proof with this package's own writer and then
 * reads it back with this package's own reader proves the two agree with each other
 * and nothing about whether either agrees with the format — and the format is
 * somebody else's, which is the point of choosing it. The same goes for the block
 * header: a header this package fabricated would meet whatever rule this package
 * happened to implement.
 *
 * So: one answer from the public calendars, and one header off the Bitcoin chain,
 * both written down with where they came from and when. The pattern follows
 * `events/vectors.ts`, which is where this codebase already keeps the bytes a
 * derivation must reproduce rather than merely be consistent about.
 */

/**
 * A real detached proof: what the calendars answered on 2026-08-23T05:44:31Z when
 * asked to attest the digest below.
 *
 * It is INCOMPLETE by nature — three calendars promising to aggregate it — which is
 * exactly the state `pending` exists for, and the state every proof is in for its
 * first hour of life.
 */
export const PENDING_PROOF_BASE64 =
  'AE9wZW5UaW1lc3RhbXBzAABQcm9vZgC/ieLohOiSlAEI+EOWRicTpf0f79OgQ83bLu2BwA9f6thvBHS/qlUcQuL/8BBe16oQG8Z0zlfaq0z+pgzWCPAIVAI3dmnxCOYI8BBNI+IG57DaDO6Dp2o0vlrUCPAgOcbOL9i6G6KwKZ20NPaB7xC34ZB/6xA5fRxHxrxvcAcI8SBwRQS7Q/Vh3q5zSBjdXZmZ87fyuRpsoejZYl8ZCk1uPAjxBGqKiL3wCE2SIkrw2j0gAIPf4w0u+QyOLi1odHRwczovL2FsaWNlLmJ0Yy5jYWxlbmRhci5vcGVudGltZXN0YW1wcy5vcmf/8BAj0Hr3zJFVbNaTXlEPXI+gCPAI0miVNQKuZJYI8BDvGmt8UmCad9yW3w8TPv0PCPAgC6QLa2lWBwK19SjdrXK5sCw7v5aLNKPMAO3L124ZWZsI8SBxvF7tuj+cquBthjS+kjBkgVlXAs6r1W8S0j3IP1hoMAjxBGqKiL7wCIxQhWkhbIr9AIPf4w0u+QyOLCtodHRwczovL2JvYi5idGMuY2FsZW5kYXIub3BlbnRpbWVzdGFtcHMub3Jn8BCBPQXkns2S54NoPMF1hpH2CPAQwX7XwbKMnH7zUfjkoh3PTQjwILWXMGrU0oUeDvhAxXMBXkAR2Hr4dsM1ltA3A+0HYZPVCPEgh6JPyeCK6/I7CJK8fzZ//rpr/sPA3YZlHOt0A/kT7goI8QRqioi/8AiOnjfefeC+1QCD3+MNLvkMjiMiaHR0cHM6Ly9idGMuY2FsZW5kYXIuY2F0YWxsYXh5LmNvbQ==';

/**
 * The digest {@link PENDING_PROOF_BASE64} is over: the SHA-256 of the signed message
 * of the third checkpoint of a real record founded for the purpose.
 *
 * A checkpoint digest and nothing else — which is the claim this layer makes about
 * what leaves the machine, written down here as a value anybody can check against
 * the proof's own bytes.
 */
export const PENDING_PROOF_DIGEST =
  'f84396462713a5fd1fefd3a043cddb2eed81c00f5fead86f0474bfaa551c42e2';

/** The calendars that answered, in the order the proof reaches them. */
export const PENDING_PROOF_CALENDARS: readonly string[] = [
  'https://alice.btc.calendar.opentimestamps.org',
  'https://bob.btc.calendar.opentimestamps.org',
  'https://btc.calendar.catallaxy.com',
];

/**
 * A real Bitcoin block header: block 800000, 80 bytes as it is serialized.
 *
 * Chosen because it is old, famous and trivially checkable from outside — it hashes
 * to `00000000000000000002a7c4c1e48d76c5a37902165a270156b7a8d72728a054`, which any
 * explorer will confirm, and it was mined at a difficulty far above this package's
 * floor.
 */
export const BLOCK_800000_HEADER =
  '00601d3455bb9fbd966b3ea2dc42d0c22722e4c0c1729fad17210100000000000000000055087fab0c8f3f89f8bcfd4df26c504d81b0a88e04907161838c0c53001af09135edbd64943805175e955e06';

/** What block 800000 hashes to, the way an explorer prints it. */
export const BLOCK_800000_ID = '00000000000000000002a7c4c1e48d76c5a37902165a270156b7a8d72728a054';

/** Block 800000's merkle root, in the INTERNAL byte order an attestation folds to. */
export const BLOCK_800000_MERKLE_ROOT =
  '55087fab0c8f3f89f8bcfd4df26c504d81b0a88e04907161838c0c53001af091';

/** The instant block 800000 claims, in seconds since the epoch. */
export const BLOCK_800000_TIME = 1690168629;

/** Its height, so no test spells the number twice. */
export const BLOCK_800000_HEIGHT = 800000;
