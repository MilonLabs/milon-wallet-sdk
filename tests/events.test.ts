import { describe, expect, it, vi } from 'vitest';

import { WalletEvent, type WalletEventListener } from '../src/index.js';
import { createInitializedProvider } from './provider-test-utils.js';

const account = { address: '0x1', name: 'Primary', network: 'testnet' as const };

describe('wallet events and destruction', () => {
  it('lets wallet OPEN and CLOSE events control iframe visibility', async () => {
    const { provider, iframe, sent, emit } = await createInitializedProvider();

    expect(iframe.style.display).toBe('none');
    const messageCountBeforeEvents = sent.length;
    emit('OPEN', {});
    expect(iframe.style.display).toBe('block');
    emit('CLOSE', {});
    expect(iframe.style.display).toBe('none');
    expect(sent.slice(messageCountBeforeEvents)).toEqual([]);

    provider.destroy();
  });

  it('notifies every account listener and supports unsubscribe', async () => {
    const { provider, emit } = await createInitializedProvider();
    const first: WalletEventListener<typeof WalletEvent.ACCOUNT_CHANGED> = vi.fn();
    const second = vi.fn();
    const unsubscribe = provider.on(WalletEvent.ACCOUNT_CHANGED, first);
    provider.on(WalletEvent.ACCOUNT_CHANGED, second);

    emit('ACCOUNT_CHANGED', account);
    expect(first).toHaveBeenCalledWith(account);
    expect(second).toHaveBeenCalledWith(account);

    unsubscribe();
    emit('ACCOUNT_CHANGED', null);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(null);
    provider.destroy();
  });

  it('validates event data and keeps runtime network in sync', async () => {
    const { provider, emit } = await createInitializedProvider();
    const listener = vi.fn();
    provider.on('NETWORK_CHANGED', listener);

    emit('NETWORK_CHANGED', { network: 'devnet' });
    emit('NETWORK_CHANGED', { network: 'unknown' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(provider.config.network).toEqual(['testnet']);
    provider.destroy();
  });

  it('applies the wallet theme event to iframe DOM styles without requesting an update', async () => {
    const { provider, iframe, sent, emit } = await createInitializedProvider();
    const container = iframe.parentElement!;
    const dragHandle = container.firstElementChild as HTMLElement;
    const listener = vi.fn();
    provider.on(WalletEvent.COLOR_MODE_CHANGED, listener);

    emit('COLOR_MODE_CHANGED', { colorMode: 'dark' });

    expect(container.style.background).toBe('rgb(17, 17, 17)');
    expect(container.style.borderColor).toBe('rgb(45, 45, 45)');
    expect(container.style.boxShadow).toBe('0 12px 32px rgba(0, 0, 0, 0.48)');
    expect(dragHandle.style.borderBottomColor).toBe('rgb(45, 45, 45)');
    expect(dragHandle.style.color).toBe('rgb(245, 245, 245)');
    expect(iframe.style.background).toBe('rgb(17, 17, 17)');
    expect(listener).toHaveBeenCalledWith({ colorMode: 'dark' });
    expect(sent.filter((message) => message.method === 'UPDATE_THEME')).toHaveLength(0);

    provider.destroy();
  });

  it('updates storage access status when the wallet grants iframe access', async () => {
    const { provider, emit } = await createInitializedProvider();
    const listener = vi.fn();
    const initResult = await provider.init();

    provider.on(WalletEvent.STORAGE_ACCESS_CHANGED, listener);
    emit('STORAGE_ACCESS_CHANGED', { storageAccess: 'required' });
    expect(provider.getStatus()).toEqual({
      ready: true,
      storageAccess: 'required',
    });

    emit('STORAGE_ACCESS_CHANGED', { storageAccess: 'granted' });
    expect(provider.getStatus()).toEqual({
      ready: true,
      storageAccess: 'granted',
    });
    expect(initResult.storageAccess).toBe('granted');
    expect(listener).toHaveBeenLastCalledWith({ storageAccess: 'granted' });

    provider.destroy();
  });

  it('rejects pending work, ignores late messages, and rejects future calls after destroy', async () => {
    const { provider, sent, respond } = await createInitializedProvider();
    const request = provider.getAccount();
    await Promise.resolve();
    const assertion = expect(request).rejects.toThrow('Provider destroyed.');

    provider.destroy();
    await assertion;
    respond(account);
    expect(provider.pendingRequestCount).toBe(0);
    await expect(provider.getAccount()).rejects.toThrow('Provider destroyed.');
    expect(() => provider.destroy()).not.toThrow();
    expect(sent.filter((message) => message.method === 'GET_ACCOUNT')).toHaveLength(1);
  });
});
