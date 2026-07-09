import { createHash } from 'node:crypto';

import { ContentInfo, id_signedData, SignedData } from '@peculiar/asn1-cms';
import { AsnConvert, OctetString } from '@peculiar/asn1-schema';
import {
  MessageImprint,
  TimeStampReq,
  TimeStampReqVersion,
  TimeStampResp,
  TSTInfo,
} from '@peculiar/asn1-tsp';
import { AlgorithmIdentifier } from '@peculiar/asn1-x509';

import type { AnchorProvider, AnchorReceipt, AnchorVerifyResult } from './anchor-provider.js';

/** The registered name of the RFC-3161 TSA provider. */
export const RFC3161_PROVIDER = 'rfc3161';

/** OID of SHA-256 — the digest the head is imprinted with. */
const SHA256_OID = '2.16.840.1.101.3.4.2.1';

/**
 * `PKIStatus` values that mean the TSA issued a usable token. `granted` (0)
 * and `grantedWithMods` (1) both carry a `timeStampToken`; anything else is a
 * rejection with no token (RFC-3161 §2.4.2).
 */
const GRANTED_STATUSES = new Set([0, 1]);

/** MIME types for the RFC-3161 request/response bodies. */
const TSQ_CONTENT_TYPE = 'application/timestamp-query';

/** The outcome of one TSA round-trip. Injectable so tests avoid the network. */
export interface TsaResponse {
  /** Whether the TSA was reached and returned a body. */
  readonly reached: boolean;
  /** The raw DER response body (a `TimeStampResp`) when `reached`. */
  readonly body?: ArrayBuffer;
  /** Human-readable reason when `reached` is false. */
  readonly reason?: string;
}

/**
 * Posts a DER `TimeStampReq` to a TSA and returns the raw DER response.
 * Injectable (mirrors {@link GitCommandRunner}) so tests supply a canned
 * token and no real network is touched. The default uses global `fetch`.
 */
export type TsaClient = (tsaUrl: string, request: ArrayBuffer) => Promise<TsaResponse>;

const HTTP_TIMEOUT_MS = 15_000;

