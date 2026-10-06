# What was measured

Six tasks where the right move depends on a decision the code does not reveal, four
runs of each in every arm, the same agent and model throughout — Claude Haiku 4.5,
on 21 August 2026, in 160 cells counting the two negative controls and the two
development tasks that ran beside them:

| arm | what the agent had | followed the team's decision, over the six tasks |
|---|---|---|
| `base` | no record, no memory, no decision file | **33.3%** |
| `host` | the decision in the host's own automatic memory | **100.0%** |
| `mnema-doc` | the decision in mnema's record, handed over as the session opened | **100.0%** |
| `mnema+` | the same, and the rules for a file handed over at each edit | **100.0%** |

Handing the decision over moves the agent from 33.3% to 100.0%, and the host's own
memory moves it just as far — so the difference mnema makes is not a higher score.
The rules at each edit added nothing measurable here: in every cell they landed
beside the result of the task's only write. What mnema changes is where the decision
lives — in the repository, shared by the team, in the diff of the pull request,
superseded rather than overwritten, and checkable by anyone. And what was measured
is conformance to a recorded decision, not whether the decision was right. The
protocol, the arms, the rule the round was read by and every cell's verdict are in
[`measurements/p1/`](../measurements/p1/), and these numbers are in
[the round's report](../measurements/p1/results/2026-08-21-full/report.md).
