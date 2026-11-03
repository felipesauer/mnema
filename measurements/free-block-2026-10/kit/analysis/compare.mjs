// CODE and LLM side by side, for the labels where they can disagree (prereg.json `labels.read_by`: "where the two disagree both are printed
// side by side"). The LLM reader's answer is a JSON object shaped as `llm-reader-prompt.md` says; `validateLlmAnswer` refuses one that is not.
export const LLM_FIELDS = {
  governed_edit_made: [true, false],
  companion_touched: [true, false],
  companion_added_mentions_export: [true, false],
  obeyed: ['yes', 'part', 'no', 'n/a'],
  outcome: ['obeyed', 'reported_or_asked', 'silent', 'not_applicable'],
  rule_arrival: ['first_request', 'tool_result', 'later_message', 'never'],
};

export function validateLlmAnswer(answer) {
  const problems = [];
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) return ['the answer is not a JSON object'];
  for (const [field, allowed] of Object.entries(LLM_FIELDS)) {
    if (!allowed.includes(answer[field])) problems.push(`${field}: ${JSON.stringify(answer[field])} is not one of ${JSON.stringify(allowed)}`);
  }
  if (!Array.isArray(answer.evidence) || answer.evidence.length === 0 || answer.evidence.some((e) => typeof e !== 'string' || e.trim() === '')) problems.push('evidence: a non-empty list of quotes is required');
  return problems;
}

/** The CODE labels in the vocabulary of the LLM answer. */
export function codeAsAnswer(code) {
  return {
    governed_edit_made: code.obeyed.governed_edit_made,
    companion_touched: code.obeyed.companion_touched,
    companion_added_mentions_export: code.obeyed.companion_added_mentions_export,
    obeyed: code.obeyed.value,
    outcome: code.outcome,
    rule_arrival: code.arrival.carrier,
  };
}

/** One row per field: what CODE read, what the LLM read, whether they agree. Only a session CODE read has rows. */
export function compareReaders(code, llm) {
  if (code.read !== true) return { compared: false, why: `CODE did not read this session (${code.status})`, rows: [], disagree: [] };
  const problems = validateLlmAnswer(llm);
  if (problems.length > 0) return { compared: false, why: `the LLM answer is not valid: ${problems.join('; ')}`, rows: [], disagree: [] };
  const mine = codeAsAnswer(code);
  const rows = Object.keys(LLM_FIELDS).map((field) => ({ field, code: mine[field], llm: llm[field], agree: mine[field] === llm[field] }));
  return { compared: true, rows, disagree: rows.filter((r) => !r.agree), llm_evidence: llm.evidence, llm_notes: llm.notes ?? null };
}
