/**
 * Adopting a stack, and removing one: the two facts that say which stacks govern the work in
 * a tree.
 *
 * WHAT THE FACT IS. "This person adopted exactly these bytes, under this name, in this scope",
 * signed. The digest is the stack's identity — the SHA-256 over its file list that anybody can
 * recompute with three lines of shell — so the claim can be held against a disk without
 * trusting the version or anybody's word.
 *
 * WHAT NEVER ENTERS IT, and why every field is a closed form rather than text. The record is
 * append-only, and the public tree is committed and cloned. A path names a machine and, in a
 * home folder, its owner; an address can carry a token; and neither is needed to say WHICH
 * stack, because the digest already does. So this door does not look for a path or a
 * credential in free text and hope to find it: it admits only values in which neither fits.
 *   - the stack's name, and the name it is installed under: the stack-name form (lower-case
 *     ASCII letters, digits and single hyphens, at most 64) — no separator, no dot;
 *   - the digest: 64 lower-case hex characters;
 *   - the scope: one of the three trees, `public`, `private` or `global`. The free folder a
 *     person may install into (`--to`) governs nothing and is no scope here: the record does
 *     not affirm what it does not govern, so that install records no fact at all;
 *   - the version, the one field that is the author's label: a version's characters (ASCII
 *     letters, digits, `.`, `+`, `-`, starting with a letter or a digit, at most 64) — no
 *     separator, no `~`, no `:` or `@` an address needs — and, because a key id is spelled in
 *     exactly those characters, the content door first, which refuses a credential in a name.
 *
 * WHICH TREE. The scope is signed in the fact AND names the tree the fact is written in; the
 * caller opens that tree. A removal is written where the adoption it ends was, and copies the
 * adoption's version, digest and scope from the record rather than taking them from a caller.
 */

import { type CatalogEvent, stackAdopted, stackRemoved } from '@mnema/chain';
import {
  type ScreenedWrite,
  type ScreenRefusal,
  screenContent,
  screened,
} from '../content/screen.js';
import { resolveExecutingAgent, type SelfAuthorizedErr } from '../identity/authority.js';
import { oneLine } from '../one-line.js';
import { orderedEvents } from '../projections/order.js';
import type { Scope } from '../topology/routing.js';
import { type AppendRefusal, appendEvent } from './append.js';
import { type Judged, onTheRecordAsItStands } from './as-the-record-stands.js';
import { systemClock } from './clock.js';
import { authorizingAnchor, ensureFounded } from './identity-operations.js';
import type { WriteContext } from './operations.js';

/** The three trees a stack can be adopted into — the scopes that are a tree, and no other. */
export const STACK_SCOPES: readonly Scope[] = ['public', 'private', 'global'];

/** The stack-name form: lower-case ASCII letters and digits, joined by single hyphens. */
const STACK_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const STACK_NAME_MAX = 64;

/** A version's characters, starting with a letter or a digit. */
const STACK_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]*$/;
const STACK_VERSION_MAX = 64;

/** Whether `text` is a stack name in the form the write door admits — the door's own rule, for readers. */
export function isStackName(text: string): boolean {
  return STACK_NAME.test(text) && text.length <= STACK_NAME_MAX;
}

/** Whether `text` is a version label in the form the write door admits — the door's own rule, for readers. */
export function isStackVersion(text: string): boolean {
  return STACK_VERSION.test(text) && text.length <= STACK_VERSION_MAX;
}

/** The digest a stack is identified by: a SHA-256, in lower-case hex. */
const STACK_DIGEST = /^[0-9a-f]{64}$/;

/** What the caller asks to adopt. */
export interface AdoptStackInput {
  /** The name the stack's own `stack.json` declares. */
  readonly name: string;
  /** The name it is installed under, when the person renamed it to settle a collision. */
  readonly as?: string;
  /** The version the stack's own `stack.json` declares. */
  readonly version: string;
  /** The stack's digest. */
  readonly digest: string;
  /** The tree that governs: `public`, `private` or `global`. */
  readonly scope: string;
  /** The agent that carried it out, if any. `who` is derived from the writer's key. */
  readonly which?: string;
  /** The run this belongs to, if any. */
  readonly run?: string;
}

/** A field that is not the closed form it has to be, named — the value is not repeated. */
export interface StackFieldRefusal {
  readonly ok: false;
  readonly code: 'STACK_FIELD_REFUSED';
  /** Which field of the caller's input. */
  readonly field: 'name' | 'as' | 'version' | 'digest' | 'scope';
  readonly message: string;
}

/** An adoption or removal refused before touching the chain. */
export type StackFactError = StackFieldRefusal | SelfAuthorizedErr | ScreenRefusal | AppendRefusal;

/** A stack was adopted: the fact was appended. */
export interface AdoptStackOk extends ScreenedWrite {
  readonly ok: true;
  /** The name it is installed under — the fact's subject. */
  readonly subject: string;
}

/** Why each field is refused, in the words a person reads. */
function fieldRefusal(
  field: StackFieldRefusal['field'],
  value: unknown,
): StackFieldRefusal | undefined {
  const text = typeof value === 'string' ? value : '';
  const refuse = (rule: string): StackFieldRefusal => ({
    ok: false,
    code: 'STACK_FIELD_REFUSED',
    field,
    message: `the stack's ${field} is refused: ${rule}. Nothing was appended.`,
  });
  switch (field) {
    case 'name':
    case 'as':
      return isStackName(text)
        ? undefined
        : refuse(
            'a stack name is lower-case ASCII letters, digits and single hyphens, at most 64 ' +
              'characters, and never a path',
          );
    case 'version':
      return isStackVersion(text)
        ? undefined
        : refuse(
            'a version is ASCII letters, digits, ".", "+" and "-", at most 64 characters, and ' +
              'never a path or an address',
          );
    case 'digest':
      return STACK_DIGEST.test(text)
        ? undefined
        : refuse("a digest is the stack's SHA-256, 64 lower-case hex characters and nothing else");
    case 'scope':
      return (STACK_SCOPES as readonly string[]).includes(text)
        ? undefined
        : refuse(
            'a scope is one of the trees the record governs — public, private or global; a ' +
              'stack installed into a folder of its own records no fact',
          );
  }
}

