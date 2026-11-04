// THE PROTOCOL OF A SESSION as data and small pure functions, read by the runner, the smoke check and the pre-registration manifest.
import { MODEL, EFFORT } from '../plan/cells.mjs';

export const WALL_CLOCK_MS = 45 * 60 * 1000; // past it the session "did not finish" (the longest 27 October session of size S took 15 minutes)
export const MAX_REQUESTS = 90; // past it, the same (the most a size-S session sent on 27 October was 64)
export const SMOKE_MAX_SESSIONS = 3;
export const ENDINGS = {
  exited: { read: true, label: 'finished' },
  timeout: { read: false, label: 'did_not_finish', why: 'the wall-clock limit was reached' },
  budget: { read: false, label: 'did_not_finish', why: 'the session sent more requests than the cap' },
  cut: { read: false, label: 'discarded', why: 'a plan limit cut the session (a rejected window, or "usage limit reached", "wrapping up")' },
  arm: { read: false, label: 'discarded', why: 'what the session saw is not what its arm says' },
  billing: { read: false, label: 'refused_or_discarded', why: 'the session is not proved to be billed to the Pro subscription (an API credential or base URL in the environment or settings, an auth method that is not claude.ai, a plan that is not pro, no subscription rate-limit event in the stream)' },
  not_started: { read: false, label: 'refused', why: 'the wrapper failed before Claude Code started: no stream, no request; the run folder is removed and the id can run again' },
  account: { read: false, label: 'refused', why: 'the account check did not pass: nothing started' },
  account_changed: { read: false, label: 'discarded', why: 'the session\'s own config after the run no longer names the enrolled account' },
  room: { read: false, label: 'refused', why: 'the windows have no room for the session: nothing started' },
};

/** The argv of Claude Code for a round: exactly what the manifest prints, the prompt last (the 27 October command with the model and effort of the design). */
export function claudeArgs({ prompt, sessionId, resume }) {
  return ['-p', '--model', MODEL, '--effort', EFFORT, '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--dangerously-skip-permissions', ...(resume ? ['--resume', sessionId] : ['--session-id', sessionId]), prompt];
}
export const claudeArgsTemplate = () => claudeArgs({ prompt: '<prompt>', sessionId: '<session id>', resume: false }).map((a) => (a === '<session id>' ? a : a));

/** What the session SAW must be what its arm is (the init event of the stream). */
export function armProblems(arm, init) {
  const out = [];
  const mcp = (init.mcp_servers ?? []).some((m) => /mnema/.test(m.name ?? '') && m.status === 'connected');
  const plugin = (init.plugins ?? []).some((p) => /mnema/.test(typeof p === 'string' ? p : (p.name ?? ''))) || mcp;
  if (arm.plugin && !(plugin && mcp)) out.push('the arm has the plugin but the session did not connect it');
  if (!arm.plugin && (plugin || (init.mcp_servers ?? []).some((m) => /mnema/.test(m.name ?? '')))) out.push('the arm has no plugin but the session loaded one');
  if (['ANTHROPIC_API_KEY', 'apiKeyHelper'].includes(init.apiKeySource)) out.push(`the session ran on ${init.apiKeySource}, not on the plan token`);
  if (init.model && init.model !== MODEL) out.push(`model seen ${init.model}, not ${MODEL}`);
  return out;
}
