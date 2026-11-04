# What was redacted in the published copies, and how

The sessions of the paid block ran on the person's own machine, and what they recorded carries its paths, a user name and, in the kit, the names of other projects. This repository does not publish anything that shows the machine, an account or another project, so every text file below was copied through a fixed table of substitutions before it was committed. **Every published file under `kit/`, `results/stage1/` and `results/stage2/` is a redacted copy. The originals, byte for byte, stay in the person's private kit repository.** The traffic of stage 1 went through two stages of redaction in the kit that ran it (the manifest's redactor, then a pass of the result writer for project names, the account name and session folder names), and then through the table below; the SHA-256 of an original in the table is the one of the file as the run left it, before any redaction.

## The table, applied in this order over the whole content of each text file

| Rule | What it matches | Times |
|---|---|---|
| R1 | the names of other projects of the person who ran the block (`[PROJECT]`) | 19 |
| R2 | the account name (`[ACCOUNT]`) | 4 |
| R3a | a regular expression of the kit that matched the user name (`\b[USER]\b`) | 2 |
| R3 | the home folder `/home/<user>` (`/home/[USER]`) | 2 |
| R4 | the user name (`[USER]`) | 2 |
| R5 | the name of the private backup repository folder (`.[PRIVATE]`) | 2 |
| R6 | an e-mail address that is not a GitHub noreply one (`[EMAIL]`) | 7 |
| R7 | the home folder inside the sandbox (`/home/[SANDBOX]`) | 3 |
| R10 | a made-up home folder in a test (`/home/[FIXTURE]`) | 2 |
| R11 | a made-up token of a test fixture, which a scanner would flag (`sk-ant-...-[FAKE]`) | 4 |
| R12 | the import line of the instructions file in a script, which a scanner reads as an address (the dot of the file name in brackets) | 1 |
| R13 | the project folder name of an example in a code comment, `-tmp-claude-<number>--home-` (a user id and a user name), written with the placeholders `<uid>` and `<user>` | 1 |
| R8 | the scratch folder of the session that ran the work (`[PATH]`) | 0 |
| R9 | the em dash (U+2014), which the model's own text carries, replaced by a hyphen-minus (this repository bans the character in anything it publishes) | 590 |

Nothing else was changed: no line was dropped, no value edited and no number touched. The made-up fixtures of the kit's tests (R10, R11, R12) and the names inside the kit's own scanner (R1 to R5) are the reason some code lines read differently from the originals; a copy is therefore not runnable byte for byte, and the SHA-256 of the original is what the manifest holds (`prereg.json`, `kit.files_sha256`). The recorded streams also hold opaque base64 signatures of the model's thinking blocks, which are kept as recorded.

Left out of this folder, with the reason: compiled caches; the manifest of the kit commit (`freeze/prereg.json` of the kit is the earlier freeze; the final one is `../prereg.json` here); and the files in `kit/WITHHELD.md`.

Rule R13 was added after the first publication of this table, when an independent scan found the user id in one code comment of `kit/lib/redact.mjs`; that one file's published copy changed (the copy hash before the change was `96a1269c374ecc444740603c0be30fcf2e0325c7b923c92f7735fca0e898c622`, the hash of the copy now published is in the table).

## SHA-256 of every original and of every published copy

| file | sha256 of the original | sha256 of the copy |
|---|---|---|
| kit/.gitignore | 73db33f002164b88f40731986eac3354fb1b08f800c75785c1bb32e4f0daef33 | 73db33f002164b88f40731986eac3354fb1b08f800c75785c1bb32e4f0daef33 |
| kit/README.md | bf17c8cce80861498119332d2816cccfe800285f40d06e66a997000ce2d29766 | be0f68bb45f3f476881713283c5e684aa0f59627ebb382575b5b013faee10149 |
| kit/account/account.mjs | 74f9e471ea478c56063d9bb64698cbca2bea9be2e0cb8d9fe84413958d5106fe | 74f9e471ea478c56063d9bb64698cbca2bea9be2e0cb8d9fe84413958d5106fe |
| kit/account/account.test.mjs | 11cf843839cf762dac3fb8b8f99d78a1a14fa31da7fee229313da59f31eea51d | 11cf843839cf762dac3fb8b8f99d78a1a14fa31da7fee229313da59f31eea51d |
| kit/account/enroll.mjs | 69da30e09da487b0e2b5077df7b05c1528158505f89020435faa2f3826446a78 | 69da30e09da487b0e2b5077df7b05c1528158505f89020435faa2f3826446a78 |
| kit/analysis/analysis.test.mjs | af7da578dc03790f2b591ae09cf090d191d439f945db23d8031d360f1260eb0a | af7da578dc03790f2b591ae09cf090d191d439f945db23d8031d360f1260eb0a |
| kit/analysis/labels.mjs | bdc5bdfa86fa6e7e8a36695ad127c43a6642c14537129d67e23cf3be47bd8a2e | bdc5bdfa86fa6e7e8a36695ad127c43a6642c14537129d67e23cf3be47bd8a2e |
| kit/analysis/llm-reader-prompt.md | 050bf8165caef84459953479dff88da55ebcab22dd05a68d1183f18fadc7ce97 | 050bf8165caef84459953479dff88da55ebcab22dd05a68d1183f18fadc7ce97 |
| kit/analysis/llm-reader.mjs | 7363b5b25041de93df10ca1be0c48a02165e590687ef2bbd4d250a52be0a0648 | 7363b5b25041de93df10ca1be0c48a02165e590687ef2bbd4d250a52be0a0648 |
| kit/analysis/q-readers.mjs | b5f24709e88d69be60245316d7eb411b8a49f30fa3c90374a5bff3145a8ff610 | b5f24709e88d69be60245316d7eb411b8a49f30fa3c90374a5bff3145a8ff610 |
| kit/analysis/read27.mjs | 42d6d58d8cda5bfa8e471e84542c7a93e2f47743d8e82fe4a4482776726f5594 | 42d6d58d8cda5bfa8e471e84542c7a93e2f47743d8e82fe4a4482776726f5594 |
| kit/analysis/repo-facts.mjs | f0c4b4ee458d5182f381b0c4b838edb4d1f5a206245ec917c285272a3a981432 | f0c4b4ee458d5182f381b0c4b838edb4d1f5a206245ec917c285272a3a981432 |
| kit/analysis/stream.mjs | 07673e28e1b12d0121f0cca786c144be3d9acdf6041e827d377c42b99689a43d | 07673e28e1b12d0121f0cca786c144be3d9acdf6041e827d377c42b99689a43d |
| kit/analysis/transcript.mjs | 4d81faa3ca1abdc47cd24c52c3e7cddf1de3fd3fab9cf250a1912eff5bdacc43 | 4d81faa3ca1abdc47cd24c52c3e7cddf1de3fd3fab9cf250a1912eff5bdacc43 |
| kit/contain/bwrap.mjs | 5e52466d1531e84b394c8bfd980553310a71b45058e293529f2eda48e6c85508 | 8124cdc32b7a192f34596dae455c4389f535a4adb304425cd68e9d3d5a8442ae |
| kit/contain/bwrap.test.mjs | e5bc477fb60034d0c514d535d9d29e48f3d72fb16e6b35313d3ce96cf06da250 | 0b88e4a2102c2260874dcea80df2d5a6ef5382034d38ff5f7da821111f331e44 |
| kit/contain/netbridge.py | e0fe0bd92a9f1566f64ca82d5aa0187ea19dc4f851e936a30bb70af81a78a194 | e0fe0bd92a9f1566f64ca82d5aa0187ea19dc4f851e936a30bb70af81a78a194 |
| kit/contain/proxy.mjs | d1c3b1418607d70a47b938eb6e3159a2f44aebe754d3784c2094b25101592612 | d1c3b1418607d70a47b938eb6e3159a2f44aebe754d3784c2094b25101592612 |
| kit/contain/proxy.test.mjs | 56b03a174bd3b704aa84e8c900c26b88b8ab651fcd0d1952e8be2f88fa5a72c6 | 56b03a174bd3b704aa84e8c900c26b88b8ab651fcd0d1952e8be2f88fa5a72c6 |
| kit/freeze/freeze.test.mjs | 2fc9fe13c1cfa04d6e6a266c5181cdc6bae17dfe5fa8445610d26f97cec842ba | dec79e091c59ff797b88a760e688699b17bbe7e9f1425c4fbeff57c975bcaa13 |
| kit/freeze/make-prereg.mjs | 8a7e4c317e12dd9abf6e331616fc30ef9f600a4707ec42584783e5a4b0014d67 | 8a7e4c317e12dd9abf6e331616fc30ef9f600a4707ec42584783e5a4b0014d67 |
| kit/freeze/verify-prereg.mjs | d2f71c7cdb1205f17ccf19c9bf7388b4f0f223b4dce5b3ed408dc07efb756d04 | d2f71c7cdb1205f17ccf19c9bf7388b4f0f223b4dce5b3ed408dc07efb756d04 |
| kit/install.sh | adfdee2688d9b6c9fc9f0fb46f076a156c407df8ab75bf130383b79e611eecc8 | adfdee2688d9b6c9fc9f0fb46f076a156c407df8ab75bf130383b79e611eecc8 |
| kit/kit.json | 306b1e97e99fea5a0d9491ae4a2ce22dede893d8fd05b1dc6bdeaa0947d52ae7 | 306b1e97e99fea5a0d9491ae4a2ce22dede893d8fd05b1dc6bdeaa0947d52ae7 |
| kit/lib/login.mjs | 77e6c9eec5c5d969e011c412226e8a7392216dd6215a6e6482883911826a204a | 77e6c9eec5c5d969e011c412226e8a7392216dd6215a6e6482883911826a204a |
| kit/lib/login.test.mjs | 08f658d3d9c5e526dc0d1c16f071943e9ad557764761d5bebd57332511356f05 | 095fe801d5bb4b9535b06711f18409d78060e4b8c8eed33a7e24f5f8c5921d97 |
| kit/lib/quota.mjs | 90194b991690109fc552ecd92bdb887ae94a09e0cd739813e0493873fa5ef712 | 90194b991690109fc552ecd92bdb887ae94a09e0cd739813e0493873fa5ef712 |
| kit/lib/quota.test.mjs | 771b07746f36665feab10872bedb4f262741f8ff52887d0cbd52dee665a8a6fa | 771b07746f36665feab10872bedb4f262741f8ff52887d0cbd52dee665a8a6fa |
| kit/lib/redact.mjs | 0ae7553ff5d492f820791ac9147c6fddc184eb8965228142b731968556b6ab8e | 92122c368eb277694dcf15ff1dd14a17d4edb0f2c5dcc8bf3ca03411d8769442 |
| kit/lib/subscription.mjs | d9ddb127e52682f59bc240145c6727ed59ba4e2cb46705e840e2dddcea7b018a | d9ddb127e52682f59bc240145c6727ed59ba4e2cb46705e840e2dddcea7b018a |
| kit/lib/subscription.test.mjs | b51689dee4b730852bde7c4221bcf36d3d26e0bc4ac03be3f04a8b8a4042d1f2 | b51689dee4b730852bde7c4221bcf36d3d26e0bc4ac03be3f04a8b8a4042d1f2 |
| kit/lib/token.mjs | 7b745bb62c105a38ae2a6c2aa6ecdeb932366460f1bdff7c052d3cf5ec193f41 | 7b745bb62c105a38ae2a6c2aa6ecdeb932366460f1bdff7c052d3cf5ec193f41 |
| kit/lib/token.test.mjs | 71cb9a73cd610bb242e48a25c52cb977859cb661cb71ac1ca5724ce126bf3aa5 | 8b8877eb85efa8bdf89b38f025292a9e69bc1501dc16f2cddec122e8e62c8d0e |
| kit/plan/budget.mjs | 009a27d751aa498db080e85ed1a81c6f5c884ab8dab567756077051e960c33ba | 009a27d751aa498db080e85ed1a81c6f5c884ab8dab567756077051e960c33ba |
| kit/plan/calibration.json | a2940cda59a9c2493ab6c09e046792cb83b5b4d70cec6e4ab9a9d65f383289c1 | a2940cda59a9c2493ab6c09e046792cb83b5b4d70cec6e4ab9a9d65f383289c1 |
| kit/plan/cells.mjs | d4cfc1d932ae06b1dc0a632ae7b97d451d16368ad652603085bbfd54e3af913b | d4cfc1d932ae06b1dc0a632ae7b97d451d16368ad652603085bbfd54e3af913b |
| kit/plan/cells.test.mjs | b5ce86f894c40c9f5ede7fb98c7cbfa2c2ae0e28cd0f3811c68dccf372479488 | b5ce86f894c40c9f5ede7fb98c7cbfa2c2ae0e28cd0f3811c68dccf372479488 |
| kit/plan/pro.mjs | 9411a76f4154f81e437b21b7d30310306672d584bff4154a960424370bffa14d | 9411a76f4154f81e437b21b7d30310306672d584bff4154a960424370bffa14d |
| kit/run/readers.mjs | ae93d4560f3cff9f9eee4302c1b18e1b854bf3cafbad70265202f232fa801681 | ae93d4560f3cff9f9eee4302c1b18e1b854bf3cafbad70265202f232fa801681 |
| kit/run/readers.test.mjs | a9562ba2431a8bf255ec3ff154e7f3bbf7b0c6706cf45790980f3efdd23d1965 | a9562ba2431a8bf255ec3ff154e7f3bbf7b0c6706cf45790980f3efdd23d1965 |
| kit/run/stage-result.mjs | b9f48398ea287672f24faa4b687538cd2af15c62e19c77ec9a35416c98ad49fd | feab2b5e71bf9f0e5f9fc721a97ee208b0f4354f659a8fcc15f3e272e162b02e |
| kit/run/stage1.mjs | cd2b4d82c3259a9894a2823bc7e6cf5266658fc413622f6ab3bdcb07e2c0d0f6 | cd2b4d82c3259a9894a2823bc7e6cf5266658fc413622f6ab3bdcb07e2c0d0f6 |
| kit/run/stage2.mjs | 28d54b204a06eba8337113da85bbbfcd25c8ddf9673d7d313054355faea2a6f2 | 99985e8fc7ebfad5ea1f2d313f701df0c843bd12fd2b57e78829ce629494a376 |
| kit/run/walker.mjs | 75f33008233deb3e5ceffae0895258f94933b64be6764116f0c54834234472fe | 75f33008233deb3e5ceffae0895258f94933b64be6764116f0c54834234472fe |
| kit/run/walker.test.mjs | 45647f775617be99181920bdc2ccc2e0aa221bfd32c9ba1b32558c3ea97f391f | 45647f775617be99181920bdc2ccc2e0aa221bfd32c9ba1b32558c3ea97f391f |
| kit/seed/make-parity-repo.mjs | 52e0dc0ac4808c720809065726f840a4ec1fcb828f8bd76dda4bbbebb323174c | fdd96cd06a1307e4f805b577b20132e38ea6bba0b67e0a521dc2cabf25ae1b9d |
| kit/seed/make-repo.mjs | d4c9af673f92170638275e8939b143eb7b610977706872ed3fa01a843f9268c0 | 752d64b13aa7834aaf003adeb062844a7be12692bf7f8db2b9db35dce3b224a1 |
| kit/seed/parity/extract.py | 0f66111f65b0e208101104948926d1e5a567c3e91a2ab37d22cbd6857e8ab80c | 0f66111f65b0e208101104948926d1e5a567c3e91a2ab37d22cbd6857e8ab80c |
| kit/seed/parity/org-08.json | f69e873f1ce4fa1ada9d1dd67530f468b302588f3dbf639af16acb668179ba00 | 3d8e61e37ef7d0859573fab418cfab5dc54f53a94b9e3d8bfb3b28862bfe9cd3 |
| kit/seed/parity/prompts/inline.g.md | b0ac033454caa8123c292f9b427bfe3d64c7de3294e21a69a8f329a66fe4ee59 | b0ac033454caa8123c292f9b427bfe3d64c7de3294e21a69a8f329a66fe4ee59 |
| kit/seed/parity/prompts/parity-neutral.md | b68985798c925fd7d2c1622ce37be48422106fdbb9802109134756962bce3059 | b68985798c925fd7d2c1622ce37be48422106fdbb9802109134756962bce3059 |
| kit/seed/parity/provenance.json | 8efd74100772f1e1861cc3a3b912f0ee713438d676d7ed28a10519667963ffb5 | 8efd74100772f1e1861cc3a3b912f0ee713438d676d7ed28a10519667963ffb5 |
| kit/session/fake-anthropic.mjs | 6df1f694f460acd56dbcb5709d18bccdcf4c833bc23e2e19a533ce866de20cf7 | 6df1f694f460acd56dbcb5709d18bccdcf4c833bc23e2e19a533ce866de20cf7 |
| kit/session/fake-login.mjs | 218bbffd3a93e30f496cbb878d51140e53c71161cf35159fd4ef73351778395f | bbe88267e9d87ff2d858577bcc8cc1a2f1999b4385fefcd711d1a0aed694d0f5 |
| kit/session/protocol.mjs | 682b32e638e25c495f81838980e3ea209867ad23815917462404470ace87cc31 | 682b32e638e25c495f81838980e3ea209867ad23815917462404470ace87cc31 |
| kit/session/session.mjs | bd79968f9d0bd9e11c5833635391b718c201ec45e99a904f80fef61619252185 | ff2967ee63dd182f79747a78d53480de78e5182b845e850683665c9469471a97 |
| kit/session/session.test.mjs | 10d492a617560571ea7b7d492b7ed8f4153e321869f02a612be8d3186e8ae6c2 | 10d492a617560571ea7b7d492b7ed8f4153e321869f02a612be8d3186e8ae6c2 |
| kit/smoke/smoke.mjs | 6c2311853c4fb31b1eb69499d8a90950e656b98505e8c1bd00c021be6c0d286a | 6c2311853c4fb31b1eb69499d8a90950e656b98505e8c1bd00c021be6c0d286a |
| kit/smoke/smoke.test.mjs | 3e0173dbab6dce0ae41873db2ec33d257a3173ed2fceaf0426ca053db1b9e19b | 3e0173dbab6dce0ae41873db2ec33d257a3173ed2fceaf0426ca053db1b9e19b |
| results/stage1/readers-side-by-side.json | f4675da2cb9ca028af71f0152374f04a77f7d68a112d74e9db5a8e6c06f06f81 | f4675da2cb9ca028af71f0152374f04a77f7d68a112d74e9db5a8e6c06f06f81 |
| results/stage1/table.json | 00c0083ef94676a721b326ed11f31cdafb9ddb923648522e7ce9b81674fb18f9 | 00c0083ef94676a721b326ed11f31cdafb9ddb923648522e7ce9b81674fb18f9 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r01/labels.json | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r01/llm-reader.json | ce4604a202260fbf5795e47b9e4719c2678cc9a8164c922a460ab4ca95de7750 | ce4604a202260fbf5795e47b9e4719c2678cc9a8164c922a460ab4ca95de7750 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r01/meta.json | df65994920eac81d660e85ddd44822c53da5062284a55adafaf70b417252d671 | df65994920eac81d660e85ddd44822c53da5062284a55adafaf70b417252d671 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r01/proxy.log | c94d0db1dea1db33e5ab7994bbc90af85bcd8bf053d141b9844b30d2091416de | c94d0db1dea1db33e5ab7994bbc90af85bcd8bf053d141b9844b30d2091416de |
| results/stage1/traffic/A-agentsmd__parity-neutral-r01/repo.json | 264a20d235a5072d05c8400fe86bc4bd67ec4e7b5eefcebef786637216cb0f52 | 264a20d235a5072d05c8400fe86bc4bd67ec4e7b5eefcebef786637216cb0f52 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r01/round1.jsonl | c0d3315054e65d23f84354efc402c8d920a355d35b9d6c6fe1643c05fac49528 | 5976d782557a0ef2c25b3f48a0426ad08ccdfb10f4860613cb2fa3e4ced93a36 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r02/labels.json | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r02/llm-reader.json | cd8f0684e829d9ea88088871d65cec48c343a7e1a38eac22722d9f3ca978510c | cd8f0684e829d9ea88088871d65cec48c343a7e1a38eac22722d9f3ca978510c |
| results/stage1/traffic/A-agentsmd__parity-neutral-r02/meta.json | d59ef15f1ccefa30f209554adc847cb63bdcf58ae26f979df2f03b806c385527 | d59ef15f1ccefa30f209554adc847cb63bdcf58ae26f979df2f03b806c385527 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r02/proxy.log | 18d6263e2b40f98ec8b8ef2dc9ffe2efffd324fc6b7e7c2572ce72478c1d1224 | 18d6263e2b40f98ec8b8ef2dc9ffe2efffd324fc6b7e7c2572ce72478c1d1224 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r02/repo.json | 53ad84f8ea6301d09219527c08ee3e8f23ede08c6ce8e47ad9b333ae91bea0ee | 53ad84f8ea6301d09219527c08ee3e8f23ede08c6ce8e47ad9b333ae91bea0ee |
| results/stage1/traffic/A-agentsmd__parity-neutral-r02/round1.jsonl | 8209b4d0d5542822dc6f0c6a06290ab22ec6d0dff1bcc2d9566b6a566bd005b1 | 337ffa2fe5bd564bdf6cab3118d52585c78de00a19179f0278e32e61a9650c8a |
| results/stage1/traffic/A-agentsmd__parity-neutral-r03/labels.json | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r03/llm-reader.json | b1748c73685793fbe57c4cf00ab119077f044b9fd0ebde0f993b4d80488add75 | b1748c73685793fbe57c4cf00ab119077f044b9fd0ebde0f993b4d80488add75 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r03/meta.json | cf26542a3e5ca14c10a434c114aacb943e58f5bfe08717a9641c54e37d9966ce | cf26542a3e5ca14c10a434c114aacb943e58f5bfe08717a9641c54e37d9966ce |
| results/stage1/traffic/A-agentsmd__parity-neutral-r03/proxy.log | f3f814ca647fc9f4c35239a3c10edf19e30ff63fc2ffe8eb68fddb66bf1fd1fd | f3f814ca647fc9f4c35239a3c10edf19e30ff63fc2ffe8eb68fddb66bf1fd1fd |
| results/stage1/traffic/A-agentsmd__parity-neutral-r03/repo.json | 5eb56cca37db77eb4391da5553332d753d95662ff98d6c389486f4ba47d017ea | 5eb56cca37db77eb4391da5553332d753d95662ff98d6c389486f4ba47d017ea |
| results/stage1/traffic/A-agentsmd__parity-neutral-r03/round1.jsonl | 5e1d6c98dba0924773e47de44bb94216ba7666b9e171906d26d0da98fd02b429 | e526f5aecc40fb3fe7d3b3d6e4ea76a34a5450bcb11b4c2b4ab99c677a7df4b9 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r04/labels.json | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r04/llm-reader.json | eb516980b3abc975cf1f3ae4c749357e1cc12e31ef589990be927105299c187b | eb516980b3abc975cf1f3ae4c749357e1cc12e31ef589990be927105299c187b |
| results/stage1/traffic/A-agentsmd__parity-neutral-r04/meta.json | ab686c6ae386b5d57bb640ec9df9987fac15381d35f63f2d1b586048bc2b9790 | ab686c6ae386b5d57bb640ec9df9987fac15381d35f63f2d1b586048bc2b9790 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r04/proxy.log | b2e2b553854f15854e92c76cb97e2f3be32536306d180d4c14ae779bd11b0a26 | b2e2b553854f15854e92c76cb97e2f3be32536306d180d4c14ae779bd11b0a26 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r04/repo.json | 57e566212893d5cac0401e2c629f302317e9dd756296303a742991c6cc790825 | 57e566212893d5cac0401e2c629f302317e9dd756296303a742991c6cc790825 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r04/round1.jsonl | ae161b46adbe6d16b3b5e11ba6269f03af980101ce2f52eb47c92fd6c5f81430 | e615fded4873b3ca9bdb61e89c3bc82453ca4b8b26da5e23336d56ec438c8b0e |
| results/stage1/traffic/A-agentsmd__parity-neutral-r05/labels.json | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r05/llm-reader.json | c44d7d2153b98a2a0e182fed9ed970db87e40fc4ae7eb2ec588895496a6e6ee4 | c44d7d2153b98a2a0e182fed9ed970db87e40fc4ae7eb2ec588895496a6e6ee4 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r05/meta.json | 1e0c0fc8f920f5c1f69a03fb1d0d0446d748e8e297986a52210066230bbacb4c | 1e0c0fc8f920f5c1f69a03fb1d0d0446d748e8e297986a52210066230bbacb4c |
| results/stage1/traffic/A-agentsmd__parity-neutral-r05/proxy.log | d2a89cf9446a2f55921530518637190caca6242073d163098f5ecf7112e053c0 | d2a89cf9446a2f55921530518637190caca6242073d163098f5ecf7112e053c0 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r05/repo.json | 8a101bfb5dae5815771525faec66e26c6e42a486a5c97baf545e79369c42462d | 8a101bfb5dae5815771525faec66e26c6e42a486a5c97baf545e79369c42462d |
| results/stage1/traffic/A-agentsmd__parity-neutral-r05/round1.jsonl | dd92c1c769ccbf57d07e3e451d4d4729b6e9e5e66a81266ca2aa3108f843b74b | 6e4adca2dc5b030a857d9fd0d0355e6283cafa65803a3f40524123dbd1c2fe94 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r06/labels.json | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r06/llm-reader.json | ffebf8e939fbec6a0c80580fd22441d9b3ec0b4f5bff2553700483158a16224c | ffebf8e939fbec6a0c80580fd22441d9b3ec0b4f5bff2553700483158a16224c |
| results/stage1/traffic/A-agentsmd__parity-neutral-r06/meta.json | 8b957f722ebe93fbf89870ce149d3cd46cafbdb7588b145755cb0d4be9776260 | 8b957f722ebe93fbf89870ce149d3cd46cafbdb7588b145755cb0d4be9776260 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r06/proxy.log | a75961035815191d38cabb33643cbded25b308f3a149ad9f8f5b0dfbdd7eacf3 | a75961035815191d38cabb33643cbded25b308f3a149ad9f8f5b0dfbdd7eacf3 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r06/repo.json | 2c7ee01b0beebc6586f75f1c0d87340eec13973a86e04a2658c99a8750bf95f3 | 2c7ee01b0beebc6586f75f1c0d87340eec13973a86e04a2658c99a8750bf95f3 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r06/round1.jsonl | 8a6ef22e9ae191d0aa716391034e0889030502a59d67fdafa426279e8fdccc2f | e3155a76aecd6ab6af6e31a92483d91e4e6150713292e3b153135a3619acbfc5 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r07/labels.json | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r07/llm-reader.json | 171829af9b608d84a5c284712c7cb91d3dc4987d8e0d961577efafc03508dea9 | 171829af9b608d84a5c284712c7cb91d3dc4987d8e0d961577efafc03508dea9 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r07/meta.json | d05273d402ef8ffe7c2a816482dc227ddb259b2b0415777938f75ed1045c4265 | d05273d402ef8ffe7c2a816482dc227ddb259b2b0415777938f75ed1045c4265 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r07/proxy.log | 746f4cfc08569e6f185d7de82a25a0634a0675701dca512a9e59c02f811fc5b9 | 746f4cfc08569e6f185d7de82a25a0634a0675701dca512a9e59c02f811fc5b9 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r07/repo.json | 414c595f62440709c98a572a37d5bdb14cb19976147f6bd6fe03db2bc622b5ac | 414c595f62440709c98a572a37d5bdb14cb19976147f6bd6fe03db2bc622b5ac |
| results/stage1/traffic/A-agentsmd__parity-neutral-r07/round1.jsonl | 4bd5482d41db08b7e9a793d5c44e3c89bd95dbe31d4c7cc290b7f08cf90c8013 | 6029753090f3e1aee5a868e10951a2e9aa8dd7cd84409a74a88581a96d0cc00e |
| results/stage1/traffic/A-agentsmd__parity-neutral-r08/labels.json | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r08/llm-reader.json | eda551f4351248e7a203aaca567bb8c5409a485d8b68773bc4b60071a20f1fa4 | eda551f4351248e7a203aaca567bb8c5409a485d8b68773bc4b60071a20f1fa4 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r08/meta.json | 1c6e2b4dc58152af32255b94ccbc156e0532141fb50dc35512523318fde2919c | 1c6e2b4dc58152af32255b94ccbc156e0532141fb50dc35512523318fde2919c |
| results/stage1/traffic/A-agentsmd__parity-neutral-r08/proxy.log | 02c30a635d68c9414e487cd382548c2d681ea54fa770a037f373592a61e5006e | 02c30a635d68c9414e487cd382548c2d681ea54fa770a037f373592a61e5006e |
| results/stage1/traffic/A-agentsmd__parity-neutral-r08/repo.json | 528d373d7db9b30168eba97fa32bf4daf364fff6b01fc5c3be36e16db263262d | 528d373d7db9b30168eba97fa32bf4daf364fff6b01fc5c3be36e16db263262d |
| results/stage1/traffic/A-agentsmd__parity-neutral-r08/round1.jsonl | 24d44c201a7e268ac811ced8268b6719881e234fdf72a8bbf084ce10f07afb6f | ce421e226db7c1783923fa010d4e83be8eaada86ddb84f96167f25bf1103ae92 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r09/labels.json | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r09/llm-reader.json | 2f85bb313b35b760498a7dc7545cc596fe58b788b384aec2a28c8524bb3fff0d | 2f85bb313b35b760498a7dc7545cc596fe58b788b384aec2a28c8524bb3fff0d |
| results/stage1/traffic/A-agentsmd__parity-neutral-r09/meta.json | a397b33390f37b57e7b67ccb733c5f4d6c7653953fa4b89b257caa442ad20192 | a397b33390f37b57e7b67ccb733c5f4d6c7653953fa4b89b257caa442ad20192 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r09/proxy.log | 9f45f9e6638607d22ee9f2bbd973a75cc38dae9f2d3cfc8042b3f62dbeb6227d | 9f45f9e6638607d22ee9f2bbd973a75cc38dae9f2d3cfc8042b3f62dbeb6227d |
| results/stage1/traffic/A-agentsmd__parity-neutral-r09/repo.json | e69eefc8132a544c5d8e62a67af53d975fb4203efa2c6e609c1cf9c7d5d3c3dd | e69eefc8132a544c5d8e62a67af53d975fb4203efa2c6e609c1cf9c7d5d3c3dd |
| results/stage1/traffic/A-agentsmd__parity-neutral-r09/round1.jsonl | c2ddbf77d81f9d7d669c54e9cc22aca4e17338312857e37603caac968201638b | 9d4379add4981aa277f86a53835744816df23ac72980a037ea52d830faca20a6 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r10/labels.json | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r10/llm-reader.json | eabe5f2c4b7e910ea99e72549f27e980e571de13bed41a7bc572468885e6fdb2 | eabe5f2c4b7e910ea99e72549f27e980e571de13bed41a7bc572468885e6fdb2 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r10/meta.json | 3f3287dc555bb28b5730ed0783a7e4e361628b14f60b25f8192998fc47b5a14d | 3f3287dc555bb28b5730ed0783a7e4e361628b14f60b25f8192998fc47b5a14d |
| results/stage1/traffic/A-agentsmd__parity-neutral-r10/proxy.log | 0350cfd6ba6a3a5444e3b63364c9c58d30ed1c4ea562985cee0cbfe962cd57f3 | 0350cfd6ba6a3a5444e3b63364c9c58d30ed1c4ea562985cee0cbfe962cd57f3 |
| results/stage1/traffic/A-agentsmd__parity-neutral-r10/repo.json | 2af4212a0f14ec777db2fad104b3684de964d54e659c247c5eddbccfbabea20f | 2af4212a0f14ec777db2fad104b3684de964d54e659c247c5eddbccfbabea20f |
| results/stage1/traffic/A-agentsmd__parity-neutral-r10/round1.jsonl | 28c8be059101b0a34a2b367291821f6c6344db8f5b0d4333aec53909d7c21c08 | 4f74920eb129bf1f20b0d214b4ad30db44fa95699eb75d7ddc2fc08b3e1a8bc7 |
| results/stage1/traffic/A__parity-neutral-r01/labels.json | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 |
| results/stage1/traffic/A__parity-neutral-r01/llm-reader.json | ad283750a3d00199f558b5593685271d1a3aeef7cff7636c4535597fc08bbc6d | ad283750a3d00199f558b5593685271d1a3aeef7cff7636c4535597fc08bbc6d |
| results/stage1/traffic/A__parity-neutral-r01/meta.json | 54edb2e88e4a277ccb7bbd0c804c175fc7177e6f1fc05517166420709d3e9cdd | 54edb2e88e4a277ccb7bbd0c804c175fc7177e6f1fc05517166420709d3e9cdd |
| results/stage1/traffic/A__parity-neutral-r01/proxy.log | 33a37a5aef43a0562692c405311fa9484d339199a6090189fb9cfbdd5141cdee | 33a37a5aef43a0562692c405311fa9484d339199a6090189fb9cfbdd5141cdee |
| results/stage1/traffic/A__parity-neutral-r01/repo.json | d3880f5cd3acf9681293b860a9255521c90d97e4dcd1e3d9eabb3a421ce71ee3 | d3880f5cd3acf9681293b860a9255521c90d97e4dcd1e3d9eabb3a421ce71ee3 |
| results/stage1/traffic/A__parity-neutral-r01/round1.jsonl | 2cc72594ef391d2d7ff75c0c988acd6d71aefcaaadacee4d8fd65544739ad99e | b4dbcc518409062678f26f944766fee18e3f4723214c433f7fc20979cb2c8774 |
| results/stage1/traffic/A__parity-neutral-r02/labels.json | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 |
| results/stage1/traffic/A__parity-neutral-r02/llm-reader.json | 111843f40d403416497a93054c395562dbf1d1cc0da9ce32048ba312b57f76f3 | 111843f40d403416497a93054c395562dbf1d1cc0da9ce32048ba312b57f76f3 |
| results/stage1/traffic/A__parity-neutral-r02/meta.json | 9429f054809510caaa77292d617a14ecc9c69dcbb3d5d0dfd1b0fb8e35be2a12 | 9429f054809510caaa77292d617a14ecc9c69dcbb3d5d0dfd1b0fb8e35be2a12 |
| results/stage1/traffic/A__parity-neutral-r02/proxy.log | 15263d102747cca717d557962b01c180c62a30dbd1c6aed85f57ef98e148dbf1 | 15263d102747cca717d557962b01c180c62a30dbd1c6aed85f57ef98e148dbf1 |
| results/stage1/traffic/A__parity-neutral-r02/repo.json | 5ebff74cbcfcc34d6f39ac3c31f6076d662db60f4243b01492ff629c7603fefb | 5ebff74cbcfcc34d6f39ac3c31f6076d662db60f4243b01492ff629c7603fefb |
| results/stage1/traffic/A__parity-neutral-r02/round1.jsonl | 93abe897c1f2a8aad84d987326378930d5358c124b2d2fdee32d18be6fd3ef46 | a8ad085355c76841fe10b9dc311f85cae6865cd6f8e0ea0f3b08c762eb4a3654 |
| results/stage1/traffic/A__parity-neutral-r03/labels.json | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 |
| results/stage1/traffic/A__parity-neutral-r03/llm-reader.json | a6fc9dc79e95d08f8f529511822bba077f374b591c9ee3a2ee4274f6cd2691da | a6fc9dc79e95d08f8f529511822bba077f374b591c9ee3a2ee4274f6cd2691da |
| results/stage1/traffic/A__parity-neutral-r03/meta.json | 42cdb64304f9f06bc35522e6912701f0ed93196d551f78b561ad3342c3d9ab08 | 42cdb64304f9f06bc35522e6912701f0ed93196d551f78b561ad3342c3d9ab08 |
| results/stage1/traffic/A__parity-neutral-r03/proxy.log | 2fa53fcb770ef080d7fb3e8bfa544a7b23ce61e9cbc418916544502f9eb3f135 | 2fa53fcb770ef080d7fb3e8bfa544a7b23ce61e9cbc418916544502f9eb3f135 |
| results/stage1/traffic/A__parity-neutral-r03/repo.json | a92c83248670ad23ca8cf0da3bfacabb8b90170cda17a6210d73c5f6d03336ed | a92c83248670ad23ca8cf0da3bfacabb8b90170cda17a6210d73c5f6d03336ed |
| results/stage1/traffic/A__parity-neutral-r03/round1.jsonl | 3cac285bd2ac723f9f7cbd064e88f7e6a2fd26734fbf1435a6b0d7116be600ea | 023e9127f9ab7baae6a0b2b867b614d685c281e72f25b0428f18112e1a80b7f4 |
| results/stage1/traffic/A__parity-neutral-r04/labels.json | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 |
| results/stage1/traffic/A__parity-neutral-r04/llm-reader.json | cf7dda7fd69b1c1ab5d8233ee468e924c7ab1fd0fa1a248f625c43c1254ca41f | cf7dda7fd69b1c1ab5d8233ee468e924c7ab1fd0fa1a248f625c43c1254ca41f |
| results/stage1/traffic/A__parity-neutral-r04/meta.json | 12fa4efcff6a49781d3104a295e69908356b5437077b6facc42dd0ab3ad040e6 | 12fa4efcff6a49781d3104a295e69908356b5437077b6facc42dd0ab3ad040e6 |
| results/stage1/traffic/A__parity-neutral-r04/proxy.log | 68078ddb438562d9db9409f51c5c0623763f87a1a915f15050807ca4f375acb6 | 68078ddb438562d9db9409f51c5c0623763f87a1a915f15050807ca4f375acb6 |
| results/stage1/traffic/A__parity-neutral-r04/repo.json | d3976a9d7e48f1d8b94f9fec9403bbbdf1178de7ee7406afed3d644ae2f21ca5 | d3976a9d7e48f1d8b94f9fec9403bbbdf1178de7ee7406afed3d644ae2f21ca5 |
| results/stage1/traffic/A__parity-neutral-r04/round1.jsonl | 933828665cf4c42a7e81c3d868c864f570be990bba3233f51ba42ebd7202c7cd | 3358fcf647c1348116eb4dcfc4937c18085084fd34717b913f01a450c38ac855 |
| results/stage1/traffic/A__parity-neutral-r05/labels.json | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 |
| results/stage1/traffic/A__parity-neutral-r05/llm-reader.json | 928c93fe5519eb3d80f26ce7303f341eebe00adf9527b1a863f99d4caa91d727 | 928c93fe5519eb3d80f26ce7303f341eebe00adf9527b1a863f99d4caa91d727 |
| results/stage1/traffic/A__parity-neutral-r05/meta.json | 861523f1b450f0c969dfbdb2cce46b673946e545c1d0a701236f39c9e4bad405 | 861523f1b450f0c969dfbdb2cce46b673946e545c1d0a701236f39c9e4bad405 |
| results/stage1/traffic/A__parity-neutral-r05/proxy.log | 30d319a72e1dc514ee9e13b13640e9aac38e6ed1b17272f9620164483abe0fe2 | 30d319a72e1dc514ee9e13b13640e9aac38e6ed1b17272f9620164483abe0fe2 |
| results/stage1/traffic/A__parity-neutral-r05/repo.json | a869f6906bcb0e233177a1cee4d3f78acbb7c2b118fa214142103e8dba649746 | a869f6906bcb0e233177a1cee4d3f78acbb7c2b118fa214142103e8dba649746 |
| results/stage1/traffic/A__parity-neutral-r05/round1.jsonl | d94e44e5a29a7a1ebfe360eb6b97be015e4363257d393aff86556174576ebd19 | 431bb909410089c5e19c7c86fb618970ffd673e49e173935d8f98315b314e6f6 |
| results/stage1/traffic/A__parity-neutral-r06/labels.json | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 |
| results/stage1/traffic/A__parity-neutral-r06/llm-reader.json | 69ac38c1d723679869737e73d8d64b86786355a54d78a74d2bf6f9fee549b5e2 | 69ac38c1d723679869737e73d8d64b86786355a54d78a74d2bf6f9fee549b5e2 |
| results/stage1/traffic/A__parity-neutral-r06/meta.json | 79bfecadcd23263c9e2c715aee164f439c12f322d26b852fc965463bffc73965 | 79bfecadcd23263c9e2c715aee164f439c12f322d26b852fc965463bffc73965 |
| results/stage1/traffic/A__parity-neutral-r06/proxy.log | 693fb42c92ad0f67edf06cdb167ae5df9f8874f857c7ba26eb285ea9c22da7f4 | 693fb42c92ad0f67edf06cdb167ae5df9f8874f857c7ba26eb285ea9c22da7f4 |
| results/stage1/traffic/A__parity-neutral-r06/repo.json | 37abaf6d634b3338cbf7b09b5554246774946f0f1be6d04376d7e972ef902b22 | 37abaf6d634b3338cbf7b09b5554246774946f0f1be6d04376d7e972ef902b22 |
| results/stage1/traffic/A__parity-neutral-r06/round1.jsonl | b4cbc50f5f4c6a51f2dac6731e865945d8695afbff10dc523bdfd2bbb58eafe6 | 5b9899285db425ab665369c188f6eec979e268e113d37c4954e144fc8e883219 |
| results/stage1/traffic/A__parity-neutral-r07/labels.json | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 |
| results/stage1/traffic/A__parity-neutral-r07/llm-reader.json | a9b0a48aebb26b2742d826759e266ae160d72d3b4654ca2a870d01705c847d98 | a9b0a48aebb26b2742d826759e266ae160d72d3b4654ca2a870d01705c847d98 |
| results/stage1/traffic/A__parity-neutral-r07/meta.json | 4126ef39cdc00ed27125a5c704c1d1c71c6ad8162d31cfbc80a341b49aaa4dd0 | 4126ef39cdc00ed27125a5c704c1d1c71c6ad8162d31cfbc80a341b49aaa4dd0 |
| results/stage1/traffic/A__parity-neutral-r07/proxy.log | 0bb47cf92c54688d014891b50307e6c8d6f6200ab93b5158de010227155c4193 | 0bb47cf92c54688d014891b50307e6c8d6f6200ab93b5158de010227155c4193 |
| results/stage1/traffic/A__parity-neutral-r07/repo.json | 1f8b97ffa7064fd53a3779b4f87196f88e74664e0a344e7b7b85955fd81d1847 | 1f8b97ffa7064fd53a3779b4f87196f88e74664e0a344e7b7b85955fd81d1847 |
| results/stage1/traffic/A__parity-neutral-r07/round1.jsonl | 0ed50bdcbf0a216f674e2c0261cf5cc7dca9d97e7530c3a3abb1da2145329e8a | f914b8d53d9eabbc280dcc63e357efb116369c500c491c5c832415001c5f57a8 |
| results/stage1/traffic/A__parity-neutral-r08/labels.json | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 |
| results/stage1/traffic/A__parity-neutral-r08/llm-reader.json | c720303be61110ca09df3a8989196f593c17d4036aacb0f1193b759f6eb2f2d7 | c720303be61110ca09df3a8989196f593c17d4036aacb0f1193b759f6eb2f2d7 |
| results/stage1/traffic/A__parity-neutral-r08/meta.json | 4e7bc7c12b4c622c1e1f3e9123bb6256decab81704c8043a96f8a0cb52d7684b | 4e7bc7c12b4c622c1e1f3e9123bb6256decab81704c8043a96f8a0cb52d7684b |
| results/stage1/traffic/A__parity-neutral-r08/proxy.log | 0faf6eae9760fc9ec936e6e22de3a307a4afb5dce814902e3c9a6df5ae5fed9d | 0faf6eae9760fc9ec936e6e22de3a307a4afb5dce814902e3c9a6df5ae5fed9d |
| results/stage1/traffic/A__parity-neutral-r08/repo.json | 78cc33f701f68a1ea11239d0edd04ec8591867906725f6468bc8893abce32f10 | 78cc33f701f68a1ea11239d0edd04ec8591867906725f6468bc8893abce32f10 |
| results/stage1/traffic/A__parity-neutral-r08/round1.jsonl | b16642f06f3aa8bee313bc34487d94602e723ff0404b00597b0c826441b74af3 | 5cc78d5808856caa8501fe00e83d5166568003ace0e756fee9e84ba255c15f4f |
| results/stage1/traffic/A__parity-neutral-r09/labels.json | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 |
| results/stage1/traffic/A__parity-neutral-r09/llm-reader.json | 46de7a51717365ed5f5aa2b54cded1e651d980feb4a7ef5428059268bd4c30fd | 46de7a51717365ed5f5aa2b54cded1e651d980feb4a7ef5428059268bd4c30fd |
| results/stage1/traffic/A__parity-neutral-r09/meta.json | a0ede85ae48243f36ffc263abc34f58ad328ea3d3b6c4259bf2ddf845b8a484a | a0ede85ae48243f36ffc263abc34f58ad328ea3d3b6c4259bf2ddf845b8a484a |
| results/stage1/traffic/A__parity-neutral-r09/proxy.log | ff5fd9a8f1cd5b306776e41bd4ca45a37424c8a458530a2c6bc6d72918fcc7b3 | ff5fd9a8f1cd5b306776e41bd4ca45a37424c8a458530a2c6bc6d72918fcc7b3 |
| results/stage1/traffic/A__parity-neutral-r09/repo.json | cd5ba01124020b958cf3235c545eaa7111aa580a64a6f4f2085264e07d53928d | cd5ba01124020b958cf3235c545eaa7111aa580a64a6f4f2085264e07d53928d |
| results/stage1/traffic/A__parity-neutral-r09/round1.jsonl | a2d6446ed3e2c8443e4f3be0d4a563c82e6b8b65e6113ad504957981de12c271 | 1b5e1592fd87a9b624c53f90ea84f84d7e12c9f31b995ca8c5a0189cace332dc |
| results/stage1/traffic/A__parity-neutral-r10/labels.json | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 |
| results/stage1/traffic/A__parity-neutral-r10/llm-reader.json | 22644555ea93cf6b8f96e6d9d990acc4f2487af8a1cb4d20df5146a1b23177ef | 22644555ea93cf6b8f96e6d9d990acc4f2487af8a1cb4d20df5146a1b23177ef |
| results/stage1/traffic/A__parity-neutral-r10/meta.json | c9a8da2ac83413da1369a9cb3c21bcc2933ce80653ebc662b550ac0ff26e9c68 | c9a8da2ac83413da1369a9cb3c21bcc2933ce80653ebc662b550ac0ff26e9c68 |
| results/stage1/traffic/A__parity-neutral-r10/proxy.log | 75d3ddc7c9d7acf0ef4b5ae008263169c8bee5fe08ba43d22f189d2e37a889c6 | 75d3ddc7c9d7acf0ef4b5ae008263169c8bee5fe08ba43d22f189d2e37a889c6 |
| results/stage1/traffic/A__parity-neutral-r10/repo.json | 958c667cec638a89c5f44083234db7cc3a5974b4a4f9e033be995e2edebf38c3 | 958c667cec638a89c5f44083234db7cc3a5974b4a4f9e033be995e2edebf38c3 |
| results/stage1/traffic/A__parity-neutral-r10/round1.jsonl | 398829da6155b2b23948f1114cd53a2d0ebb060a92e69e1c4ee205eb5689c2c0 | f1b79a4b3e243f6158171184e466da6c1651f45b14386af16d414a4a722e85df |
| results/stage1/traffic/A__parity-scoped-r01/labels.json | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 |
| results/stage1/traffic/A__parity-scoped-r01/llm-reader.json | 819d647f1685ee74197087354c318ea580fbefe964d7adce86ea4931dc0be638 | 819d647f1685ee74197087354c318ea580fbefe964d7adce86ea4931dc0be638 |
| results/stage1/traffic/A__parity-scoped-r01/meta.json | 04d067a70b4ff82f6426007a0829f9aea53b5674538cb0d4e2918ec949f8c07d | 04d067a70b4ff82f6426007a0829f9aea53b5674538cb0d4e2918ec949f8c07d |
| results/stage1/traffic/A__parity-scoped-r01/proxy.log | eea6f0f1a6f6540b431ce3867e4627b83e0ae046da748b3fecd58e69deff3b86 | eea6f0f1a6f6540b431ce3867e4627b83e0ae046da748b3fecd58e69deff3b86 |
| results/stage1/traffic/A__parity-scoped-r01/repo.json | 2ee1221f2b556634780d9e40de227ecc0bdd98905ce161dc061398fbf1f5bdf1 | 2ee1221f2b556634780d9e40de227ecc0bdd98905ce161dc061398fbf1f5bdf1 |
| results/stage1/traffic/A__parity-scoped-r01/round1.jsonl | 7e0e5e108c0a8786871a1f96288523ac2b15c666ddd3dde9a250729527e5e072 | 2500b11f00665050e9bad1696b08fc7bfd3d2110a42eb4ca397333ea3ab3932a |
| results/stage1/traffic/A__parity-scoped-r02/labels.json | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 | bc282e875837e53f3bfe2e4188b18c22b51cab1f935cee9040553193f2611320 |
| results/stage1/traffic/A__parity-scoped-r02/llm-reader.json | c21fd6b5fe04c8f3500cf941f85af64bf2ac93e2c6617ec4e1b1500ddf220de9 | c21fd6b5fe04c8f3500cf941f85af64bf2ac93e2c6617ec4e1b1500ddf220de9 |
| results/stage1/traffic/A__parity-scoped-r02/meta.json | e5d2a4fa8e9e44fb37233b23970f66c3c36259694c02cef70772b52abb57024b | e5d2a4fa8e9e44fb37233b23970f66c3c36259694c02cef70772b52abb57024b |
| results/stage1/traffic/A__parity-scoped-r02/proxy.log | 2372cf395ed9d81d0ad013134e2cd1e9341ccf1b04106d5256729e89920d5c9b | 2372cf395ed9d81d0ad013134e2cd1e9341ccf1b04106d5256729e89920d5c9b |
| results/stage1/traffic/A__parity-scoped-r02/repo.json | fdbf6e01139cf09750fdecb9b6e4823d324c8439bf24b98ebf12fc5220ece2a4 | fdbf6e01139cf09750fdecb9b6e4823d324c8439bf24b98ebf12fc5220ece2a4 |
| results/stage1/traffic/A__parity-scoped-r02/round1.jsonl | fc837af65fc4fae9d9b72a901a5de86636b9301f34761c1d436480a3a6341a06 | 83e07f4fdcaedb9bcf261322b5bc1cf2a53757c720fa724840ffd6cd802bad85 |
| results/stage1/traffic/B__parity-neutral-r01/labels.json | be1c0d9174cc73cda4ae633b0ff0117898c88c3c77aeb115b4c8e7e4206efd62 | be1c0d9174cc73cda4ae633b0ff0117898c88c3c77aeb115b4c8e7e4206efd62 |
| results/stage1/traffic/B__parity-neutral-r01/llm-reader.json | c39cc23390c0dba693bc010450c7671ac9934edf76aa7a393334650223eab0d8 | c39cc23390c0dba693bc010450c7671ac9934edf76aa7a393334650223eab0d8 |
| results/stage1/traffic/B__parity-neutral-r01/meta.json | 3ad62e5264b8793ba8b396ebbcd7bf4fb24cfb37c1f43333061f9124176f7f24 | 3ad62e5264b8793ba8b396ebbcd7bf4fb24cfb37c1f43333061f9124176f7f24 |
| results/stage1/traffic/B__parity-neutral-r01/proxy.log | 3b2da006a4aa2591ec4a50462791818890d8d1744dfb781489e91263444bf183 | 3b2da006a4aa2591ec4a50462791818890d8d1744dfb781489e91263444bf183 |
| results/stage1/traffic/B__parity-neutral-r01/repo.json | 085fbe3de8737315e7a0fba88ea9354439ffce7e1810c110d864d87d221e8583 | 085fbe3de8737315e7a0fba88ea9354439ffce7e1810c110d864d87d221e8583 |
| results/stage1/traffic/B__parity-neutral-r01/round1.jsonl | a1cbc5793a5d0a2b3c944b5c99d43bd92149a3a5dbdb33e23fb4da342ffc36e1 | 27ba3f4b99dbf141e431bdfcbfd866d40f5a634cc45c26183c4a67ea5365fd56 |
| results/stage1/traffic/B__parity-neutral-r02/labels.json | abadeb31be1e9c05548ed0f04f03596b8b5758f2554bc6437a73c07881b4a362 | abadeb31be1e9c05548ed0f04f03596b8b5758f2554bc6437a73c07881b4a362 |
| results/stage1/traffic/B__parity-neutral-r02/llm-reader.json | ad38b7c1391e899dbfdfd48a8f2f91ff20f88c8e854ab7f73e32d6cdad3db24f | ad38b7c1391e899dbfdfd48a8f2f91ff20f88c8e854ab7f73e32d6cdad3db24f |
| results/stage1/traffic/B__parity-neutral-r02/meta.json | 8770709dbde9e84057d7ff19db949c86797a0ad85341fc5d98a2abc8c2a88355 | 8770709dbde9e84057d7ff19db949c86797a0ad85341fc5d98a2abc8c2a88355 |
| results/stage1/traffic/B__parity-neutral-r02/proxy.log | f1186529ad6f15d187214b2725378f743940d7c2df3abd2c393a3c5bdabd182f | f1186529ad6f15d187214b2725378f743940d7c2df3abd2c393a3c5bdabd182f |
| results/stage1/traffic/B__parity-neutral-r02/repo.json | 4e1ab776355d59391e7dcb38a707f5c592b2af390b1dbf9df98e80ad7475ec49 | 4e1ab776355d59391e7dcb38a707f5c592b2af390b1dbf9df98e80ad7475ec49 |
| results/stage1/traffic/B__parity-neutral-r02/round1.jsonl | 07abae4c1285cff143e68fc49786c6518c25dbd4edae98f29de7e57fedcdcf14 | 9e7438981a8b07d5e7f56716e4e60fb9f4555a98b9fba1dd84d7e15427569566 |
| results/stage1/traffic/B__parity-neutral-r03/labels.json | abadeb31be1e9c05548ed0f04f03596b8b5758f2554bc6437a73c07881b4a362 | abadeb31be1e9c05548ed0f04f03596b8b5758f2554bc6437a73c07881b4a362 |
| results/stage1/traffic/B__parity-neutral-r03/llm-reader.json | 3f0746f759a20a4602df6415a09a4554f69e028253398cad891bdfd79fe48345 | 3f0746f759a20a4602df6415a09a4554f69e028253398cad891bdfd79fe48345 |
| results/stage1/traffic/B__parity-neutral-r03/meta.json | 6d78eecede2b2d185677ce5ffe5e843e48068c96acf3bd3881e44595040231ce | 6d78eecede2b2d185677ce5ffe5e843e48068c96acf3bd3881e44595040231ce |
| results/stage1/traffic/B__parity-neutral-r03/proxy.log | 7cc7a33cab2dde2dcb9c9f55beb71e9194159850117810588f40ead2c16cb807 | 7cc7a33cab2dde2dcb9c9f55beb71e9194159850117810588f40ead2c16cb807 |
| results/stage1/traffic/B__parity-neutral-r03/repo.json | 1e2d85e8e36741ae5a9d248ea49208624748f30e11617b3ac2607b66e9012fba | 1e2d85e8e36741ae5a9d248ea49208624748f30e11617b3ac2607b66e9012fba |
| results/stage1/traffic/B__parity-neutral-r03/round1.jsonl | 4a85dff58023d633f6250a10ce26193bde621eeb4252a8f902794be46c274fcb | 55626a965a082e1a2807773a20ba485f7faef873a51ef8f0f566359e9f418d99 |
| results/stage1/traffic/B__parity-neutral-r04/labels.json | abadeb31be1e9c05548ed0f04f03596b8b5758f2554bc6437a73c07881b4a362 | abadeb31be1e9c05548ed0f04f03596b8b5758f2554bc6437a73c07881b4a362 |
| results/stage1/traffic/B__parity-neutral-r04/llm-reader.json | 7d65f9ddff81abc86e8f5d7fbfc38d82aa08ddd6b5603c650cbf6b0b79c74a78 | 7d65f9ddff81abc86e8f5d7fbfc38d82aa08ddd6b5603c650cbf6b0b79c74a78 |
| results/stage1/traffic/B__parity-neutral-r04/meta.json | fb256fc6f8ba3ad655f866f52e591bbf2d5147e48038bd12acf36c3218fdefb4 | fb256fc6f8ba3ad655f866f52e591bbf2d5147e48038bd12acf36c3218fdefb4 |
| results/stage1/traffic/B__parity-neutral-r04/proxy.log | 95dddc21f8fae5c248a5ad23487714ea83441649efc037cbbdf5c6ce15fddef5 | 95dddc21f8fae5c248a5ad23487714ea83441649efc037cbbdf5c6ce15fddef5 |
| results/stage1/traffic/B__parity-neutral-r04/repo.json | 5a8d0b7fcc75a6a6e4994a546d34c9dc8c201b70f46be847254ff9387fc9d734 | 5a8d0b7fcc75a6a6e4994a546d34c9dc8c201b70f46be847254ff9387fc9d734 |
| results/stage1/traffic/B__parity-neutral-r04/round1.jsonl | c27e55807e78420355d9d41ce7def00caf532b3389eca9b2f553eaee82bdbda9 | 8a08c833cc08c2f998bf474eaf7951163a8bcbb3686b5086a920f03cfbeb078c |
| results/stage1/traffic/B__parity-neutral-r05/labels.json | abadeb31be1e9c05548ed0f04f03596b8b5758f2554bc6437a73c07881b4a362 | abadeb31be1e9c05548ed0f04f03596b8b5758f2554bc6437a73c07881b4a362 |
| results/stage1/traffic/B__parity-neutral-r05/llm-reader.json | a3117962bb976702790f294d9acfdd8c0fe1df71649c09cda24609b1ead09cae | a3117962bb976702790f294d9acfdd8c0fe1df71649c09cda24609b1ead09cae |
| results/stage1/traffic/B__parity-neutral-r05/meta.json | d57931f004e03b0211b67fdf94846c4a76fadac82bd3c6f023286fb94174fe04 | d57931f004e03b0211b67fdf94846c4a76fadac82bd3c6f023286fb94174fe04 |
| results/stage1/traffic/B__parity-neutral-r05/proxy.log | f71a1a295af81142a183d245fe04bde7f5fd6c18e4e9e001a1b6ac53c0cf60de | f71a1a295af81142a183d245fe04bde7f5fd6c18e4e9e001a1b6ac53c0cf60de |
| results/stage1/traffic/B__parity-neutral-r05/repo.json | 58c029e67f1f93250856dd08238be643c0aaa1df7300e9595f32b695b164089b | 58c029e67f1f93250856dd08238be643c0aaa1df7300e9595f32b695b164089b |
| results/stage1/traffic/B__parity-neutral-r05/round1.jsonl | 64101a1717b7100414692fe73b282d9351cf0548afdc6c3bac0d3be8252015a7 | 7cfce31188d5db3c33d6563b5fde9af9d1599b4c0cac5ecfdddf657816391a15 |
| results/stage1/traffic/B__parity-neutral-r06/labels.json | abadeb31be1e9c05548ed0f04f03596b8b5758f2554bc6437a73c07881b4a362 | abadeb31be1e9c05548ed0f04f03596b8b5758f2554bc6437a73c07881b4a362 |
| results/stage1/traffic/B__parity-neutral-r06/llm-reader.json | 1b96aed90eb295649f8b14b6f0dbc8f9e0d0bdfc50de57630bf3115ca34b2f28 | 1b96aed90eb295649f8b14b6f0dbc8f9e0d0bdfc50de57630bf3115ca34b2f28 |
| results/stage1/traffic/B__parity-neutral-r06/meta.json | e8dd3fe65649b9b414b65979e98be52cf7f26c90c400b3d79853b2067e9060e1 | e8dd3fe65649b9b414b65979e98be52cf7f26c90c400b3d79853b2067e9060e1 |
| results/stage1/traffic/B__parity-neutral-r06/proxy.log | 9f83e574e73b8915154ea6b5b0289869f8124ce277547df507e29be1213124cf | 9f83e574e73b8915154ea6b5b0289869f8124ce277547df507e29be1213124cf |
| results/stage1/traffic/B__parity-neutral-r06/repo.json | 0d8ae06344fa45926fa8876341bb323901047428816ae6c9769f057546d794a2 | 0d8ae06344fa45926fa8876341bb323901047428816ae6c9769f057546d794a2 |
| results/stage1/traffic/B__parity-neutral-r06/round1.jsonl | 8ff17062dbc1fa2a8c5798ec08bec5b02497400b33e39a25c749f944909e71e4 | 5d5de9a07adb9f12b5dfd237ddb51f2db77107aa954d713b1382927d014f83da |
| results/stage1/traffic/B__parity-neutral-r07/labels.json | abadeb31be1e9c05548ed0f04f03596b8b5758f2554bc6437a73c07881b4a362 | abadeb31be1e9c05548ed0f04f03596b8b5758f2554bc6437a73c07881b4a362 |
| results/stage1/traffic/B__parity-neutral-r07/llm-reader.json | a51ce330bd9f75588ceefa6079bff1121aa67e67cf08906dcbbbc8c72497e0fd | a51ce330bd9f75588ceefa6079bff1121aa67e67cf08906dcbbbc8c72497e0fd |
| results/stage1/traffic/B__parity-neutral-r07/meta.json | b6b80c7dcc0c5febc81adb50724bc85231c1b1c8123e6769cfd8d0c2db27d9dc | b6b80c7dcc0c5febc81adb50724bc85231c1b1c8123e6769cfd8d0c2db27d9dc |
| results/stage1/traffic/B__parity-neutral-r07/proxy.log | e31dd04c071e4074d2cd217c9de9d93a8555c6ea032f3ff82b9eb0aabd4d028f | e31dd04c071e4074d2cd217c9de9d93a8555c6ea032f3ff82b9eb0aabd4d028f |
| results/stage1/traffic/B__parity-neutral-r07/repo.json | 05fae1e1da080e9ad1f6259593022d54e532db2c22b51a994ecc7ce89d7364da | 05fae1e1da080e9ad1f6259593022d54e532db2c22b51a994ecc7ce89d7364da |
| results/stage1/traffic/B__parity-neutral-r07/round1.jsonl | 50288c17ae93fe5b09d010cde54c8d99665770158bc58d0f4e84bff29bf84b5d | ebd9abc35c83cc2bb89b844bf944754b1105c9700e7d92a6c787590e3afb8114 |
| results/stage1/traffic/B__parity-neutral-r08/labels.json | abadeb31be1e9c05548ed0f04f03596b8b5758f2554bc6437a73c07881b4a362 | abadeb31be1e9c05548ed0f04f03596b8b5758f2554bc6437a73c07881b4a362 |
| results/stage1/traffic/B__parity-neutral-r08/llm-reader.json | 0be96e647ce04eafeabcf6f4ae59aef805a8305217e209fa3ed8a427e84ebed1 | 0be96e647ce04eafeabcf6f4ae59aef805a8305217e209fa3ed8a427e84ebed1 |
| results/stage1/traffic/B__parity-neutral-r08/meta.json | da4a371477adfda4f41fe7a23276a441dbc7bd9f1d82597441872c129c1059c9 | da4a371477adfda4f41fe7a23276a441dbc7bd9f1d82597441872c129c1059c9 |
| results/stage1/traffic/B__parity-neutral-r08/proxy.log | 643f8ca5c8d1b30a94edb46d7b6d5e658ad53577ee1964bfa5ee3bbb8fa627a5 | 643f8ca5c8d1b30a94edb46d7b6d5e658ad53577ee1964bfa5ee3bbb8fa627a5 |
| results/stage1/traffic/B__parity-neutral-r08/repo.json | c6f0816db3d1ae59b42d0e9776b087e5cbff7d68cbd3e775573c38fa68f8ae37 | c6f0816db3d1ae59b42d0e9776b087e5cbff7d68cbd3e775573c38fa68f8ae37 |
| results/stage1/traffic/B__parity-neutral-r08/round1.jsonl | fc370974bfbf609bf5ae91969b8ee681fbc98383efd3bf8a89e0d18a886ebeb7 | 8215b0cc1a1f287e20a4a1c5119856714547e582a68825663e730ce8c7c6ed62 |
| results/stage1/traffic/B__parity-neutral-r09/labels.json | abadeb31be1e9c05548ed0f04f03596b8b5758f2554bc6437a73c07881b4a362 | abadeb31be1e9c05548ed0f04f03596b8b5758f2554bc6437a73c07881b4a362 |
| results/stage1/traffic/B__parity-neutral-r09/llm-reader.json | e7c5ace6dd8b8bfbe102b37521fa44b9b24d6c07a262c0c5fec7719326947cdf | e7c5ace6dd8b8bfbe102b37521fa44b9b24d6c07a262c0c5fec7719326947cdf |
| results/stage1/traffic/B__parity-neutral-r09/meta.json | 7582dd569d7dd1d494839a3bf25ebf1b85b999315910159c0d361ddd2145b6c9 | 7582dd569d7dd1d494839a3bf25ebf1b85b999315910159c0d361ddd2145b6c9 |
| results/stage1/traffic/B__parity-neutral-r09/proxy.log | a3276dee150e6d8f9119c5d9b04554558d2d35fd41683c76449995ab9d48ad89 | a3276dee150e6d8f9119c5d9b04554558d2d35fd41683c76449995ab9d48ad89 |
| results/stage1/traffic/B__parity-neutral-r09/repo.json | 8125f38749d501e04b09fc7d05401faf1e7757545aa773005d987efd2d1b10ee | 8125f38749d501e04b09fc7d05401faf1e7757545aa773005d987efd2d1b10ee |
| results/stage1/traffic/B__parity-neutral-r09/round1.jsonl | dcf434bd328070ac0f4ffbc0629291270c16198af0180335d8facfc7cfe06250 | 72a7677639edc80def3489cb76b39a69317b7287c40a6a50155935ec3a506750 |
| results/stage1/traffic/B__parity-neutral-r10/labels.json | abadeb31be1e9c05548ed0f04f03596b8b5758f2554bc6437a73c07881b4a362 | abadeb31be1e9c05548ed0f04f03596b8b5758f2554bc6437a73c07881b4a362 |
| results/stage1/traffic/B__parity-neutral-r10/llm-reader.json | 40634e9315b066a068cccbe2a85dcd28b079e6080de59799c66db59bbe4f3ee0 | 40634e9315b066a068cccbe2a85dcd28b079e6080de59799c66db59bbe4f3ee0 |
| results/stage1/traffic/B__parity-neutral-r10/meta.json | fd2f4371d4e37f19bafbb5d6097084a8db6b0e691b9e3eef5d0b3d80f87f3fed | fd2f4371d4e37f19bafbb5d6097084a8db6b0e691b9e3eef5d0b3d80f87f3fed |
| results/stage1/traffic/B__parity-neutral-r10/proxy.log | 5fd621f6765249223002ce088badc483a36f459de2d45ca54cd4afa7778c7205 | 5fd621f6765249223002ce088badc483a36f459de2d45ca54cd4afa7778c7205 |
| results/stage1/traffic/B__parity-neutral-r10/repo.json | 63578e8c4ad41cc76c373e98e9dda26fe46f20283e052a5343e86ea6c5b91b0f | 63578e8c4ad41cc76c373e98e9dda26fe46f20283e052a5343e86ea6c5b91b0f |
| results/stage1/traffic/B__parity-neutral-r10/round1.jsonl | 11c5a47a7fda35bdd16b384e3931b22e1ce6200d9c099b563055083d3ea0a451 | 5324eca79c1a8a8d1cf9cf9752b3f8645ae0231d830744fc4e2e34554f2a25c0 |
| results/stage1/traffic/B__parity-scoped-r01/labels.json | abadeb31be1e9c05548ed0f04f03596b8b5758f2554bc6437a73c07881b4a362 | abadeb31be1e9c05548ed0f04f03596b8b5758f2554bc6437a73c07881b4a362 |
| results/stage1/traffic/B__parity-scoped-r01/llm-reader.json | 4cfcc6b04c335d9d67169c74288cf0cfbb753da25e3c5276b5bf01b9f1554ec8 | 4cfcc6b04c335d9d67169c74288cf0cfbb753da25e3c5276b5bf01b9f1554ec8 |
| results/stage1/traffic/B__parity-scoped-r01/meta.json | 7139618c29aca535140db4a0af53c386194d9d1edf1f587e0064d6d5da8578c3 | 7139618c29aca535140db4a0af53c386194d9d1edf1f587e0064d6d5da8578c3 |
| results/stage1/traffic/B__parity-scoped-r01/proxy.log | 4c6d361facd469c34006b6bea68039b7822ff7a92d87b05868a9fdd8b00f1df3 | 4c6d361facd469c34006b6bea68039b7822ff7a92d87b05868a9fdd8b00f1df3 |
| results/stage1/traffic/B__parity-scoped-r01/repo.json | e07d3778c72950d42447186037c0c5b58d62f3327a13c2c075b575eb131a75a6 | e07d3778c72950d42447186037c0c5b58d62f3327a13c2c075b575eb131a75a6 |
| results/stage1/traffic/B__parity-scoped-r01/round1.jsonl | eb29f1f3faab287072a14800bc759d4926749cf3e399a0cc3b9d9b96568d683d | e1c9b9acaac4e366e3f557e681d4f6dad9f195d6aae6293a95f008c9b37e4887 |
| results/stage1/traffic/B__parity-scoped-r02/labels.json | abadeb31be1e9c05548ed0f04f03596b8b5758f2554bc6437a73c07881b4a362 | abadeb31be1e9c05548ed0f04f03596b8b5758f2554bc6437a73c07881b4a362 |
| results/stage1/traffic/B__parity-scoped-r02/llm-reader.json | 991aa7553a94b0803d0d16676344eaf939847ad0b8b508fec45e27409013cc4c | 991aa7553a94b0803d0d16676344eaf939847ad0b8b508fec45e27409013cc4c |
| results/stage1/traffic/B__parity-scoped-r02/meta.json | 8a250d7e8123b9d66c69fb204c6d79659621db150acff1436adfc33715ebc08f | 8a250d7e8123b9d66c69fb204c6d79659621db150acff1436adfc33715ebc08f |
| results/stage1/traffic/B__parity-scoped-r02/proxy.log | a3b4589409cbaa08ddf371256c863cdafd8edf951e14ee77d97e4ca8920930fa | a3b4589409cbaa08ddf371256c863cdafd8edf951e14ee77d97e4ca8920930fa |
| results/stage1/traffic/B__parity-scoped-r02/repo.json | fa114e0753c7b57a2c6f5ee1ef823ba45a50e396c9152dab9d6bb41106af7406 | fa114e0753c7b57a2c6f5ee1ef823ba45a50e396c9152dab9d6bb41106af7406 |
| results/stage1/traffic/B__parity-scoped-r02/round1.jsonl | 71c2b9cb251225c3e35bef1961d61217c3ee4fd0b47c98038a42977881d54805 | 150c3ce6a65480fe24b4b083a831faba96fb2b1ce27e1ee173e4e79f73e6e291 |
| results/stage2/counts.json | edf57a97d3586d11ff87c671f4fd76e58e1f39f39225914ac159294d693f11f1 | 4930ffedb0252ed176d71fd624877a0f58b7a2c908cadb4aa04ef687a36d6e2d |
