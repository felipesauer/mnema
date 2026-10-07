# The tools, by host

The skill names the actions, and the server has the same tools in every host: `record_decision`,
`capture_memory`, `record_observation`, `governing_rules`, `search`, `read_record`, `bootstrap`
and `resume`. What differs is how a host spells the name it shows the model.

| Host | What the tool is called |
|---|---|
| Claude Code, with this plugin | `mcp__plugin_mnema_mnema__record_decision`, and likewise for every tool. A server also registered by hand shows the same tools a second time, as `mcp__mnema__record_decision`; one of the two is enough. |
| Cursor | The server is a namespace named `mnema`, and the tools inside it keep their own names: `record_decision`. This is what a Cursor session's request carried when it was read on 23 September 2026. |
| VS Code | The same server and the same tool names. How this host spells the name it shows the model was not measured. |

A host that defers tools hands the model only their names and the server's instructions when a
session starts. If the tool is not callable yet, the host's own tool search finds it by name.

Where a skill says "dispatch a subagent", the host's own name for that varies, and none of it
changes what is asked of the subagent here: it hands its decisions back, and the agent that
dispatched it records them.
