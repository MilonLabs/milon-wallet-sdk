# Milon Wallet SDK

`@milonlabs/milon-wallet-sdk` connects browser DApps to Milon Wallet for account access, message signing, and transaction signing and submission. Users select their account and approve requests in the wallet. This release supports `devnet`.

## Install

Once the package is available on npm, install it in your DApp:

```bash
npm install @milonlabs/milon-wallet-sdk
# or
pnpm add @milonlabs/milon-wallet-sdk
```

The SDK ships as ECMAScript modules with TypeScript declarations. Create the provider in the browser, where the DOM is available. In a server-rendered app, create it after the component mounts on the client.

## 1. Create a provider

```ts
import { MilonWalletProvider } from '@milonlabs/milon-wallet-sdk';

const provider = new MilonWalletProvider({
  walletUrl: 'https://wallet.milonlabs.com/',
  network: ['devnet'],
  app: { title: 'Example DApp' },
});
```

Use an absolute HTTPS `walletUrl` and set `network` to `['devnet']`. The SDK creates the wallet iframe, initializes it when it loads, and sends messages to the wallet's exact origin. If your DApp previously created the iframe or sent wallet messages directly, use the provider to manage both.

Set `app.title` to the name users should see in the wallet. The SDK discovers the icon from the page's `<link rel="icon">`, with `/favicon.ico` as a fallback. You can pass a parent element as `container` or set the initial `colorMode` to `'light'` or `'dark'`.

## 2. Enable connection after wallet initialization

Start with **Connect Wallet** disabled. Once `init()` resolves or `ProviderEvent.INIT` fires, enable the button and call `connect()` from its click handler. To read the current account automatically, call `getAccount()` only if `res.storageAccess === 'granted'`.

```ts
import { ProviderEvent } from '@milonlabs/milon-wallet-sdk';

// Alternatively, await provider.init() to get the initialization result.
const stopInit = provider.on(ProviderEvent.INIT, (res) => {
  const connectButton = document.querySelector<HTMLButtonElement>('#connect-wallet');
  if (connectButton) connectButton.disabled = false;

  if (res.storageAccess === 'granted') {
    void provider.getAccount().then(console.log, console.error);
  }
});
```

| Method | Use |
| --- | --- |
| `init()` | Wait for wallet initialization. Returns the active network, current account if available, and storage access status. |
| `getStatus()` | Read the current initialization and storage access state. |
| `getAccount()` | After initialization and storage access are confirmed, read the connected account or `null`. |
| `getPublicKeys()` | Read the connected account's public keys as `{ curve, publicKeyHex }` entries. |
| `open()` / `close()` | Show or hide the wallet window. |
| `disconnect()` | Revoke this DApp's connection. |
| `destroy()` | Remove the wallet iframe and listeners and reject pending requests. |

## 3. Sign a message or authenticate a user

Use `signMessage()` for general message signing and `login()` to show a sign-in confirmation in the wallet. Both require a connected account.

```ts
const signedMessage = await provider.signMessage({
  message: 'Confirm your request in Example DApp',
});

async function signLoginChallenge(message: string, nonce: string) {
  await provider.connect();
  return provider.login({ message, nonce });
}
```

Pass a non-empty `message` of at most 4,096 UTF-8 bytes. An optional `nonce` can contain up to 256 UTF-8 bytes. The result contains `address`, `curve`, `publicKeyHex`, `signatureHex`, `message`, `nonce`, and `fullMessage`.

For login, issue a short-lived, single-use challenge on your server. Verify the signature over the exact `fullMessage` returned by the wallet. Check the expected DApp origin, `devnet`, message, and nonce encoded in that text, and verify that the signing key belongs to the account being authenticated. Consume the challenge before creating a session.

## 4. Sign or submit a transaction

For instructions on building and serializing a Devnet transaction, see the [milon-sdk-js documentation](https://github.com/MilonLabs/milon-sdk-js#readme). The SDK accepts a non-empty hexadecimal string with an even number of digits and an optional `0x` prefix. The wallet parses the transaction and shows the approval screen.

| Method | Result |
| --- | --- |
| `signTransaction(serializedTransactionHex, options?)` | Returns `{ serializedTransactionHex }` containing the signed transaction. The DApp decides when to submit it. |
| `signAndSubmitTransaction(serializedTransactionHex, options?)` | Signs and submits the transaction in the wallet, then returns `{ txHash }`. |

Choose one method for a given transaction, depending on who will submit it.

```ts
async function signTransaction(serializedTransactionHex: string) {
  const { serializedTransactionHex: signedHex } =
    await provider.signTransaction(serializedTransactionHex, {
      instructionIndexes: [0],
      includePayer: true,
    });
  return signedHex;
}

async function submitTransaction(serializedTransactionHex: string) {
  const { txHash } =
    await provider.signAndSubmitTransaction(serializedTransactionHex);
  return txHash;
}
```

Use `txHash` to check the transaction status on-chain before retrying an uncertain submission.

Both methods accept these optional signing fields:

| Field | Purpose |
| --- | --- |
| `instructionIndexes` | Zero-based instruction indexes to authorize, from `0` through `62`. The signing example authorizes only instruction `0`. |
| `includePayer` | Whether to authorize the gas payer. |
| `authBit` | An unsigned 64-bit authorization bitmap as a decimal string or a hexadecimal string with a `0x` prefix. It takes precedence over `instructionIndexes` and `includePayer`. |
| `publicKeyHex` | Select a signing key from the connected account. If omitted, the wallet uses its default key. |

When no authorization scope is specified, the wallet uses its default scope. Pass only the transaction and supported signing options. The wallet determines the account and produces its own transaction summary and fee display.

## 5. Listen for events and clean up

```ts
import { WalletEvent } from '@milonlabs/milon-wallet-sdk';

const stopAccount = provider.on(WalletEvent.ACCOUNT_CHANGED, (account) => {
  console.log(account);
});

function disposeWallet() {
  stopInit();
  stopAccount();
  provider.destroy();
}
```

Call `disposeWallet()` when the page or component is torn down. Use `WalletEvent.OPEN` and `WalletEvent.CLOSE` to track wallet visibility.

## 6. Handle errors and pending requests

Wallet protocol errors are reported as `MilonWalletError`. Use `error.code` to decide how the DApp should respond.

| Error code | What to do |
| --- | --- |
| `USER_REJECTED` | End the operation and re-enable the button. |
| `NOT_CONNECTED` | Ask the user to connect their wallet. |
| `WALLET_LOCKED` | Ask the user to unlock the wallet before retrying. |
| `INVALID_TRANSACTION` | Validate or rebuild the transaction before retrying. |
| `TRANSACTION_NETWORK_MISMATCH` | Build the transaction for Devnet and check that the wallet is on Devnet. |
| `SUBMIT_FAILED` | If the submission outcome is unclear, check on-chain before retrying. |

For the full list, see [`WalletRpcErrorCode`](./src/protocol.ts#L320-L337). If the browser blocks the storage access popup, allow popups for the DApp and retry from a user action.

Wallet requests have no automatic SDK timeout. A pending request may still be waiting for user confirmation. Avoid issuing a duplicate transaction while the original request is pending.

## Devnet demo

Use the [connection demo](./examples/connect-demo/README.md) to connect to Milon Wallet and try message signing.
