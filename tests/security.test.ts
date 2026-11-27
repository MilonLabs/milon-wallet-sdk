import { describe, expect, it, vi } from 'vitest';

import { RequestManager } from '../src/request-manager.js';
import type { WalletEventMessage, WalletRequestMessage } from '../src/protocol.js';
import { createInitializedProvider } from './provider-test-utils.js';

const walletOrigin = 'https://wallet.example';
const walletWindow = window;
const attackerWindow = {} as Window;

function messageEvent(options: {
  origin: string;
  source: MessageEventSource | null;
  data: unknown;
}): MessageEvent<unknown> {
  return new MessageEvent('message', options);
}

describe('wallet message security', () => {
  it.each([
    ['wrong origin', 'https://attacker.test', walletWindow],
    ['wrong source', walletOrigin, attackerWindow],
  ] as const)('ignores %s', (_, origin, source) => {
    const sent: WalletRequestMessage[] = [];
    const onEvent = vi.fn();
    const manager = new RequestManager({
      send: (message) => sent.push(message),
      walletOrigin,
      getWalletWindow: () => walletWindow,
      onEvent,
    });
    const request = manager.request('GET_ACCOUNT', {});
    const response = {
      channel: 'milon-wallet' as const,
      version: 1 as const,
      target: 'milon-web3-sdk' as const,
      kind: 'response' as const,
      requestId: sent[0]!.requestId,
      result: { address: '0x1' },
    };

    manager.handleMessageEvent(messageEvent({ origin, source, data: response }));
    expect(manager.pendingRequestCount).toBe(1);
    manager.destroy();
    void request.catch(() => undefined);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('dispatches only valid events from the wallet frame', () => {
    const onEvent = vi.fn();
    const manager = new RequestManager({
      send: () => undefined,
      walletOrigin,
      getWalletWindow: () => walletWindow,
      onEvent,
    });
    const event: WalletEventMessage = {
      channel: 'milon-wallet',
      version: 1,
      target: 'milon-web3-sdk',
      kind: 'event',
      event: 'NETWORK_CHANGED',
      data: { network: 'testnet' },
    };

    manager.handleMessageEvent(
      messageEvent({ origin: walletOrigin, source: walletWindow, data: event }),
    );
    manager.handleMessageEvent(
      messageEvent({
        origin: walletOrigin,
        source: walletWindow,
        data: { ...event, version: 2 },
      }),
    );

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(event);
    manager.destroy();
  });

  it('removes its window listener on destroy', () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    const manager = new RequestManager({
      send: () => undefined,
      walletOrigin,
      getWalletWindow: () => walletWindow,
    });

    manager.destroy();
    expect(removeEventListener).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('ignores malformed protocol envelopes without settling a request', () => {
    const sent: WalletRequestMessage[] = [];
    const manager = new RequestManager({
      send: (message) => sent.push(message),
      walletOrigin,
      getWalletWindow: () => walletWindow,
    });
    const request = manager.request('GET_ACCOUNT', {});
    void request.catch(() => undefined);
    const valid = {
      channel: 'milon-wallet',
      version: 1,
      target: 'milon-web3-sdk',
      kind: 'response',
      requestId: sent[0]!.requestId,
      result: { address: '0x1' },
    };

    for (const data of [
      { ...valid, channel: 'attacker' },
      { ...valid, version: 2 },
      { ...valid, kind: 'event' },
      { ...valid, requestId: '' },
      { ...valid, error: { code: 'USER_REJECTED', message: 'User rejected the request.' } },
    ]) {
      manager.handleMessageEvent(
        messageEvent({ origin: walletOrigin, source: walletWindow, data }),
      );
    }

    expect(manager.pendingRequestCount).toBe(1);
    manager.destroy();
  });

  it('always sends with the parsed wallet origin', async () => {
    const { provider, targetOrigins } = await createInitializedProvider();
    const request = provider.getAccount();
    await Promise.resolve();
    const assertion = expect(request).rejects.toThrow('Provider destroyed.');

    expect(targetOrigins).toEqual(['https://wallet.example', 'https://wallet.example']);
    expect(targetOrigins).not.toContain('*');
    provider.destroy();
    await assertion;
  });
});
