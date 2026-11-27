import { describe, expect, it } from 'vitest';

import { MilonWalletProvider } from '../src/provider.js';
import type { WalletRequestMessage } from '../src/protocol.js';
import { FakeWallet } from './fake-wallet.js';

describe('provider RPC lifecycle', () => {
  it('matches 100 concurrent requests with reversed responses', async () => {
    const provider = new MilonWalletProvider({
      walletUrl: 'https://wallet.example/iframe',
      network: 'testnet',
      app: { title: 'Demo dapp' },
    });
    const init = provider.init();
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    const wallet = new FakeWallet(
      window,
      iframe.contentWindow!,
      'https://wallet.example',
    );
    iframe.contentWindow!.postMessage = ((message: WalletRequestMessage) => {
      wallet.receive(message);
    }) as Window['postMessage'];
    iframe.dispatchEvent(new Event('load'));
    await Promise.resolve();
    wallet.respond(wallet.requests[0]!.requestId, { network: 'testnet', account: null });
    await init;

    const requests = Array.from({ length: 100 }, () => provider.getAccount());
    await Promise.resolve();
    await Promise.resolve();
    const rpcRequests = wallet.requests.slice(1);
    expect(rpcRequests).toHaveLength(100);

    for (const request of [...rpcRequests].reverse()) {
      wallet.respond(request.requestId, {
        address: request.requestId,
        name: 'Primary',
        network: 'testnet',
      });
    }

    await expect(Promise.all(requests)).resolves.toEqual(
      rpcRequests.map((request) => ({
        address: request.requestId,
        name: 'Primary',
        network: 'testnet',
      })),
    );
    expect(provider.pendingRequestCount).toBe(0);
    provider.destroy();
  });
});
