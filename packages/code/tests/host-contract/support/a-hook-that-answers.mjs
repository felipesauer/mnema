// A command hook for `PreToolUse` that answers the permission decision it is told, with a reason,
// whatever the tool — so a case can read what the host does with that answer, apart from mnema.
//
// usage: node a-hook-that-answers.mjs <allow|ask|deny>
const [, , decision] = process.argv;
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: `a hook of the person's own answered ${decision}`,
    },
  }),
);
