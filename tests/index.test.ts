import { describe, expect, it } from 'vitest';

import * as sdk from '../src/index.js';
import {
  ProviderEvent,
  WalletEvent,
  type WalletEventListener,
} from '../src/index.js';

const accountChangedListener: WalletEventListener<
  typeof WalletEvent.ACCOUNT_CHANGED
> = (account) => {
  void account?.address;
};

const colorModeChangedListener: WalletEventListener<
  typeof WalletEvent.COLOR_MODE_CHANGED
> = ({ colorMode }) => {
  void colorMode;
};

describe('public exports', () => {
  it('exports MilonWalletProvider', () => {
    expect(sdk).toHaveProperty('MilonWalletProvider');
  });

  it('exports event constants and listener types', () => {
    expect(WalletEvent.ACCOUNT_CHANGED).toBe('ACCOUNT_CHANGED');
    expect(accountChangedListener).toBeTypeOf('function');
    expect(WalletEvent.COLOR_MODE_CHANGED).toBe('COLOR_MODE_CHANGED');
    expect(colorModeChangedListener).toBeTypeOf('function');
    expect(ProviderEvent.INIT).toBe('INIT');
    expect(sdk).toHaveProperty('ProviderEvent');
  });
});
