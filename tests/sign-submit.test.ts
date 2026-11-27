import { describe, expect, it } from 'vitest';

import { MilonWalletError } from '../src/errors.js';
import { createInitializedProvider } from './provider-test-utils.js';

describe('signAndSubmitTransaction', () => {
  it('returns the wallet submission hash without retrying', async () => {
    const { provider, iframe, sent, respond, emit } = await createInitializedProvider();

    const request = provider.signAndSubmitTransaction('00', {
      authBit: '0x8000000000000001',
      instructionIndexes: [0],
      includePayer: false,
    });
    await Promise.resolve();
    expect(sent.at(-1)?.method).toBe('GET_ACCOUNT');
    respond({ address: '0x1', name: 'Primary', network: 'testnet' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent.at(-1)).toMatchObject({
      method: 'SIGN_AND_SUBMIT_TRANSACTION',
      params: {
        serializedTransactionHex: '00',
        authBit: '0x8000000000000001',
        instructionIndexes: [0],
        includePayer: false,
      },
    });
    expect(iframe.style.display).toBe('none');
    emit('OPEN', {});
    expect(iframe.style.display).toBe('block');
    respond({ txHash: 'abc123' });
    await expect(request).resolves.toEqual({ txHash: 'abc123' });
    expect(iframe.style.display).toBe('block');
    expect(sent.filter((message) => message.method === 'SIGN_AND_SUBMIT_TRANSACTION')).toHaveLength(1);
    expect(sent.filter((message) => message.method === 'OPEN')).toHaveLength(0);
    expect(sent.filter((message) => message.method === 'CLOSE')).toHaveLength(0);
    provider.destroy();
  });

  it('rejects an invalid authBit before checking the account', async () => {
    const { provider, sent } = await createInitializedProvider();

    await expect(
      provider.signAndSubmitTransaction('00', { authBit: '0x10000000000000000' }),
    ).rejects.toThrow('Invalid authBit.');
    expect(sent.map((message) => message.method)).toEqual(['INIT']);
    provider.destroy();
  });

  it('rejects before opening the wallet when no account is connected', async () => {
    const { provider, sent, respond } = await createInitializedProvider();
    const request = provider.signAndSubmitTransaction('00', {
      instructionIndexes: [0],
      includePayer: false,
    });

    await Promise.resolve();
    respond(null);

    await expect(request).rejects.toThrow('Wallet not connected.');
    expect(sent.map((message) => message.method)).toEqual(['INIT', 'GET_ACCOUNT']);
    provider.destroy();
  });

  it('preserves JSSDK details on a submission failure', async () => {
    const { provider, iframe, sent, respond } = await createInitializedProvider();
    const request = provider.signAndSubmitTransaction('00');

    await Promise.resolve();
    respond({ address: '0x1', name: 'Primary', network: 'testnet' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const walletRequest = sent.at(-1)!;
    iframe.ownerDocument!.defaultView!.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://wallet.example',
        source: iframe.contentWindow,
        data: {
          channel: 'milon-wallet',
          version: 1,
          target: 'milon-web3-sdk',
          kind: 'response',
          requestId: walletRequest.requestId,
          error: {
            code: 'SUBMIT_FAILED',
            message: 'Transaction submission failed.',
            details: {
              source: 'jssdk',
              code: 6,
              message: 'Account not found.',
            },
          },
        },
      }),
    );

    await expect(request).rejects.toMatchObject({
      code: 'SUBMIT_FAILED',
      message: 'Transaction submission failed. [JSSDK 6] Account not found.',
      details: {
        source: 'jssdk',
        code: 6,
        message: 'Account not found.',
      },
    } satisfies Partial<MilonWalletError>);
    provider.destroy();
  });

  it('includes a JSSDK detail without a numeric code in the error message', () => {
    const error = new MilonWalletError({
      code: 'SUBMIT_FAILED',
      message: 'Transaction submission failed.',
      details: {
        source: 'jssdk',
        message: 'tx stamp out of window',
      },
    });

    expect(error.message).toBe(
      'Transaction submission failed. [JSSDK] tx stamp out of window',
    );
  });
});
