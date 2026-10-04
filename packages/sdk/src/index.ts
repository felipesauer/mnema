/**
 * @mnema/sdk — the record, from a program. See the package README for what it promises.
 */

export type {
  HookCallback,
  HookInput,
  HookMatcher,
  HookOptions,
  HookOutput,
  MnemaHooks,
} from './hooks.js';
export { DEFAULT_HOOK_AGENT, mnemaHooks, WRITE_TOOLS_MATCHER } from './hooks.js';
export type { BriefRead, MnemaRecord, RecordOptions } from './record.js';
export { openRecord } from './record.js';
