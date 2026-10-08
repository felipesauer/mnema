/**
 * Rule checks: a rule carries a command, and a key that signs only check results records
 * whether the rule held at a commit.
 *
 * Three operations, one per fact a person or a machine adds:
 *
 *   - {@link declareCheck} — a person says what program checks a rule (`check.declared`).
 *   - {@link enrollChecker} — a person vouches for a key that will sign check results and
 *     nothing else, from the line that key's machine printed (`checker.enrolled`).
 *   - {@link runRuleChecks} — the checker runs every declared check of a rule in force and
 *     records each result under its OWN anchor (`check.passed` / `check.failed`).
 *   - {@link retireChecker} — a person takes the role away from a checker key, for good
 *     (`checker.retired`): the answer to a leaked runner secret.
 *
 * WHAT RUNS A CHECK IS HANDED IN. This module decides which checks run, refuses a key that is
 * not a checker before anything runs, bounds and neutralizes what a check printed, and writes
 * the facts; it never starts a process. The surface hands it the runner (a program started
 * without a shell, under a timeout) and the commit, so the decisions here are testable with a
 * runner that runs nothing.
 *
 * The record's reader is what makes the role mean anything (FORMAT.md section 6.2): a result
 * signed by a key that is not a checker, or any other fact signed by one, fails `verify`. The
 * refusals here keep this product from writing either; they are not what proves them.
 */

import {
  type CatalogEvent,
  checkDeclared,
  checkerEnrolled,
  checkerRetired,
  checkFailed,
  checkPassed,
  deriveAnchor,
  materializePublicKey,
} from '@mnema/chain';
import { neutralized } from '@mnema/chain/one-line';
import {
  type ScreenedWrite,
  type ScreenRefusal,
  screenContent,
  screened,
} from '../content/screen.js';
import { resolveExecutingAgent, type SelfAuthorizedErr } from '../identity/authority.js';
import { CHECKER_REQUEST_PREFIX, decodeKeyRequest } from '../identity/handshake.js';
import { membershipIn, rosterOf } from '../identity/membership.js';
import { oneLine } from '../one-line.js';
import { orderedEvents } from '../projections/order.js';
import { type AppendRefusal, appendEvent } from '../workflow/append.js';
import { systemClock } from '../workflow/clock.js';
import { decideAnchor, ensureFounded } from '../workflow/identity-operations.js';
import {
  type DecideThenWrite,
  openedContext,
  signerOfContext,
  type WriteContext,
} from '../workflow/operations.js';
import { checkersIn, consentsToCheck, retiredCheckersIn } from './checkers.js';

/**
 * The most of what a check printed that the record keeps: the LAST characters, because a
 * failure says why at the end. Counted in characters after neutralizing, so the bound holds
 * for what is written, escapes included.
 */
export const OUTPUT_LIMIT = 4000;

// ---------------------------------------------------------------------------------------
// Declaring a check
// ---------------------------------------------------------------------------------------

/** What a person asks to declare. */
export interface DeclareCheckInput {
  /** The rule — a decision's id in this tree. */
  readonly rule: string;
  /** The program to run. */
  readonly command: string;
  /** Its arguments, one by one. */
  readonly args?: readonly string[];
  /** The agent that carried it out, if any. `who` is derived from the writer's key. */
  readonly which?: string;
}

/** The check was declared. */
export interface DeclareCheckOk extends ScreenedWrite {
  readonly ok: true;
  /** The rule the check is for. */
  readonly rule: string;
}

/** A declaration refused before touching the chain. */
export type DeclareCheckErr =
  | ScreenRefusal
  | AppendRefusal
  | SelfAuthorizedErr
  /** This tree holds no decision by that id. */
  | { readonly ok: false; readonly code: 'UNKNOWN_RULE'; readonly message: string };

/**
 * Declares the program that checks a rule: one `check.declared` whose subject is the rule. A
 * later declaration on the same rule is the one {@link runRuleChecks} runs; neither is erased.
 *
 * The program and its arguments are NAMES to the content door: a credential in either refuses
 * the declaration rather than being redacted, because a program with one argument replaced is
 * a different program.
 */
