/**
 * Operating an identity's roster: bringing a key in, and taking one out.
 *
 * The mechanisms these sit on already existed (`enrollKey` / `revokeKey` append
 * the facts and sign a checkpoint over them). What this adds is the part that
 * cannot live in a mechanism: the JUDGEMENT of whether the fact should exist at
 * all. An enrollment fact is append-only, so one whose proof does not check out
 * leaves the tree permanently failing verification, with no way to take it back,
 * and a revocation of the last key leaves an identity with nothing able to extend
 * its own history. Both are refused here, while refusing is still free.
 *
 * Every refusal below has the same shape of reason: it is cheaper than the state
 * it prevents. That is the whole argument for putting them ahead of the write.
 *
 * AHEAD OF THE WRITER TOO, and that is a second promise rather than the same one. They
 * used to run after the caller had OPENED the tree's writer, which appends nothing and
 * still touched the tree: for a key that never wrote there it materialized the key's
 * public half, minted an installation id and gave the tail a directory and a proof (all
 * but the id wait for the writer's first append now, and the id is still a file).
 * Measured on the binary, a refused `key enroll` left the tree with an untracked `.pub`
 * and an empty tail, and a refused `key revoke` the same. Both operations take a
 * {@link DecideThenWrite} now: handed a deferred context, they decide with the signer
 * and open the writer after their last refusal, so a refusal leaves the tree exactly
 * as it found it (`code/tests/a-refusal-leaves-nothing.test.ts`).
 */

import {
  type ChainSigner,
  catalogUpcasters,
  committedPublicKey,
  materializePublicKey,
} from '@mnema/chain';
import {
  type ScreenedWrite,
  type ScreenRefusal,
  screenContent,
  screened,
} from '../content/screen.js';
import { oneLine } from '../one-line.js';
import { orderedEvents } from '../projections/order.js';
import type { AppendRefusal } from '../workflow/append.js';
import {
  type Judged,
  onTheRecordAsItStands,
  type RecordAndWriter,
} from '../workflow/as-the-record-stands.js';
import {
  type AnchorDecision,
  decideAnchor,
  enrollAgent,
  enrollKey,
  retireAgent,
  revokeKey,
} from '../workflow/identity-operations.js';
import {
  type DecideThenWrite,
  openedContext,
  signerOfContext,
  type WriteContext,
} from '../workflow/operations.js';
import { agentNameRefusal } from './agent-name.js';
import { decodeAgentRequest, decodeKeyRequest } from './handshake.js';
import {
  agentKeysIn,
  membershipIn,
  provesAgentConsent,
  provesConsent,
  rosterByRole,
} from './membership.js';

/** What enrolling a requested key needs. */
export interface EnrollRequestInput {
  /** The request line the joining machine produced (see the handshake). */
  readonly request: string;
}

/** The key is a member of this machine's identity. */
export interface EnrollRequestOk {
  readonly ok: true;
  /** The joining key's fingerprint, derived from the key the request carried. */
  readonly fingerprint: string;
  /** The identity it now belongs to: this machine's own. */
  readonly anchor: string;
  /**
   * True when the record ALREADY proved this key a member, so nothing was
   * appended. Reported rather than treated as an error: the person asked for a
   * state that holds, and a second enrollment fact would say nothing new.
   */
  readonly alreadyMember: boolean;
}

/** Why a key was not enrolled. */
export type EnrollRequestErrorCode =
  /** The text is not a key request, or the key inside it cannot be read. */
  | 'MALFORMED_REQUEST'
  /** The request does not prove the key consented to join THIS identity. */
  | 'UNPROVEN_REQUEST'
  /** This machine's own key is not currently valid for its identity, so it cannot vouch. */
  | 'CANNOT_VOUCH'
  /** The key already holds the agent role in this identity: it cannot also join it. */
  | 'AN_AGENT_KEY'
  /** The material would have made a fact no read could accept; nothing was written. */
  | 'UNREADABLE_EVENT'
  /**
   * Never earned today: an enrollment carries no reason, so the door has nothing to ask of it.
   * It is here because the door's refusal is one type (`AppendRefusal`), forwarded as it comes.
   */
  | 'NOT_A_REASON'
  /** Never earned today either: an enrollment carries no title. Here for the same reason. */
  | 'NOT_A_TITLE'
  /** Never earned today either: an enrollment names no reference a caller typed. */
  | 'NOT_A_REFERENCE';

