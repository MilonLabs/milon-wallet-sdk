import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseProviderConfig } from '../src/config.js';
import { IframeController } from '../src/iframe-controller.js';

const config = parseProviderConfig({
  walletUrl: 'https://wallet.example/iframe',
  network: 'testnet',
  app: { title: 'Demo dapp' },
});

describe('IframeController', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('mounts one iframe and removes it on destroy', () => {
    const controller = new IframeController(config);

    const first = controller.mount();
    expect(controller.mount()).toBe(first);
    expect(getComputedStyle(first.parentElement!).display).toBe('none');
    expect(getComputedStyle(first).display).toBe('none');

    controller.destroy();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('wraps the iframe and restores a saved desktop position', () => {
    localStorage.setItem('milon-wallet-sdk:modal-left', '120');
    localStorage.setItem('milon-wallet-sdk:modal-top', '80');
    const controller = new IframeController(config);
    const iframe = controller.mount();
    const container = iframe.parentElement!;

    expect(container.dataset.milonWalletContainer).toBe('true');
    expect(container.style.left).toBe('120px');
    expect(container.style.top).toBe('80px');

    controller.destroy();
    expect(container.isConnected).toBe(false);
  });

  it('returns the hidden wallet bounds for popup positioning', () => {
    const controller = new IframeController(config);
    const iframe = controller.mount();
    const container = iframe.parentElement!;

    container.style.left = '';
    container.style.top = '';
    container.style.inset = '20px auto auto 458px';

    expect(controller.getContainerBounds()).toMatchObject({
      left: 458,
      top: 20,
      width: 360,
      height: 680,
    });
    controller.destroy();
  });

  it('applies configured and runtime color modes without changing layout', () => {
    const controller = new IframeController({ ...config, colorMode: 'dark' });
    const iframe = controller.mount();
    const container = iframe.parentElement!;
    const dragHandle = container.firstElementChild as HTMLElement;

    const initialLeft = container.style.left;
    const initialTop = container.style.top;

    expect(container.style.background).toBe('rgb(17, 17, 17)');
    expect(container.style.borderColor).toBe('rgb(45, 45, 45)');
    expect(container.style.boxShadow).toBe('0 12px 32px rgba(0, 0, 0, 0.48)');
    expect(dragHandle.style.borderBottomColor).toBe('rgb(45, 45, 45)');
    expect(dragHandle.style.color).toBe('rgb(245, 245, 245)');
    expect(iframe.style.background).toBe('rgb(17, 17, 17)');

    controller.setColorMode('light');

    expect(container.style.background).toBe('rgb(255, 255, 255)');
    expect(container.style.borderColor).toBe('rgb(229, 231, 235)');
    expect(container.style.boxShadow).toBe('0 12px 32px rgba(0, 0, 0, 0.18)');
    expect(dragHandle.style.borderBottomColor).toBe('rgb(229, 231, 235)');
    expect(dragHandle.style.color).toBe('rgb(17, 24, 39)');
    expect(iframe.style.background).toBe('rgb(255, 255, 255)');
    expect(container.style.left).toBe(initialLeft);
    expect(container.style.top).toBe(initialTop);

    controller.destroy();
  });

  it('keeps dragging inside the viewport and persists the final position', () => {
    const controller = new IframeController(config);
    const iframe = controller.mount();
    const handle = iframe.parentElement!.firstElementChild!;

    handle.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }),
    );
    document.dispatchEvent(
      new MouseEvent('pointermove', { clientX: -1_000, clientY: -1_000 }),
    );
    document.dispatchEvent(new MouseEvent('pointerup'));

    expect(iframe.parentElement!.style.left).toBe('0px');
    expect(iframe.parentElement!.style.top).toBe('0px');
    expect(localStorage.getItem('milon-wallet-sdk:modal-left')).toBe('0');
    expect(localStorage.getItem('milon-wallet-sdk:modal-top')).toBe('0');
  });

  it('calls the close callback without starting a drag', () => {
    const onClose = vi.fn();
    const controller = new IframeController(config, onClose);
    const iframe = controller.mount();
    const container = iframe.parentElement!;
    const closeButton = container.querySelector<HTMLButtonElement>(
      '[data-milon-wallet-close="true"]',
    )!;

    closeButton.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }),
    );
    closeButton.click();
    document.dispatchEvent(
      new MouseEvent('pointermove', { clientX: -1_000, clientY: -1_000 }),
    );

    expect(onClose).toHaveBeenCalledOnce();
    expect(container.style.left).not.toBe('0px');
    controller.destroy();
  });

  it('uses a fixed bottom sheet and disables dragging on narrow screens', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const controller = new IframeController(config);
    const iframe = controller.mount();
    const container = iframe.parentElement!;
    const handle = container.firstElementChild!;

    handle.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }),
    );
    document.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 100, clientY: 100 }),
    );

    expect(container.style.left).toBe('0px');
    expect(container.style.bottom).toBe('0px');
    expect(localStorage.getItem('milon-wallet-sdk:modal-left')).toBeNull();
    controller.destroy();
  });

  it('uses the supplied container and supports visibility changes', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const controller = new IframeController({ ...config, container });

    controller.show();
    const iframe = container.querySelector('iframe')!;
    const walletContainer = iframe.parentElement!;
    expect(getComputedStyle(walletContainer).display).toBe('flex');
    expect(getComputedStyle(iframe).display).toBe('block');

    controller.hide();
    expect(getComputedStyle(walletContainer).display).toBe('none');
    expect(getComputedStyle(iframe).display).toBe('none');
  });

  it('sets the required sandbox without top-level navigation permissions', () => {
    const controller = new IframeController(config);
    const iframe = controller.mount();

    expect(iframe.title).toBe('Milon Wallet');
    expect(iframe.getAttribute('sandbox')).toBe(
      [
        'allow-scripts',
        'allow-forms',
        'allow-same-origin',
        'allow-storage-access-by-user-activation',
        'allow-popups',
      ].join(' '),
    );
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-top-navigation');
    expect(controller.contentWindow).toBe(iframe.contentWindow);
  });
});
