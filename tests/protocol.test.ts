import { describe, expect, it } from 'vitest';

import {
  WalletEvent,
  isWalletEvent,
  isWalletResponse,
  normalizeMessage,
  normalizeNonce,
  normalizeTransactionHex,
  type WalletEventMessage,
  type WalletResponseMessage,
} from '../src/protocol.js';

const successResponse: WalletResponseMessage = {
  channel: 'milon-wallet',
  version: 1,
  target: 'milon-web3-sdk',
  kind: 'response',
  requestId: 'request-1',
  result: { address: '0x1' },
};

const errorResponse: WalletResponseMessage = {
  channel: 'milon-wallet',
  version: 1,
  target: 'milon-web3-sdk',
  kind: 'response',
  requestId: 'request-2',
  error: {
    code: 'USER_REJECTED',
    message: 'User rejected the request.',
  },
};

const submitFailureResponse: WalletResponseMessage = {
  channel: 'milon-wallet',
  version: 1,
  target: 'milon-web3-sdk',
  kind: 'response',
  requestId: 'request-3',
  error: {
    code: 'SUBMIT_FAILED',
    message: 'Transaction submission failed.',
    details: {
      source: 'jssdk',
      code: 6,
      message: 'Account not found.',
    },
  },
};

const accountChangedEvent: WalletEventMessage = {
  channel: 'milon-wallet',
  version: 1,
  target: 'milon-web3-sdk',
  kind: 'event',
  event: 'ACCOUNT_CHANGED',
  data: { address: '0x1', name: 'Primary', network: 'testnet' },
};

const colorModeChangedEvent: WalletEventMessage = {
  channel: 'milon-wallet',
  version: 1,
  target: 'milon-web3-sdk',
  kind: 'event',
  event: 'COLOR_MODE_CHANGED',
  data: { colorMode: 'dark' },
};

const openEvent: WalletEventMessage = {
  channel: 'milon-wallet',
  version: 1,
  target: 'milon-web3-sdk',
  kind: 'event',
  event: 'OPEN',
  data: {},
};

const storageAccessChangedEvent: WalletEventMessage = {
  channel: 'milon-wallet',
  version: 1,
  target: 'milon-web3-sdk',
  kind: 'event',
  event: 'STORAGE_ACCESS_CHANGED',
  data: { storageAccess: 'granted' },
};

describe('wallet protocol guards', () => {
  it('exports every protocol event value from WalletEvent', () => {
    expect(WalletEvent).toEqual({
      OPEN: 'OPEN',
      CLOSE: 'CLOSE',
      ACCOUNT_CHANGED: 'ACCOUNT_CHANGED',
      NETWORK_CHANGED: 'NETWORK_CHANGED',
      COLOR_MODE_CHANGED: 'COLOR_MODE_CHANGED',
      DISCONNECTED: 'DISCONNECTED',
      STORAGE_ACCESS_CHANGED: 'STORAGE_ACCESS_CHANGED',
    });
  });

  it('accepts result xor error responses', () => {
    expect(isWalletResponse(successResponse)).toBe(true);
    expect(isWalletResponse(errorResponse)).toBe(true);
    expect(isWalletResponse(submitFailureResponse)).toBe(true);
    expect(
      isWalletResponse({ ...successResponse, error: errorResponse.error }),
    ).toBe(false);
  });

  it('rejects malformed responses', () => {
    expect(isWalletResponse({ ...successResponse, channel: 'attacker' })).toBe(
      false,
    );
    expect(isWalletResponse({ ...successResponse, version: 2 })).toBe(false);
    expect(isWalletResponse({ ...successResponse, kind: 'event' })).toBe(false);
    expect(isWalletResponse({ ...successResponse, requestId: '' })).toBe(false);
    expect(isWalletResponse({ ...successResponse, target: 'milon-wallet-sdk' })).toBe(false);
    expect(
      isWalletResponse({
        ...submitFailureResponse,
        error: {
          ...submitFailureResponse.error,
          details: { source: 'jssdk', code: '6', message: 'Account not found.' },
        },
      }),
    ).toBe(false);
    expect(
      isWalletResponse({
        ...submitFailureResponse,
        error: {
          ...submitFailureResponse.error,
          details: { source: 'other', message: 'Account not found.' },
        },
      }),
    ).toBe(false);
  });

  it('accepts protocol events and rejects malformed ones', () => {
    expect(isWalletEvent(accountChangedEvent)).toBe(true);
    expect(isWalletEvent(openEvent)).toBe(true);
    expect(isWalletEvent(colorModeChangedEvent)).toBe(true);
    expect(isWalletEvent(storageAccessChangedEvent)).toBe(true);
    expect(isWalletEvent({ ...openEvent, target: 'milon-wallet-sdk' })).toBe(false);
    expect(isWalletEvent({ ...openEvent, data: { unexpected: true } })).toBe(
      false,
    );
    expect(isWalletEvent({ ...accountChangedEvent, event: 'UNKNOWN' })).toBe(
      false,
    );
    expect(isWalletEvent({ ...accountChangedEvent, data: undefined })).toBe(false);
    expect(
      isWalletEvent({ ...accountChangedEvent, data: { address: '0x1' } }),
    ).toBe(false);
    expect(
      isWalletEvent({
        ...accountChangedEvent,
        event: 'NETWORK_CHANGED',
        data: { network: 'unknown' },
      }),
    ).toBe(false);
    expect(
      isWalletEvent({
        ...accountChangedEvent,
        event: 'DISCONNECTED',
        data: { reason: 'unknown' },
      }),
    ).toBe(false);
    expect(
      isWalletEvent({
        ...colorModeChangedEvent,
        data: { colorMode: 'system' },
      }),
    ).toBe(false);
    expect(
      isWalletEvent({
        ...colorModeChangedEvent,
        data: { colorMode: 'dark', extra: true },
      }),
    ).toBe(false);
    expect(
      isWalletEvent({
        ...storageAccessChangedEvent,
        data: { storageAccess: 'granted', extra: true },
      }),
    ).toBe(false);
    expect(
      isWalletEvent({
        ...storageAccessChangedEvent,
        data: { storageAccess: 'prompt' },
      }),
    ).toBe(false);
  });

  it('normalizes signing inputs at the protocol boundary', () => {
    expect(normalizeMessage('hello')).toBe('hello');
    expect(() => normalizeMessage('')).toThrow('Invalid message.');
    expect(normalizeNonce(undefined)).toBeUndefined();
    expect(normalizeNonce('')).toBe('');
    expect(normalizeNonce('🙂'.repeat(64))).toBe('🙂'.repeat(64));
    expect(() => normalizeNonce('🙂'.repeat(65))).toThrow('Invalid nonce.');
    expect(() => normalizeNonce(123)).toThrow('Invalid nonce.');
    expect(normalizeTransactionHex('0xA0ff')).toBe('a0ff');
    expect(() => normalizeTransactionHex('0x123')).toThrow(
      'Invalid transaction hex.',
    );
  });
});
