import {
  parseProviderConfig,
  normalizeNetwork,
  parseNetworkServices,
  type MilonWalletProviderConfig,
  type ParsedProviderConfig,
  type WalletColorMode,
} from './config.js';
import { IframeController } from './iframe-controller.js';
import { RequestManager } from './request-manager.js';
import {
  STORAGE_ACCESS_RESULT_MESSAGE,
  normalizeMessage,
  normalizeNonce,
  normalizeSignTransactionOptions,
  normalizeTransactionHex,
} from './protocol.js';
import type {
  ConnectedAccount,
  DisconnectResult,
  InitResult,
  PublicKeyInfo,
  SignAndSubmitTransactionResult,
  SignMessageParams,
  SignMessageResult,
  SignTransactionResult,
  SignTransactionOptions,
  StorageAccessStatus,
  SwitchNetworkResult,
  UpdateThemeParams,
  UpdateThemeResult,
  UpdateNetworksParams,
  NetworkServiceConfig,
  WalletNetwork,
  WalletNetworkInput,
  WalletEventData,
  WalletEventMessage,
  WalletEventName,
  WalletMethodParams,
  WalletMethodResults,
  WalletRequestMethod,
} from './protocol.js';

export type WalletEventListener<K extends WalletEventName> = (
  data: WalletEventData[K],
) => void;

export const ProviderEvent = {
  INIT: 'INIT',
} as const;

export type ProviderEventName =
  (typeof ProviderEvent)[keyof typeof ProviderEvent];

export type ProviderEventData = {
  INIT: InitResult;
};

export type ProviderEventListener<K extends ProviderEventName> = (
  data: ProviderEventData[K],
) => void;

interface PendingOpen {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

export interface ProviderStatus {
  ready: boolean;
  storageAccess: StorageAccessStatus | 'unknown';
}

export class MilonWalletProvider {
  #config: ParsedProviderConfig;
  readonly #iframe: IframeController;
  #requests: RequestManager | null = null;
  #initPromise: Promise<InitResult> | null = null;
  #initResult: InitResult | null = null;
  #initializationRecoveryPromise: Promise<InitResult> | null = null;
  #storageAccessStatus: StorageAccessStatus | 'unknown' = 'unknown';
  #storageAccessPromise: Promise<void> | null = null;
  #cancelStorageAccess: (() => void) | null = null;
  #completeStorageAccess: (() => void) | null = null;
  #ready = false;
  #destroyed = false;
  #cancelIframeLoad: (() => void) | null = null;
  #iframeVisible = false;
  #notifiedWalletWindowVisible = false;
  #pendingOpen: PendingOpen | null = null;
  readonly #initListeners = new Set<ProviderEventListener<'INIT'>>();
  readonly #listeners: {
    [K in WalletEventName]: Set<WalletEventListener<K>>;
  } = {
    OPEN: new Set(),
    CLOSE: new Set(),
    ACCOUNT_CHANGED: new Set(),
    NETWORK_CHANGED: new Set(),
    COLOR_MODE_CHANGED: new Set(),
    DISCONNECTED: new Set(),
    STORAGE_ACCESS_CHANGED: new Set(),
  };

  constructor(config: MilonWalletProviderConfig) {
    this.#config = parseProviderConfig(config);
    this.#iframe = new IframeController(this.#config, () => this.#handleUserClose());
    this.#initPromise = this.#initialize();
    void this.#initPromise.catch(() => undefined);
  }

  get config(): ParsedProviderConfig {
    return this.#config;
  }

  get ready(): boolean {
    return this.#ready;
  }

  getStatus(): ProviderStatus {
    return {
      ready: this.#ready,
      storageAccess: this.#storageAccessStatus,
    };
  }

  get pendingRequestCount(): number {
    return this.#requests?.pendingRequestCount ?? 0;
  }

  init(): Promise<InitResult> {
    if (this.#destroyed) {
      return Promise.reject(new Error('Provider destroyed.'));
    }

    return this.#initPromise!;
  }