export function declareCheck(
  ctx: WriteContext,
  input: DeclareCheckInput,
): DeclareCheckOk | DeclareCheckErr {
  const text = screenContent({
    command: input.command,
    ...(input.args !== undefined && input.args.length > 0 ? { args: input.args } : {}),
  });
  if (!text.ok) return text;

  const events = orderedEvents(ctx.layout, ctx.upcasters);
  if (!events.some((e) => e.kind === 'decision.recorded' && e.subject === input.rule)) {
    return {
      ok: false,
      code: 'UNKNOWN_RULE',
      message: `no decision "${oneLine(input.rule)}" is in this record — a check is declared on a rule`,
    };
  }

  const who = ensureFounded(ctx);
  const agent = resolveExecutingAgent(who, input.which);
  if (!agent.ok) return agent;
  const appended = appendEvent(
    ctx.writer,
    checkDeclared(
      {
        at: (ctx.clock ?? systemClock)(),
        who,
        signerFp: ctx.writer.signerFingerprint,
        subject: input.rule,
        ...(agent.which !== undefined ? { which: agent.which } : {}),
      },
      {
        command: text.fields.command,
        ...(text.fields.args !== undefined ? { args: text.fields.args } : {}),
      },
    ),
  );
  if (!appended.ok) return appended;
  return { ok: true, rule: input.rule, ...screened([...text.replaced, ...agent.replaced]) };
}

// ---------------------------------------------------------------------------------------
// Enrolling a checker
// ---------------------------------------------------------------------------------------

/** The key may now sign check results. */
export interface EnrollCheckerOk {
  readonly ok: true;
  /** The checker key's fingerprint, derived from the key the request carried. */
  readonly fingerprint: string;
  /** The anchor the checker speaks under — its own. */
  readonly checker: string;
  /** The identity that vouched for it — this machine's. */
  readonly vouchedBy: string;
  /** True when the record already enrolled it, so nothing was appended. */
  readonly alreadyChecker: boolean;
}

/** Why a key was not enrolled as a checker. */
export type EnrollCheckerErr =
  | AppendRefusal
  | {
      readonly ok: false;
      readonly code:
        | 'MALFORMED_REQUEST'
        | 'UNPROVEN_REQUEST'
        | 'CANNOT_VOUCH'
        | 'A_MEMBER_KEY'
        | 'RETIRED_CHECKER';
      readonly message: string;
    };

/**
 * Enrolls the key a CHECKER request carries, vouched for by this machine's identity.
 *
 * Refused: a line that is not a checker request (a request to JOIN is refused here, by its
 * prefix, so a person cannot grant the wrong power by pasting the wrong line); a request
 * whose consent was given to another identity; a machine whose key its identity no longer
 * counts; and a key that is a MEMBER of an identity in this record, because a checker key
 * signs check results only, and every other fact that key went on to sign would fail.
 */
