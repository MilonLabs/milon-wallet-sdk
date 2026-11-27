import { describe, expect, it } from 'vitest';

import { MilonWalletError } from '../src/errors.js';
import type { WalletRequestMessage, WalletRpcError } from '../src/protocol.js';
import { createInitializedProvider, type ProviderHarness } from './provider-test-utils.js';

const notInitializedError: WalletRpcError = {
  code: 'NOT_INITIALIZED',
  message: 'Wallet is not initialized.',
};

function fail(harness: ProviderHarness, index: number, error: WalletRpcError): void {
  const request = harness.sent[index]!;
  harness.iframe.ownerDocument!.defaultView!.dispatchEvent(
    new MessageEvent('message', {
      origin: 'https://wallet.example',
      source: harness.iframe.contentWindow,
      data: {
        channel: 'milon-wallet',
        version: 1,
        target: 'milon-web3-sdk',
        kind: 'response',
        requestId: request.requestId,
        error,
      },
    }),
  );
}

function methods(harness: ProviderHarness): string[] {
  return harness.sent.map((message) => message.method);
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('provider initialization recovery', () => {
  it('reinitializes and retries the original request with the same requestId', async () => {
    const harness = await createInitializedProvider();
    const request = harness.provider.getAccount();
    await flushPromises();
    const original = harness.sent[1]!;

    fail(harness, 1, notInitializedError);
    await flushPromises();
    expect(methods(harness)).toEqual(['INIT', 'GET_ACCOUNT', 'INIT']);

    harness.respond({ network: 'testnet', account: null }, 2);
    await flushPromises();
    expect(methods(harness)).toEqual(['INIT', 'GET_ACCOUNT', 'INIT', 'GET_ACCOUNT']);
    expect(harness.sent[3]!.requestId).toBe(original.requestId);

    harness.respond(null, 3);
    await expect(request).resolves.toBeNull();
    expect(harness.provider.ready).toBe(true);
    harness.provider.destroy();
  });

  it('does not recover again when the retried request is still NOT_INITIALIZED', async () => {
    const harness = await createInitializedProvider();
    const request = harness.provider.getAccount();
    await flushPromises();

    fail(harness, 1, notInitializedError);
    await flushPromises();
    harness.respond({ network: 'testnet', account: null }, 2);
    await flushPromises();
    fail(harness, 3, notInitializedError);

    await expect(request).rejects.toBeInstanceOf(MilonWalletError);
    expect(methods(harness)).toEqual(['INIT', 'GET_ACCOUNT', 'INIT', 'GET_ACCOUNT']);
    harness.provider.destroy();
  });

  it('rejects the original request when recovery INIT fails', async () => {
    const harness = await createInitializedProvider();
    const request = harness.provider.getAccount();
    await flushPromises();

    fail(harness, 1, notInitializedError);
    await flushPromises();
    fail(harness, 2, {
      code: 'INTERNAL_ERROR',
      message: 'Recovery INIT failed.',
    });

    await expect(request).rejects.toThrow('Recovery INIT failed.');
    expect(methods(harness)).toEqual(['INIT', 'GET_ACCOUNT', 'INIT']);
    harness.provider.destroy();
  });

  it('shares one recovery INIT across concurrent requests and retries each once', async () => {
    const harness = await createInitializedProvider();
    const first = harness.provider.getAccount();
    const second = harness.provider.getAccount();
    await flushPromises();

    const firstRequest = harness.sent[1] as WalletRequestMessage;
    const secondRequest = harness.sent[2] as WalletRequestMessage;
    fail(harness, 1, notInitializedError);
    fail(harness, 2, notInitializedError);
    await flushPromises();
    expect(methods(harness)).toEqual(['INIT', 'GET_ACCOUNT', 'GET_ACCOUNT', 'INIT']);

    harness.respond({ network: 'testnet', account: null }, 3);
    await flushPromises();
    expect(methods(harness)).toEqual([
      'INIT',
      'GET_ACCOUNT',
      'GET_ACCOUNT',
      'INIT',
      'GET_ACCOUNT',
      'GET_ACCOUNT',
    ]);
    expect(harness.sent[4]!.requestId).toBe(firstRequest.requestId);
    expect(harness.sent[5]!.requestId).toBe(secondRequest.requestId);

    harness.respond(null, 4);
    harness.respond(null, 5);
    await expect(Promise.all([first, second])).resolves.toEqual([null, null]);
    harness.provider.destroy();
  });
});
