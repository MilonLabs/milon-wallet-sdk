import type {
  WalletRequestMessage,
  WalletResponseMessage,
  WalletRpcError,
} from '../src/protocol.js';

export class FakeWallet {
  readonly requests: WalletRequestMessage[] = [];

  constructor(
    private readonly target: Window,
    private readonly source: WindowProxy,
    private readonly origin: string,
  ) {}

  receive(message: WalletRequestMessage): void {
    this.requests.push(message);
  }

  respond(requestId: string, result: unknown): void {
    this.dispatch({
      channel: 'milon-wallet',
      version: 1,
      target: 'milon-web3-sdk',
      kind: 'response',
      requestId,
      result,
    });
  }

  fail(requestId: string, error: WalletRpcError): void {
    this.dispatch({
      channel: 'milon-wallet',
      version: 1,
      target: 'milon-web3-sdk',
      kind: 'response',
      requestId,
      error,
    });
  }

  private dispatch(message: WalletResponseMessage): void {
    this.target.dispatchEvent(
      new MessageEvent('message', {
        origin: this.origin,
        source: this.source,
        data: message,
      }),
    );
  }
}
