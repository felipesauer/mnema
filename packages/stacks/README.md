# @mnema/stacks

The contract of a **stack** for [mnema](https://github.com/felipesauer/mnema): a directory that brings skills,
agents and declared hooks to an agent, the validator that checks it, and the digest that identifies it. A pure
library: it reads a directory and runs nothing in it.

## What a stack is

```
my-stack/
  stack.json                  the manifest
  skills/<name>/SKILL.md      the open Agent Skills format, byte for byte
  agents/<name>.md            an agent, in a neutral format
  hooks/<file>                a script a hook declares (optional, and off)
  LICENSE
```

```json
{
  "name": "hello-stack",
  "version": "1.0.0",
  "description": "A one-skill, one-agent stack that says hello.",
  "author": { "name": "Example Author", "url": "https://example.com" },
  "license": "Apache-2.0",
  "brings": { "skills": ["hello"], "agents": ["greeter"], "hooks": [] }
}
```

`stack.schema.json` is that manifest as a JSON Schema. `fixtures/hello-stack/` is a stack that passes.

`validateStack(directory)` returns the problems it found, each with a code, and the digest. A stack is refused when it:

- carries an MCP server in any form: a `.mcp.json`, an `.mcpb` bundle, or `mcpServers` in any JSON file;
- has a hook that is not declared in `stack.json`, whose file is missing, or that says it is enabled;
- has a `brings` that is not what the files hold;
- has a skill whose `name` is not its directory, that lacks a description, or that has a field the specification
  does not;
- holds a symbolic link, a path that leaves the root, or a name that is not in Unicode form NFC.

Hooks are declared one by one, apart from everything else, and the manifest can only say a hook is off.

## The digest

The identity of a stack is its digest, not its version. It is the SHA-256 of one line per file, in byte order of the
path, each `path NUL sha256(file) LF`, over every file except `.git/` and the signature at the root. Line endings
are not normalized. It needs no mnema:

```sh
sh digest.sh path/to/my-stack
```

which is, in full, `find`, `sort` and `sha256sum` (see `digest.sh`, which is one line). `hello-stack` is
`df9d8d71cdc13bd89b45af349e677ecfcbe98949805278bd42f16e6c0498f9ed`, and a case holds the library and the shell to
that number.

## What it proves — and what it does not

- The digest proves that two directories hold the same bytes. It does not prove who wrote them, and a digest with
  no signature says only "exactly this".
- The validator proves that a directory fits the contract. It does not prove that a skill is safe, that its
  instructions are good, or that a script under `scripts/` or `hooks/` does what its description says; it never
  runs one.
- `brings` is checked against the files, but the check does not read what a skill's text tells an agent to do.
- It refuses an MCP server by name and by file. It does not detect a server described in some other way.
- The frontmatter reader is small on purpose and is not a YAML parser. It reads top-level `key: value` lines and
  refuses a document it cannot place. Where `skills-ref`, the validator the specification publishes, is on the
  path, a case holds the two to the same verdict over a set of skills; it is not a dependency, and it takes
  non-ASCII skill names that this validator refuses.
- It does not install anything, fetch anything, or sign anything.

## License

Apache-2.0.