/** The enrollment was refused; nothing was written. */
export interface EnrollRequestErr {
  readonly ok: false;
  readonly code: EnrollRequestErrorCode;
  /** Plain-language reason, to be reported to the person as-is. */
  readonly message: string;
}

/**
 * Enrolls the key a request carries into THIS machine's identity: commits the
 * key's public half into the tree, then appends the vouch.
 *
 * The consent signature is checked against this machine's OWN anchor, never
 * against an anchor the request names. A request is made for one identity, and a
 * signature over `enroll:<other>:<fp>` is not consent to join this one: appending
 * it would leave the tree carrying an enrollment its own verifier rejects, for
 * good. So a request made for someone else is refused here, where refusing costs
 * nothing.
 *
 * The public half is materialized BEFORE the fact is appended, the same order a
 * tree's own founding uses: a crash between the two leaves a harmless committed
 * key with no event, while the reverse would leave an event whose proof is missing
 * from the disk it must be proven against.
 */
export function enrollFromRequest(
  ctx: DecideThenWrite,
  input: EnrollRequestInput,
): EnrollRequestOk | EnrollRequestErr {
  const request = decodeKeyRequest(input.request);
  if (request === null) {
    return {
      ok: false,
      code: 'MALFORMED_REQUEST',
      message:
        'that is not a key request: hand over the whole line the joining machine ' +
        'printed, unedited, with nothing added or trimmed',
    };
  }

  // WHO this machine is here, decided without writing, and without a writer: an
  // anchor already recorded, one the record proves it joined, or the anchor it is
  // about to found. Read again under the tail's lock if anything landed since
  // ({@link onTheRecordAsItStands}): a key retired a moment ago by another session can
  // no longer vouch, and a key enrolled a moment ago is a member already.
  const signer = signerOfContext(ctx);
  const fingerprint = request.key.fingerprint;
  const writing = writingOnce(ctx);
  return onTheRecordAsItStands(
    writing,
    () => rosterAsItStands(ctx, signer),
    ({ decided, roster, agentKeys }): Judged<EnrollRequestOk | EnrollRequestErr> => {
      const anchor = decided.anchor;
      // A key that holds the agent role is in an identity already, THIS one or any other the
      // record holds, and the verifier refuses a second enrolment of it: said here, while
      // refusing is free.
      const holder = agentKeys.get(fingerprint);
      if (holder !== undefined) {
        return {
          refuse: {
            ok: false,
            code: 'AN_AGENT_KEY',
            message:
              `the key ${oneLine(fingerprint)} is an agent key of ${oneLine(holder.anchor)}: an agent is not ` +
              'a member that joins, and the record takes a key in one role only',
          },
        };
      }
      if (!provesConsent(request.key, anchor, request.reverseSig)) {
        return {
          refuse: {
            ok: false,
            code: 'UNPROVEN_REQUEST',
            message:
              `that request does not prove the key ${oneLine(fingerprint)} consented to join ${oneLine(anchor)}: ` +
              `a request is made for ONE identity, so check the joining machine asked to join ${oneLine(anchor)} ` +
              'and not some other',
          },
        };
      }

      // The roster as the record proves it now. A tree with no founding yet has an
      // empty one, and this machine is about to become its only member, which is why
      // an unfounded tree may still vouch.
      if (decided.source !== 'unfounded' && !roster.has(signer.signerFingerprint)) {
        return {
          refuse: {
            ok: false,
            code: 'CANNOT_VOUCH',
            message:
              `this machine's key is not currently valid for ${oneLine(anchor)}: the record retired it, ` +
              'so a vouch it signed would be rejected. Enroll from a machine that is still a member',
          },
        };
      }
      if (roster.has(fingerprint)) {
        return { refuse: { ok: true, fingerprint, anchor, alreadyMember: true } };
      }

      return {
        write: () => {
          // Every refusal the record can give is behind this line, so only now is the tree touched.
          const write = writing.opened();
          materializePublicKey(write.layout, request.key);
          // The vouch's own refusal is forwarded rather than asserted away: it is the one
          // refusal here that is about the MATERIAL rather than the roster, and it comes
          // back with nothing appended, so the caller can hear it and act.
          const joined = enrollKey(write, { newFp: fingerprint, reverseSig: request.reverseSig });
          if (!joined.ok) return joined;
          return { ok: true, fingerprint, anchor, alreadyMember: false };
        },
      };
    },
  );
}

