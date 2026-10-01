// The version of the agent CLI is part of the instrument, and it is pinned like the rest.
//
// The rounds that ran were taken on 2.1.228; the host this is written on is 2.1.281, and between
// the two the system prompt and the hook contract moved. The CLI updates itself, and it updates
// the MACHINE's installed binary (a cell's own HOME is thrown away, so nothing a cell sets can
// stop that), which means a round spread over days — and a round by subscription is spread over
// days, because the session limit cuts it — can change the thing it measures between two cells
// and say so nowhere. `cli_version` has been in every line since the first, and nothing read it.
//
// TWO REFUSALS, both before the next cell is spent:
//
//   1. THE ROUND DECLARES IT. A pre-registration may name the version it was written for
//      (`cli_version`, the exact string `claude --version` prints), and a machine whose CLI is
//      another version does not start that round. Rounds 1 to 4 declare none and are not touched.
//   2. IT DOES NOT CHANGE UNDER THE ROUND. Whatever the CLI was at the first cell, a later cell
//      that finds another one stops the round. This holds for every round, pinned or not: a
//      capture whose cells ran on two CLIs is a capture of two instruments.
//
// WHAT THIS DOES NOT DO. It does not stop the update; it makes the update visible at the next
// cell. Setting `DISABLE_AUTOUPDATER` in a cell would be a variable no cell can use — the cell's
// HOME is not where the binary lives — so the guard is a comparison and not a switch.

/** A sentence when the machine's CLI is not the one the round declares, else `null`. */
export function cliPinProblem({ round, declared, actual }) {
  if (declared === null || declared === undefined) return null
  if (actual === declared) return null
  return (
    `round ${round} declares the CLI ${JSON.stringify(declared)} and this machine's is ` +
    `${actual === null ? 'not answering `--version`' : JSON.stringify(actual)}: the round does not start`
  )
}

/** A sentence when the CLI changed after the first cell, else `null`. */
export function cliDriftProblem({ first, now }) {
  if (now === first) return null
  return (
    `the CLI was ${JSON.stringify(first)} at the first cell and is ${now === null ? 'not answering' : JSON.stringify(now)} ` +
    'now: a capture whose cells ran on two CLIs is a capture of two instruments, so the round stops here'
  )
}
