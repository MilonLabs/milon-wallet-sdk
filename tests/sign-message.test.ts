import { describe, expect, it } from 'vitest';

import { createInitializedProvider } from './provider-test-utils.js';

describe('signMessage', () => {
  it('sends message and nonce without constructing fullMessage', async () => {
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

    const request = provider.signMessage({ message: 'hello', nonce: 'nonce-1' });
    await Promise.resolve();
    expect(sent.at(-1)?.method).toBe('GET_ACCOUNT');
    respond({ address: '0x1', name: 'Primary', network: 'testnet' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const message = sent.at(-1);
    expect(message).toMatchObject({
      method: 'SIGN_MESSAGE',
      params: { message: 'hello', nonce: 'nonce-1' },
    });
    const params = message && 'params' in message ? message.params : undefined;
    expect(Object.keys(params ?? {})).toEqual(['message', 'nonce']);
    respond(signature);
    await expect(request).resolves.toEqual(signature);
    expect(sent.map((message) => message.method)).toEqual([
      'INIT',
      'GET_ACCOUNT',
      'SIGN_MESSAGE',
    ]);
    provider.destroy();
  });

  it('omits nonce from the wire payload when it is not provided', async () => {
    const { provider, sent, respond } = await createInitializedProvider();
    const request = provider.signMessage({ message: 'hello' });

    await Promise.resolve();
    expect(sent.at(-1)?.method).toBe('GET_ACCOUNT');
    respond({ address: '0x1', name: 'Primary', network: 'testnet' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const message = sent.at(-1);
    expect(message).toMatchObject({
      method: 'SIGN_MESSAGE',
      params: { message: 'hello' },
    });
    const params = message && 'params' in message ? message.params : undefined;
    expect(Object.keys(params ?? {})).toEqual(['message']);

    respond({
      address: '0x1',
      curve: 'ed25519',
      publicKeyHex: 'aa',
      signatureHex: 'bb',
      message: 'hello',
      nonce: 'wallet-generated-nonce',
      fullMessage: 'milon.wallet.message.v1.example',
    });
    await expect(request).resolves.toMatchObject({ nonce: 'wallet-generated-nonce' });
    provider.destroy();
  });

  it('preserves an explicitly empty nonce in the wire payload', async () => {
    const { provider, sent, respond } = await createInitializedProvider();
    const request = provider.signMessage({ message: 'hello', nonce: '' });

    await Promise.resolve();
    expect(sent.at(-1)?.method).toBe('GET_ACCOUNT');
    respond({ address: '0x1', name: 'Primary', network: 'testnet' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const message = sent.at(-1);
    expect(message).toMatchObject({
      method: 'SIGN_MESSAGE',
      params: { message: 'hello', nonce: '' },
    });
    const params = message && 'params' in message ? message.params : undefined;
    expect(Object.keys(params ?? {})).toEqual(['message', 'nonce']);

    respond({
      address: '0x1',
      curve: 'ed25519',
      publicKeyHex: 'aa',
      signatureHex: 'bb',
      message: 'hello',
      nonce: '',
      fullMessage: 'milon.wallet.message.v1.example',
    });
    await expect(request).resolves.toMatchObject({ nonce: '' });
    provider.destroy();
  });

  it('leaves completion visibility to the wallet for concurrent signing requests', async () => {
    const { provider, iframe, sent, respond, emit } = await createInitializedProvider();
    const first = provider.signMessage({ message: 'first', nonce: 'nonce-first' });
    const second = provider.signMessage({ message: 'second', nonce: 'nonce-second' });

    await Promise.resolve();
    const accountIndexes = sent.flatMap((message, index) =>
      message.method === 'GET_ACCOUNT' ? [index] : [],
    );
    expect(accountIndexes).toHaveLength(2);
    respond({ address: '0x1', name: 'Primary', network: 'testnet' }, accountIndexes[0]);
    respond({ address: '0x1', name: 'Primary', network: 'testnet' }, accountIndexes[1]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const signIndexes = sent.flatMap((message, index) =>
      message.method === 'SIGN_MESSAGE' ? [index] : [],
    );
    expect(signIndexes).toHaveLength(2);
    expect(sent.filter((message) => message.method === 'OPEN')).toHaveLength(0);
    expect(iframe.style.display).toBe('none');

    emit('OPEN', {});
    expect(iframe.style.display).toBe('block');

    respond(
      {
        address: '0x1',
        curve: 'ed25519',
        publicKeyHex: 'aa',
        signatureHex: 'bb',
        message: 'first',
        nonce: 'nonce-first',
        fullMessage: 'first-full-message',
      },
      signIndexes[0],
    );
    respond(
      {
        address: '0x1',
        curve: 'ed25519',
        publicKeyHex: 'aa',
        signatureHex: 'cc',
        message: 'second',
        nonce: 'nonce-second',
        fullMessage: 'second-full-message',
      },
      signIndexes[1],
    );
    await Promise.all([first, second]);

    expect(iframe.style.display).toBe('block');
    expect(sent.filter((message) => message.method === 'OPEN')).toHaveLength(0);
    expect(sent.filter((message) => message.method === 'CLOSE')).toHaveLength(0);

    emit('CLOSE', {});
    expect(iframe.style.display).toBe('none');
    provider.destroy();
  });

  it('validates UTF-8 message and nonce lengths', async () => {
    const { provider } = await createInitializedProvider();

    await expect(provider.signMessage({ message: '', nonce: 'nonce-1' })).rejects.toThrow(
      'Invalid message.',
    );
    await expect(
      provider.signMessage({ message: 'a'.repeat(4_097), nonce: 'nonce-1' }),
    ).rejects.toThrow(
      'Invalid message.',
    );
    await expect(
      provider.signMessage({ message: 'hello', nonce: 123 as never }),
    ).rejects.toThrow('Invalid nonce.');
    await expect(
      provider.signMessage({ message: 'hello', nonce: undefined as never }),
    ).rejects.toThrow('Invalid nonce.');
    await expect(
      provider.signMessage({ message: 'hello', nonce: 'a'.repeat(257) }),
    ).rejects.toThrow(
      'Invalid nonce.',
    );
    await expect(
      provider.signMessage({ message: 'hello', nonce: '🙂'.repeat(65) }),
    ).rejects.toThrow('Invalid nonce.');
    provider.destroy();
  });

  it('rejects before opening the wallet when no account is connected', async () => {
    const { provider, sent, respond } = await createInitializedProvider();
    const request = provider.signMessage({ message: 'hello', nonce: 'nonce-1' });

    await Promise.resolve();
    respond(null);

    await expect(request).rejects.toThrow('Wallet not connected.');
    expect(sent.map((message) => message.method)).toEqual(['INIT', 'GET_ACCOUNT']);
    provider.destroy();
  });

  it('rejects the pending promise when the user closes the wallet window', async () => {
    const { provider, iframe, sent, respond, emit } = await createInitializedProvider();
    const request = provider.signMessage({ message: 'hello', nonce: 'nonce-1' });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent.at(-1)?.method).toBe('GET_ACCOUNT');
    respond({ address: '0x1', name: 'Primary', network: 'testnet' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    emit('OPEN', {});
    const closeButton = iframe.parentElement?.querySelector<HTMLButtonElement>(
      '[data-milon-wallet-close="true"]',
    );

    expect(closeButton).not.toBeNull();
    closeButton!.click();

    await expect(request).rejects.toThrow('User closed wallet.');
    expect(iframe.style.display).toBe('none');
    expect(sent.at(-1)?.method).toBe('CLOSE');
    expect(sent.filter((message) => message.method === 'OPEN')).toHaveLength(0);
    expect(sent.filter((message) => message.method === 'CLOSE')).toHaveLength(1);
    provider.destroy();
  });
});
