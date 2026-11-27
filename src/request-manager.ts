import { MilonWalletError } from './errors.js';
import {
  WALLET_CHANNEL,
  WALLET_PROTOCOL_VERSION,
  MILON_WALLET_TARGET,
  isWalletEvent,
  isWalletResponse,
  type WalletEventMessage,
  type WalletMethodParams,
  type WalletMethodResults,
  type WalletRequestMessage,
  type WalletRequestMethod,
  type WalletResponseMessage,
} from './protocol.js';

interface PendingRequest {
  message: WalletRequestMessage;
  resolve(value: unknown): void;
  reject(error: Error): void;
  retriedAfterInitialization: boolean;
}

function createRequestId(): string {
  const cryptoApi = typeof crypto === 'undefined' ? undefined : crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  return `request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface RequestManagerOptions {
  send(message: WalletRequestMessage): void;
  walletOrigin: string;
  getWalletWindow(): Window | null;
  onEvent?(message: WalletEventMessage): void;
  onNotInitialized?(): Promise<void>;
}

export class RequestManager {
  readonly #pending = new Map<string, PendingRequest>();
  readonly #messageListener: (event: MessageEvent<unknown>) => void;
  #destroyed = false;

  constructor(private readonly options: RequestManagerOptions) {
    this.#messageListener = (event) => this.handleMessageEvent(event);
    window.addEventListener('message', this.#messageListener);
  }

  get pendingRequestCount(): number {
    return this.#pending.size;
  }

  request<M extends WalletRequestMethod>(
    method: M,
    ...args: M extends 'CONNECT' | 'GET_PUBLIC_KEYS'
      ? []
      : [params: WalletMethodParams[M]]
  ): Promise<WalletMethodResults[M]> {
    if (this.#destroyed) {
      return Promise.reject(new Error('Provider destroyed.'));
    }

    const requestId = createRequestId();
    const message = {
      channel: WALLET_CHANNEL,
      version: WALLET_PROTOCOL_VERSION,
      target: MILON_WALLET_TARGET,
      kind: 'request',
      requestId,
      method,
      ...(args.length === 0 ? {} : { params: args[0] }),
    } as WalletRequestMessage<M>;

    return new Promise<WalletMethodResults[M]>((resolve, reject) => {
      const pending: PendingRequest = {
        message,
        resolve,
        reject,
        retriedAfterInitialization: false,
      };
      this.#pending.set(requestId, pending);
      try {
        this.options.send(message);
      } catch (error) {
        this.#clearPendingRequest(requestId, pending);
        reject(error instanceof Error ? error : new Error('Wallet request failed.'));
      }
    });
  }

  handleResponse(message: WalletResponseMessage): void {
    const pending = this.#pending.get(message.requestId);
    if (!pending) {
      return;
    }

    if ('error' in message) {
      if (
        message.error.code === 'NOT_INITIALIZED' &&
        pending.message.method !== 'INIT' &&
        !pending.retriedAfterInitialization &&
        this.options.onNotInitialized
      ) {
        pending.retriedAfterInitialization = true;
        this.#recoverAndRetry(message.requestId, pending);
        return;
      }
      this.#clearPendingRequest(message.requestId, pending);
      pending.reject(new MilonWalletError(message.error));
      return;
    }

    this.#clearPendingRequest(message.requestId, pending);
    pending.resolve(message.result);
  }

  handleMessageEvent(event: MessageEvent<unknown>): void {
    if (
      this.#destroyed ||
      event.origin !== this.options.walletOrigin ||
      event.source !== this.options.getWalletWindow()
    ) {
      return;
    }

    if (isWalletResponse(event.data)) {
      this.handleResponse(event.data);
    } else if (isWalletEvent(event.data)) {
      this.options.onEvent?.(event.data);
    }
  }

  rejectAllPending(error: Error): number {
    const pendingEntries = [...this.#pending.entries()];
    for (const [requestId, pending] of pendingEntries) {
      this.#clearPendingRequest(requestId, pending);
      pending.reject(error);
    }
    return pendingEntries.length;
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }

    this.#destroyed = true;
    window.removeEventListener('message', this.#messageListener);
    this.rejectAllPending(new Error('Provider destroyed.'));
  }

  #clearPendingRequest(requestId: string, pending: PendingRequest): void {
    this.#pending.delete(requestId);
  }

  #recoverAndRetry(requestId: string, pending: PendingRequest): void {
    void this.options
      .onNotInitialized!()
      .then(() => {
        if (this.#pending.get(requestId) !== pending || this.#destroyed) {
          return;
        }

        try {
          this.options.send(pending.message);
        } catch (error) {
          this.#clearPendingRequest(requestId, pending);
          pending.reject(error instanceof Error ? error : new Error('Wallet request failed.'));
        }
      })
      .catch((error: unknown) => {
        if (this.#pending.get(requestId) !== pending) {
          return;
        }

        this.#clearPendingRequest(requestId, pending);
        pending.reject(error instanceof Error ? error : new Error('Wallet initialization failed.'));
      });
  }
}