  open(): Promise<InitResult> {
    this.#assertNotDestroyed();
    return this.#ensureStorageAccess()
      .then(() => this.init())
      .then((result) => this.#openWalletWindow().then(() => result));
  }

  close(): void {
    this.#assertNotDestroyed();
    this.#cancelPendingOpen(new Error('Wallet closed.'));
    this.#setIframeVisible(false);
    this.#syncWalletWindowVisibility();
  }

  async getAccount(): Promise<ConnectedAccount | null> {
    await this.#ensureStorageAccess();
    return this.#request('GET_ACCOUNT', {});
  }

  async getPublicKeys(): Promise<PublicKeyInfo[]> {
    await this.init();
    return this.#request('GET_PUBLIC_KEYS');
  }

  async connect(): Promise<ConnectedAccount> {
    const account = await this.getAccount();
    if (account) {
      return account;
    }

    return this.#request('CONNECT');
  }

  async disconnect(): Promise<DisconnectResult> {
    await this.init();
    return this.#request('DISCONNECT', {});
  }

  async switchNetwork(network: WalletNetwork): Promise<SwitchNetworkResult> {
    normalizeNetwork(network, 'update');
    await this.init();
    return this.#request('SWITCH_NETWORK', { network });
  }

  async updateNetwork(
    network: WalletNetworkInput,
    services: NetworkServiceConfig = {},
  ): Promise<void> {
    const normalizedNetwork = normalizeNetwork(network, 'update');
    const normalizedServices = parseNetworkServices(services);
    await this.init();
    await this.#request('UPDATE_NETWORKS', {
      network: normalizedNetwork,
      ...normalizedServices,
    } satisfies UpdateNetworksParams);
    this.#config = {
      ...this.#config,
      network: normalizedNetwork,
      ...normalizedServices,
    };
  }

  async updateTheme(colorMode: WalletColorMode): Promise<UpdateThemeResult> {
    const normalizedColorMode = normalizeColorMode(colorMode);
    await this.init();
    const result = await this.#request('UPDATE_THEME', {
      colorMode: normalizedColorMode,
    } satisfies UpdateThemeParams);
    const effectiveColorMode = normalizeColorMode(result.colorMode);
    this.#iframe.setColorMode(effectiveColorMode);
    return { colorMode: effectiveColorMode };
  }

  async login(params: SignMessageParams): Promise<SignMessageResult> {
    return this.#signMessageRequest('LOGIN', params);
  }

  async signMessage(params: SignMessageParams): Promise<SignMessageResult> {
    return this.#signMessageRequest('SIGN_MESSAGE', params);
  }

  async #signMessageRequest<M extends 'LOGIN' | 'SIGN_MESSAGE'>(
    method: M,
    params: SignMessageParams,
  ): Promise<WalletMethodResults[M]> {
    const normalizedMessage = normalizeMessage(params.message);
    const hasNonce = Object.prototype.hasOwnProperty.call(params, 'nonce');
    const normalizedNonce = normalizeNonce(params.nonce);
    if (hasNonce && normalizedNonce === undefined) {
      throw new TypeError('Invalid nonce.');
    }
    await this.#assertConnected();
    return this.#request<'LOGIN' | 'SIGN_MESSAGE'>(
      method,
      {
        message: normalizedMessage,
        ...(normalizedNonce === undefined ? {} : { nonce: normalizedNonce }),
      },
    );
  }

  async signTransaction(
    serializedTransactionHex: string,
    options?: SignTransactionOptions,
  ): Promise<SignTransactionResult> {
    const normalizedTransactionHex = normalizeTransactionHex(serializedTransactionHex);
    const normalizedOptions = normalizeSignTransactionOptions(options);
    await this.#assertConnected();
    return this.#request(
      'SIGN_TRANSACTION',
      {
        serializedTransactionHex: normalizedTransactionHex,
        ...normalizedOptions,
      },
    );
  }

  async signAndSubmitTransaction(
    serializedTransactionHex: string,
    options?: SignTransactionOptions,
  ): Promise<SignAndSubmitTransactionResult> {
    const normalizedTransactionHex = normalizeTransactionHex(serializedTransactionHex);
    const normalizedOptions = normalizeSignTransactionOptions(options);
    await this.#assertConnected();
    return this.#request(
      'SIGN_AND_SUBMIT_TRANSACTION',
      {
        serializedTransactionHex: normalizedTransactionHex,
        ...normalizedOptions,
      },
    );
  }

  on<K extends WalletEventName>(
    event: K,
    listener: WalletEventListener<K>,
  ): () => void;

  on<K extends ProviderEventName>(
    event: K,
    listener: ProviderEventListener<K>,
  ): () => void;
  on(
    event: WalletEventName | ProviderEventName,
    listener:
      | WalletEventListener<WalletEventName>
      | ProviderEventListener<ProviderEventName>,
  ): () => void {
    this.#assertNotDestroyed();
    if (event === ProviderEvent.INIT) {
      const initListener = listener as ProviderEventListener<'INIT'>;
      this.#initListeners.add(initListener);
      if (this.#initResult) {
        initListener(this.#initResult);
      }
      return () => this.#initListeners.delete(initListener);
    }

    const listeners = this.#listeners[event as WalletEventName] as Set<
      WalletEventListener<WalletEventName>
    >;
    const walletListener = listener as WalletEventListener<WalletEventName>;
    listeners.add(walletListener);
    return () => listeners.delete(walletListener);
  }

  off<K extends WalletEventName>(
    event: K,
    listener: WalletEventListener<K>,
  ): void;

  off<K extends ProviderEventName>(
    event: K,
    listener: ProviderEventListener<K>,
  ): void;
  off(
    event: WalletEventName | ProviderEventName,
    listener:
      | WalletEventListener<WalletEventName>
      | ProviderEventListener<ProviderEventName>,
  ): void {
    if (event === ProviderEvent.INIT) {
      this.#initListeners.delete(listener as ProviderEventListener<'INIT'>);
      return;
    }

    const listeners = this.#listeners[event as WalletEventName] as Set<
      WalletEventListener<WalletEventName>
    >;
    listeners.delete(listener as WalletEventListener<WalletEventName>);
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }

    this.#destroyed = true;
    this.#cancelStorageAccess?.();
    this.#cancelStorageAccess = null;
    this.#cancelIframeLoad?.();
    this.#cancelIframeLoad = null;
    this.#cancelPendingOpen(new Error('Provider destroyed.'));
    this.#requests?.destroy();
    this.#requests = null;
    this.#iframe.destroy();
    for (const listeners of Object.values(this.#listeners)) {
      listeners.clear();
    }
    this.#initListeners.clear();
  }

  async #initialize(): Promise<InitResult> {
    const iframe = this.#iframe.mount();
    const iframeLoad = waitForIframeLoad(iframe);
    this.#cancelIframeLoad = iframeLoad.cancel;
    try {
      await iframeLoad.promise;
    } finally {
      this.#cancelIframeLoad = null;
    }
    this.#assertNotDestroyed();
    this.#requests = new RequestManager({
      send: (message) => {
        const walletWindow = this.#iframe.contentWindow;
        if (!walletWindow) {
          throw new Error('Wallet iframe is unavailable.');
        }
        walletWindow.postMessage(message, this.#config.walletOrigin);
      },
      walletOrigin: this.#config.walletOrigin,
      getWalletWindow: () => this.#iframe.contentWindow,
      onEvent: (event) => this.#handleWalletEvent(event),
      onNotInitialized: async () => {
        await this.#recoverInitialization();
      },
    });

    try {
      const result = await this.#request('INIT', this.#getInitParams());
      this.#storeInitResult(result);
      this.#ready = true;
      this.#syncWalletWindowVisibility();
      this.#emitInit(result);
      return result;
    } catch (error) {
      this.#requests.destroy();
      this.#requests = null;
      throw error;
    }
  }

  #request<M extends WalletRequestMethod>(
    method: M,
    ...args: M extends 'CONNECT' | 'GET_PUBLIC_KEYS'
      ? []
      : [params: WalletMethodParams[M]]
  ): Promise<WalletMethodResults[M]> {
    this.#assertNotDestroyed();
    if (!this.#requests) {
      return Promise.reject(new Error('Wallet is not initialized.'));
    }
    return this.#requests.request(method, ...args);
  }

  #recoverInitialization(): Promise<InitResult> {
    this.#assertNotDestroyed();
    if (this.#initializationRecoveryPromise) {
      return this.#initializationRecoveryPromise;
    }

    this.#ready = false;
    const recoveryPromise = this.#request('INIT', this.#getInitParams()).then(
      (result) => {
        this.#storeInitResult(result);
        this.#ready = true;
        this.#emitInit(result);
        return result;
      },
    );
    this.#initializationRecoveryPromise = recoveryPromise;
    recoveryPromise.then(
      () => {
        if (this.#initializationRecoveryPromise === recoveryPromise) {
          this.#initializationRecoveryPromise = null;
        }
      },
      () => {
        if (this.#initializationRecoveryPromise === recoveryPromise) {
          this.#initializationRecoveryPromise = null;
        }
      },
    );
    return recoveryPromise;
  }

  #getInitParams(): WalletMethodParams['INIT'] {
    return {
      network: this.#config.network,
      ...(this.#config.rpc === undefined ? {} : { rpc: this.#config.rpc }),
      ...(this.#config.indexer === undefined ? {} : { indexer: this.#config.indexer }),
      ...(this.#config.prover === undefined ? {} : { prover: this.#config.prover }),
      app: this.#config.app,
      ...(this.#config.colorMode === undefined ? {} : { colorMode: this.#config.colorMode }),
    };
  }

  #storeInitResult(result: InitResult): void {
    this.#initResult = result;
    this.#storageAccessStatus =
      result.storageAccess === 'required' ? 'required' : 'granted';
  }

  #emitInit(result: InitResult): void {
    for (const listener of this.#initListeners) {
      listener(result);
    }
  }

  #ensureStorageAccess(): Promise<void> {
    console.log('this.#storageAccessStatus: ', this.#storageAccessStatus);
    if (this.#destroyed) {
      return Promise.reject(new Error('Provider destroyed.'));
    }

    if (this.#storageAccessStatus === 'unknown') {
      return this.#initPromise!.then(() => this.#ensureStorageAccess());
    }

    if (this.#storageAccessPromise) {
      if (this.#storageAccessStatus === 'granted') {
        return this.#storageAccessPromise;
      }

      return Promise.reject(
        new Error('Storage access request is already in progress.'),
      );
    }

    if (this.#storageAccessStatus === 'granted') {
      return Promise.resolve();
    }

    const accessUrl = new URL('/storage-access', this.#config.walletUrl);
    accessUrl.searchParams.set('openerOrigin', window.location.origin);
    const containerBounds = this.#iframe.getContainerBounds();
    const popupFeatures = containerBounds
      ? [
          'popup=1',
          `width=${Math.round(containerBounds.width)}`,
          `height=${Math.round(containerBounds.height)}`,
          `left=${Math.round(window.screenX + containerBounds.left)}`,
          `top=${Math.round(window.screenY + containerBounds.top)}`,
        ].join(',')
      : 'popup=1,width=400,height=600';
      console.log('popupFeatures: ', popupFeatures);
    const popup = window.open(
      accessUrl.toString(),
      'milon-storage-access',
      popupFeatures,
    );
    console.log('11111111popup: ', popup);
    if (!popup) {
      return Promise.reject(new Error('Storage access popup was blocked.'));
    }

    const requestPromise = new Promise<void>((resolve, reject) => {
      let closeCheckTimer: number | undefined;
      let popupCloseGraceTimer: number | undefined;
      let settled = false;

      const cleanup = () => {
        window.removeEventListener('message', handleMessage);
        if (closeCheckTimer !== undefined) {
          window.clearInterval(closeCheckTimer);
        }
        if (popupCloseGraceTimer !== undefined) {
          window.clearTimeout(popupCloseGraceTimer);
          popupCloseGraceTimer = undefined;
        }
      };

      const fail = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };

      const succeed = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve();
      };

      const handleMessage = (event: MessageEvent<unknown>) => {
        if (
          event.origin !== this.#config.walletOrigin ||
          event.source !== popup
        ) {
          return;
        }

        const message =
          event.data && typeof event.data === 'object'
            ? (event.data as { type?: unknown; granted?: unknown })
            : null;
        if (
          !message ||
          message.type !== STORAGE_ACCESS_RESULT_MESSAGE ||
          typeof message.granted !== 'boolean'
        ) {
          return;
        }

        cleanup();
        if (!message.granted) {
          fail(new Error('Storage access was denied.'));
          return;
        }

        void this.#request('RETRY_STORAGE_ACCESS', {})
          .then((retryResult) => {
            if (retryResult.storageAccess !== 'granted') {
              // The wallet is waiting for a user-activated retry in the iframe.
              // Keep the original request pending until it reports granted.
              return;
            }

            this.#storageAccessStatus = 'granted';
            if (this.#initResult) {
              this.#initResult.storageAccess = 'granted';
            }
            succeed();
          })
          .catch((error: unknown) => {
            fail(
              error instanceof Error
                ? error
                : new Error('Storage access retry failed.'),
            );
          });
      };

      this.#cancelStorageAccess = () => fail(new Error('Provider destroyed.'));
      this.#completeStorageAccess = succeed;
      window.addEventListener('message', handleMessage);
      closeCheckTimer = window.setInterval(() => {
        if (!popup.closed || popupCloseGraceTimer !== undefined) {
          return;
        }

        // The authorization page may send the success message just before it closes itself.
        popupCloseGraceTimer = window.setTimeout(() => {
          popupCloseGraceTimer = undefined;
          fail(new Error('Storage access popup was closed.'));
        }, 250);
      }, 250);
    });

    let trackedPromise: Promise<void>;
    trackedPromise = requestPromise.finally(() => {
      if (this.#storageAccessPromise === trackedPromise) {
        this.#storageAccessPromise = null;
      }
      this.#cancelStorageAccess = null;
      this.#completeStorageAccess = null;
    });
    this.#storageAccessPromise = trackedPromise;
    return trackedPromise;
  }

  #openWalletWindow(): Promise<void> {
    if (this.#iframeVisible && this.#notifiedWalletWindowVisible) {
      return Promise.resolve();
    }
    if (this.#pendingOpen) {
      return this.#pendingOpen.promise;
    }

    // Keep stale iframe content hidden until the wallet confirms its OPEN route.
    this.#setIframeVisible(false);
    this.#notifiedWalletWindowVisible = true;

    let resolveOpen!: () => void;
    let rejectOpen!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolveOpen = resolve;
      rejectOpen = reject;
    });
    const pendingOpen: PendingOpen = {
      promise,
      resolve: resolveOpen,
      reject: rejectOpen,
    };
    this.#pendingOpen = pendingOpen;

    void this.#request('OPEN', {}).then(
      () => this.#confirmOpen(pendingOpen),
      (error: unknown) => this.#failOpen(pendingOpen, error),
    );
    return promise;
  }

  async #assertConnected(): Promise<void> {
    const account = await this.getAccount();
    if (!account) {
      throw new Error('Wallet not connected.');
    }
  }

  #setIframeVisible(visible: boolean): void {
    if (this.#iframeVisible !== visible) {
      this.#iframeVisible = visible;
      if (visible) {
        this.#iframe.show();
      } else {
        this.#iframe.hide();
      }
    }
  }

  #confirmOpen(pendingOpen: PendingOpen): void {
    if (this.#pendingOpen !== pendingOpen) {
      return;
    }

    this.#pendingOpen = null;
    this.#notifiedWalletWindowVisible = true;
    this.#setIframeVisible(true);
    pendingOpen.resolve();
  }

  #failOpen(pendingOpen: PendingOpen, error: unknown): void {
    if (this.#pendingOpen !== pendingOpen) {
      return;
    }

    this.#pendingOpen = null;
    this.#notifiedWalletWindowVisible = false;
    this.#setIframeVisible(false);
    pendingOpen.reject(
      error instanceof Error ? error : new Error('Wallet open failed.'),
    );
  }

  #cancelPendingOpen(error: Error): void {
    const pendingOpen = this.#pendingOpen;
    if (!pendingOpen) {
      return;
    }

    this.#pendingOpen = null;
    pendingOpen.reject(error);
  }

  #syncWalletWindowVisibility(): void {
    if (!this.#requests || !this.#ready || this.#destroyed) {
      return;
    }
    if (this.#notifiedWalletWindowVisible === this.#iframeVisible) {
      return;
    }

    this.#notifiedWalletWindowVisible = this.#iframeVisible;
    const method = this.#iframeVisible ? 'OPEN' : 'CLOSE';
    void this.#request(method, {}).catch(() => undefined);
  }

  #handleUserClose(): void {
    if (this.#destroyed) {
      return;
    }

    this.#setIframeVisible(false);
    this.#cancelPendingOpen(new Error('User closed wallet.'));
    this.#cancelStorageAccess?.();
    this.#requests?.rejectAllPending(new Error('User closed wallet.'));
    this.#syncWalletWindowVisibility();
  }

  #handleWalletEvent(event: WalletEventMessage): void {
    if (event.event === 'OPEN') {
      if (this.#pendingOpen) {
        this.#confirmOpen(this.#pendingOpen);
      } else {
        this.#notifiedWalletWindowVisible = true;
        this.#setIframeVisible(true);
      }
    } else if (event.event === 'CLOSE') {
      this.#cancelPendingOpen(new Error('Wallet closed.'));
      this.#notifiedWalletWindowVisible = false;
      this.#setIframeVisible(false);
    } else if (event.event === 'COLOR_MODE_CHANGED') {
      this.#iframe.setColorMode(event.data.colorMode);
    } else if (event.event === 'STORAGE_ACCESS_CHANGED') {
      this.#storageAccessStatus = event.data.storageAccess;
      if (this.#initResult) {
        this.#initResult.storageAccess = event.data.storageAccess;
      }
      if (event.data.storageAccess === 'granted') {
        this.#completeStorageAccess?.();
      }
    }

    const listeners = this.#listeners[event.event] as Set<
      WalletEventListener<typeof event.event>
    >;
    for (const listener of listeners) {
      listener(event.data);
    }
  }

  #assertNotDestroyed(): void {
    if (this.#destroyed) {
      throw new Error('Provider destroyed.');
    }
  }
}

function normalizeColorMode(value: unknown): WalletColorMode {
  if (value !== 'light' && value !== 'dark') {
    throw new TypeError('colorMode must be "light" or "dark".');
  }
  return value;
}

function waitForIframeLoad(iframe: HTMLIFrameElement): {
  promise: Promise<void>;
  cancel(): void;
} {
  let cancel: () => void = () => undefined;
  const promise = new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };
    const onLoad = () => {
      settle(resolve);
    };
    const onError = () => {
      settle(() => reject(new Error('Wallet iframe failed to load.')));
    };
    const cleanup = () => {
      iframe.removeEventListener('load', onLoad);
      iframe.removeEventListener('error', onError);
    };
    cancel = () => settle(() => reject(new Error('Provider destroyed.')));
    iframe.addEventListener('load', onLoad, { once: true });
    iframe.addEventListener('error', onError, { once: true });
  });
  return { promise, cancel };
}
