# Does the skill fire when it should?

**Prepared, not run.** No session of this test has been run against a model. Everything below that
is a fact was checked against the real host with a stand-in where the model would be; everything
about outcomes is a question.

The plugin ships a skill, `recording-decisions`, whose description tells the host when to use it:
when a choice between approaches was just settled, when an option was turned down, or when the
person said how something is to be done. A description is a promise about WHEN, and the host is
what keeps it or not. This test asks the host.

## The two arms

Both arms load a copy of this repository's `plugin/` with `--plugin-dir`, the way the plugin
reaches a person. The second copy has `skills/recording-decisions/` removed **and nothing else**:
the same hooks, the same server, the same command line. It is the baseline WITHOUT the skill.

| arm | what it loads |
|---|---|
| `with-skill` | the plugin, whole |
| `without-skill` | the plugin minus the skill's directory |

## The cases

Twelve prompts, frozen in [`cases.json`](cases.json) before any session: six that should make the
skill fire (a library chosen, an option turned down, a rule stated, a correction, a trade-off
settled, a convention) and six that should not (a typo, a test, a question, a rename, an
explanation, a docstring). Each runs in a fresh copy of the small repository in [`repo/`](repo/),
with a record founded in it and the product's own binary on the cell's `PATH`, so the plugin's
server answers.

## What a session is read for

From the vendor's own event stream (`--output-format stream-json`), and only from tool calls the
session made — never from text, which can name a skill without using it:

- **fired** — the session called the host's `Skill` tool for this skill;
- **recorded** — the session called the server's `record_decision`.

`fired` is the trigger. `recorded` is what the trigger is for, and the only one of the two the
baseline can show.

## The reading, fixed before any session

Per arm, over the `ok` sessions:

1. **fires when it should** — `fired` over the `with-skill` sessions of the six cases that should;
2. **stays quiet when it should not** — `fired` over the `with-skill` sessions of the six that
   should not;
3. **what the skill adds** — `recorded` in `with-skill` against `recorded` in `without-skill`, on
   each kind of case.

No threshold is pre-registered for a pass: twelve cases at four runs is 48 sessions per arm, enough
to describe the behaviour and not to estimate a small rate. The numbers are published as counts.

## The preflight (`node run.mjs --selftest`, free)

1. the cases have the frozen shape — unique ids, both kinds present;
2. the two arms' plugin directories differ in the skill's files and in no other file;
3. **what reaches the model**: the first request the host sends offers the skill, by name and with
   its description, in `with-skill` and not in `without-skill`;
4. **the trigger is read off the stream**: a session scripted to call the skill reads as fired, the
   host resolves the name it was called with (no error result), and a session that calls nothing
   reads as not fired;
5. the credential the cells would copy is there.

## Running it

```
node run.mjs --selftest
node run.mjs --yes                 # 12 cases x 2 arms x 4 runs = 96 sessions on the frozen model
node run.mjs --read results/<date>/cells.jsonl
```

It refuses a CLI other than the one the cases were frozen for (`cli_version` in `cases.json`).

## What it does not promise

- It does not say whether what was recorded was right, or whether a person wanted it recorded.
- It covers one host (Claude Code) and one model.
- `-p` sessions have no person in them: a case that only makes sense in a conversation is not here.
