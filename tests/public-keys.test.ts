import { describe, expect, it, vi } from 'vitest';

import { createInitializedProvider } from './provider-test-utils.js';

describe('getPublicKeys', () => {
  it('returns public keys without opening the wallet or requesting storage access', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { provider, iframe, sent, respond } = await createInitializedProvider('required');
    const getPublicKeys = provider.getPublicKeys.bind(provider) as unknown as (
      ignoredParams: unknown,
    ) => Promise<unknown>;
    const request = getPublicKeys({ address: 'attacker-controlled' });

    await Promise.resolve();
    expect(sent.at(-1)).toMatchObject({ method: 'GET_PUBLIC_KEYS' });
    expect(sent.at(-1)).not.toHaveProperty('params');
    expect(open).not.toHaveBeenCalled();
    expect(iframe.style.display).toBe('none');
    expect(sent.some((message) => message.method === 'GET_ACCOUNT')).toBe(false);
    expect(sent.some((message) => message.method === 'OPEN')).toBe(false);
    expect(sent.some((message) => message.method === 'CLOSE')).toBe(false);

    const publicKeys = [
      { curve: 'ed25519' as const, publicKeyHex: 'aa' },
      { curve: 'fn_dsa512' as const, publicKeyHex: 'bb' },
    ];
    respond(publicKeys);

    await expect(request).resolves.toEqual(publicKeys);
    provider.destroy();
  });
});
