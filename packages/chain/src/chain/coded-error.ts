/**
 * An error that is a REFUSAL, and carries the code it is refused by.
 *
 * Four classes of this package (`TailBusyError` and the three that refuse an installation id)
 * and two of the packages above it are thrown because the decision sits below every write,
 * where no caller returns anything: a lock another process holds, an id file a stopped
 * process left empty, a key the record gives no honest identity. Each carries a `code`, and
 * the door that answers an agent (`Refused (CODE): …`) knew two of them by name. The rest went
 * out of the server as the bare message, with none of what the session owed, because a class
 * nothing imports by name is a class nothing catches — and a THIRD kind of refusal added next
 * year would have joined them, since the list of classes lived in the door and the door is
 * not where a class is written.
 *
 * So the contract lives with the thing it is a contract for. A class that carries a refusal
 * code extends this one, and the door asks the one question — *is this a refusal?* — instead
 * of keeping a list. `every-chain-refusal-is-a-refusal.test.ts` finds the classes by the
 * discriminant (a `code` on a class that extends `Error`) rather than by a list, and fails
 * for one that does not extend this.
 */
export abstract class CodedError extends Error {
  /** The refusal's code — the word a caller branches on, and the one the reply leads with. */
  abstract readonly code: string;
}
