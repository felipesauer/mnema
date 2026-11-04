// THE CODE READERS of Q1 to Q3 (design.yaml `measures`), over the stream of a finished session. Heuristics, said as such in the pre-registration: the
// LLM reader reads the same sessions and the two are printed side by side. No model, no request.
import { finalMessageOf, toolCallsOf, touchedFromStream } from './stream.mjs';

const isBash = (c) => c.name === 'Bash';
const cmd = (c) => String(c.input.command ?? '');
const notHelp = (c) => !/--help|\s-h(\s|$)/.test(cmd(c));
const isRecordCall = (c) => /record_decision$/.test(c.name) || (isBash(c) && notHelp(c) && /\bmnema\s+decision\s+record\b/.test(cmd(c)));

/** Q1 (q-codes): the answer says the CURRENT rule (a stable string code beside the message), what it REPLACED (the class alone, a message only) and WHY (message text broke consumers, one class covers several causes); and the predecessor is named in what mnema returned. */
export function q1(events) {
  const text = finalMessageOf(events);
  const calls = toolCallsOf(events);
  const returned = calls.filter((c) => /mnema/.test(c.name) || (isBash(c) && /\bmnema\b/.test(cmd(c)))).map((c) => c.result ?? '').join('\n');
  return {
    names_current: /(stable )?(string )?code/i.test(text) && /(beside|alongside|next to|with|carr(y|ies)).{0,40}message|message.{0,40}code/i.test(text),
    names_before: /(catch(es)?|caught|by) (the )?class|class(es)? (alone|only)|message only|only a message|used to/i.test(text),
    names_because: /(match(ed|ing)? on|parsing|parse) .{0,30}(message|text)|wording|several causes|branch on|breaking/i.test(text),
    predecessor_named_in_what_mnema_returned: /Exceptions carry a message only/i.test(returned) || /supersed/i.test(returned),
    consulted_mnema: returned.length > 0,
  };
}

/** Q2 (d-*): what the agent recorded, with paths (governs), and what it superseded; whether the reply of a record call offered a path. */
export function q2(events) {
  const calls = toolCallsOf(events);
  const records = calls.filter(isRecordCall);
  const governs = calls.filter((c) => (isBash(c) && /\bmnema\s+link\b.*--rel\s+governs/.test(cmd(c))) || /link|govern/i.test(c.name) || (isRecordCall(c) && (c.input.paths || c.input.addresses || c.input.governs)));
  const supersedes = calls.filter((c) => (isBash(c) && notHelp(c) && /\bmnema\s+decision\s+supersede\b/.test(cmd(c))) || (/decision_transition/.test(c.name) && c.input.action === 'supersede'));
  const offered = records.some((c) => /\b(path|governs|address)/i.test(c.result ?? ''));
  return { recorded: records.length, governs_links: governs.length, supersedes: supersedes.length, reply_offered_a_path: offered, first_record_at_call: records.length ? calls.indexOf(records[0]) : null, total_calls: calls.length };
}

/** Q3 (arm C): `--help` of mnema read before the first record; and a format:check that went red on a file the agent did not write. */
export function q3(events) {
  const calls = toolCallsOf(events).filter(isBash);
  const firstRecord = calls.findIndex((c) => notHelp(c) && /\bmnema\s+decision\s+record\b/.test(cmd(c)));
  const help = calls.findIndex((c) => /\bmnema\b[^|;&]*(--help|\bhelp\b|-h\b)/.test(cmd(c)));
  const wrote = touchedFromStream(events);
  const red = [];
  for (const c of calls.filter((x) => /format:check|prettier\s+--check|biome\s+(check|format)/.test(cmd(x)))) {
    for (const m of String(c.result ?? '').matchAll(/\[warn\]\s+(\S+\.\w+)/g)) red.push(m[1]);
  }
  const unwritten = [...new Set(red)].filter((f) => !wrote.some((w) => w.endsWith(f)));
  return { recorded_at_all: firstRecord >= 0, help_before_first_record: firstRecord >= 0 && help >= 0 && help < firstRecord, help_read: help >= 0, format_check_red_files: [...new Set(red)].length, format_check_red_on_unwritten: unwritten.length };
}
