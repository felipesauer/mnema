# Files of the kit that are not published, and why

The manifest's kit commit (`prereg.json`, `kit.commit`) holds the files below. They are specific to the two real repositories that stage 2 ran in (the rules copied from an earlier kit and written for them, the prompts of the stage 2 tasks, which name code of theirs, and the script that builds their bases), so they are not published, as the stage 2 traffic is not (ADR-182). Their SHA-256 are the ones the manifest holds.

| file | sha256 (as in the manifest) |
|---|---|
| legacy-provenance.json | 6f537d1cb430ac1224e7ce7c3994de07ef73c4589b635fe8c034af2e62c0ea71 |
| legacy/gen.py | 1407f11a8f3723159c2f02a175300f47007e9bfeef9eab6dca7aa5c3b4588ae7 |
| legacy/kit.py | e50a37a1c9cb81ece8b2cd4ca47f87ebd8d8037804297a2996dcc909e1c5bede |
| legacy/medium/design.py | 2d3e11db4f1a0d280bfebbb7f0e08fb105fe5f83c703de4665e57dfb331ec7b1 |
| legacy/medium/design.yaml | 45040365492465ad135f08608ddf06a85a63e4a0b401cf1d3e38bbafaae1815f |
| legacy/medium/rules-repo-b.yaml | e9af20c9c703772d37bf2451c41d6cf62fda6562c43124676186bbab4cf47549 |
| legacy/rules.yaml | bb25212f7e5edb759216b236f31729b1d12c0f8eaa8a020699b600e0d9f93b95 |
| seed/build-real-bases.sh | 133e3b51e3c666e539c7b0308869131a09007f5feda901b4c481c0d4084010d3 |
| tasks/prompts/d-cache.followup.md | 65e5e1fd13c8d36e7d445cfab0175537695cd14fca9c31caeab4fd124a5c27b4 |
| tasks/prompts/d-cache.md | 5cb387666684c78d3929b083ab87c00a6668868d146bb8817e235aa2ab0860dd |
| tasks/prompts/d-env.followup.md | 5bb958b2c475197132895a3cd295cd2084ace2c71a0f09fdcdabd4383cc83da7 |
| tasks/prompts/d-env.md | 24ed0342ca8ee0661170d5f4814b3f260448db4023c276ec2c4339f1a350039e |
| tasks/prompts/d-retry.followup.md | 09244b66352a8608c07e45edd1c2e40599c8e08f427504a154f110664a27a1dc |
| tasks/prompts/d-retry.md | 4fb1f6f2a3764f104f05b30cb27eb1d2654629b0268421f0d6a9ebbc04612f3a |
| tasks/prompts/q-codes.md | 636a348302f8c411feb282df1305ba4de91784696bf1ed8e508ca008aeb703ac |

The compiled caches `legacy/__pycache__/*.pyc` were also in that commit and are not published. `freeze/prereg.json` of the kit commit is the freeze before the last one; the manifest is `../prereg.json`.
