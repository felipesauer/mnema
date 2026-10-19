/**
 * WHICH MNEMA THIS READER IS — the version a refusal names (`FORMAT.md` §7.1).
 *
 * A reader that meets a line whose `kind` and `v` no row of its table declares cannot know which
 * later version declares it: the record carries no field saying which binary wrote a line, and
 * none is added for this. What it can say is which one it is, so the refusal names this, and
 * "a newer mnema than this one" is something a person can act on.
 *
 * It is a constant and not a read of `package.json`, for the reason `@mnema/code`'s `VERSION` is
 * one. The workspace ships one number: `packages/code/tests/the-version-is-one-number.test.ts`
 * holds this constant to every manifest and to the program's own `VERSION`, so a release that
 * bumps one and not the other fails there.
 */
export const READER_VERSION = '0.1.0';
