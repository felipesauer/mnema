# Captures made by hand

Some of what the plugin hands a host cannot be read on a free runner. Cursor's command-line agent
needs an account, and the model behind it is the vendor's, so nothing here starts it from a workflow:
what is known of it is read by a person, on a machine that has the account, from the script in this
folder, and kept as a dated file.

A capture is **a reading, not a test**. Nothing in this repository reruns it and nothing fails when it
goes stale, so a page that cites one says *captured by hand on `<date>`, Cursor CLI `<version>`* and
never *tested*. It expires with the version it was read on.

| File | What it is |
|---|---|
| [`cursor-script.md`](cursor-script.md) | The script a person follows to read Cursor's agent: the project to make, the three cases, how to take the transcript and how to redact it. |
| [`cursor-capture.template.json`](cursor-capture.template.json) | The shape of the result. A capture is a copy of it, filled in, named `cursor-<date>.json`. |

What a capture holds is what the standard for a test execution record asks of one: the environment
(the date, the exact version of the agent and the SHA-256 of the file that ran, the machine), who read
it and how, the commit of the script and of the plugin that was read, the transcript with its secrets
removed, and a verdict per case in three words: `held`, `did-not-hold`, `not-run`.

## When to make another

When a hook of the plugin changes, when Cursor releases a version of its agent, or when a page that
cites a capture is about to say something its capture does not. A new capture is a new file; an old one
is never edited, so a reader can see what was read when.

## What a capture does not do

- It does not start Cursor for anyone but the person making it, and it asks nobody for a key: the agent
  is logged in by that person, on that person's machine, and no file here may hold a credential.
- It does not say the model read what the host handed it, or followed it. It says what the host did
  with what the plugin handed it, in one version, once.
- It does not cover a tool of Cursor's that the script does not name. Of the editing tools, the script
  asks for `Write` only, because that is the one that has been read.
- It is not part of the evidence page's table of held claims, and no test cites it.
