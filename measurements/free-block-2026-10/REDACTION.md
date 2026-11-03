# What was redacted in the published copies, and how

The sessions of the free block ran on the maintainer's machine, and what they recorded carries its paths: the folder the
runs were made in, the home folder, and the user name inside them. This repository does not publish anything that
shows the machine, so every text file and every gzip of `results/` and of `kit/results/` was copied through one
fixed table of substitutions before it was committed. The same table was applied to every file, and nothing else was
changed in them: no line was dropped, no value was edited, and no number was touched. **The published traffic and log files
are redacted copies. The originals, byte for byte, stay in the maintainer's private kit repository.**

## The table

Applied in this order, each over the whole content of a file (a `.gz` is decompressed, redacted and compressed again with a fixed header):

| Rule | What it matches | Becomes | Times |
|---|---|---|---|
| R0 | the run folder as a host wrote it inside its own paths, dash-encoded (`-tmp-<uid-folder>--home-<user>-...-scratchpad`) | `-RUNS` | 61 |
| R1 | the folder the runs were made in: `/tmp/<uid-folder>/-home-<user>-Documents-Personal-Me--projects-mnema/<session id>/scratchpad` | `<RUNS>` | 1816 |
| R2 | the maintainer's home path down to the kit folder (`/home/<user>/.../mnema/ab-free-block`, two spellings of the private repository's folder) | `<KIT>` | 11 |
| R3 | any other path under the maintainer's home folder | `<HOME>` | 0 |
| R4 | what is left of the folder of rule R1 when a host cut the text short (`/tmp/<uid-folder>` and the `-home-...` part, with or without a start of the session id) | `<SESSIONS>` | 11 |
| R5 | the machine's host name | `<HOST>` | 0 |
| R6 | the user name, in any other place | `<USER>` | 0 |
| R7 | the user id folder of `/tmp`, in any other place | `<UID>` | 0 |
| R8 | the em dash (U+2014) in a text file that is not a gzip (the repository bans it; the compressed traffic is not text to that rule and keeps its characters) | the en dash (U+2013) | 3 |

1902 substitutions in 30 of the 113 files. R3, R5, R6 and R7 matched nothing after the rules before them ran,
and stay in the table so the rule is the same for any file added. After the table, a scan of the whole published tree (each gzip decompressed)
found no user name, host name, home path, uid folder, private address, MAC address, `USER`, `LOGNAME`, `HOSTNAME` or `PWD` value, or `uname` output in `results/` or `kit/results/`.
The first scan, before the table, had found 3796 matches of these in the same files.

## What the redaction did not change

