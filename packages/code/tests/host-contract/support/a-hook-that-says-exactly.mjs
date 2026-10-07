// A command hook for `SessionStart` that hands the host exactly as many UTF-16 code units of
// `additionalContext` as it is told, and says in its first characters which text it was. The host's
// ceiling is in that unit, so the text is made of one-unit characters (`a`) or of two-unit ones
// (an emoji), and nothing else is in the string but a marker that is not counted twice.
//
// usage: node a-hook-that-says-exactly.mjs <units> <plain|astral>
const [, , units, kind] = process.argv;
const count = Number(units);
const text = kind === 'astral' ? '\u{1F600}'.repeat(count / 2) : 'a'.repeat(count);
process.stdout.write(
  JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }),
);