/** What retiring a key needs. */
export interface RevokeMemberInput {
  /** The full fingerprint of the key to retire. */
  readonly fingerprint: string;
  /** Why it is being retired: recorded in the fact. */
  readonly reason: string;
}

/** The key was retired from this machine's identity, from this point forward. */
export interface RevokeMemberOk extends ScreenedWrite {
  readonly ok: true;
  readonly fingerprint: string;
  /** The identity it was retired from. */
  readonly anchor: string;
  /** True when the retired key is the one this machine signs with. */
  readonly self: boolean;
  /** How many keys the identity has left. */
  readonly remaining: number;
  /**
   * When the retired key is this machine's own: the one identity the record still proves it a
   * member of here, read after the revocation by the reading a `key restore` of that key asks,
   * absent when the record proves it a member of none, or of more than one, where a restore here
   * points this checkout nowhere.
   */
  readonly stillMemberOf?: string;
}

/** Why a key was not retired. */
export type RevokeMemberErrorCode =
  /** The record does not currently count this key as a member of the identity. */
  | 'UNKNOWN_KEY'
  /** The key holds the agent role, which is retired by `mnema key revoke --agent`. */
  | 'AN_AGENT_KEY'
  /** It is the identity's last key: retiring it would leave nothing able to extend the record. */
  | 'LAST_KEY'
  /** This machine's own key is not currently valid for its identity, so it cannot revoke. */
  | 'CANNOT_VOUCH'
  /** The reason given was over the per-field size limit. */
  | 'CONTENT_TOO_LARGE'
  /**
   * A name field of the revocation read as a credential. It cannot be the reason
   * (that is a body and is redacted), so today it is the pinned `run` or the agent
   * name on the envelope, and it is a refusal for the reason those are names.
   */
  | 'NAME_HOLDS_A_SECRET'
  /** The reason came in empty, and no read would have accepted the fact. */
  | 'UNREADABLE_EVENT'
  /** The reason says nothing: no letter and no digit, or the `<why>` a recipe prints. */
  | 'NOT_A_REASON'
  /**
   * Never earned today: a revocation carries no title. It is here because the door's refusal is
   * one type (`AppendRefusal`), forwarded as it comes.
   */
  | 'NOT_A_TITLE'
  /** Never earned today either: an enrollment names no reference a caller typed. */
  | 'NOT_A_REFERENCE';

/** The revocation was refused; nothing was written. */
export interface RevokeMemberErr {
  readonly ok: false;
  readonly code: RevokeMemberErrorCode;
  /** Plain-language reason, to be reported to the person as-is. */
  readonly message: string;
}

/**
 * Retires a key from THIS machine's identity, from this point forward. Events the
 * key signed before stay valid: a revocation is prospective, never retroactive,
 * so past work does not become unattributable because a key was later rotated out.
 *
 * The last key is refused. An identity whose every key is retired has no key able
 * to sign another enrollment, so its history can never be extended again and no
 * command can repair it: the one state in the roster with no way back. The order
 * that works is the reverse: bring the replacement in first, and retire the old
 * key once the record proves the new one a member.
 */
