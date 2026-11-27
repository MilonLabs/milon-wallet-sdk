import { describe, expect, it } from 'vitest';

import { createInitializedProvider } from './provider-test-utils.js';

const account = { address: '0x1', name: 'Primary', network: 'testnet' as const };

describe('wallet connection and network APIs', () => {
  it('returns an existing account without opening the iframe or requesting connect', async () => {
    const { provider, iframe, sent, respond } = await createInitializedProvider();

    const connect = provider.connect();
    await Promise.resolve();
    expect(sent.at(-1)).toMatchObject({ method: 'GET_ACCOUNT', params: {} });
    expect(iframe.style.display).toBe('none');
    respond(account);

    await expect(connect).resolves.toEqual(account);
    expect(sent.filter((message) => message.method === 'CONNECT')).toHaveLength(0);
    expect(sent.filter((message) => message.method === 'OPEN')).toHaveLength(0);
    expect(sent.filter((message) => message.method === 'CLOSE')).toHaveLength(0);
    provider.destroy();
  });

  it('opens the iframe for connect when no account exists', async () => {
    const { provider, iframe, sent, respond, emit } = await createInitializedProvider();

    const connect = provider.connect();
    await Promise.resolve();
    const getAccountIndex = sent.findIndex((message) => message.method === 'GET_ACCOUNT');
    expect(getAccountIndex).toBeGreaterThanOrEqual(0);
    respond(null, getAccountIndex);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const connectIndex = sent.findIndex((message) => message.method === 'CONNECT');
    expect(connectIndex).toBeGreaterThan(getAccountIndex);
    expect(sent[connectIndex]).not.toHaveProperty('params');
    expect(iframe.style.display).toBe('none');
    expect(sent.filter((message) => message.method === 'OPEN')).toHaveLength(0);

    emit('OPEN', {});
    expect(iframe.style.display).toBe('block');

    respond(account);
    await expect(connect).resolves.toEqual(account);
    expect(iframe.style.display).toBe('block');
    expect(sent.filter((message) => message.method === 'CLOSE')).toHaveLength(0);

    emit('CLOSE', {});
    expect(iframe.style.display).toBe('none');
    provider.destroy();
  });

  it('leaves completion visibility to the wallet for concurrent interactive requests', async () => {
    const { provider, iframe, sent, respond, emit } = await createInitializedProvider();
    const first = provider.connect();
    const second = provider.connect();
    await Promise.resolve();
    const getAccountIndexes = sent.flatMap((message, index) =>
      message.method === 'GET_ACCOUNT' ? [index] : [],
    );

    expect(getAccountIndexes).toHaveLength(2);
    respond(null, getAccountIndexes[0]);
    respond(null, getAccountIndexes[1]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const connectIndexes = sent.flatMap((message, index) =>
      message.method === 'CONNECT' ? [index] : [],
    );
    expect(sent.filter((message) => message.method === 'OPEN')).toHaveLength(0);
    expect(connectIndexes).toHaveLength(2);
    expect(iframe.style.display).toBe('none');

    emit('OPEN', {});
    expect(iframe.style.display).toBe('block');

    respond(account, connectIndexes[0]);
    await expect(first).resolves.toEqual(account);
    expect(iframe.style.display).toBe('block');

    respond(account, connectIndexes[1]);
    await expect(second).resolves.toEqual(account);
    expect(iframe.style.display).toBe('block');
    expect(sent.filter((message) => message.method === 'CLOSE')).toHaveLength(0);

    emit('CLOSE', {});
    expect(iframe.style.display).toBe('none');
    provider.destroy();
  });

  it('keeps the first confirmation visible when a later connect is rejected', async () => {
    const { provider, iframe, sent, respond, emit } = await createInitializedProvider();
    const first = provider.connect();
    await Promise.resolve();
    respond(null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const firstConnectIndex = sent.length - 1;
    expect(sent[firstConnectIndex]?.method).toBe('CONNECT');

    emit('OPEN', {});
    const second = provider.connect();
    await Promise.resolve();
    respond(null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const secondRequest = sent.at(-1)!;
    expect(secondRequest.method).toBe('CONNECT');
    const displayWhilePending = iframe.style.display;

    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://wallet.example',
      source: iframe.contentWindow,
      data: {
        channel: 'milon-wallet',
        version: 1,
        target: 'milon-web3-sdk',
        kind: 'response',
        requestId: secondRequest.requestId,
        error: { code: 'INTERNAL_ERROR', message: 'Wallet internal error.' },
      },
    }));
    await expect(second).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    const displayAfterRejection = iframe.style.display;
    respond(account, firstConnectIndex);
    await expect(first).resolves.toEqual(account);
    provider.destroy();

    expect(displayWhilePending).toBe('block');
    expect(displayAfterRejection).toBe('block');
  });

  it('updates the declared network range with normalized arrays', async () => {
    const { provider, sent, respond } = await createInitializedProvider();

    const update = provider.updateNetwork(
      ['testnet', 'mainnet', 'testnet'],
      { rpc: 'opaque rpc', indexer: 'opaque indexer', prover: 'opaque prover' },
    );
    await Promise.resolve();
    expect(sent.at(-1)).toMatchObject({
      method: 'UPDATE_NETWORKS',
      params: {
        network: ['testnet', 'mainnet'],
        rpc: 'opaque rpc',
        indexer: 'opaque indexer',
        prover: 'opaque prover',
      },
    });
    respond({});
    await expect(update).resolves.toBeUndefined();
    expect(provider.config.network).toEqual(['testnet', 'mainnet']);
    expect(provider.config.rpc).toBe('opaque rpc');
    provider.destroy();
  });

  it('switches the wallet network separately without changing the declaration', async () => {
    const { provider, sent, respond } = await createInitializedProvider();

    const request = provider.switchNetwork('mainnet');
    await Promise.resolve();
    expect(sent.at(-1)).toMatchObject({
      method: 'SWITCH_NETWORK',
      params: { network: 'mainnet' },
    });
    respond({ network: 'mainnet' });
    await expect(request).resolves.toEqual({ network: 'mainnet' });
    expect(provider.config.network).toEqual(['testnet']);
    provider.destroy();
  });

  it('updates the theme without requiring an account or opening the iframe', async () => {
    const { provider, iframe, sent, respond } = await createInitializedProvider();

    const update = provider.updateTheme('dark');
    await Promise.resolve();
    expect(sent.at(-1)).toMatchObject({
      method: 'UPDATE_THEME',
      params: { colorMode: 'dark' },
    });
    expect(sent.filter((message) => message.method === 'GET_ACCOUNT')).toHaveLength(0);
    expect(sent.filter((message) => message.method === 'CONNECT')).toHaveLength(0);
    expect(sent.filter((message) => message.method === 'OPEN')).toHaveLength(0);
    expect(sent.filter((message) => message.method === 'CLOSE')).toHaveLength(0);
    expect(iframe.style.display).toBe('none');

    respond({ colorMode: 'light' });
    await expect(update).resolves.toEqual({ colorMode: 'light' });
    provider.destroy();
  });

  it('rejects invalid runtime theme values before messaging the wallet', async () => {
    const { provider, sent } = await createInitializedProvider();

    await expect(provider.updateTheme('system' as never)).rejects.toThrow(
      'colorMode must be "light" or "dark".',
    );
    expect(sent.at(-1)).not.toMatchObject({ method: 'UPDATE_THEME' });
    provider.destroy();
  });

  it('does not default missing or empty networks during dynamic updates', async () => {
    const { provider, sent } = await createInitializedProvider();

    await expect(provider.updateNetwork(undefined as never)).rejects.toThrow(
      'Invalid network parameter.',
    );
    await expect(provider.updateNetwork([])).rejects.toThrow(
      'Invalid network parameter.',
    );
    expect(sent.at(-1)).not.toMatchObject({ method: 'UPDATE_NETWORKS' });
    provider.destroy();
  });
});
