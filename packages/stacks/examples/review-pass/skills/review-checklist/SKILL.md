---
name: review-checklist
description: Use when reviewing a change. A short checklist of what to read, what to run and what to say, so the verdict covers what it claims to.
license: Apache-2.0
---

# Review checklist

One pass. Work through these in order and write down what you did not do.

1. **The claim.** What does the change say it does? Find the sentence in the description or the
   commit. Everything below is checked against it.
2. **The diff against the claim.** Does each hunk serve the claim? Name any hunk that does not.
3. **The callers.** For each changed function or rule, find who uses it. A change that is right
   for the caller you saw can be wrong for the one you did not.
4. **The tests.** Does a test fail if the behaviour breaks? Prefer one that asserts a value over
   one that only runs the code.
5. **The edges.** Empty input, the largest input, a second call, a failure halfway.
6. **The words.** Do the messages, comments and documentation say only what the code does?

## The verdict

State it first: approve, approve with remarks, or do not approve. Separate what blocks from what
is a remark. Close with the list of what you did not check.