export function enrollChecker(
  ctx: DecideThenWrite,
  input: { readonly request: string },
): EnrollCheckerOk | EnrollCheckerErr {
  const request = decodeKeyRequest(input.request, CHECKER_REQUEST_PREFIX);
  if (request === null) {
    return {
      ok: false,
      code: 'MALFORMED_REQUEST',
      message:
        'that is not a checker request — hand over the whole line `mnema key request --checker --anchor <id>` ' +
        'printed on the machine that will run the checks, unedited',
    };
  }
  const signer = signerOfContext(ctx);
  const decided = decideAnchor({ writer: signer, layout: ctx.layout, upcasters: ctx.upcasters });
  const anchor = decided.anchor;
  const fingerprint = request.key.fingerprint;

  if (!consentsToCheck(request.key, anchor, request.reverseSig)) {
    return {
      ok: false,
      code: 'UNPROVEN_REQUEST',
      message:
        `that request does not prove the key ${oneLine(fingerprint)} consented to check for ` +
        `${oneLine(anchor)} — a checker request is made for ONE identity`,
    };
  }
  const query = { tree: ctx.layout.root, upcasters: ctx.upcasters };
  if (decided.source !== 'unfounded' && !rosterOf(query, anchor).has(signer.signerFingerprint)) {
    return {
      ok: false,
      code: 'CANNOT_VOUCH',
      message: `this machine's key is not currently valid for ${oneLine(anchor)}, so a vouch it signed would be rejected`,
    };
  }
  const membership = membershipIn(query, request.key);
  if (membership.ok || membership.code === 'AMBIGUOUS_MEMBERSHIP') {
    return {
      ok: false,
      code: 'A_MEMBER_KEY',
      message:
        `the key ${oneLine(fingerprint)} is a member of an identity in this record — a checker ` +
        'key signs check results only, so every other fact it signed would fail verification. ' +
        'Make a key of its own for the machine that runs the checks',
    };
  }
  const retirement = retiredCheckersIn(ctx.layout, ctx.upcasters).get(fingerprint);
  if (retirement !== undefined) return retiredRefusal(fingerprint, retirement.by);
  const checker = deriveAnchor(fingerprint);
  if (checkersIn(ctx.layout, ctx.upcasters).has(fingerprint)) {
    return { ok: true, fingerprint, checker, vouchedBy: anchor, alreadyChecker: true };
  }

  const write = openedContext(ctx);
  return write.writer.exclusively(() => {
    const who = ensureFounded(write);
    materializePublicKey(write.layout, request.key);
    const appended = appendEvent(
      write.writer,
      checkerEnrolled(
        {
          at: (write.clock ?? systemClock)(),
          who,
          signerFp: write.writer.signerFingerprint,
          subject: checker,
        },
        { checkerFp: fingerprint, reverseSig: request.reverseSig },
      ),
    );
    if (!appended.ok) return appended;
    write.writer.checkpoint();
    return { ok: true, fingerprint, checker, vouchedBy: who, alreadyChecker: false };
  });
}

// ---------------------------------------------------------------------------------------
// Running the checks
// ---------------------------------------------------------------------------------------

/** One check to run: the rule it is for, and the program its latest declaration names. */
export interface DeclaredCheck {
  readonly rule: string;
  readonly command: string;
  readonly args: readonly string[];
}

/** What running one check came to. `output` is everything it printed, unbounded. */
export type CheckOutcome =
  | { readonly passed: true; readonly output: string }
  | { readonly passed: false; readonly failure: string; readonly output: string };

/** What the checker is asked to do. */
export interface RunChecksInput {
  /** The commit the working tree stands at — the full object name. */
  readonly commit: string;
  /** The rules in force. A declared check of any other rule is not run. */
  readonly rulesInForce: ReadonlySet<string>;
  /** Runs one check. Called once per check, in rule order, only after every refusal. */
  readonly run: (check: DeclaredCheck) => CheckOutcome;
}

/** One check's result, as recorded. */
export interface CheckResult {
  readonly rule: string;
  readonly passed: boolean;
  /** How it failed, when it did. */
  readonly failure?: string;
}

/** Every check of a rule in force ran, and each result is on the record. */
export interface RunChecksOk extends ScreenedWrite {
  readonly ok: true;
  /** The anchor the results were signed under — the checker's own. */
  readonly checker: string;
  readonly results: readonly CheckResult[];
}

/** Why no check ran; nothing was written. */
export type RunChecksErr =
  | AppendRefusal
  | ScreenRefusal
  | {
      readonly ok: false;
      readonly code: 'NOT_A_CHECKER' | 'BAD_COMMIT' | 'RETIRED_CHECKER';
      readonly message: string;
    };

/** A full object name: SHA-1 or SHA-256, lower-case hex. */
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * Runs the declared check of every rule in force and records each result, signed by this
 * machine's key under ITS OWN anchor — never founding an identity, which a checker key may
 * not sign.
 *
 * Refused before anything runs: a commit that is not a full object name, and a key this
 * record does not enroll as a checker. A tree with no check to run writes nothing.
 */
