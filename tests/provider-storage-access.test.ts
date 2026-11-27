import { describe, expect, it, vi } from 'vitest';

import { MilonWalletProvider } from '../src/provider.js';
import type { WalletRequestMessage } from '../src/protocol.js';

const walletOrigin = 'https://wallet.example';

const flushPromises = async () => {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
};

function sendResponse(
  iframe: HTMLIFrameElement,
  request: WalletRequestMessage,
  result: unknown,
): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: walletOrigin,
      source: iframe.contentWindow,
      data: {
        channel: 'milon-wallet',
        version: 1,
        target: 'milon-web3-sdk',
        kind: 'response',
        requestId: request.requestId,
        result,
      },
    }),
  );
}

function sendPopupMessage(
  popup: Window,
  origin: string,
  granted: boolean,
): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin,
      source: popup,
      data: {
        type: 'MIL0N_STORAGE_ACCESS_RESULT',
        granted,
      },
    }),
  );
}

function sendWalletEvent(
  iframe: HTMLIFrameElement,
  event: string,
  data: unknown,
): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: walletOrigin,
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
}

function createProvider(): MilonWalletProvider {
  return new MilonWalletProvider({
    walletUrl: `${walletOrigin}/iframe`,
    network: 'testnet',
    app: { title: 'Demo dapp' },
  });
}

