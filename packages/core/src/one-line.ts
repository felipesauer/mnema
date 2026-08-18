/**
 * The rule of the LINE, as this package reaches it.
 *
 * There is one rule and it lives in `@mnema/chain/one-line`, under everything, because
 * the sentences that need it are written in three packages and no surface can apply a
 * rule to the inside of a sentence another package already joined. This file is the
 * address a module of THIS package uses, so a site written next year imports from the
 * package it is in and never has to know where the rule moved to.
 *
 * IT IS THE SUBPATH AND NOT THE INDEX, for the reason the rule came down at all: the
 * index is the proof engine, and what is wanted here is a string function that loads
 * nothing.
 *
 * WHAT THIS PACKAGE PUTS THROUGH IT is every value it interpolates into a refusal that
 * came through the argv, back out of the record, or off this machine's disk — an id a
 * caller typed, a fingerprint nothing has validated yet, an anchor read out of the
 * files. `the-phrase-the-domain-words-is-one-line.test.ts` classifies every one of them
 * and reconciles the classification against this source in both directions.
 */

export { oneLine } from '@mnema/chain/one-line';
