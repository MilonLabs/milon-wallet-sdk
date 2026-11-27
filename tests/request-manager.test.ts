import { describe, expect, it, vi } from 'vitest';

import { MilonWalletError } from '../src/errors.js';
import { RequestManager } from '../src/request-manager.js';
import type { WalletRequestMessage, WalletResponseMessage } from '../src/protocol.js';

const walletOrigin = 'https://wallet.example';
const walletWindow = window;

function createManager(sent: WalletRequestMessage[]): RequestManager {
  return new RequestManager({
    send: (message) => sent.push(message),
    walletOrigin,
    getWalletWindow: () => walletWindow,
  });
}

function responseFor(requestId: string, result: unknown): WalletResponseMessage {
  return {
    channel: 'milon-wallet',
    version: 1,
    target: 'milon-web3-sdk',
    kind: 'response',
    requestId,
    result,
  };
}

describe('RequestManager', () => {
  it('uses crypto.randomUUID when available', async () => {
    const originalCrypto = globalThis.crypto;
    const randomUUID = vi.fn(() => 'native-request-id');
    vi.stubGlobal('crypto', { randomUUID });
    const sent: WalletRequestMessage[] = [];
    const manager = createManager(sent);

    const request = manager.request('GET_ACCOUNT', {});

    expect(randomUUID).toHaveBeenCalledOnce();
    expect(sent[0]!.requestId).toBe('native-request-id');
    manager.destroy();
    await expect(request).rejects.toThrow('Provider destroyed.');
    vi.stubGlobal('crypto', originalCrypto);
  });

  it('falls back when crypto.randomUUID is unavailable', async () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', undefined);
    const sent: WalletRequestMessage[] = [];
    const manager = createManager(sent);

    const first = manager.request('GET_ACCOUNT', {});
    const second = manager.request('GET_ACCOUNT', {});

    expect(sent[0]!.requestId).toMatch(/^request-\d+-[a-z0-9]+$/);
    expect(sent[1]!.requestId).toMatch(/^request-\d+-[a-z0-9]+$/);
    expect(sent[0]!.requestId).not.toBe(sent[1]!.requestId);
    manager.destroy();
    await expect(first).rejects.toThrow('Provider destroyed.');
    await expect(second).rejects.toThrow('Provider destroyed.');
    vi.stubGlobal('crypto', originalCrypto);
  });

  it('matches concurrent responses by request id', async () => {
    const sent: WalletRequestMessage[] = [];
    const manager = createManager(sent);
    const first = manager.request('GET_ACCOUNT', {});
    const second = manager.request('GET_ACCOUNT', {});

    expect(sent[0]!.target).toBe('milon-wallet-runtime');
    manager.handleResponse(responseFor(sent[1]!.requestId, { address: 'second' }));
    manager.handleResponse(responseFor(sent[0]!.requestId, { address: 'first' }));

    await expect(first).resolves.toMatchObject({ address: 'first' });
    await expect(second).resolves.toMatchObject({ address: 'second' });
    expect(manager.pendingRequestCount).toBe(0);
    manager.destroy();
  });

  it('retries after initialization recovery without dropping the request', async () => {
    const sent: WalletRequestMessage[] = [];
    let finishRecovery: (() => void) | undefined;
    const recovery = new Promise<void>((resolve) => {
      finishRecovery = resolve;
    });
    const manager = new RequestManager({
      send: (message) => sent.push(message),
      walletOrigin,
      getWalletWindow: () => walletWindow,
      onNotInitialized: () => recovery,
    });
    const request = manager.request('GET_ACCOUNT', {});

    manager.handleResponse({
      channel: 'milon-wallet',
      version: 1,
      target: 'milon-web3-sdk',
      kind: 'response',
      requestId: sent[0]!.requestId,
      error: {
        code: 'NOT_INITIALIZED',
        message: 'Wallet is not initialized.',
      },
    });
    expect(manager.pendingRequestCount).toBe(1);

    finishRecovery!();
    await Promise.resolve();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.requestId).toBe(sent[0]!.requestId);

    manager.handleResponse(responseFor(sent[1]!.requestId, { address: 'recovered' }));
    await expect(request).resolves.toMatchObject({ address: 'recovered' });
    manager.destroy();
  });

  it('preserves wallet error codes and ignores late responses', async () => {
    const sent: WalletRequestMessage[] = [];
    const manager = createManager(sent);
    const request = manager.request('GET_ACCOUNT', {});

    manager.handleResponse({
      channel: 'milon-wallet',
      version: 1,
      target: 'milon-web3-sdk',
      kind: 'response',
      requestId: sent[0]!.requestId,
      error: { code: 'USER_REJECTED', message: 'User rejected the request.' },
    });
    await expect(request).rejects.toBeInstanceOf(MilonWalletError);
    manager.handleResponse(responseFor(sent[0]!.requestId, { address: 'late' }));
    expect(manager.pendingRequestCount).toBe(0);
    manager.destroy();
  });

  it('rejects all pending requests on destroy', async () => {
    const sent: WalletRequestMessage[] = [];
    const manager = createManager(sent);
    const request = manager.request('GET_ACCOUNT', {});

    manager.destroy();
    await expect(request).rejects.toThrow('Provider destroyed.');
    expect(manager.pendingRequestCount).toBe(0);
  });

  it('rejects every pending request when user closes the wallet', async () => {
    const sent: WalletRequestMessage[] = [];
    const manager = createManager(sent);
    const first = manager.request('GET_ACCOUNT', {});
    const second = manager.request('GET_ACCOUNT', {});

    expect(manager.rejectAllPending(new Error('User closed wallet.'))).toBe(2);

    await expect(first).rejects.toThrow('User closed wallet.');
    await expect(second).rejects.toThrow('User closed wallet.');
    expect(manager.pendingRequestCount).toBe(0);
    manager.destroy();
  });
});
