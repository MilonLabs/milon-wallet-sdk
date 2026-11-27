import { MilonWalletProvider } from '../src/provider.js';
import type { StorageAccessStatus, WalletRequestMessage } from '../src/protocol.js';

export interface ProviderHarness {
  provider: MilonWalletProvider;
  iframe: HTMLIFrameElement;
  sent: WalletRequestMessage[];
  targetOrigins: string[];
  respond(result: unknown, index?: number): void;
  emit(event: string, data: unknown): void;
}

export async function createInitializedProvider(
  storageAccess?: StorageAccessStatus,
): Promise<ProviderHarness> {
  const provider = new MilonWalletProvider({
    walletUrl: 'https://wallet.example/iframe',
    network: 'testnet',
    app: { title: 'Demo dapp' },
  });
  const init = provider.init();
  const iframe = document.querySelector('iframe') as HTMLIFrameElement;
  const sent: WalletRequestMessage[] = [];
  const targetOrigins: string[] = [];
  iframe.contentWindow!.postMessage = ((
    message: WalletRequestMessage,
    targetOrigin: string,
  ) => {
    sent.push(message);
    targetOrigins.push(targetOrigin);
  }) as Window['postMessage'];
  iframe.dispatchEvent(new Event('load'));
  await Promise.resolve();

  const respond = (result: unknown, index = sent.length - 1) => {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://wallet.example',
        source: iframe.contentWindow,
        data: {
          channel: 'milon-wallet',
          version: 1,
          target: 'milon-web3-sdk',
          kind: 'response',
          requestId: sent[index]!.requestId,
          result,
        },
      }),
    );
  };
  const emit = (event: string, data: unknown) => {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://wallet.example',
        source: iframe.contentWindow,
        data: {
          channel: 'milon-wallet',
          version: 1,
          target: 'milon-web3-sdk',
          kind: 'event',
          event,
          data,
        },
      }),
    );
  };

  respond({ network: 'testnet', account: null, ...(storageAccess && { storageAccess }) }, 0);
  await init;
  return { provider, iframe, sent, targetOrigins, respond, emit };
}
