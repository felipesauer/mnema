/**
 * THE KIND OF A KEY THAT CANNOT BE AN AGENT'S IS NAMED WITH THE ARTICLE IT TAKES.
 *
 * The refusal says what the key is: "an EC key", "an RSA key", "an ed448 key", "an x25519 key",
 * "a dsa key". The article follows how the name is said, not how it is spelled.
 */

import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { agentKeyAlgorithmRefusal } from '../src/commands/key-request.js';

const said = (publicKey: KeyObject): string | undefined =>
  agentKeyAlgorithmRefusal({ fingerprint: 'f'.repeat(64), publicKey });

describe('agentKeyAlgorithmRefusal', () => {
  it.each([
    ['an EC key', generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey],
    ['an RSA key', generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey],
    ['an ed448 key', generateKeyPairSync('ed448').publicKey],
    ['an x25519 key', generateKeyPairSync('x25519').publicKey],
    [
      'a dsa key',
      generateKeyPairSync('dsa', { modulusLength: 1024, divisorLength: 160 }).publicKey,
    ],
  ])('names the key as %s', (name, publicKey) => {
    expect(said(publicKey)).toBe(
      `the key ${'f'.repeat(64)} is ${name}, and an agent's key is an Ed25519 one: the consent that enrols it is proved for no other kind; \`mnema key request --agent <name> --anchor <your identity>\` without --key makes one`,
    );
  });

  it('has nothing to say of an Ed25519 key', () => {
    expect(said(generateKeyPairSync('ed25519').publicKey)).toBeUndefined();
  });
});