describe('provider storage access', () => {
  it('updates theme and network settings without opening storage access', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const provider = createProvider();
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    const sent: WalletRequestMessage[] = [];
    iframe.contentWindow!.postMessage = ((message: WalletRequestMessage) => {
      sent.push(message);
    }) as Window['postMessage'];

    iframe.dispatchEvent(new Event('load'));
    await flushPromises();
    sendResponse(iframe, sent[0]!, {
      network: 'testnet',
      account: null,
      storageAccess: 'required',
    });
    await provider.init();

    const theme = provider.updateTheme('dark');
    const networks = provider.updateNetwork(['testnet', 'mainnet']);
    const network = provider.switchNetwork('testnet');
    await flushPromises();

    expect(open).not.toHaveBeenCalled();
    expect(iframe.style.display).toBe('none');
    expect(sent.slice(1).map(({ method, params }) => ({ method, params }))).toEqual([
      { method: 'UPDATE_THEME', params: { colorMode: 'dark' } },
      { method: 'UPDATE_NETWORKS', params: { network: ['testnet', 'mainnet'] } },
      { method: 'SWITCH_NETWORK', params: { network: 'testnet' } },
    ]);
    sendResponse(iframe, sent[1]!, { colorMode: 'dark' });
    sendResponse(iframe, sent[2]!, {});
    sendResponse(iframe, sent[3]!, { network: 'testnet' });
    await expect(Promise.all([theme, networks, network])).resolves.toEqual([
      { colorMode: 'dark' },
      undefined,
      { network: 'testnet' },
    ]);
    provider.destroy();
  });

  it('disconnects without opening storage access when the wallet reports it is required', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const provider = createProvider();
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    const sent: WalletRequestMessage[] = [];
    iframe.contentWindow!.postMessage = ((message: WalletRequestMessage) => {
      sent.push(message);
    }) as Window['postMessage'];

    const disconnect = provider.disconnect();
    iframe.dispatchEvent(new Event('load'));
    await flushPromises();
    expect(sent.map((message) => message.method)).toEqual(['INIT']);

    sendResponse(iframe, sent[0]!, {
      network: 'testnet',
      account: null,
      storageAccess: 'required',
    });
    await flushPromises();

    expect(open).not.toHaveBeenCalled();
    expect(sent.map((message) => message.method)).toEqual(['INIT', 'DISCONNECT']);
    sendResponse(iframe, sent[1]!, { disconnected: true });
    await expect(disconnect).resolves.toEqual({ disconnected: true });
    provider.destroy();
  });

  it('authorizes at the top level before sending the original request', async () => {
    const popup = { closed: false } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);
    const provider = createProvider();
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    const sent: WalletRequestMessage[] = [];
    iframe.contentWindow!.postMessage = ((message: WalletRequestMessage) => {
      sent.push(message);
    }) as Window['postMessage'];

    const init = provider.init();
    iframe.dispatchEvent(new Event('load'));
    await flushPromises();

    sendResponse(iframe, sent[0]!, {
      network: 'testnet',
      account: null,
      storageAccess: 'required',
    });
    await flushPromises();

    await expect(init).resolves.toMatchObject({ storageAccess: 'required' });
    expect(open).not.toHaveBeenCalled();

    const accountRequest = provider.getAccount();
    await flushPromises();

    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('/storage-access?openerOrigin='),
      'milon-storage-access',
      'popup=1,width=360,height=680,left=644,top=20',
    );
    expect(sent.map((message) => message.method)).toEqual(['INIT']);

    sendPopupMessage(popup, walletOrigin, true);
    await flushPromises();
    expect(sent.map((message) => message.method)).toEqual([
      'INIT',
      'RETRY_STORAGE_ACCESS',
    ]);

    sendResponse(iframe, sent[1]!, { storageAccess: 'granted' });
    await flushPromises();
    expect(sent.map((message) => message.method)).toEqual([
      'INIT',
      'RETRY_STORAGE_ACCESS',
      'GET_ACCOUNT',
    ]);

    sendResponse(iframe, sent[2]!, null);
    await expect(accountRequest).resolves.toBeNull();
    await expect(provider.init()).resolves.toMatchObject({
      storageAccess: 'granted',
    });
    provider.destroy();
  });

  it('waits for the wallet iframe when the retry still requires storage access', async () => {
    const popup = { closed: false } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const provider = createProvider();
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    const sent: WalletRequestMessage[] = [];
    iframe.contentWindow!.postMessage = ((message: WalletRequestMessage) => {
      sent.push(message);
    }) as Window['postMessage'];

    const accountRequest = provider.getAccount();
    iframe.dispatchEvent(new Event('load'));
    await flushPromises();
    sendResponse(iframe, sent[0]!, {
      network: 'testnet',
      account: null,
      storageAccess: 'required',
    });
    await flushPromises();

    sendPopupMessage(popup, walletOrigin, true);
    await flushPromises();
    sendWalletEvent(iframe, 'OPEN', {});
    sendResponse(iframe, sent[1]!, { storageAccess: 'required' });

    expect(iframe.style.display).toBe('block');
    expect(accountRequest).toBeInstanceOf(Promise);
    expect(sent.map((message) => message.method)).toEqual([
      'INIT',
      'RETRY_STORAGE_ACCESS',
    ]);

    sendWalletEvent(iframe, 'STORAGE_ACCESS_CHANGED', {
      storageAccess: 'granted',
    });
    await flushPromises();
    expect(sent.map((message) => message.method)).toEqual([
      'INIT',
      'RETRY_STORAGE_ACCESS',
      'GET_ACCOUNT',
    ]);
    sendResponse(iframe, sent[2]!, null);
    await expect(accountRequest).resolves.toBeNull();
    provider.destroy();
  });

  it('waits for the authorization result when the popup closes after Start', async () => {
    vi.useFakeTimers();

    try {
      let popupClosed = false;
      const popup = {
        get closed() {
          return popupClosed;
        },
      } as unknown as Window;
      vi.spyOn(window, 'open').mockReturnValue(popup);
      const provider = createProvider();
      const iframe = document.querySelector('iframe') as HTMLIFrameElement;
      const sent: WalletRequestMessage[] = [];
      iframe.contentWindow!.postMessage = ((message: WalletRequestMessage) => {
        sent.push(message);
      }) as Window['postMessage'];

      const accountRequest = provider.getAccount();
      iframe.dispatchEvent(new Event('load'));
      await flushPromises();
      sendResponse(iframe, sent[0]!, {
        network: 'testnet',
        account: null,
        storageAccess: 'required',
      });
      await flushPromises();

      popupClosed = true;
      vi.advanceTimersByTime(250);
      sendPopupMessage(popup, walletOrigin, true);
      await flushPromises();

      expect(sent.map((message) => message.method)).toEqual([
        'INIT',
        'RETRY_STORAGE_ACCESS',
      ]);

      sendResponse(iframe, sent[1]!, { storageAccess: 'granted' });
      await flushPromises();
      sendResponse(iframe, sent[2]!, null);
      await expect(accountRequest).resolves.toBeNull();
      provider.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores authorization messages from another window or origin', async () => {
    const popup = { closed: false } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const provider = createProvider();
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    const sent: WalletRequestMessage[] = [];
    iframe.contentWindow!.postMessage = ((message: WalletRequestMessage) => {
      sent.push(message);
    }) as Window['postMessage'];

    const accountRequest = provider.getAccount();
    iframe.dispatchEvent(new Event('load'));
    await flushPromises();
    sendResponse(iframe, sent[0]!, {
      network: 'testnet',
      account: null,
      storageAccess: 'required',
    });
    await flushPromises();

    sendPopupMessage({} as Window, walletOrigin, true);
    sendPopupMessage(popup, 'https://attacker.example', true);
    await flushPromises();
    expect(sent.map((message) => message.method)).toEqual(['INIT']);

    sendPopupMessage(popup, walletOrigin, false);
    await expect(accountRequest).rejects.toThrow('Storage access was denied.');
    expect(sent.map((message) => message.method)).toEqual(['INIT']);
    provider.destroy();
  });

  it('rejects a concurrent authorization request without opening another popup', async () => {
    const popup = { closed: false } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);
    const provider = createProvider();
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    const sent: WalletRequestMessage[] = [];
    iframe.contentWindow!.postMessage = ((message: WalletRequestMessage) => {
      sent.push(message);
    }) as Window['postMessage'];

    const firstRequest = provider.getAccount();
    const secondRequest = provider.getAccount();
    iframe.dispatchEvent(new Event('load'));
    await flushPromises();
    sendResponse(iframe, sent[0]!, {
      network: 'testnet',
      account: null,
      storageAccess: 'required',
    });
    await flushPromises();

    await expect(secondRequest).rejects.toThrow(
      'Storage access request is already in progress.',
    );
    sendPopupMessage(popup, walletOrigin, false);
    await expect(firstRequest).rejects.toThrow('Storage access was denied.');

    expect(open).toHaveBeenCalledOnce();
    expect(sent.map((message) => message.method)).toEqual(['INIT']);

    const retryRequest = provider.getAccount();
    await flushPromises();
    expect(open).toHaveBeenCalledTimes(2);
    sendPopupMessage(popup, walletOrigin, false);
    await expect(retryRequest).rejects.toThrow('Storage access was denied.');
    provider.destroy();
  });

  it('waits for the active request after storage access becomes granted', async () => {
    const popup = { closed: false } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);
    const provider = createProvider();
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    const sent: WalletRequestMessage[] = [];
    iframe.contentWindow!.postMessage = ((message: WalletRequestMessage) => {
      sent.push(message);
    }) as Window['postMessage'];

    const firstRequest = provider.getAccount();
    iframe.dispatchEvent(new Event('load'));
    await flushPromises();
    sendResponse(iframe, sent[0]!, {
      network: 'testnet',
      account: null,
      storageAccess: 'required',
    });
    await flushPromises();
    expect(open).toHaveBeenCalledOnce();

    sendWalletEvent(iframe, 'STORAGE_ACCESS_CHANGED', {
      storageAccess: 'granted',
    });
    const secondRequest = provider.getAccount();
    let secondSettled = false;
    void secondRequest.then(
      () => {
        secondSettled = true;
      },
      () => {
        secondSettled = true;
      },
    );
    await flushPromises();

    expect(secondSettled).toBe(false);
    expect(open).toHaveBeenCalledOnce();
    expect(sent.map((message) => message.method)).toEqual([
      'INIT',
      'GET_ACCOUNT',
      'GET_ACCOUNT',
    ]);

    sendResponse(iframe, sent[1]!, null);
    sendResponse(iframe, sent[2]!, null);
    await expect(firstRequest).resolves.toBeNull();
    await expect(secondRequest).resolves.toBeNull();
    provider.destroy();
  });

  it('reports a blocked popup without sending a retry request', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const provider = createProvider();
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    const sent: WalletRequestMessage[] = [];
    iframe.contentWindow!.postMessage = ((message: WalletRequestMessage) => {
      sent.push(message);
    }) as Window['postMessage'];

    const accountRequest = provider.getAccount();
    iframe.dispatchEvent(new Event('load'));
    await flushPromises();
    sendResponse(iframe, sent[0]!, {
      network: 'testnet',
      account: null,
      storageAccess: 'required',
    });

    await expect(accountRequest).rejects.toThrow(
      'Storage access popup was blocked.',
    );
    expect(sent.map((message) => message.method)).toEqual(['INIT']);
    provider.destroy();
  });
});
