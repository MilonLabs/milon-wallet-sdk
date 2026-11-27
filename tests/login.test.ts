import { describe, expect, it } from 'vitest';

import { createInitializedProvider } from './provider-test-utils.js';

describe('login', () => {
  it('sends LOGIN with shared sign-message params and returns the signature', async () => {
    const { provider, sent, respond } = await createInitializedProvider();
    const signature = {
      address: '0x1',
      curve: 'ed25519' as const,
      publicKeyHex: 'aa',
      signatureHex: 'bb',
      message: 'hello',
      nonce: 'nonce-1',
      fullMessage: 'milon.wallet.message.v1.example',
    };

    const request = provider.login({ message: 'hello', nonce: 'nonce-1' });
    await Promise.resolve();
    expect(sent.at(-1)?.method).toBe('GET_ACCOUNT');
    respond({ address: '0x1', name: 'Primary', network: 'testnet' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sent.at(-1)).toMatchObject({
      method: 'LOGIN',
      params: { message: 'hello', nonce: 'nonce-1' },
    });
    respond(signature);
    await expect(request).resolves.toEqual(signature);
    provider.destroy();
  });

  it('uses the shared message and nonce validation', async () => {
    const { provider } = await createInitializedProvider();

    await expect(provider.login({ message: '' })).rejects.toThrow('Invalid message.');
    await expect(
      provider.login({ message: 'hello', nonce: 'a'.repeat(257) }),
    ).rejects.toThrow('Invalid nonce.');
    provider.destroy();
  });

  it('requires an existing connected account before opening the login request', async () => {
    const { provider, sent, respond } = await createInitializedProvider();
    const request = provider.login({ message: 'hello' });

    await Promise.resolve();
    respond(null);

    await expect(request).rejects.toThrow('Wallet not connected.');
    expect(sent.map((message) => message.method)).toEqual(['INIT', 'GET_ACCOUNT']);
    provider.destroy();
  });
});
