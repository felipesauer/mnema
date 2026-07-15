---
layout: home

hero:
  name: mnema
  text: A tamper-evident audit trail for AI-agent work
  tagline: You drive, agents execute — every change stamped with who authorized it and which agent ran it, in a log you can prove wasn't altered.
  actions:
    - theme: brand
      text: Client integration
      link: /client-integration
    - theme: alt
      text: Configuration reference
      link: /configuration
    - theme: alt
      text: GitHub
      link: https://github.com/felipesauer/mnema

features:
  - title: Provable
    details: Every mutation appends to a hash-chained, keyed, per-machine-signed audit log. `mnema doctor` detects edits, truncation, replays, deletion, and downgrade.
  - title: Human-in-the-loop
    details: Agents move work through workflow gates that reject invalid transitions. You approve through the terminal; the agent can't route around you.
  - title: Local-first
    details: Zero telemetry, no remote services. SQLite + plain-text Markdown/JSONL in your repo — the files outlive mnema and open in any editor.
---

This site is the reference for [mnema](https://github.com/felipesauer/mnema).
Start with **[Client integration](/client-integration)** to wire an agent to
the rail, or jump to the **[Configuration reference](/configuration)** for
every config key.
