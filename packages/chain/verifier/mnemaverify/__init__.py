"""A second reader of the mnema chain format.

Written from `packages/chain/FORMAT.md`, from the published `canonical-vectors.json`, from
the bytes of the frozen records, and from specifications OUTSIDE this product: RFC 8032,
RFC 8259, ECMA-262, the OpenTimestamps format, and the Bitcoin block header. It imports
nothing from the product - not the compiled package, not the source, not a fixture helper -
because a second implementation that copied the first proves nothing. The document's own
"What this document does not promise" section says why this exists: "There is no second
implementation. Every digest here was produced by the one codebase this document
describes."

The points where the document did not suffice are in `gaps`, and they are the deliverable
half: a second reader that found nothing to write down there would be one that peeked.
"""

__all__ = ["gaps", "record", "selftest", "vectors", "verdict"]
