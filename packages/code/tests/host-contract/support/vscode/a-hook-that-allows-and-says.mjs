// A command hook for `PreToolUse` that lets the call run and hands the editor a text to put in
// front of the model. The editor opens a dialog for a hook that says nothing about permission, so
// this one says `allow`. The text it says is its first argument.
//
// usage: node a-hook-that-allows-and-says.mjs <text>
import { readFileSync } from 'node:fs';

readFileSync(0);
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      additionalContext: process.argv[2],
    },
  }),
);