The reading of CODE (`analysis/labels.mjs`, the kit's own) was run again over the redacted copies of the five measured sessions:
its output is identical to the one over the originals and to each session's recorded `labels.json`, for every session. The second reader's
`llm-reader.json` files were not produced again (a call costs money and the maintainer's subscription): they were written over the
originals, and what is published is their redacted text. The kit's `freeze/` and the code were not redacted: the manifest holds their hashes.

## Every published file, with the SHA-256 of the original and of the published copy

A file the table did not change has the same hash twice. For a `.gz`, the first pair is of the file as stored and the second of the content once decompressed.

| File | Original | Published | Substitutions |
|---|---|---|---|
| `results/codex.summary.json` | `477feac30a1b1412c4730fbbf6c1e82af601105722838288715e6b2bbbbbac18` | `477feac30a1b1412c4730fbbf6c1e82af601105722838288715e6b2bbbbbac18` | none |
| `results/copilot-cut-revision-5.summary.json` | `634ba7a449471fe4fcef5d404eea9f3128418e9c7479b4a604f21c56e24fb493` | `634ba7a449471fe4fcef5d404eea9f3128418e9c7479b4a604f21c56e24fb493` | none |
| `results/copilot-redo.summary.json` | `7d771dd2a8e41738a59ee5eb51d8bb7ae503d48631dc41228adacf6779d7bed9` | `7d771dd2a8e41738a59ee5eb51d8bb7ae503d48631dc41228adacf6779d7bed9` | none |
| `results/opencode.summary.json` | `98baea324bf21965a9384d0da406471674c0a8802edfddc1aced978eb27816f8` | `98baea324bf21965a9384d0da406471674c0a8802edfddc1aced978eb27816f8` | none |
| `results/qwen.summary.json` | `c548efdea67bd16989a34c90a9d1d5a84af45f8e1a18b81818c846f582381599` | `c548efdea67bd16989a34c90a9d1d5a84af45f8e1a18b81818c846f582381599` | none |
| `kit/results/codex/host-output.txt` | `273c727b971e534a5d6156c189f8ae35655edf640692a96258358017ecee4d3f` | `c49ff3a719801a6a05de29d1f9d553cc1e88f14eb7e2523983e1b181f14702d9` | R1 x2 |
| `kit/results/codex/install-output.txt` | `a70e318ac66a7b6473c0d10ac0207c78bdab8c9297a9533295873f4d86e17bab` | `5b4e4bb4ecfc92df297dbea37c45d542e5797e7c25f50028b696d2d47ceeba5e` | R1 x4, R2 x2 |
| `kit/results/codex/meta.json` | `1a3cc3dea2d810ade9c076e879b797ad446841c8f57c1291d1986f85640ba16e` | `1a3cc3dea2d810ade9c076e879b797ad446841c8f57c1291d1986f85640ba16e` | none |
| `kit/results/codex/outcome.json` | `f9dfb871199c4dbb0361fa78be9b81990328fdea5e77890439aa9f8e320de96c` | `a5eba8877a8a9b05c415c6c74caa6e063cd645b35f84ff82b415cc2f5f1547c7` | R1 x1 |
| `kit/results/codex/relay.log` | `26d85e87d9af63da0133669eaa5abc3eed902da409de99abee1bf5009ae4cd17` | `26d85e87d9af63da0133669eaa5abc3eed902da409de99abee1bf5009ae4cd17` | none |
| `kit/results/codex/served-verified.json` | `ae787f07b6219d92d66a949c3b7e0c10a3288db488449937cbb9b02bc3a92b4d` | `ae787f07b6219d92d66a949c3b7e0c10a3288db488449937cbb9b02bc3a92b4d` | none |
| `kit/results/codex/verdict.json` | `9ffcc4f06536c94e26c3160abf2db04f28c0db21c92c34b4d61762ed97ca38e2` | `338d463375123b9832af414de6e9bdc9610f4e6e8f13b6742f86b31532987dc9` | R1 x2, R4 x2 |
| `kit/results/codex/wire.jsonl.gz` | `3766286b53902671551e62bb20e13b9ef3690461fd2916f7d488b41e7d752dfd` | `c553e0d27b4cc7d125fb6247de7edd3de17ab223a2afba4dc243cd46518f12a9` | R1 x30 |
| `kit/results/codex/wire.jsonl.gz` (decompressed) | `e7a1564c6c4e2e7036f4fe73ce7a6410f2c085e7d2d9bf4b8cb9e8cd30c132b3` | `ca652ae05e7e376fb5d4085863b3e0b0bd6923d97d80e18382bed37a3352f032` | |
| `kit/results/codex-hooks-trusted/hook-proof.json` | `14064ed8c3a210d138db6e06e112dd74c5309ae4fbaa272b2f0a62391477b506` | `14064ed8c3a210d138db6e06e112dd74c5309ae4fbaa272b2f0a62391477b506` | none |
| `kit/results/codex-hooks-trusted/hook-trust.json` | `fd9051ae731bcb8e09719887dc12c952f0cff5abfa829fc8bb6acb23a8d58dc1` | `fd9051ae731bcb8e09719887dc12c952f0cff5abfa829fc8bb6acb23a8d58dc1` | none |
| `kit/results/codex-hooks-trusted/host-output.txt` | `c6e5ce3d926365bf03a581c9816da0a78c8c39a4920a4a0535fb39a858c9db3e` | `2ee82ca3731156051f5257a007864931fd47f1fbf57bf0aeb44a81dfe7d0e2e5` | R1 x4 |
| `kit/results/codex-hooks-trusted/install-output.txt` | `b7da9e5acc926496750e68d9297e31d5df0b956ed2ad464daddc4f9f90c6467c` | `92904e6a4fd55a50914cc1f6cc71331512dc1c7d9e8dc13547f91492ab9bc7aa` | R1 x4, R2 x2 |
| `kit/results/codex-hooks-trusted/meta.json` | `33acb3d3e228ed0e120914fb2160e7268592d32498039ddccc689068dbe1fa76` | `33acb3d3e228ed0e120914fb2160e7268592d32498039ddccc689068dbe1fa76` | none |
| `kit/results/codex-hooks-trusted/outcome.json` | `b1b542151d0cbdddc2759492c7b6a81f0ab1e475d43b60ead3b2c4d8a8b92baa` | `a2f037bbe60e49fd90532a9347f1715bb1763d7cbd819676982d7bdb86f1151e` | R1 x1 |
| `kit/results/codex-hooks-trusted/relay.log` | `70e4cefd96a422545f0334342903e45a7c8209eadfc03945f7f73a0358594619` | `70e4cefd96a422545f0334342903e45a7c8209eadfc03945f7f73a0358594619` | none |
| `kit/results/codex-hooks-trusted/served-verified.json` | `ae787f07b6219d92d66a949c3b7e0c10a3288db488449937cbb9b02bc3a92b4d` | `ae787f07b6219d92d66a949c3b7e0c10a3288db488449937cbb9b02bc3a92b4d` | none |
| `kit/results/codex-hooks-trusted/verdict.json` | `f27c2b520f288749b9a263bf04a454a566fb7d2377913ff48984d34d5553e6ac` | `67d8ed0f6bcc9b187ff81440da7d8448a5b9384293a60e011b10efcecc0fa204` | R1 x2, R4 x2 |
| `kit/results/codex-hooks-trusted/wire.jsonl.gz` | `3a1c951e24d075117b64bf088421e172967df586345b84a2911479ac7322c207` | `a3f1ef7061b1664b2dbafe89cedbd3e869a339ce1ed7f743f1b0e59675b84ef0` | R1 x30 |
| `kit/results/codex-hooks-trusted/wire.jsonl.gz` (decompressed) | `602c66832802ca85d7b3d23aa41303c5c8e23f1cfb4878f81d074c3332bed636` | `d028f536b0c7ff2045a9d2352684a76c915d6c07d88d3f76010b5a76213592b7` | |
| `kit/results/copilot/host-output.txt` | `6b2c0938d898ecda4d33a92ac5983efdbf74d12d4d68823c718b31a116202da1` | `a0032f6ef0bc902da2c3c91af32beb22d6f828b2e98ed30a19cc7598d5fe16fd` | R4 x1 |
| `kit/results/copilot/install-output.txt` | `ee7a8be4e2f62c3936c8a485df61d0e093f8a88cffa061b330cea614ec4d9967` | `444a50f4392560951fb0bebcb4d0ee29b9ddf75fa81d9793f9301a5c3d7e402f` | R2 x1, R8 x1 |
| `kit/results/copilot/meta.json` | `641bd13a3c01c0de84e66334eb6bf39440082341e4dd244de2b14eb4c08835e6` | `641bd13a3c01c0de84e66334eb6bf39440082341e4dd244de2b14eb4c08835e6` | none |
| `kit/results/copilot/outcome.json` | `29a43ec6429920e1fc82f223f25e26e47c3ef353afca491a49ec33163ef0111b` | `29a43ec6429920e1fc82f223f25e26e47c3ef353afca491a49ec33163ef0111b` | none |
| `kit/results/copilot/relay.log` | `bfbbbd7b9360a3c3cccee604d9cfb1d6c07380ec009d6872eeac0abc26def6bf` | `bfbbbd7b9360a3c3cccee604d9cfb1d6c07380ec009d6872eeac0abc26def6bf` | none |
| `kit/results/copilot/served-verified.json` | `ae787f07b6219d92d66a949c3b7e0c10a3288db488449937cbb9b02bc3a92b4d` | `ae787f07b6219d92d66a949c3b7e0c10a3288db488449937cbb9b02bc3a92b4d` | none |
| `kit/results/copilot/verdict.json` | `8f605ff79fcd9087b8cf1e8246a4fa2bab2d894e5ac2f5e2e94223b5d8f7bbfa` | `45dea943354de8abfd796bfcddb0ed6417fa4dd20064754467ea00d8115ee48a` | R1 x1, R4 x2 |
| `kit/results/copilot/wire.jsonl.gz` | `63cc5ab88d26688f371b0221ce51eeeccaa7be8fc18f66f5efeeaffead7ddbb8` | `aa4423e41c23e85915f4e09917b17447d8e88a69752e12de12bfa212d74b6b90` | R1 x18 |
| `kit/results/copilot/wire.jsonl.gz` (decompressed) | `2b1b057d1d6ad21cea882803781f980b25822349ee9d46ecedb841f2fd33842b` | `85ef27ba5f167cb23c365e059c247e0c8a423dba8d517c6a6b04133c3f2572f1` | |
| `kit/results/direct/meta.json` | `f6b076f10f290dac4ac63f884c3ef11d78d6e80196cd4676fe8ed76f2013c49c` | `f6b076f10f290dac4ac63f884c3ef11d78d6e80196cd4676fe8ed76f2013c49c` | none |
| `kit/results/direct/relay.log` | `d8720f5e2c64af9da41248bc2a7663e9be5ae3968a4d837f562ab8456acb5e44` | `d8720f5e2c64af9da41248bc2a7663e9be5ae3968a4d837f562ab8456acb5e44` | none |
| `kit/results/direct/served-verified.json` | `ae787f07b6219d92d66a949c3b7e0c10a3288db488449937cbb9b02bc3a92b4d` | `ae787f07b6219d92d66a949c3b7e0c10a3288db488449937cbb9b02bc3a92b4d` | none |
| `kit/results/direct/verdict.json` | `f86ffda291e56738496ef4eb9fd306463e7a0b72da000646efa983f014d6990a` | `f86ffda291e56738496ef4eb9fd306463e7a0b72da000646efa983f014d6990a` | none |
| `kit/results/direct/wire.jsonl.gz` | `b9c9ffc458b815d76a600eedc4eec65a75c8780f6d730f5f77c9c8c152432b0a` | `b9c9ffc458b815d76a600eedc4eec65a75c8780f6d730f5f77c9c8c152432b0a` | none |
| `kit/results/direct/wire.jsonl.gz` (decompressed) | `29d4d302b894a575e75933a6c98fca0b572c824fbce095ffa801d3bf63149883` | `29d4d302b894a575e75933a6c98fca0b572c824fbce095ffa801d3bf63149883` | |
| `kit/results/opencode/host-output.txt` | `c17cf6d30447ed31a057328b55313f25698b5283bfc55ee683a9765032d32a1b` | `c17cf6d30447ed31a057328b55313f25698b5283bfc55ee683a9765032d32a1b` | none |
| `kit/results/opencode/install-output.txt` | `02276e701e96a2ba08db2025dddce58c6f0371e0c7f161569984af410236a8cf` | `02276e701e96a2ba08db2025dddce58c6f0371e0c7f161569984af410236a8cf` | none |
| `kit/results/opencode/meta.json` | `b962a46c8660ea93a93103fef7bc551018650a9e789418e11688066cc870ccde` | `b962a46c8660ea93a93103fef7bc551018650a9e789418e11688066cc870ccde` | none |
| `kit/results/opencode/outcome.json` | `244775254faf5fbe2bc1b344b468ddce1093652f936058fc543f97df8e7bda2e` | `244775254faf5fbe2bc1b344b468ddce1093652f936058fc543f97df8e7bda2e` | none |
| `kit/results/opencode/relay.log` | `e80e6d382a17bb14675933db4d5d1226b9afd6eb7c73f629c200e2cd45bfea9c` | `e80e6d382a17bb14675933db4d5d1226b9afd6eb7c73f629c200e2cd45bfea9c` | none |
| `kit/results/opencode/served-verified.json` | `d569efcf97fbb5794d7ccd098edf51bf7c9e14188ae94eaa428417c25b31f300` | `d569efcf97fbb5794d7ccd098edf51bf7c9e14188ae94eaa428417c25b31f300` | none |
| `kit/results/opencode/verdict.json` | `605674dfd931fd9daf85660f46e81290f58c26805cdf467ce72e225b0af2cbdf` | `ebf48155e4286ef138a677bf534e039b4e09bb0877e6958ba5b204b5d070b6ae` | R1 x1, R4 x2 |
| `kit/results/opencode/wire.jsonl.gz` | `3ae5b8d0adacc15a3b902d99b2fb8ffef3b6124df42c6f31c083b1c5469b8654` | `441a949a6753cf7dca794b122c45f1b99c96fce9a0c9df419f7a8b555d2d2952` | R1 x18 |
| `kit/results/opencode/wire.jsonl.gz` (decompressed) | `bf21df83af3f05bb8fb4661deebbc25b986e67e316cf0d3256dd75233a7a6f27` | `9e31f5884a7ffdf5cfe88528b907746e621e907364fac90cedde1be52bc4421f` | |
| `kit/results/qwen/host-output.txt` | `257183ca0492845c42f5c7e1ec1c38a27b6460b4d1ec0c70e106a3b5e47ec80a` | `257183ca0492845c42f5c7e1ec1c38a27b6460b4d1ec0c70e106a3b5e47ec80a` | none |
| `kit/results/qwen/install-output.txt` | `84659b3f96cd8009b6618c6ba6d05f2796ad360454a61ae6d1187ac52637ba49` | `9b9f68b5ee03e98347941aa18148dd9ab987f60d926a521b3362e5bad11879a6` | R2 x1 |
| `kit/results/qwen/meta.json` | `da4a3f0b91619704ca1800a0e248096b0d57a200ffb1405d15301e328d37d51e` | `da4a3f0b91619704ca1800a0e248096b0d57a200ffb1405d15301e328d37d51e` | none |
| `kit/results/qwen/outcome.json` | `50f0e8a8daae2fb19fb8a6ed92e4432dffd31e6e2b0b0fe596be32e32b4450d2` | `50f0e8a8daae2fb19fb8a6ed92e4432dffd31e6e2b0b0fe596be32e32b4450d2` | none |
| `kit/results/qwen/relay.log` | `fa242e0637773bb052b7a2822446503a8121e0c744bd80730ac72ba963e2fe5a` | `fa242e0637773bb052b7a2822446503a8121e0c744bd80730ac72ba963e2fe5a` | none |
| `kit/results/qwen/served-verified.json` | `e67aff8f5fe52d20bcaa97ebac28cce02e212452deaace724b0f2333b7fa7c40` | `e67aff8f5fe52d20bcaa97ebac28cce02e212452deaace724b0f2333b7fa7c40` | none |
| `kit/results/qwen/verdict.json` | `7741e66c1690ab5f604557d08ab1328d1356879bb688feda65e3bf676f4ff200` | `df9279732e152607f87c5f33815d4b35b435189a6ef0c3aaec54a87e46e69025` | R1 x1, R4 x2 |
| `kit/results/qwen/wire.jsonl.gz` | `128808a314b174d78171d5cf4220e4186895d9c05ba3ce7b7a74a561ae23825a` | `c72fd01484073ba00008ec8eee4278efcc2a65fa2c591bce36a41bca9dee4e86` | R0 x20, R1 x72 |
| `kit/results/qwen/wire.jsonl.gz` (decompressed) | `0946b71475526d6cab849a64fc400a49702cc800074e703ab7b27600c5663cbc` | `14b67408daf3e5123f4fddcefa0f89aa589ecb5f48078f3ebe4c34dac9df4f0c` | |
| `results/codex/hook-trust.json` | `fd9051ae731bcb8e09719887dc12c952f0cff5abfa829fc8bb6acb23a8d58dc1` | `fd9051ae731bcb8e09719887dc12c952f0cff5abfa829fc8bb6acb23a8d58dc1` | none |
| `results/codex/host-output.txt` | `0b2c86ee2a4e204e66061ddc4cb31651b6056e718e59f450acfb236fee6a154e` | `14060c01a17c160761e92281cdcaacbc6e7800a9e6e46ba5332104b875064af4` | R1 x45 |
| `results/codex/install-output.txt` | `dd5633be52ef64a36b02f87189d6763d2bc3d78faec211aabb7aeb32d2c2aced` | `a9cfcde4e1cc01a2da58beb25f85194af7c3b68f582259fe139867a6629e5d12` | R1 x3, R2 x2 |
| `results/codex/labels.json` | `36e4a3f3cf277db6f3931a687ade23e5f529bbd954a4de3ebee65408f24c14db` | `36e4a3f3cf277db6f3931a687ade23e5f529bbd954a4de3ebee65408f24c14db` | none |
| `results/codex/llm-reader.json` | `1627f179069b283c13f9fa93cf77d4cd4083051864187806684ee333a0c6ff78` | `1627f179069b283c13f9fa93cf77d4cd4083051864187806684ee333a0c6ff78` | none |
| `results/codex/meta.json` | `24f5f91a94ac8982104ea155e628912d26e57b75d5a62230905bb10a97360e35` | `24f5f91a94ac8982104ea155e628912d26e57b75d5a62230905bb10a97360e35` | none |
| `results/codex/outcome.json` | `83a331b7650ca615421f7d855879b80bf135d16d371fb578377bc5ec14ac9300` | `83a331b7650ca615421f7d855879b80bf135d16d371fb578377bc5ec14ac9300` | none |
| `results/codex/relay.log` | `077ee7f6ed9c1a45ffde5d7d3227758b905cad9f8c97e65096c6e1861487b2f9` | `077ee7f6ed9c1a45ffde5d7d3227758b905cad9f8c97e65096c6e1861487b2f9` | none |
| `results/codex/repo.json` | `80a20ec557c619969128879f666b8d057b43b312acb3b97907f90c740a92e49b` | `80a20ec557c619969128879f666b8d057b43b312acb3b97907f90c740a92e49b` | none |
| `results/codex/served-verified.json` | `609b2d5fe1194299e73ee9b4173e71704d89ead2a3b9f6d3172a9f3113c50c7d` | `609b2d5fe1194299e73ee9b4173e71704d89ead2a3b9f6d3172a9f3113c50c7d` | none |
| `results/codex/start.json` | `bd30000d2025d2ad0378451b35aede44668025060cd74521e9a4f3389222909b` | `bd30000d2025d2ad0378451b35aede44668025060cd74521e9a4f3389222909b` | none |
| `results/codex/summary.json` | `477feac30a1b1412c4730fbbf6c1e82af601105722838288715e6b2bbbbbac18` | `477feac30a1b1412c4730fbbf6c1e82af601105722838288715e6b2bbbbbac18` | none |
| `results/codex/wire.jsonl.gz` | `172af0648e211c0e27d0bbbc24de7208d3bbdde5510863bac376bce72f8d3342` | `8f23b70212477cb59d221ff273423e20a9031a20339db982bbd5771f08ee102e` | R1 x607 |
| `results/codex/wire.jsonl.gz` (decompressed) | `447eb95c9afb7655fe36dc9be1c56bda7ba8214ae97d20d667702b47d3354be1` | `7cf7e1adad81365d23d4d4d88d71b2d8b697624e1750af3ed6e3b2d4f54f7baa` | |
| `results/copilot-cut-revision-5/host-output.txt` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | none |
| `results/copilot-cut-revision-5/install-output.txt` | `8c226f712b485dd17c30b48607995ce287a0cb133c3cc69d7e43134f2b0ba1e4` | `25876ee414f301b8fdb48367bba5630a18f1017d75eb5b0ed20d253f6889ac9c` | R2 x1, R8 x1 |
| `results/copilot-cut-revision-5/labels.json` | `6fa74637cca7db0bbd59dbc572469ed4c1f010678d285d874b107c6aa7063771` | `6fa74637cca7db0bbd59dbc572469ed4c1f010678d285d874b107c6aa7063771` | none |
| `results/copilot-cut-revision-5/meta.json` | `ef65e70cdf930554ac9dc420230a72550598bc2acae17f1d69c31e70d3aa5110` | `ef65e70cdf930554ac9dc420230a72550598bc2acae17f1d69c31e70d3aa5110` | none |
| `results/copilot-cut-revision-5/outcome.json` | `c4c44fcc8c9a8585d7c082850ef419ec599d56eac0ab06a4d1c676dddd315aa5` | `c4c44fcc8c9a8585d7c082850ef419ec599d56eac0ab06a4d1c676dddd315aa5` | none |
| `results/copilot-cut-revision-5/relay.log` | `e1f8a886a974e6706b4b7ffbc7538410248c8627bce48377ba8f1efc02a6a59b` | `e1f8a886a974e6706b4b7ffbc7538410248c8627bce48377ba8f1efc02a6a59b` | none |
| `results/copilot-cut-revision-5/repo.json` | `a44c3bc46213c9bf1b76017140b91c5671817dd3c6a189cd23c46a2d72bfec50` | `a44c3bc46213c9bf1b76017140b91c5671817dd3c6a189cd23c46a2d72bfec50` | none |
| `results/copilot-cut-revision-5/served-verified.json` | `37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570` | `37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570` | none |
| `results/copilot-cut-revision-5/start.json` | `93eb07802f01dbc1a6e37facdc5a2a4275e4ffb8c5a0d3a03d546cc3ad1147f0` | `93eb07802f01dbc1a6e37facdc5a2a4275e4ffb8c5a0d3a03d546cc3ad1147f0` | none |
| `results/copilot-cut-revision-5/summary.json` | `634ba7a449471fe4fcef5d404eea9f3128418e9c7479b4a604f21c56e24fb493` | `634ba7a449471fe4fcef5d404eea9f3128418e9c7479b4a604f21c56e24fb493` | none |
| `results/copilot-cut-revision-5/wire.jsonl.gz` | `b15c862005ab36585f55ce6c9ab60d0cb58ac1a71988a79b07ec390d44f26516` | `11682d81a81620751aa5bdde6e3e0bc7968e5581aeec1254d1cca95bab47b4da` | R1 x3 |
| `results/copilot-cut-revision-5/wire.jsonl.gz` (decompressed) | `c750272b3bfeb0c8188ff5be2217e4f83552aa331495d740a305983344f2359e` | `bbd02a4446c9a95664a8f4a187fe55c2736b8c06407ec21d13d4ff2328818153` | |
| `results/copilot-redo/host-output.txt` | `9c6622f663ee71fd9308d060130847edbf08681d13d4436741b763757a219579` | `9c6622f663ee71fd9308d060130847edbf08681d13d4436741b763757a219579` | none |
| `results/copilot-redo/install-output.txt` | `8c226f712b485dd17c30b48607995ce287a0cb133c3cc69d7e43134f2b0ba1e4` | `25876ee414f301b8fdb48367bba5630a18f1017d75eb5b0ed20d253f6889ac9c` | R2 x1, R8 x1 |
| `results/copilot-redo/labels.json` | `0c98433b62189d1bb1cb87c7f98de50493b317473cc1fdecc9e95bccc2844f2d` | `0c98433b62189d1bb1cb87c7f98de50493b317473cc1fdecc9e95bccc2844f2d` | none |
| `results/copilot-redo/llm-reader.json` | `42d3282862589293f4d4f7ece2ae48bfc410bbae77ad2310741ce335424a0cc6` | `42d3282862589293f4d4f7ece2ae48bfc410bbae77ad2310741ce335424a0cc6` | none |
| `results/copilot-redo/meta.json` | `264a82fa77d5221f373cbc42709916db9cc199fd70c193a46f4259d5e2bed6ed` | `264a82fa77d5221f373cbc42709916db9cc199fd70c193a46f4259d5e2bed6ed` | none |
| `results/copilot-redo/outcome.json` | `de0efb2ad4ed6afabb03e1563fe172ee6159603662b1add39f8c53dda0b58b08` | `de0efb2ad4ed6afabb03e1563fe172ee6159603662b1add39f8c53dda0b58b08` | none |
| `results/copilot-redo/relay.log` | `0eab7df36a7f2c99a0b1983a375744f5615d0484cb65d3caa3da4d8c24250d31` | `0eab7df36a7f2c99a0b1983a375744f5615d0484cb65d3caa3da4d8c24250d31` | none |
| `results/copilot-redo/repo.json` | `5c2175f03d16a7a757a2069c96da5f5096f0e30227a741a86f5117daa6c77160` | `5c2175f03d16a7a757a2069c96da5f5096f0e30227a741a86f5117daa6c77160` | none |
| `results/copilot-redo/served-verified.json` | `274f184230849e753a593f6504b70feb1509b2371c00eb255f5c609d947613cb` | `274f184230849e753a593f6504b70feb1509b2371c00eb255f5c609d947613cb` | none |
| `results/copilot-redo/start.json` | `7fec27c8810ca953aee13ddfae400da20a7169fd731cdaf50bdfe59b49338ebf` | `7fec27c8810ca953aee13ddfae400da20a7169fd731cdaf50bdfe59b49338ebf` | none |
| `results/copilot-redo/summary.json` | `7d771dd2a8e41738a59ee5eb51d8bb7ae503d48631dc41228adacf6779d7bed9` | `7d771dd2a8e41738a59ee5eb51d8bb7ae503d48631dc41228adacf6779d7bed9` | none |
| `results/copilot-redo/wire.jsonl.gz` | `3c57c856d79afee489683d5005cb85d1cebfe02296a04309d426059de003667b` | `55d7f6b81345ff5a686b41a6bd23dd6910b275b49cd70252688f8c2110272d76` | R1 x122 |
| `results/copilot-redo/wire.jsonl.gz` (decompressed) | `7e68110b89ee2ad4a1431987a7dd6fb05aa1d950c2f81c6d3f6b9a0252fdef9c` | `8c8fc4722cedd2bfcdaa4ba1c603d8466cda4eb4bca4d8ba8c08a9e706ca162e` | |
| `results/copilot-redo-refused/summary.json` | `c65afa46bfc2105ae48c441f388d9dea88dab54cb6c3aa79c1768f4b62dad7d6` | `c65afa46bfc2105ae48c441f388d9dea88dab54cb6c3aa79c1768f4b62dad7d6` | none |
| `results/opencode/host-output.txt` | `1b796d22de1eff5dfcff124a356fa9a06416ac9a2443ed13dc2c0abe9d3476a2` | `11f25135fbbb2a0498e9762e82c22ff265a12e25f39c6512e6d3c352b57121f7` | R1 x12 |
| `results/opencode/install-output.txt` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | none |
| `results/opencode/labels.json` | `8993d1d609caf712cbc75c1759403f2560f7bbd37e99d7f397840ae8bfe0a60a` | `8993d1d609caf712cbc75c1759403f2560f7bbd37e99d7f397840ae8bfe0a60a` | none |
| `results/opencode/llm-reader.json` | `8b13ded090f5bd6a27613642053267a14489df208f10d2268b9aecb1548ded73` | `8b13ded090f5bd6a27613642053267a14489df208f10d2268b9aecb1548ded73` | none |
| `results/opencode/meta.json` | `1c9808976a8941e13209a3351ac0e953e920c9f8c87f63863c2dbb1bc20088a1` | `1c9808976a8941e13209a3351ac0e953e920c9f8c87f63863c2dbb1bc20088a1` | none |
| `results/opencode/outcome.json` | `8e5b3299ebc39c8e07c0801b24efa1161f88d4e2d8790de0f0ec9330b03e12dd` | `8e5b3299ebc39c8e07c0801b24efa1161f88d4e2d8790de0f0ec9330b03e12dd` | none |
| `results/opencode/relay.log` | `a6be6b1b01ad592cbbfb827bac0bc0c4a58679269851a98f0376756e60716f56` | `a6be6b1b01ad592cbbfb827bac0bc0c4a58679269851a98f0376756e60716f56` | none |
| `results/opencode/repo.json` | `a5605001be6f0cff8efbbbd441e6d16be438479561b5484eb28acc5d1c357bac` | `a5605001be6f0cff8efbbbd441e6d16be438479561b5484eb28acc5d1c357bac` | none |
| `results/opencode/served-verified.json` | `8c8b10e5e7e07262bb56c7edfdd82f3aae3276793003f8bfc6892bbe5fb4ea8d` | `8c8b10e5e7e07262bb56c7edfdd82f3aae3276793003f8bfc6892bbe5fb4ea8d` | none |
| `results/opencode/start.json` | `2c570612408d459dbe3f31903e0e96636a7474d49058129655073b15110b1fca` | `2c570612408d459dbe3f31903e0e96636a7474d49058129655073b15110b1fca` | none |
| `results/opencode/summary.json` | `98baea324bf21965a9384d0da406471674c0a8802edfddc1aced978eb27816f8` | `98baea324bf21965a9384d0da406471674c0a8802edfddc1aced978eb27816f8` | none |
| `results/opencode/wire.jsonl.gz` | `c849fa6abfd556ed79aae345fbc701cdd65272c28a9159ccbbd703e7495b1aa7` | `338848d37180742c8c9e3615c1e42d38532d7ed4a6f98415059efe029c630994` | R1 x474 |
| `results/opencode/wire.jsonl.gz` (decompressed) | `aaca38df82de2ff768a02b2eb3d8aedbfdedeb1adcc620f59560f7f6306ee5fb` | `654fba33a983adb2d2e56d3f607c9b5bc1b0147b9ab0fc31297571950b58d1d4` | |
| `results/qwen/host-output.txt` | `1579aca75fc40544bd580c79159164773cde54bcda26bf33134414198a256f28` | `1579aca75fc40544bd580c79159164773cde54bcda26bf33134414198a256f28` | none |
| `results/qwen/install-output.txt` | `9ca7b6e6060f51706232148e3a233dd0243a55f52e832802590c4e46cf4af10b` | `b4730c966b8b0672c9b1ad178693236c58b4155517ca484be391f8465dbd8988` | R2 x1 |
| `results/qwen/labels.json` | `3e324d87e1cb419b3e5f195e95ed294328842a66e7b718a36dc8d21eebf3629b` | `3e324d87e1cb419b3e5f195e95ed294328842a66e7b718a36dc8d21eebf3629b` | none |
| `results/qwen/llm-reader.json` | `23afb7eb175da3916334c7ff7cf5f84ac7caa51805d1880d3a5995c0847a73a4` | `23afb7eb175da3916334c7ff7cf5f84ac7caa51805d1880d3a5995c0847a73a4` | none |
| `results/qwen/meta.json` | `a7adf1bc2aec31d9546d14b5151b20253d2a8b7df568604f87c87514b79d5c73` | `a7adf1bc2aec31d9546d14b5151b20253d2a8b7df568604f87c87514b79d5c73` | none |
| `results/qwen/outcome.json` | `69fc5c18c1b0dfc681bf56462c5d93f545b516ec460885bbb055c2c43e0074bb` | `69fc5c18c1b0dfc681bf56462c5d93f545b516ec460885bbb055c2c43e0074bb` | none |
| `results/qwen/relay.log` | `887b615cc65617f3103d65bae07144baafae9f852d02a63b529a33c7808028cd` | `887b615cc65617f3103d65bae07144baafae9f852d02a63b529a33c7808028cd` | none |
| `results/qwen/repo.json` | `77ada999e79c4dc4feac93ebe9b1910a308b5068f8629b696e3e59a9e3023712` | `77ada999e79c4dc4feac93ebe9b1910a308b5068f8629b696e3e59a9e3023712` | none |
| `results/qwen/served-verified.json` | `31941ad0cc810673a747f18d40e642f2e6a24df7258a398f78f00062c7f5c3ce` | `31941ad0cc810673a747f18d40e642f2e6a24df7258a398f78f00062c7f5c3ce` | none |
| `results/qwen/start.json` | `1d64cede3bd1b7c74df71f6dadd47d89ee8f6909748d9e8b28cab55a9f19c1f7` | `1d64cede3bd1b7c74df71f6dadd47d89ee8f6909748d9e8b28cab55a9f19c1f7` | none |
| `results/qwen/summary.json` | `c548efdea67bd16989a34c90a9d1d5a84af45f8e1a18b81818c846f582381599` | `c548efdea67bd16989a34c90a9d1d5a84af45f8e1a18b81818c846f582381599` | none |
| `results/qwen/wire.jsonl.gz` | `e5190d0f1f3a11334a8469678d4dc6ecdd9418347942dce025f2b960e857c8b5` | `183feb475385539959a14b4ebcea53b0c8bc68e3458f15dc76f0746e18c2dfaa` | R0 x41, R1 x359 |
| `results/qwen/wire.jsonl.gz` (decompressed) | `1499dccfad3ee54859953dcda6912c1baf5b52b7fc6963ad34ca31b01472e964` | `de1f6f12ac84d93cac9fcd076643ad20ff41af820a25f317617acc26249134c2` | |