export function runRuleChecks(
  ctx: DecideThenWrite,
  input: RunChecksInput,
): RunChecksOk | RunChecksErr {
  if (!COMMIT.test(input.commit)) {
    return {
      ok: false,
      code: 'BAD_COMMIT',
      message: `"${oneLine(input.commit)}" is not a full commit object name`,
    };
  }
  const fingerprint = signerOfContext(ctx).signerFingerprint;
  if (!checkersIn(ctx.layout, ctx.upcasters).has(fingerprint)) {
    return {
      ok: false,
      code: 'NOT_A_CHECKER',
      message:
        `this machine's key ${oneLine(fingerprint)} is not enrolled as a checker in this record — ` +
        'run `mnema key request --checker --anchor <id>` here, and have a member enroll the line ' +
        'with `mnema key enroll --checker <the line>`',
    };
  }
  const retirement = retiredCheckersIn(ctx.layout, ctx.upcasters).get(fingerprint);
  if (retirement !== undefined) return retiredRefusal(fingerprint, retirement.by);

  const checks = declaredChecks(orderedEvents(ctx.layout, ctx.upcasters)).filter((check) =>
    input.rulesInForce.has(check.rule),
  );
  const checker = deriveAnchor(fingerprint);
  if (checks.length === 0) return { ok: true, checker, results: [] };

  const built: { event: CatalogEvent; result: CheckResult }[] = [];
  const replaced: ScreenedWrite['replaced'][] = [];
  for (const check of checks) {
    const outcome = input.run(check);
    const output = boundedOutput(outcome.output);
    const text = screenContent({
      ...(output !== '' ? { output } : {}),
      ...(outcome.passed ? {} : { failure: outcome.failure }),
    });
    if (!text.ok) return text;
    replaced.push(text.replaced);
    const envelope = {
      at: (ctx.clock ?? systemClock)(),
      who: checker,
      signerFp: fingerprint,
      subject: check.rule,
    };
    const ran = {
      commit: input.commit,
      command: check.command,
      ...(check.args.length > 0 ? { args: check.args } : {}),
      ...(text.fields.output !== undefined ? { output: text.fields.output } : {}),
    };
    built.push(
      outcome.passed
        ? { event: checkPassed(envelope, ran), result: { rule: check.rule, passed: true } }
        : {
            event: checkFailed(envelope, { ...ran, failure: text.fields.failure ?? '' }),
            result: { rule: check.rule, passed: false, failure: text.fields.failure ?? '' },
          },
    );
  }

  const write = openedContext(ctx);
  return write.writer.exclusively(() => {
    for (const { event } of built) {
      const appended = appendEvent(write.writer, event);
      if (!appended.ok) return appended;
    }
    write.writer.checkpoint();
    return {
      ok: true,
      checker,
      results: built.map((b) => b.result),
      ...screened(replaced.flatMap((r) => r ?? [])),
    };
  });
}

/**
 * The check each rule's LATEST declaration names, in the order the rules were first given
 * one — the order a person reads them back in.
 */
export function declaredChecks(events: readonly CatalogEvent[]): DeclaredCheck[] {
  const latest = new Map<string, DeclaredCheck>();
  for (const event of events) {
    if (event.kind !== 'check.declared') continue;
    latest.set(event.subject, {
      rule: event.subject,
      command: event.payload.command,
      args: event.payload.args ?? [],
    });
  }
  return [...latest.values()];
}

/** The tail of what a check printed, neutralized, at most {@link OUTPUT_LIMIT} characters. */
function boundedOutput(raw: string): string {
  const visible = neutralized(raw).trimEnd();
  const chars = Array.from(visible);
  if (chars.length <= OUTPUT_LIMIT) return visible;
  return `…\n${chars.slice(chars.length - OUTPUT_LIMIT).join('')}`;
}

// ---------------------------------------------------------------------------------------
// Retiring a checker
// ---------------------------------------------------------------------------------------