export function revokeMember(
  ctx: DecideThenWrite,
  input: RevokeMemberInput,
): RevokeMemberOk | RevokeMemberErr {
  // Judged on the roster, and judged AGAIN under the tail's lock when anything landed since
  // ({@link onTheRecordAsItStands}). Two revocations of two keys of a two-key identity, run
  // together, each read two keys and each passed the last-key refusal; the identity came out
  // with none, which is the one state of the roster with no way back.
  const signer = signerOfContext(ctx);
  const writing = writingOnce(ctx);
  return onTheRecordAsItStands(
    writing,
    () => rosterAsItStands(ctx, signer),
    ({ decided, roster, agents }): Judged<RevokeMemberOk | RevokeMemberErr> => {
      const anchor = decided.anchor;
      if (agents.has(input.fingerprint)) {
        return {
          refuse: {
            ok: false,
            code: 'AN_AGENT_KEY',
            message:
              `${oneLine(input.fingerprint)} is an agent key of ${oneLine(anchor)}, and an agent is ` +
              `retired by its own verb: \`mnema key revoke --agent ${oneLine(input.fingerprint)} --reason "<why>"\``,
          },
        };
      }
      if (decided.source !== 'unfounded' && !roster.has(signer.signerFingerprint)) {
        return {
          refuse: {
            ok: false,
            code: 'CANNOT_VOUCH',
            message:
              `this machine's key is not currently valid for ${oneLine(anchor)}: the record retired it, ` +
              'so a revocation it signed would have no effect. Revoke from a machine that is still a member',
          },
        };
      }
      if (!roster.has(input.fingerprint)) {
        return {
          refuse: {
            ok: false,
            code: 'UNKNOWN_KEY',
            message:
              `the record does not count ${oneLine(input.fingerprint)} as a key of ${oneLine(anchor)}: ` +
              'it was never enrolled here, or it was retired already',
          },
        };
      }
      if (roster.size <= 1) {
        return {
          refuse: {
            ok: false,
            code: 'LAST_KEY',
            message:
              `${oneLine(input.fingerprint)} is the only key of ${oneLine(anchor)} that is not an agent's: retiring it would leave the ` +
              'identity unable to sign anything again, including a repair. Enroll the replacement ' +
              'first, then retire this one',
          },
        };
      }

      // The reason is free text, and it is screened HERE, before the writer opens: an
      // oversize reason is a refusal like the three above, and it must leave the tree as
      // they do. The mechanism screens it again at the append, which is its own door and
      // stays one; over text this already cleaned it finds nothing, so what was replaced
      // is reported from this screening.
      const text = screenContent({ reason: input.reason });
      if (!text.ok) return { refuse: text };

      return {
        write: () => {
          // Forward the append's refusal rather than asserting success: a reason no read would
          // accept is the one refusal left, and it comes back with nothing appended.
          const revoked = revokeKey(writing.opened(), {
            revokedFp: input.fingerprint,
            reason: text.fields.reason,
          });
          if (!revoked.ok) return revoked;
          const self = input.fingerprint === signer.signerFingerprint;
          return {
            ok: true,
            fingerprint: input.fingerprint,
            anchor,
            self,
            remaining: roster.size - 1,
            ...(self ? stillProvenIn(ctx, input.fingerprint) : {}),
            ...screened(text.replaced),
          };
        },
      };
    },
  );
}

/** Who this machine is in the tree, and the roster of that identity: one reading of both. */
function rosterAsItStands(
  ctx: DecideThenWrite,
  signer: ChainSigner,
): {
  readonly decided: AnchorDecision;
  /** The keys that are the identity's own: the ones that vouch, retire, and count as "the last". */
  readonly roster: Set<string>;
  /** The agent keys it holds, each with the name it was enrolled under. */
  readonly agents: ReadonlyMap<string, string>;
  /** Every key that holds the agent role under ANY identity of the record, and whose. */
  readonly agentKeys: ReadonlyMap<string, { readonly anchor: string; readonly name: string }>;
} {
  const decided = decideAnchor({ writer: signer, layout: ctx.layout, upcasters: ctx.upcasters });
  const { persons, agents } = rosterByRole(
    { tree: ctx.layout.root, upcasters: ctx.upcasters },
    decided.anchor,
  );
  const agentKeys = agentKeysIn(
    orderedEvents({ root: ctx.layout.root }, ctx.upcasters),
    ctx.layout.root,
  );
  return { decided, roster: persons, agents, agentKeys };
}

/**
 * The context's writer, opened at most once and only when first asked, which
 * {@link onTheRecordAsItStands} does after the first reading's last refusal, so a refusal still
 * leaves the tree as it found it (`code/tests/a-refusal-leaves-nothing.test.ts`). Once: a
 * deferred context opens a NEW writer each time it is asked, and a second writer of one tail
 * in one process would wait on the first's lock.
 */
function writingOnce(ctx: DecideThenWrite): RecordAndWriter & { opened(): WriteContext } {
  let opened: WriteContext | undefined;
  const open = (): WriteContext => {
    opened ??= openedContext(ctx);
    return opened;
  };
  return {
    layout: ctx.layout,
    get writer() {
      return open().writer;
    },
    opened: open,
  };
}

