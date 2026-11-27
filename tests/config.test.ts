import { describe, expect, it } from 'vitest';

import { normalizeNetwork, parseProviderConfig } from '../src/config.js';
import { MilonWalletProvider } from '../src/provider.js';

const validConfig = {
  walletUrl: 'https://wallet.example/iframe',
  network: ['mainnet', 'testnet'] as const,
  rpc: 'not interpreted by SDK',
  indexer: 'also opaque',
  prover: 'passthrough only',
  app: {
    title: 'Demo dapp',
  },
};

describe('network normalization', () => {
  it('uses mainnet and testnet by default for INIT', () => {
    expect(
      parseProviderConfig({
        walletUrl: validConfig.walletUrl,
        app: validConfig.app,
      }).network,
    ).toEqual(['mainnet', 'testnet']);
  });

  it('normalizes a single network to an array', () => {
    expect(normalizeNetwork('devnet', 'init')).toEqual(['devnet']);
  });

  it('deduplicates repeated networks while keeping first order', () => {
    expect(normalizeNetwork(['testnet', 'mainnet', 'testnet'], 'init')).toEqual([
      'testnet',
      'mainnet',
    ]);
  });

  it.each([
    [[], 'Invalid network parameter.'],
    [['local'], 'Invalid network parameter.'],
    [['mainnet', 'local'], 'Invalid network parameter.'],
  ])('rejects invalid or empty network input', (network, message) => {
    expect(() => normalizeNetwork(network, 'init')).toThrow(message);
  });

  it('rejects missing or empty network during dynamic updates', () => {
    expect(() => normalizeNetwork(undefined, 'update')).toThrow(
      'Invalid network parameter.',
    );
    expect(() => normalizeNetwork([], 'update')).toThrow(
      'Invalid network parameter.',
    );
  });
});

describe('parseProviderConfig', () => {
  it('keeps optional service strings opaque', () => {
    expect(parseProviderConfig(validConfig)).toMatchObject({
      network: ['mainnet', 'testnet'],
      rpc: validConfig.rpc,
      indexer: validConfig.indexer,
      prover: validConfig.prover,
      walletOrigin: 'https://wallet.example',
    });
  });

  it('accepts custom and devnet without identity or URL checks', () => {
    expect(
      parseProviderConfig({
        walletUrl: validConfig.walletUrl,
        network: ['custom', 'devnet'],
        rpc: 'not a URL',
        app: validConfig.app,
      }).network,
    ).toEqual(['custom', 'devnet']);
  });

  it.each([
    [
      'insecure wallet URL',
      { ...validConfig, walletUrl: 'http://wallet.example' },
      'walletUrl must use HTTPS.',
    ],
    [
      'invalid rpc type',
      { ...validConfig, rpc: 1 },
      'rpc must be a string.',
    ],
    [
      'title that is too long',
      { ...validConfig, app: { title: 'x'.repeat(101) } },
      'app.title must be between 1 and 100 characters.',
    ],
  ])('rejects %s', (_, config, message) => {
    expect(() => parseProviderConfig(config as never)).toThrow(message);
  });

  it('falls back to the current hostname for an empty title', () => {
    expect(
      parseProviderConfig({
        ...validConfig,
        app: { ...validConfig.app, title: '  ' },
      }).app.title,
    ).toBe(window.location.hostname);
  });

  it('derives a relative favicon URL from the current document', () => {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = '/assets/dapp.svg';
    document.head.append(link);

    try {
      expect(parseProviderConfig(validConfig).app.icon).toBe(
        'http://localhost:3000/assets/dapp.svg',
      );
    } finally {
      link.remove();
    }
  });

  it('falls back to the site favicon when the document has no icon link', () => {
    expect(parseProviderConfig(validConfig).app.icon).toBe(
      'http://localhost:3000/favicon.ico',
    );
  });

  it('ignores unsupported icon URLs and uses the site favicon fallback', () => {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = 'javascript:alert(1)';
    document.head.append(link);

    try {
      expect(parseProviderConfig(validConfig).app.icon).toBe(
        'http://localhost:3000/favicon.ico',
      );
    } finally {
      link.remove();
    }
  });

  it('validates config in the public provider constructor', () => {
    expect(
      () =>
        new MilonWalletProvider({
          ...validConfig,
          colorMode: 'system' as never,
        }),
    ).toThrow('colorMode must be "light" or "dark".');
  });
});
