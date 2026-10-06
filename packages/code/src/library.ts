/**
 * The operations the private `@mnema/sdk` calls — the same functions the command line calls, under
 * one entry so a program can reach them without the binary.
 *
 * It adds no operation and no rule: each name below is a command's own function, or the
 * presentation the command prints through. There is no stability promise on it; the package that
 * documents what a program may rely on is `@mnema/sdk`.
 */

export { runBeforeAPath } from './commands/before-a-write.js';
export { runBrief } from './commands/brief.js';
export { runDecision } from './commands/decision.js';
export { runDecisionTransition } from './commands/decision-transition.js';
export { runMemory } from './commands/memory.js';
export { runRecall } from './commands/recall.js';
export { runRules } from './commands/rules.js';
export { runVerify } from './commands/verify.js';
export { discoveryEnv } from './env.js';
export { labelAsAddress } from './label-as-address.js';
export { hookReply } from './mcp/hook-reply.js';
export { briefDocument, briefWithin } from './presentation/brief.js';
export { renderPlain } from './presentation/plain.js';
export { roomBeside } from './presentation/within-a-hook.js';
export { linkBreakNotice } from './wiring/integrity.js';
export { DEFAULT_REQUIREMENT } from './wiring/verify.js';