/**
 * The one identity the record at `ctx` still proves `fingerprint` a member of, read right after
 * its revocation.
 *
 * The checkout that retired its own key goes on recording the identity it left. THIS SAID
 * "nothing rereads a recorded anchor, so anything it writes next is signed by a retired key and
 * fails verification for good", which was the trap: every write now asks whether the recorded
 * identity still counts the key, and refuses (`ensureFounded`). Where the record still proves
 * the key in one other identity, `mnema key restore` points the checkout there; this asks the
 * question that restore asks ({@link membershipIn}, over the key's committed half), so the
 * surface never offers a restore the record would refuse, and where it proves none, the surface
 * says the restore on the condition a pull meets, since what this reads is the copy of the record
 * this checkout holds.
 */
function stillProvenIn(ctx: DecideThenWrite, fingerprint: string): { stillMemberOf?: string } {
  const key = committedPublicKey(ctx.layout, fingerprint);
  if (key === null) return {};
  const proven = membershipIn({ tree: ctx.layout.root, upcasters: ctx.upcasters }, key);
  return proven.ok ? { stillMemberOf: proven.anchor } : {};
}

/** What enrolling an agent key needs. */
export interface EnrollAgentInput {
  /** The line `mnema key request --agent` printed on the machine that holds the agent's key. */
  readonly request: string;
}

/** The key is an agent of this machine's identity. */
export interface EnrollAgentOk {
  readonly ok: true;
  /** The agent key's fingerprint, derived from the key the request carried. */
  readonly fingerprint: string;
  /** The name it was enrolled under: what every fact it signs carries as its `which`. */
  readonly name: string;
  /** The identity it speaks for: this machine's own. */
  readonly anchor: string;
  /** True when the record already had this key under this name, so nothing was appended. */
  readonly alreadyAgent: boolean;
}

/** Why a key was not enrolled as an agent. */
export type EnrollAgentErr =
  | AppendRefusal
  | ScreenRefusal
  | {
      readonly ok: false;
      readonly code:
        | 'MALFORMED_REQUEST'
        | 'BAD_AGENT_NAME'
        | 'UNPROVEN_REQUEST'
        | 'CANNOT_VOUCH'
        | 'A_MEMBER_KEY'
        | 'AGENT_UNDER_ANOTHER_NAME'
        | 'RETIRED_AGENT';
      readonly message: string;
    };

/**
 * Enrolls the key an AGENT request carries as an agent of THIS machine's identity, under the name
 * the request carries: commits the key's public half into the tree, then appends the vouch and
 * checkpoints it, so the role is proven at once.
 *
 * Refused while refusing is free: a line that is not an agent request (a request to JOIN is refused
 * by its prefix, so a person cannot grant the wrong power by pasting the wrong line); a name this
 * product does not enrol; a consent given for another identity or another name; a machine whose
 * own key the identity no longer counts, or that is itself an agent (an agent vouches for nobody);
 * a key that is already a member of an identity in this record, or an agent under another name, or
 * one the record took out of the role: the verifier refuses each of those facts for good.
 */
