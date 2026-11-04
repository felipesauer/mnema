In the JS package, make `EnvAccessor` accept lines written as `export KEY=value` (a shell habit): the key is `KEY`, exactly as if the `export ` prefix were not there. Add tests for it.