/** The refusal a retired key earns at every door: it is never a checker again. */
function retiredRefusal(
  fingerprint: string,
  by: string,
): { readonly ok: false; readonly code: 'RETIRED_CHECKER'; readonly message: string } {
  return {
    ok: false,
    code: 'RETIRED_CHECKER',
    message:
      `the key ${oneLine(fingerprint)} was retired as a checker by ${oneLine(by)}, and a retired ` +
      'key signs nothing again — make a new key for the machine that runs the checks, and enroll ' +
      'its line with `mnema key enroll --checker <the line>`',
  };
}

/** What a person asks to retire. */
export interface RetireCheckerInput {
  /** The full fingerprint of the checker key. */
  readonly fingerprint: string;
  /** Why — recorded in the fact. */
  readonly reason: string;
}

/** The key is a checker no longer. */
export interface RetireCheckerOk extends ScreenedWrite {
  readonly ok: true;
  readonly fingerprint: string;
  /** The anchor its results were signed under — its own. */
  readonly checker: string;
  /** The identity that retired it — this machine's, or the one that did it first. */
  readonly retiredBy: string;
  /** True when the record already retired it, so nothing was appended. */
  readonly alreadyRetired: boolean;
}

/** Why the key was not retired; nothing was written. */
export type RetireCheckerErr =
  | AppendRefusal
  | ScreenRefusal
  | {
      readonly ok: false;
      readonly code: 'NOT_A_CHECKER' | 'CANNOT_VOUCH';
      readonly message: string;
    };

/**
 * Retires a checker key, signed by this machine's identity: one `checker.retired`, checkpointed
 * at once, because the reader honours a retirement only when a checkpoint covers it.
 *
 * Who may retire is who may enrol: a key valid for its identity now. Any identity, not only the
 * one that vouched — the person who most needs to retire a leaked key may not be the one who
 * enrolled it, and the worst a retirement does is stop a machine's results from counting, in a
 * fact that names who did it. The checker key is not asked.
 *
 * Refused: a key this record does not enroll as a checker, and a machine whose key its identity
 * no longer counts. A key already retired is reported, and nothing is appended.
 */
export function retireChecker(
  ctx: DecideThenWrite,
  input: RetireCheckerInput,
): RetireCheckerOk | RetireCheckerErr {
  const fingerprint = input.fingerprint;
  const checker = deriveAnchor(fingerprint);
  if (!checkersIn(ctx.layout, ctx.upcasters).has(fingerprint)) {
    return {
      ok: false,
      code: 'NOT_A_CHECKER',
      message:
        `the record enrolls no checker key ${oneLine(fingerprint)} — give the full fingerprint ` +
        'the enrolment printed (`Enrolled checker <fingerprint>`)',
    };
  }
  const retirement = retiredCheckersIn(ctx.layout, ctx.upcasters).get(fingerprint);
  if (retirement !== undefined) {
    return {
      ok: true,
      fingerprint,
      checker,
      retiredBy: retirement.by,
      alreadyRetired: true,
    };
  }
  const signer = signerOfContext(ctx);
  const decided = decideAnchor({ writer: signer, layout: ctx.layout, upcasters: ctx.upcasters });
  const query = { tree: ctx.layout.root, upcasters: ctx.upcasters };
  if (
    decided.source !== 'unfounded' &&
    !rosterOf(query, decided.anchor).has(signer.signerFingerprint)
  ) {
    return {
      ok: false,
      code: 'CANNOT_VOUCH',
      message: `this machine's key is not currently valid for ${oneLine(decided.anchor)}, so a retirement it signed would be rejected`,
    };
  }
  const text = screenContent({ reason: input.reason });
  if (!text.ok) return text;

  const write = openedContext(ctx);
  return write.writer.exclusively(() => {
    const who = ensureFounded(write);
    const appended = appendEvent(
      write.writer,
      checkerRetired(
        {
          at: (write.clock ?? systemClock)(),
          who,
          signerFp: write.writer.signerFingerprint,
          subject: checker,
        },
        { checkerFp: fingerprint, reason: text.fields.reason },
      ),
    );
    if (!appended.ok) return appended;
    write.writer.checkpoint();
    return {
      ok: true,
      fingerprint,
      checker,
      retiredBy: who,
      alreadyRetired: false,
      ...screened(text.replaced),
    };
  });
}
