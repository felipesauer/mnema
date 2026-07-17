import { createHash } from 'node:crypto';

import {
  ContentInfo,
  EncapsulatedContent,
  EncapsulatedContentInfo,
  id_signedData,
  SignedData,
  SignerInfos,
} from '@peculiar/asn1-cms';
import { AsnConvert, OctetString } from '@peculiar/asn1-schema';
import {
  id_ct_tstInfo,
  MessageImprint,
  PKIStatusInfo,
  TimeStampResp,
  TSTInfo,
  TSTInfoVersion,
} from '@peculiar/asn1-tsp';
import { AlgorithmIdentifier } from '@peculiar/asn1-x509';
import { describe, expect, it } from 'vitest';

import {
  Rfc3161AnchorProvider,
  type TsaClient,
} from '@/services/anchor/rfc3161-anchor-provider.js';

const SHA256_OID = '2.16.840.1.101.3.4.2.1';
const head = 'a'.repeat(64);

/** SHA-256 of a head hex string's bytes — mirrors the provider's imprint. */
function digest(h: string): Buffer {
  return createHash('sha256').update(h, 'utf-8').digest();
}

/**
 * Builds a genuine RFC-3161 `TimeStampResp` (DER) whose token imprints
 * `imprintDigest`, so the provider's real parse path is exercised — no byte
 * stubbing. `status` defaults to granted(0); pass a rejection to model a
 * refusing TSA. The token is a CMS ContentInfo(SignedData) with the TSTInfo
 * in the encapsulated content, exactly what a real TSA returns.
 */
function makeResponse(
  opts: { imprintDigest?: Buffer; status?: number; hashOid?: string } = {},
): ArrayBuffer {
  const status = opts.status ?? 0;
  const resp = new TimeStampResp({ status: new PKIStatusInfo({ status }) });

  if (status === 0 || status === 1) {
    const tstInfo = new TSTInfo({
      version: TSTInfoVersion.v1,
      policy: '1.2.3.4.5',
      messageImprint: new MessageImprint({
        hashAlgorithm: new AlgorithmIdentifier({ algorithm: opts.hashOid ?? SHA256_OID }),
        hashedMessage: new OctetString(opts.imprintDigest ?? digest(head)),
      }),
      serialNumber: new Uint8Array([1]).buffer,
      genTime: new Date('2026-07-09T00:00:00Z'),
    });
    const signedData = new SignedData({
      version: 3,
      encapContentInfo: new EncapsulatedContentInfo({
        eContentType: id_ct_tstInfo,
        eContent: new EncapsulatedContent({
          single: new OctetString(AsnConvert.serialize(tstInfo)),
        }),
      }),
      signerInfos: new SignerInfos(),
    });
    resp.timeStampToken = new ContentInfo({
      contentType: id_signedData,
      content: AsnConvert.serialize(signedData),
    });
  }
  return AsnConvert.serialize(resp);
}

/** A TsaClient that returns a canned response body, no network. */
function clientReturning(body: ArrayBuffer): TsaClient {
  return async () => ({ reached: true, body });
}

/** A TsaClient that models an unreachable TSA. */
const unreachableClient: TsaClient = async () => ({
  reached: false,
  reason: 'getaddrinfo ENOTFOUND tsa.example',
});

const TSA = 'https://tsa.example/tsr';

describe('Rfc3161AnchorProvider', () => {
  it('stamps a token that then verifies as anchored against the same head', async () => {
    const provider = new Rfc3161AnchorProvider(TSA, clientReturning(makeResponse()));

    const receipt = await provider.stamp(head);
    expect(receipt.status).toBe('anchored');
    expect(receipt.provider).toBe('rfc3161');
    expect(receipt.blob.length).toBeGreaterThan(0);

    const result = await provider.verify(head, receipt);
    expect(result.state).toBe('anchored');
  });

  it('verify() is broken when the token imprints a different head', async () => {
    const provider = new Rfc3161AnchorProvider(TSA, clientReturning(makeResponse()));
    const receipt = await provider.stamp(head);

    const result = await provider.verify('b'.repeat(64), receipt);
    expect(result.state).toBe('broken');
    expect(result.detail).toMatch(/does not imprint this head/i);
  });

  it('is fail-open (pending, no token) when the TSA is unreachable', async () => {
    const provider = new Rfc3161AnchorProvider(TSA, unreachableClient);
    const receipt = await provider.stamp(head);
    expect(receipt.status).toBe('pending');
    expect(receipt.blob).toBe('');
  });

  it('is fail-open (pending) when the TSA refuses the request', async () => {
    // status 2 = rejection; no timeStampToken present.
    const provider = new Rfc3161AnchorProvider(TSA, clientReturning(makeResponse({ status: 2 })));
    const receipt = await provider.stamp(head);
    expect(receipt.status).toBe('pending');
    expect(receipt.blob).toBe('');
  });

  it('verify() reports pending for a receipt with no token yet', async () => {
    const provider = new Rfc3161AnchorProvider(TSA, unreachableClient);
    const receipt = { provider: 'rfc3161', head, blob: '', status: 'pending' as const };
    const result = await provider.verify(head, receipt);
    expect(result.state).toBe('pending');
  });

  it('verify() is cannot-verify (not broken) for a structurally unreadable token', async () => {
    const provider = new Rfc3161AnchorProvider(TSA);
    const receipt = {
      provider: 'rfc3161',
      head,
      blob: Buffer.from('not a DER token').toString('base64'),
      status: 'anchored' as const,
    };
    const result = await provider.verify(head, receipt);
    expect(result.state).toBe('cannot-verify');
    expect(result.detail).toMatch(/could not be parsed/i);
  });

  it('verify() does not throw for a receipt with a null blob (legacy/roundtripped record)', async () => {
    const provider = new Rfc3161AnchorProvider(TSA);
    // A record where blob came back null (e.g. a JSON roundtrip) must not
    // crash verify — the interface forbids throwing.
    const receipt = {
      provider: 'rfc3161',
      head,
      blob: null as unknown as string,
      status: 'pending' as const,
    };
    const result = await provider.verify(head, receipt);
    expect(result.state).toBe('pending');
  });

  it('verify() is cannot-verify when the token used a non-SHA-256 imprint algorithm', async () => {
    // A token whose imprint is 32 bytes but computed with a different algorithm
    // must not be compared byte-for-byte against our SHA-256 digest.
    const sha512Oid = '2.16.840.1.101.3.4.2.3';
    const provider = new Rfc3161AnchorProvider(
      TSA,
      clientReturning(makeResponse({ hashOid: sha512Oid })),
    );
    const receipt = await provider.stamp(head);
    const result = await provider.verify(head, receipt);
    expect(result.state).toBe('cannot-verify');
  });

  it('verify() is broken when the receipt is for another provider', async () => {
    const provider = new Rfc3161AnchorProvider(TSA);
    const receipt = {
      provider: 'git-signed',
      head,
      blob: 'x',
      status: 'anchored' as const,
    };
    expect((await provider.verify(head, receipt)).state).toBe('broken');
  });

  it('offline verify of an already-stamped token still works (token is self-contained)', async () => {
    // Stamp with a client, then verify with a provider that has NO client
    // configured for network — the token alone must verify.
    const stamped = await new Rfc3161AnchorProvider(TSA, clientReturning(makeResponse())).stamp(
      head,
    );
    const offline = new Rfc3161AnchorProvider(TSA);
    expect((await offline.verify(head, stamped)).state).toBe('anchored');
  });
});
