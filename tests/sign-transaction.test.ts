import { describe, expect, it } from 'vitest';

import { createInitializedProvider } from './provider-test-utils.js';

describe('signTransaction', () => {
  it('sends authBit and an optional public key', async () => {
    const { provider, iframe, sent, respond, emit } = await createInitializedProvider();

    const request = provider.signTransaction('0xA0', {
      authBit: '0x8000000000000001',
      instructionIndexes: [2, 0],
      includePayer: false,
      publicKeyHex: '0xABCD',
    });
    await Promise.resolve();
    expect(sent.at(-1)?.method).toBe('GET_ACCOUNT');
    respond({ address: '0x1', name: 'Primary', network: 'testnet' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent.at(-1)).toMatchObject({
      method: 'SIGN_TRANSACTION',
      params: {
        serializedTransactionHex: 'a0',
        authBit: '0x8000000000000001',
        instructionIndexes: [2, 0],
        includePayer: false,
        publicKeyHex: 'abcd',
      },
    });
    expect(iframe.style.display).toBe('none');
    emit('OPEN', {});
    expect(iframe.style.display).toBe('block');
    respond({ serializedTransactionHex: '01' });
    await expect(request).resolves.toEqual({ serializedTransactionHex: '01' });
    expect(iframe.style.display).toBe('block');
    expect(sent.map((message) => message.method)).toEqual([
      'INIT',
      'GET_ACCOUNT',
      'SIGN_TRANSACTION',
    ]);
    provider.destroy();
  });

  it('omits authBit so the wallet can apply the full-transaction default', async () => {
    const { provider, sent, respond } = await createInitializedProvider();
    const request = provider.signTransaction('00');

    await Promise.resolve();
    respond({ address: '0x1', name: 'Primary', network: 'testnet' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent.at(-1)).toMatchObject({
      method: 'SIGN_TRANSACTION',
      params: { serializedTransactionHex: '00' },
    });
    expect(sent.at(-1)?.params).not.toHaveProperty('authBit');
    respond({ serializedTransactionHex: '01' });
    await expect(request).resolves.toEqual({ serializedTransactionHex: '01' });
    expect(sent.filter((message) => message.method === 'OPEN')).toHaveLength(0);
    expect(sent.filter((message) => message.method === 'CLOSE')).toHaveLength(0);
    provider.destroy();
  });

  it.each(['', '0', 'zz'])('rejects invalid hex %j', async (hex) => {
    const { provider } = await createInitializedProvider();

    await expect(
      provider.signTransaction(hex, { authBit: '1' }),
    ).rejects.toThrow(
      'Invalid transaction hex.',
    );
    provider.destroy();
  });

  it('rejects an invalid authBit before checking the account', async () => {
    const { provider, sent } = await createInitializedProvider();

    await expect(
      provider.signTransaction('00', { authBit: 'not-a-bitset' }),
    ).rejects.toThrow('Invalid authBit.');
    expect(sent.map((message) => message.method)).toEqual(['INIT']);
    provider.destroy();
  });

  it('rejects authBit values wider than 64 bits', async () => {
    const { provider, sent } = await createInitializedProvider();

    await expect(
      provider.signTransaction('00', { authBit: '0x10000000000000000' }),
    ).rejects.toThrow('Invalid authBit.');
    expect(sent.map((message) => message.method)).toEqual(['INIT']);
    provider.destroy();
  });

  it('rejects an invalid public key before checking the account', async () => {
    const { provider, sent } = await createInitializedProvider();

    await expect(
      provider.signTransaction('00', { authBit: '1', publicKeyHex: '0xabc' }),
    ).rejects.toThrow(
      'Invalid public key hex.',
    );
    expect(sent.map((message) => message.method)).toEqual(['INIT']);
    provider.destroy();
  });

  it.each([
    [{ instructionIndexes: [-1] }, 'Invalid instruction indexes.'],
    [{ instructionIndexes: [63] }, 'Invalid instruction indexes.'],
    [{ includePayer: 'yes' }, 'Invalid includePayer.'],
  ])('rejects invalid semantic authorization fields', async (options, message) => {
    const { provider, sent } = await createInitializedProvider();

    await expect(provider.signTransaction('00', options as never)).rejects.toThrow(message);
    expect(sent.map((request) => request.method)).toEqual(['INIT']);
    provider.destroy();
  });

  it('rejects before opening the wallet when no account is connected', async () => {
    const { provider, sent, respond } = await createInitializedProvider();
    const request = provider.signTransaction('00', {
      instructionIndexes: [0, 1],
      includePayer: true,
    });

    await Promise.resolve();
    respond(null);

    await expect(request).rejects.toThrow('Wallet not connected.');
    expect(sent.map((message) => message.method)).toEqual(['INIT', 'GET_ACCOUNT']);
    provider.destroy();
  });
});
