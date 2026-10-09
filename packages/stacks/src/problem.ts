/** What stands in the way of a stack being valid. The `code` is what a caller and a test branch on; the message is for a person. */
export type ProblemCode =
  | 'no-manifest'
  | 'manifest-invalid'
  | 'no-license-file'
  | 'mcp-server'
  | 'hook-enabled'
  | 'hook-undeclared'
  | 'hook-file-missing'
  | 'hook-invalid'
  | 'brings-mismatch'
  | 'skill-invalid'
  | 'agent-invalid'
  | 'symlink'
  | 'signature-not-a-file'
  | 'not-a-file'
  | 'path-refused'
  | 'not-an-archive';

export interface Problem {
  readonly code: ProblemCode;
  readonly path?: string;
  readonly message: string;
}
