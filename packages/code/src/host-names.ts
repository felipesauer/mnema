/**
 * The hosts this product answers or prints for beyond Claude Code, by name — and nothing else.
 *
 * Two closed sets, each a union with its list beside it, and a module of their own for one
 * reason: the command line declares every option before it can route a word, so the lists a
 * `--host` enumerates are loaded on every invocation, while what each verb knows about a host —
 * the payload it reads, the file format it prints — is loaded only when that verb runs
 * (`tests/the-floor-is-the-declaration.test.ts`). They are different sets because they answer
 * different measurements (`measurements/hooks-by-host/`): a host is in {@link HookHost} when its
 * hook can hold a write for a person, and in {@link RulesFileHost} when it reads rules from a
 * file with a glob.
 */

/** A host this product answers as a command hook before a write — see `host-hook.ts`. */
export type HookHost = 'vscode';

/** Every {@link HookHost}, as the list `mnema before-a-write --host` enumerates. */
export const HOOK_HOSTS: readonly HookHost[] = ['vscode'];