const defaultTsaClient: TsaClient = async (tsaUrl, request) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(tsaUrl, {
      method: 'POST',
      headers: { 'content-type': TSQ_CONTENT_TYPE },
      // Wrap in a Blob so the exact DER bytes are sent as a binary body
      // (a bare Uint8Array is not a BodyInit under this TS lib target).
      body: new Blob([request], { type: TSQ_CONTENT_TYPE }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { reached: false, reason: `TSA responded ${res.status} ${res.statusText}` };
    }
    return { reached: true, body: await res.arrayBuffer() };
  } catch (err) {
    // Unreachable / DNS / TLS / abort → fail-open (the caller records
    // `pending`, never `failed`-as-tampered).
    return { reached: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
};

/** SHA-256 of the head hex string's bytes (the imprint the TSA signs over). */
function headDigest(head: string): Buffer {
  return createHash('sha256').update(head, 'utf-8').digest();
}

/**
 * Anchors the head into an RFC-3161 timestamp token obtained from a
 * configured Time-Stamp Authority. `stamp` imprints SHA-256(head), POSTs a
 * `TimeStampReq`, and persists the returned `timeStampToken` (base64 DER) as
 * the receipt. `verify` re-parses that token OFFLINE — the token is
 * self-contained — and checks its `messageImprint` covers this head.
 *
 * Scope (ADR-37, advisory like the git-signed provider): `verify` confirms
 * the token IMPRINTS THIS HEAD. It does not validate the TSA's CMS signature
 * or certificate chain; the token is stored verbatim so a stricter offline
 * re-verification stays possible later. A hash mismatch is `broken`; a token
 * that cannot be parsed at all is `cannot-verify` (structurally unreadable,
 * distinct from a genuine mismatch); an unreachable TSA at stamp time is
 * fail-open (`pending`).
 */
export class Rfc3161AnchorProvider implements AnchorProvider {
  readonly name = RFC3161_PROVIDER;

  /**
   * @param tsaUrl - The TSA endpoint (https). Required by config for this
   *   provider; the schema already enforces https + presence.
   * @param client - Injectable TSA client (tests supply a canned token)
   */
  constructor(
    private readonly tsaUrl: string,
    private readonly client: TsaClient = defaultTsaClient,
  ) {}

  /** Builds a DER `TimeStampReq` imprinting SHA-256(head), certReq=true. */
  private buildRequest(head: string): ArrayBuffer {
    const req = new TimeStampReq({
      version: TimeStampReqVersion.v1,
      messageImprint: new MessageImprint({
        hashAlgorithm: new AlgorithmIdentifier({ algorithm: SHA256_OID }),
        hashedMessage: new OctetString(headDigest(head)),
      }),
      // Ask the TSA to embed its certificate so the token is self-contained
      // for a later, stricter verification without a separate cert lookup.
      certReq: true,
    });
    return AsnConvert.serialize(req);
  }

  async stamp(head: string): Promise<AnchorReceipt> {
    const response = await this.client(this.tsaUrl, this.buildRequest(head));
    if (!response.reached || response.body === undefined) {
      // Fail-open: the write already stood; a later retry can re-stamp.
      return { provider: this.name, head, blob: '', status: 'pending' };
    }

    let resp: TimeStampResp;
    try {
      resp = AsnConvert.parse(Buffer.from(response.body), TimeStampResp);
    } catch {
      // A body we cannot parse is treated as a failed attempt (fail-open,
      // retryable) rather than a crash on the off-hot-path scheduler.
      return {
        provider: this.name,
        head,
        blob: '',
        status: 'pending',
      };
    }

    const status = resp.status.status as number;
    if (!GRANTED_STATUSES.has(status) || resp.timeStampToken === undefined) {
      // The TSA refused (bad policy, rate limit, malformed request). Fail-open
      // and retryable — never a phantom "anchored".
      return { provider: this.name, head, blob: '', status: 'pending' };
    }

    // Persist the token (a CMS ContentInfo) verbatim as base64 DER.
    const tokenDer = AsnConvert.serialize(resp.timeStampToken);
    return {
      provider: this.name,
      head,
      blob: Buffer.from(tokenDer).toString('base64'),
      status: 'anchored',
    };
  }

  async verify(head: string, receipt: AnchorReceipt): Promise<AnchorVerifyResult> {
    if (receipt.provider !== this.name) {
      return { state: 'broken', detail: `receipt is for provider "${receipt.provider}"` };
    }
    // `verify` must never throw (interface contract). A receipt whose blob is
    // absent/empty (a pending stamp, or a legacy/JSON-roundtripped record with
    // a null blob) is `pending`, not a crash — guard before any `.length`.
    if (receipt.blob === undefined || receipt.blob === null || receipt.blob.length === 0) {
      return { state: 'pending', detail: 'no timestamp token yet (stamp pending)' };
    }

    const imprint = this.extractImprint(receipt.blob);
    if (imprint === null) {
      // The stored token is structurally unreadable — cannot attest, but this
      // is distinct from a genuine head mismatch (see `broken` below).
      return {
        state: 'cannot-verify',
        detail: 'timestamp token could not be parsed',
      };
    }

    const expected = headDigest(head);
    if (imprint.equals(expected)) {
      return { state: 'anchored', detail: `RFC-3161 token imprints this head` };
    }
    return {
      state: 'broken',
      detail: 'timestamp token does not imprint this head',
    };
  }

  /**
   * Unwraps a stored token (base64 DER of a CMS `ContentInfo`) down to the
   * `TSTInfo.messageImprint.hashedMessage`. Returns `null` for any structural
   * failure so the caller can report `cannot-verify` rather than throw.
   */
  private extractImprint(blobBase64: string): Buffer | null {
    try {
      const der = Buffer.from(blobBase64, 'base64');
      const contentInfo = AsnConvert.parse(der, ContentInfo);
      if (contentInfo.contentType !== id_signedData) return null;

      const signedData = AsnConvert.parse(contentInfo.content, SignedData);
      const eContent = signedData.encapContentInfo.eContent;
      const tstInfoDer = eContent?.single ?? eContent?.any;
      if (tstInfoDer === undefined) return null;

      const tstInfo = AsnConvert.parse(
        tstInfoDer instanceof OctetString ? tstInfoDer.buffer : tstInfoDer,
        TSTInfo,
      );
      // Only trust an imprint computed with the digest we compare against.
      // Without this, a token whose messageImprint used a different algorithm
      // but happens to be 32 bytes could be compared byte-for-byte against our
      // SHA-256 digest — a mismatch of meaning, not just of bytes.
      if (tstInfo.messageImprint.hashAlgorithm.algorithm !== SHA256_OID) return null;
      return Buffer.from(tstInfo.messageImprint.hashedMessage.buffer);
    } catch {
      return null;
    }
  }
}