export function enrollAgentFromRequest(
  ctx: DecideThenWrite,
  input: EnrollAgentInput,
): EnrollAgentOk | EnrollAgentErr {
  const request = decodeAgentRequest(input.request);
  if (request === null) {
    return {
      ok: false,
      code: 'MALFORMED_REQUEST',
      message:
        'that is not an agent request: hand over the whole line `mnema key request --agent <name> --anchor <id>` ' +
        'printed on the machine that holds the agent key, unedited',
    };
  }
  const unnamed = agentNameRefusal(request.name);
  if (unnamed !== undefined) return { ok: false, code: 'BAD_AGENT_NAME', message: unnamed };

  const signer = signerOfContext(ctx);
  const fingerprint = request.key.fingerprint;
  const writing = writingOnce(ctx);
  return onTheRecordAsItStands(
    writing,
    () => rosterAsItStands(ctx, signer),
    ({ decided, roster, agents }): Judged<EnrollAgentOk | EnrollAgentErr> => {
      const anchor = decided.anchor;
      if (!provesAgentConsent(request.key, anchor, request.name, request.reverseSig)) {
        return {
          refuse: {
            ok: false,
            code: 'UNPROVEN_REQUEST',
            message:
              `that request does not prove the key ${oneLine(fingerprint)} consented to be ` +
              `"${oneLine(request.name)}" for ${oneLine(anchor)}: an agent request is made for ONE ` +
              'identity under ONE name',
          },
        };
      }
      if (decided.source !== 'unfounded' && !roster.has(signer.signerFingerprint)) {
        return {
          refuse: {
            ok: false,
            code: 'CANNOT_VOUCH',
            message:
              `this machine's key is not currently one of ${oneLine(anchor)}'s own: the record retired it, ` +
              'or it is an agent key, so a vouch it signed would be rejected. Enroll from a machine that is still a member',
          },
        };
      }
      const held = agents.get(fingerprint);
      if (held === request.name) {
        return {
          refuse: { ok: true, fingerprint, name: request.name, anchor, alreadyAgent: true },
        };
      }
      if (held !== undefined) return { refuse: underAnotherName(fingerprint, anchor, held) };
      const query = { tree: ctx.layout.root, upcasters: ctx.upcasters };
      const membership = membershipIn(query, request.key);
      // The record is read ONCE MORE here, outside the reading `agents` came from, and another
      // enrolment of this very key may have landed in between: the key is then proven an agent of
      // this identity, which is the role it was asked for and not a member's. Said by what the
      // record holds now, under the name it holds it.
      if (membership.ok && membership.membership === 'agent' && membership.anchor === anchor) {
        const now = rosterByRole(query, anchor).agents.get(fingerprint);
        if (now === request.name) {
          return {
            refuse: { ok: true, fingerprint, name: request.name, anchor, alreadyAgent: true },
          };
        }
        if (now !== undefined) return { refuse: underAnotherName(fingerprint, anchor, now) };
      }
      if (membership.ok || membership.code === 'AMBIGUOUS_MEMBERSHIP') {
        return {
          refuse: {
            ok: false,
            code: 'A_MEMBER_KEY',
            message:
              `the key ${oneLine(fingerprint)} is already a member of an identity in this record: an agent ` +
              'key is a key of its own, made for the agent, and the record takes a key in one role only',
          },
        };
      }
      if (membership.code === 'REVOKED_KEY') {
        return {
          refuse: {
            ok: false,
            code: 'RETIRED_AGENT',
            message:
              `the key ${oneLine(fingerprint)} was taken out of an identity in this record and is never ` +
              `enrolled again: \`mnema key request --agent ${oneLine(request.name)} --anchor <your identity>\` ` +
              'makes the agent a new key, and `mnema key enroll --agent <the line it prints>` puts it in force',
          },
        };
      }
      return {
        write: () => {
          const write = writing.opened();
          materializePublicKey(write.layout, request.key);
          const enrolled = enrollAgent(write, {
            agentFp: fingerprint,
            name: request.name,
            reverseSig: request.reverseSig,
          });
          if (!enrolled.ok) return enrolled;
          return { ok: true, fingerprint, name: request.name, anchor, alreadyAgent: false };
        },
      };
    },
  );
}

/** The refusal of a key that already holds a name as an agent of `anchor`: a key keeps the name it was enrolled under. */
function underAnotherName(
  fingerprint: string,
  anchor: string,
  held: string,
): { readonly ok: false; readonly code: 'AGENT_UNDER_ANOTHER_NAME'; readonly message: string } {
  return {
    ok: false,
    code: 'AGENT_UNDER_ANOTHER_NAME',
    message:
      `the key ${oneLine(fingerprint)} is already ${oneLine(anchor)}'s agent "${oneLine(held)}": ` +
      'a key keeps the name it was enrolled under, so retire it first and make the agent a key of its own',
  };
}

/** The agent key is held or retired somewhere a write to the other trees would contradict. */
export interface AgentKeyConflict {
  readonly ok: false;
  readonly code: 'RETIRED_AGENT' | 'AGENT_UNDER_ANOTHER_NAME';
  readonly message: string;
}

/**
 * Whether the records of several trees, read apart from any write, already say something about the
 * key an agent request carries that enrolling it in the others would contradict: it was retired in
 * one (and a key retired anywhere is retired everywhere this machine writes, so enrolling it in
 * the rest would only make a tree that lets it sign) or it is an agent under ANOTHER name in one,
 * and the record keeps a key to the name it was enrolled under. `where` is how each tree is said.
 *
 * It decides nothing about a request that holds up (a line that does not decode, a name the product
 * does not enrol, a consent for another identity): each tree's own operation refuses those.
 */