/**
 * Records that a person adopted a stack: appends one `stack.adopted`, signed and checkpointed,
 * so the adoption is covered by a signature the moment it lands.
 *
 * Every field is refused unless it is the closed form the module comment gives, and the
 * version goes through the content door first; a refusal names the field and appends nothing.
 * The caller writes through the writer of the tree `scope` names.
 */
export function adoptStack(
  ctx: WriteContext,
  input: AdoptStackInput,
): AdoptStackOk | StackFactError {
  // The door first, so a credential is refused as one, under its own code, before the form
  // that would also refuse it says something vaguer.
  const text = screenContent({ version: input.version, run: input.run });
  if (!text.ok) return text;

  const subject = input.as ?? input.name;
  for (const [field, value] of [
    ['name', input.name],
    ['as', subject],
    ['version', input.version],
    ['digest', input.digest],
    ['scope', input.scope],
  ] as const) {
    const refused = fieldRefusal(field, value);
    if (refused !== undefined) return refused;
  }

  const who = authorizingAnchor(ctx);
  const agent = resolveExecutingAgent(who, input.which);
  if (!agent.ok) return agent;

  // Appended and signed in ONE hold of the tail's lock, so no other session can take the tail
  // between the fact landing and its signature.
  return ctx.writer.exclusively(() => {
    ensureFounded(ctx);
    const appended = appendEvent(
      ctx.writer,
      stackAdopted(
        {
          at: (ctx.clock ?? systemClock)(),
          who,
          signerFp: ctx.writer.signerFingerprint,
          subject,
          ...(agent.which !== undefined ? { which: agent.which } : {}),
          ...(text.fields.run !== undefined ? { run: text.fields.run } : {}),
        },
        {
          name: input.name,
          version: text.fields.version,
          digest: input.digest,
          scope: input.scope,
        },
      ),
    );
    if (!appended.ok) return appended;
    ctx.writer.checkpoint();
    return { ok: true, subject, ...screened([...text.replaced, ...agent.replaced]) };
  });
}

/** What the caller asks to remove: the name the stack is installed under. */
export interface RemoveStackInput {
  readonly name: string;
  readonly which?: string;
  readonly run?: string;
}

/** A stack was removed: the fact was appended, naming the bytes let go. */
export interface RemoveStackOk extends ScreenedWrite {
  readonly ok: true;
  readonly subject: string;
  readonly version: string;
  readonly digest: string;
  readonly scope: string;
}

/** A removal refused before touching the chain. */
export type RemoveStackError =
  | StackFactError
  /** This tree holds no standing adoption under that name. */
  | { readonly ok: false; readonly code: 'UNKNOWN_STACK'; readonly message: string };

/** The adoption that stands under `name` in this tree, if any: the last, unless removed since. */
function standingAdoption(
  events: readonly CatalogEvent[],
  name: string,
): { version: string; digest: string; scope: string } | undefined {
  let standing: { version: string; digest: string; scope: string } | undefined;
  for (const event of events) {
    if (event.subject !== name) continue;
    if (event.kind === 'stack.adopted') {
      const { version, digest, scope } = event.payload;
      standing = { version, digest, scope };
    } else if (event.kind === 'stack.removed') {
      standing = undefined;
    }
  }
  return standing;
}

/**
 * Records that a person removed a stack they had adopted: appends one `stack.removed` whose
 * version, digest and scope are the standing adoption's, read from the record under the tail's
 * lock. A name this tree holds no standing adoption of is refused, not recorded dangling.
 */
export function removeStack(
  ctx: WriteContext,
  input: RemoveStackInput,
): RemoveStackOk | RemoveStackError {
  const text = screenContent({ run: input.run });
  if (!text.ok) return text;

  const who = authorizingAnchor(ctx);
  const agent = resolveExecutingAgent(who, input.which);
  if (!agent.ok) return agent;

  return onTheRecordAsItStands(
    ctx,
    () => standingAdoption(orderedEvents(ctx.layout, ctx.upcasters), input.name),
    (standing): Judged<RemoveStackOk | RemoveStackError> => {
      if (standing === undefined) {
        return {
          refuse: {
            ok: false,
            code: 'UNKNOWN_STACK',
            message: `no stack "${oneLine(input.name)}" stands adopted in this record. Nothing was appended.`,
          },
        };
      }
      return {
        write: () => {
          ensureFounded(ctx);
          const appended = appendEvent(
            ctx.writer,
            stackRemoved(
              {
                at: (ctx.clock ?? systemClock)(),
                who,
                signerFp: ctx.writer.signerFingerprint,
                subject: input.name,
                ...(agent.which !== undefined ? { which: agent.which } : {}),
                ...(text.fields.run !== undefined ? { run: text.fields.run } : {}),
              },
              standing,
            ),
          );
          if (!appended.ok) return appended;
          ctx.writer.checkpoint();
          return {
            ok: true,
            subject: input.name,
            ...standing,
            ...screened([...text.replaced, ...agent.replaced]),
          };
        },
      };
    },
  );
}
