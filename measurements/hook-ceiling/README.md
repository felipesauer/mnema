# hook ceiling

**How much text one hook hands the model, and what the host does with more.** The host's
documentation says a hook's `additionalContext` is capped at 10,000 characters, that each hook of
an event is measured on its own, and that past the cap the text is saved to a file and replaced by
the path and a preview (code.claude.com/docs/en/hooks, *JSON output*). The two texts a session
opens with — `mnema brief --hook` and `mnema recall --hook` — are cut to stay inside that
ceiling (`packages/code/src/presentation/within-a-hook.ts`), so the number and its unit had to be
measured rather than read: "characters" is three different counts for a string that is not ASCII.

## How

No model was called, and the host is real:

- the `claude` binary installed on this machine, **2.1.281**, run as `claude -p`;
- a `SessionStart` hook of type `command` in a sandboxed settings file, printing
  `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext": T}}` for a text `T`
  of a chosen length — no plugin, no mnema;
- a stand-in for the model API on `127.0.0.1`, in a network namespace with loopback only, with the
  config, the home and the key all inside a per-case sandbox.

**The evidence is the first request the host sends to the stand-in**: text in its `messages` is
text the model would read. Each `T` opens with a marker and is filler after it, so what arrived
can be measured in the request itself.

What each case had to show if the ceiling is 10,000 UTF-16 code units — the JavaScript string
length — was written down before the run, together with what would void it: the 100-character
control not arriving, or the 10,000-character case not arriving whole, would be the harness and
not the host.

## What it found — `results/2026-09-30/cases.json`

| case | the text (code units / code points / bytes) | arrived |
|---|---|---|
| control | 100 / 100 / 100 | whole |
| at the ceiling | 10,000 / 10,000 / 10,000 | whole |
| one past it | 10,001 / 10,001 / 10,001 | **replaced**: a path and a preview of 2,000 |
| 9,999 ASCII + U+1F600 | 10,001 / 10,000 / 10,003 | **replaced** |
| 9,998 ASCII + U+2014 + 1 ASCII | 10,000 / 10,000 / 10,002 | whole |
| two hooks of one event, 9,000 each | 9,000 / 9,000 / 9,000, twice | both whole |

So the ceiling is **10,000 code units, inclusive**: an astral character costs two (the fourth case
has 10,000 code points and was replaced), a three-byte character costs one (the fifth has 10,002
bytes and arrived whole), and two hooks of one event are measured one by one (18,000 in all
arrived). Past the ceiling the whole text is gone from the request: what is there is
`Output too large (9.8KB). Full output saved to: <a path>` and a `Preview (first 2KB):` of the
first 2,000 units, inside a `<persisted-output>` block — with no sentence asking the model to open
the file.

## What it does not show

- **One event, one hook type, one output shape**: `SessionStart`, `command`, JSON
  `hookSpecificOutput`. The per-edit hook is an `mcp_tool` on `PreToolUse` and was not measured
  here.
- **One host, one version**: 2.1.281 on Linux, in `-p` mode. Not the VS Code or Cursor hosts, and
  not an interactive session.
- **n = 1 per case**, and no boundary but the ones in the table: not a surrogate pair split across
  the 10,000th unit, and not where the preview stops when an astral character sits at its edge.
