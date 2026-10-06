# What VS Code and Cursor hand to the model

This document summarizes public evidence about what text from mnema reaches the model on two coding agents: VS Code's Copilot Chat and Cursor's command-line agent.

## VS Code: Copilot Chat 0.65

**Measured:** VS Code 1.137 with Copilot Chat 0.65, 21 cases tested offline with local backend, 30 September 2026.

### What reaches the model

The mnema plugin hands three types of text at session start:

- **`brief`** — decision summary text — arrives complete in the system message
- **`recall`** — context about recent decisions — arrives complete in the system message  
- **`instructions`** — the server's capabilities and rules — arrives complete in seven model families, as a labelled instruction block; absent in five others

All three arrive under the heading "Additional instructions from hooks" in the model's opening system message.

### When descriptions arrive

Tool descriptions do not arrive in the opening message. When the model calls a tool, VS Code asks for descriptions on demand (`GetDynamicTools`), which then reach the model before the call proceeds.

### Size of the text

- `brief`: full text of each decision's summary, word-for-word
- `recall`: full text of recent memo notes, word-for-word
- `instructions`: the complete server definition — 1,755 characters in the measured case

## Cursor: command-line agent 2026.09.18

**Measured:** Cursor's command-line agent 2026.09.18-9a7762b on the free plan, with the `Auto`/Composer model, 4 sessions tested on 23 September 2026. Backend behaviour read from the chat database the agent keeps locally.

### What reaches the model

The mnema plugin hands text at session start, delivered by Cursor's backend to the model:

- **`brief`** — 1,975 characters, word-for-word in the model's opening message
- **`recall`** — 761 characters, word-for-word in the model's opening message
- **`instructions`** — 1,755 characters, whole except for indentation: continuation lines that start with two spaces arrive with one space

All three arrive in the first user message under "Additional context provided by session hooks."

### When descriptions arrive

Tool descriptions do not arrive in the opening message. When the model calls a tool, Cursor's backend fetches descriptions on demand. The model called tools in all four sessions; descriptions arrived each time before the model completed a call.

### What the model used

All three text types that arrived were in the model's prompt when asked to reproduce specific tokens from each. The model is constrained to Composer (the automatic model selector in Cursor's free plan).

## Method

Both measurements were made by:

1. **Reading what the host passes to the backend** — the opening message and tool metadata
2. **Observing what the backend hand to the model** — the prompt the backend sends, read from the agent's local chat database
3. **Asking the model to reproduce marked text** — embedding unique random tokens in the text and asking the model to return them, to confirm arrival

Neither measurement examined what happens after the model receives the prompt. Cursor's backend and VS Code's model selection run outside the measured system; this summary concerns only what leaves the agent and reaches the point of model invocation.

## Measured versions

- **Cursor**: agent binary 2026.09.18-9a7762b, free plan (no paid plan tested)
- **VS Code**: 1.137.0, Copilot Chat 0.65.0
- **mnema**: production build from commit `bf4bc077` (VS Code), `bf4bc077` (Cursor)

## Scope

- **VS Code measured**: Copilot Chat on the free tier, tested offline
- **Cursor measured**: command-line agent on the free plan, with the `Auto` model (Composer), 4 sessions
- **Not measured**: VS Code's paid tier, Cursor's Hobby or Pro plans, Cursor's editor, other models on either platform, backend transformations or model responses, what the model did with the text after receiving it

## When evidence is not public

The raw measurements — transcripts, database exports, token counts — live in `.refactor/archive/` because they contain paths and skills. This summary extracts only what the product needs to promise.