export function agentKeyConflictIn(
  trees: readonly { readonly tree: string; readonly where: string }[],
  input: EnrollAgentInput,
): AgentKeyConflict | undefined {
  const request = decodeAgentRequest(input.request);
  if (request === null) return undefined;
  const fingerprint = request.key.fingerprint;
  for (const { tree, where } of trees) {
    const query = { tree, upcasters: catalogUpcasters() };
    const proven = membershipIn(query, request.key);
    if (!proven.ok) {
      if (proven.code !== 'REVOKED_KEY') continue;
      return {
        ok: false,
        code: 'RETIRED_AGENT',
        message:
          `the key ${oneLine(fingerprint)} was retired in ${oneLine(where)} and is never enrolled again, ` +
          `in any tree it reaches from here: \`mnema key request --agent ${oneLine(request.name)} --anchor <your identity>\` ` +
          'makes the agent a new key, and `mnema key enroll --agent <the line it prints>` puts it in force',
      };
    }
    if (proven.membership !== 'agent') continue;
    const held = rosterByRole(query, proven.anchor).agents.get(fingerprint);
    if (held !== undefined && held !== request.name) {
      return {
        ok: false,
        code: 'AGENT_UNDER_ANOTHER_NAME',
        message:
          `the key ${oneLine(fingerprint)} is already ${oneLine(proven.anchor)}'s agent "${oneLine(held)}" in ${oneLine(where)}: ` +
          'a key keeps the name it was enrolled under, so retire it first and make the agent a key of its own',
      };
    }
  }
  return undefined;
}

/** What retiring an agent key needs. */
export interface RetireAgentInput {
  /** The full fingerprint of the agent key. */
  readonly fingerprint: string;
  /** Why: recorded in the fact. */
  readonly reason: string;
}

/** The agent key signs nothing from this point on. */
export interface RetireAgentOk extends ScreenedWrite {
  readonly ok: true;
  readonly fingerprint: string;
  /** The identity that retired it. */
  readonly anchor: string;
  /** The name it held. */
  readonly name: string;
}

/** Why an agent key was not retired. */
export type RetireAgentErr =
  | AppendRefusal
  | ScreenRefusal
  | {
      readonly ok: false;
      readonly code: 'UNKNOWN_AGENT' | 'CANNOT_VOUCH';
      readonly message: string;
    };

/**
 * Retires an agent key of THIS machine's identity: from the retirement on it signs nothing, and it
 * is never enrolled again. Events it signed before stay valid. The agent key is not asked (a key
 * somebody holds is not a key that has to agree to be taken back) and only a key of the
 * identity's own can do it. The retirement is checkpointed at once, because a reader honours it
 * only when it is covered.
 */
export function retireAgentKey(
  ctx: DecideThenWrite,
  input: RetireAgentInput,
): RetireAgentOk | RetireAgentErr {
  const text = screenContent({ reason: input.reason });
  if (!text.ok) return text;
  const signer = signerOfContext(ctx);
  const writing = writingOnce(ctx);
  return onTheRecordAsItStands(
    writing,
    () => rosterAsItStands(ctx, signer),
    ({ decided, roster, agents }): Judged<RetireAgentOk | RetireAgentErr> => {
      const anchor = decided.anchor;
      if (decided.source !== 'unfounded' && !roster.has(signer.signerFingerprint)) {
        return {
          refuse: {
            ok: false,
            code: 'CANNOT_VOUCH',
            message:
              `this machine's key is not currently one of ${oneLine(anchor)}'s own, so a retirement it ` +
              'signed would be rejected. Retire from a machine that is still a member',
          },
        };
      }
      const name = agents.get(input.fingerprint);
      if (name === undefined) {
        return {
          refuse: {
            ok: false,
            code: 'UNKNOWN_AGENT',
            message:
              `the record does not count ${oneLine(input.fingerprint)} as an agent key of ${oneLine(anchor)}: ` +
              'it was never enrolled here, or it was retired already',
          },
        };
      }
      return {
        write: () => {
          const retired = retireAgent(writing.opened(), {
            agentFp: input.fingerprint,
            reason: text.fields.reason,
          });
          if (!retired.ok) return retired;
          return {
            ok: true,
            fingerprint: input.fingerprint,
            anchor,
            name,
            ...screened(text.replaced),
          };
        },
      };
    },
  );
}
