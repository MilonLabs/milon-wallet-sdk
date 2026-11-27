import { describe, expect, it, vi } from 'vitest';

import { MilonWalletProvider, ProviderEvent } from '../src/provider.js';
import type { WalletRequestMessage } from '../src/protocol.js';

function createProvider(): MilonWalletProvider {
  return new MilonWalletProvider({
    walletUrl: 'https://wallet.example/iframe',
    network: 'testnet',
    app: { title: 'Demo dapp' },
  });
}

function sentMessages(iframe: HTMLIFrameElement): WalletRequestMessage[] {
  const messages: WalletRequestMessage[] = [];
  iframe.contentWindow!.postMessage = ((message: WalletRequestMessage) => {
    messages.push(message);
  }) as Window['postMessage'];
  return messages;
}

function dispatchWalletResponse(
  iframe: HTMLIFrameElement,
  requestId: string,
  payload:
    | { result: unknown }
    | { error: { code: string; message: string } },
): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: 'https://wallet.example',
      source: iframe.contentWindow,
      data: {
        channel: 'milon-wallet',
        version: 1,
        target: 'milon-web3-sdk',
        kind: 'response',
        requestId,
        ...payload,
      },
    }),
  );
}

function dispatchWalletEvent(
  iframe: HTMLIFrameElement,
  event: string,
): void {
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
        data: {},
      },
    }),
  );
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('MilonWalletProvider initialization', () => {
  it('sends the DApp favicon discovered from the current document', async () => {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = '/dapp-icon.svg';
    document.head.append(link);

    try {
      const provider = createProvider();
      const iframe = document.querySelector('iframe') as HTMLIFrameElement;
      const messages = sentMessages(iframe);

      iframe.dispatchEvent(new Event('load'));
      await Promise.resolve();

      expect(messages[0]).toMatchObject({
        method: 'INIT',
        params: { app: { title: 'Demo dapp', icon: 'http://localhost:3000/dapp-icon.svg' } },
      });
      provider.destroy();
    } finally {
      link.remove();
    }
  });

  it('starts INIT automatically and becomes ready after the wallet response', async () => {
    const provider = createProvider();
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    const messages = sentMessages(iframe);

    iframe.dispatchEvent(new Event('load'));
    await Promise.resolve();
    expect(messages.map((message) => message.method)).toEqual(['INIT']);
    expect(messages[0]).toMatchObject({
      params: {
        network: ['testnet'],
      },
    });
    expect(provider.ready).toBe(false);

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://wallet.example',
        source: iframe.contentWindow,
        data: {
          channel: 'milon-wallet',
          version: 1,
          target: 'milon-web3-sdk',
          kind: 'response',
          requestId: messages[0]!.requestId,
          result: { network: 'testnet', account: null },
        },
      }),
    );
    await expect(provider.init()).resolves.toEqual({ network: 'testnet', account: null });
    expect(provider.ready).toBe(true);
    provider.destroy();
  });

  it('emits INIT and exposes initialization status', async () => {
    const provider = createProvider();
    const initListener = vi.fn();
    provider.on(ProviderEvent.INIT, initListener);

    expect(provider.getStatus()).toEqual({
      ready: false,
      storageAccess: 'unknown',
    });

    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    const messages = sentMessages(iframe);
    iframe.dispatchEvent(new Event('load'));
    await Promise.resolve();

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://wallet.example',
        source: iframe.contentWindow,
        data: {
          channel: 'milon-wallet',
          version: 1,
          target: 'milon-web3-sdk',
          kind: 'response',
          requestId: messages[0]!.requestId,
          result: {
            network: 'testnet',
            account: null,
            storageAccess: 'required',
          },
        },
      }),
    );

    await expect(provider.init()).resolves.toMatchObject({
      storageAccess: 'required',
    });
    expect(initListener).toHaveBeenCalledWith({
      network: 'testnet',
      account: null,
      storageAccess: 'required',
    });
    expect(provider.getStatus()).toEqual({
      ready: true,
      storageAccess: 'required',
    });

    const lateListener = vi.fn();
    provider.on(ProviderEvent.INIT, lateListener);
    expect(lateListener).toHaveBeenCalledWith({
      network: 'testnet',
      account: null,
      storageAccess: 'required',
    });

    provider.destroy();
  });

  it('keeps the configured color mode in INIT as the DApp default', async () => {
    const provider = new MilonWalletProvider({
      walletUrl: 'https://wallet.example/iframe',
      network: 'testnet',
      app: { title: 'Demo dapp' },
      colorMode: 'dark',
    });
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    const messages = sentMessages(iframe);

    iframe.dispatchEvent(new Event('load'));
    await Promise.resolve();
    expect(messages[0]).toMatchObject({
      method: 'INIT',
      params: { colorMode: 'dark' },
    });
    provider.destroy();
  });

  it('waits for INIT before sending a theme update', async () => {
    const provider = createProvider();
    const update = provider.updateTheme('dark');
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    const messages = sentMessages(iframe);

    iframe.dispatchEvent(new Event('load'));
    await Promise.resolve();
    expect(messages.map((message) => message.method)).toEqual(['INIT']);

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://wallet.example',
        source: iframe.contentWindow,
        data: {
          channel: 'milon-wallet',
          version: 1,
          target: 'milon-web3-sdk',
          kind: 'response',
          requestId: messages[0]!.requestId,
          result: { network: 'testnet', account: null },
        },
      }),
    );
    await provider.init();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(messages[1]).toMatchObject({
      method: 'UPDATE_THEME',
      params: { colorMode: 'dark' },
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://wallet.example',
        source: iframe.contentWindow,
        data: {
          channel: 'milon-wallet',
          version: 1,
          target: 'milon-web3-sdk',
          kind: 'response',
          requestId: messages[1]!.requestId,
          result: { colorMode: 'dark' },
        },
      }),
    );
    await expect(update).resolves.toEqual({ colorMode: 'dark' });
    provider.destroy();
  });

  it('applies the wallet effective theme to the outer iframe container', async () => {
    const provider = createProvider();
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    const container = iframe.parentElement!;
    const messages = sentMessages(iframe);

    iframe.dispatchEvent(new Event('load'));
    await Promise.resolve();
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://wallet.example',
        source: iframe.contentWindow,
        data: {
          channel: 'milon-wallet',
          version: 1,
          target: 'milon-web3-sdk',
          kind: 'response',
          requestId: messages[0]!.requestId,
          result: { network: 'testnet', account: null },
        },
      }),
    );
    await provider.init();

    const update = provider.updateTheme('light');
    await Promise.resolve();
    expect(messages.at(-1)).toMatchObject({
      method: 'UPDATE_THEME',
      params: { colorMode: 'light' },
    });
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://wallet.example',
        source: iframe.contentWindow,
        data: {
          channel: 'milon-wallet',
          version: 1,
          target: 'milon-web3-sdk',
          kind: 'response',
          requestId: messages.at(-1)!.requestId,
          result: { colorMode: 'dark' },
        },
      }),
    );

    await expect(update).resolves.toEqual({ colorMode: 'dark' });
    expect(container.style.background).toBe('rgb(17, 17, 17)');
    expect(container.style.borderColor).toBe('rgb(45, 45, 45)');
    expect(container.style.boxShadow).toBe('0 12px 32px rgba(0, 0, 0, 0.48)');
    expect(iframe.style.background).toBe('rgb(17, 17, 17)');

    provider.destroy();
  });

  it('does not change outer styles for an invalid wallet theme response', async () => {
    const provider = createProvider();
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    const container = iframe.parentElement!;
    const messages = sentMessages(iframe);

    iframe.dispatchEvent(new Event('load'));
    await Promise.resolve();
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://wallet.example',
        source: iframe.contentWindow,
        data: {
          channel: 'milon-wallet',
          version: 1,
          target: 'milon-web3-sdk',
          kind: 'response',
          requestId: messages[0]!.requestId,
          result: { network: 'testnet', account: null },
        },
      }),
    );
    await provider.init();

    const backgroundBeforeUpdate = container.style.background;
    const update = provider.updateTheme('dark');
    await Promise.resolve();
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://wallet.example',
        source: iframe.contentWindow,
        data: {
          channel: 'milon-wallet',
          version: 1,
          target: 'milon-web3-sdk',
          kind: 'response',
          requestId: messages.at(-1)!.requestId,
          result: { colorMode: 'system' },
        },
      }),
    );

    await expect(update).rejects.toThrow('colorMode must be "light" or "dark".');
    expect(container.style.background).toBe(backgroundBeforeUpdate);
    provider.destroy();
  });

  it('sends the default public network range when INIT network is omitted', async () => {
    const provider = new MilonWalletProvider({
      walletUrl: 'https://wallet.example/iframe',
      app: { title: 'Demo dapp' },
    });
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    const messages: WalletRequestMessage[] = [];
    iframe.contentWindow!.postMessage = ((message: WalletRequestMessage) => {
      messages.push(message);
    }) as Window['postMessage'];

    iframe.dispatchEvent(new Event('load'));
    await Promise.resolve();
    expect(messages[0]).toMatchObject({
      method: 'INIT',
      params: { network: ['mainnet', 'testnet'] },
    });
    provider.destroy();
  });

  it('uses a single in-flight init operation', async () => {
    const provider = createProvider();
    const init = provider.init();
    const assertion = expect(init).rejects.toThrow('Provider destroyed.');

    expect(init).toBe(provider.init());
    provider.destroy();
    await assertion;
  });

  it('opens an initialized iframe and closes it without destroying the provider', async () => {
    const provider = createProvider();
    const open = provider.open();
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    const messages = sentMessages(iframe);

    expect(iframe.style.display).toBe('none');
    iframe.dispatchEvent(new Event('load'));
    await Promise.resolve();
    dispatchWalletResponse(iframe, messages[0]!.requestId, {
      result: { network: 'testnet', account: null },
    });
    await flushPromises();
    expect(messages.map((message) => message.method)).toEqual(['INIT', 'OPEN']);
    expect(iframe.style.display).toBe('none');

    dispatchWalletResponse(iframe, messages[1]!.requestId, { result: {} });
    await expect(open).resolves.toEqual({ network: 'testnet', account: null });
    expect(iframe.style.display).toBe('block');

    provider.close();
    expect(iframe.style.display).toBe('none');
    expect(messages.map((message) => message.method)).toEqual(['INIT', 'OPEN', 'CLOSE']);
    expect(provider.ready).toBe(true);
    provider.destroy();
  });

  it('shows the iframe when the wallet confirms OPEN with an event', async () => {
    const provider = createProvider();
    const open = provider.open();
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    const messages = sentMessages(iframe);

    iframe.dispatchEvent(new Event('load'));
    await Promise.resolve();
    dispatchWalletResponse(iframe, messages[0]!.requestId, {
      result: { network: 'testnet', account: null },
    });
    await flushPromises();

    expect(messages.map((message) => message.method)).toEqual(['INIT', 'OPEN']);
    expect(iframe.style.display).toBe('none');

    dispatchWalletEvent(iframe, 'OPEN');
    await expect(open).resolves.toEqual({ network: 'testnet', account: null });
    expect(iframe.style.display).toBe('block');
    provider.destroy();
  });

  it('keeps a pending OPEN closed when the wallet emits CLOSE', async () => {
    const provider = createProvider();
    const open = provider.open();
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    const messages = sentMessages(iframe);

    iframe.dispatchEvent(new Event('load'));
    await Promise.resolve();
    dispatchWalletResponse(iframe, messages[0]!.requestId, {
      result: { network: 'testnet', account: null },
    });
    await flushPromises();

    const openMessage = messages[1]!;
    dispatchWalletEvent(iframe, 'CLOSE');
    await expect(open).rejects.toThrow('Wallet closed.');
    expect(iframe.style.display).toBe('none');

    dispatchWalletResponse(iframe, openMessage.requestId, { result: {} });
    await Promise.resolve();
    expect(iframe.style.display).toBe('none');
    provider.destroy();
  });

  it('keeps a failed OPEN hidden and allows a later retry', async () => {
    const provider = createProvider();
    const firstOpen = provider.open();
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    const messages = sentMessages(iframe);

    iframe.dispatchEvent(new Event('load'));
    await Promise.resolve();
    dispatchWalletResponse(iframe, messages[0]!.requestId, {
      result: { network: 'testnet', account: null },
    });
    await flushPromises();

    dispatchWalletResponse(iframe, messages[1]!.requestId, {
      error: { code: 'INTERNAL_ERROR', message: 'Open failed.' },
    });
    await expect(firstOpen).rejects.toThrow('Open failed.');
    expect(iframe.style.display).toBe('none');

    const retryOpen = provider.open();
    await flushPromises();
    expect(messages.filter((message) => message.method === 'OPEN')).toHaveLength(2);
    const retryMessage = messages.at(-1)!;
    expect(retryMessage.method).toBe('OPEN');

    dispatchWalletResponse(iframe, retryMessage.requestId, { result: {} });
    await expect(retryOpen).resolves.toEqual({ network: 'testnet', account: null });
    expect(iframe.style.display).toBe('block');
    provider.destroy();
  });

  it('does not send duplicate window visibility notifications', async () => {
    const provider = createProvider();
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    const messages = sentMessages(iframe);

    iframe.dispatchEvent(new Event('load'));
    await Promise.resolve();
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://wallet.example',
        source: iframe.contentWindow,
        data: {
          channel: 'milon-wallet',
          version: 1,
          target: 'milon-web3-sdk',
          kind: 'response',
          requestId: messages[0]!.requestId,
          result: { network: 'testnet', account: null },
        },
      }),
    );
    await provider.init();

    const firstOpen = provider.open();
    const secondOpen = provider.open();
    await flushPromises();
    expect(messages.filter((message) => message.method === 'OPEN')).toHaveLength(1);
    expect(iframe.style.display).toBe('none');

    const openMessage = messages.find((message) => message.method === 'OPEN')!;
    dispatchWalletResponse(iframe, openMessage.requestId, { result: {} });
    await expect(Promise.all([firstOpen, secondOpen])).resolves.toEqual([
      { network: 'testnet', account: null },
      { network: 'testnet', account: null },
    ]);
    provider.close();
    provider.close();

    expect(messages.filter((message) => message.method === 'OPEN')).toHaveLength(1);
    expect(messages.filter((message) => message.method === 'CLOSE')).toHaveLength(1);
    provider.destroy();
  });

  it('rejects an iframe load failure', async () => {
    const provider = createProvider();
    const init = provider.init();
    const assertion = expect(init).rejects.toThrow('Wallet iframe failed to load.');

    document.querySelector('iframe')!.dispatchEvent(new Event('error'));
    await assertion;
    provider.destroy();
  });

  it('rejects an in-flight initialization when destroyed', async () => {
    const provider = createProvider();
    const init = provider.init();
    const assertion = expect(init).rejects.toThrow('Provider destroyed.');

    provider.destroy();
    await assertion;
  });
});
