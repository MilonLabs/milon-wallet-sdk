export const WALLET_CHANNEL = 'milon-wallet' as const;
export const WALLET_PROTOCOL_VERSION = 1 as const;
export const MILON_MESSAGE_TARGET = 'milon-web3-sdk' as const;
export const MILON_WALLET_TARGET = 'milon-wallet-runtime' as const;
export const STORAGE_ACCESS_RESULT_MESSAGE = 'MIL0N_STORAGE_ACCESS_RESULT' as const;

export type WalletNetwork = 'mainnet' | 'testnet' | 'devnet' | 'custom';
export type WalletNetworkInput = WalletNetwork | readonly WalletNetwork[];
export type WalletColorMode = 'light' | 'dark';

export interface NetworkServiceConfig {
  rpc?: string;
  indexer?: string;
  prover?: string;
}

export type WalletCurve = 'ed25519' | 'secp256k1' | 'bls12381' | 'fn_dsa512';

export interface InitParams {
  network: WalletNetwork[];
  rpc?: string;
  indexer?: string;
  prover?: string;
  app: {
    title: string;
    /** Derived by the SDK from the current DApp document. */
    icon?: string;
  };
  colorMode?: WalletColorMode;
}

export interface ConnectedAccount {
  address: string;
  name: string;
  network: WalletNetwork;
}

export type StorageAccessStatus = 'granted' | 'required';

export interface StorageAccessStatusResult {
  storageAccess: StorageAccessStatus;
}

export interface PublicKeyInfo {
  curve: WalletCurve;
  publicKeyHex: string;
}

export interface InitResult {
  network: WalletNetwork;
  account: ConnectedAccount | null;
  storageAccess: StorageAccessStatus;
}

export interface DisconnectResult {
  disconnected: true;
}

export interface SwitchNetworkParams {
  network: WalletNetwork;
}

export interface SwitchNetworkResult {
  network: WalletNetwork;
}

export interface UpdateNetworksParams {
  network: WalletNetwork[];
  rpc?: string;
  indexer?: string;
  prover?: string;
}

export interface UpdateThemeParams {
  colorMode: WalletColorMode;
}

export interface UpdateThemeResult {
  colorMode: WalletColorMode;
}

export interface SignMessageParams {
  message: string;
  nonce?: string;
}

export interface SignMessageResult {
  address: string;
  curve: WalletCurve;
  publicKeyHex: string;
  signatureHex: string;
  message: string;
  nonce: string;
  fullMessage: string;
}

export interface SignTransactionOptions {
  authBit?: string;
  instructionIndexes?: number[];
  includePayer?: boolean;
  publicKeyHex?: string;
}

export interface SignTransactionParams extends SignTransactionOptions {
  serializedTransactionHex: string;
}

export interface SignTransactionResult {
  serializedTransactionHex: string;
}

export interface SignAndSubmitTransactionParams
  extends SignTransactionOptions {
  serializedTransactionHex: string;
}

export interface SignAndSubmitTransactionResult {
  txHash: string;
}

export function normalizeAuthBit(
  value: unknown,
): string {
  if (typeof value !== 'string' || !/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value)) {
    throw new TypeError('Invalid authBit.');
  }

  let authBit: bigint;
  try {
    authBit = BigInt(value);
  } catch {
    throw new TypeError('Invalid authBit.');
  }
  if (authBit < 0n || authBit > 0xffff_ffff_ffff_ffffn) {
    throw new TypeError('Invalid authBit.');
  }

  return value.startsWith('0x') || value.startsWith('0X')
    ? `0x${value.slice(2).toLowerCase()}`
    : value;
}

export function normalizePublicKeyHex(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new TypeError('Invalid public key hex.');
  }

  const publicKeyHex = value.startsWith('0x') || value.startsWith('0X')
    ? value.slice(2)
    : value;
  if (
    publicKeyHex.length === 0 ||
    publicKeyHex.length % 2 !== 0 ||
    !/^[0-9a-f]+$/i.test(publicKeyHex)
  ) {
    throw new TypeError('Invalid public key hex.');
  }
  return publicKeyHex.toLowerCase();
}

export function normalizeSignTransactionOptions(
  value: unknown,
): SignTransactionOptions {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new TypeError('Invalid transaction signing options.');
  }

  const authBit =
    value.authBit === undefined ? undefined : normalizeAuthBit(value.authBit);
  const instructionIndexes = value.instructionIndexes;
  if (
    instructionIndexes !== undefined &&
    (!Array.isArray(instructionIndexes) ||
      instructionIndexes.some(
        (index) =>
          typeof index !== 'number' ||
          !Number.isInteger(index) ||
          index < 0 ||
          index > 62,
      ))
  ) {
    throw new TypeError('Invalid instruction indexes.');
  }

  const includePayer = value.includePayer;
  if (includePayer !== undefined && typeof includePayer !== 'boolean') {
    throw new TypeError('Invalid includePayer.');
  }

  const publicKeyHex = normalizePublicKeyHex(value.publicKeyHex);
  return {
    ...(authBit === undefined ? {} : { authBit }),
    ...(instructionIndexes === undefined
      ? {}
      : { instructionIndexes: [...instructionIndexes] as number[] }),
    ...(includePayer === undefined ? {} : { includePayer }),
    ...(publicKeyHex === undefined ? {} : { publicKeyHex }),
  };
}

export function normalizeMessage(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('Invalid message.');
  }

  const byteLength = new TextEncoder().encode(value).byteLength;
  if (byteLength === 0 || byteLength > 4_096) {
    throw new TypeError('Invalid message.');
  }
  return value;
}

export function normalizeNonce(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new TypeError('Invalid nonce.');
  }

  const byteLength = new TextEncoder().encode(value).byteLength;
  if (byteLength > 256) {
    throw new TypeError('Invalid nonce.');
  }
  return value;
}

export function normalizeTransactionHex(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('Invalid transaction hex.');
  }

  const normalizedValue =
    value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value;
  if (
    normalizedValue.length === 0 ||
    normalizedValue.length % 2 !== 0 ||
    !/^[0-9a-fA-F]+$/.test(normalizedValue)
  ) {
    throw new TypeError('Invalid transaction hex.');
  }
  return normalizedValue.toLowerCase();
}

export interface WalletMethodParams {
  INIT: InitParams;
  OPEN: Record<string, never>;
  CLOSE: Record<string, never>;
  GET_ACCOUNT: Record<string, never>;
  RETRY_STORAGE_ACCESS: Record<string, never>;
  GET_PUBLIC_KEYS: never;
  CONNECT: never;
  DISCONNECT: Record<string, never>;
  SWITCH_NETWORK: SwitchNetworkParams;
  UPDATE_NETWORKS: UpdateNetworksParams;
  UPDATE_THEME: UpdateThemeParams;
  LOGIN: SignMessageParams;
  SIGN_MESSAGE: SignMessageParams;
  SIGN_TRANSACTION: SignTransactionParams;
  SIGN_AND_SUBMIT_TRANSACTION: SignAndSubmitTransactionParams;
}

export interface WalletMethodResults {
  INIT: InitResult;
  OPEN: Record<string, never>;
  CLOSE: Record<string, never>;
  GET_ACCOUNT: ConnectedAccount | null;
  RETRY_STORAGE_ACCESS: StorageAccessStatusResult;
  GET_PUBLIC_KEYS: PublicKeyInfo[];
  CONNECT: ConnectedAccount;
  DISCONNECT: DisconnectResult;
  SWITCH_NETWORK: SwitchNetworkResult;
  UPDATE_NETWORKS: Record<string, never>;
  UPDATE_THEME: UpdateThemeResult;
  LOGIN: SignMessageResult;
  SIGN_MESSAGE: SignMessageResult;
  SIGN_TRANSACTION: SignTransactionResult;
  SIGN_AND_SUBMIT_TRANSACTION: SignAndSubmitTransactionResult;
}

export type WalletRequestMethod = keyof WalletMethodParams;

export const WalletEvent = {
  OPEN: 'OPEN',
  CLOSE: 'CLOSE',
  ACCOUNT_CHANGED: 'ACCOUNT_CHANGED',
  NETWORK_CHANGED: 'NETWORK_CHANGED',
  COLOR_MODE_CHANGED: 'COLOR_MODE_CHANGED',
  DISCONNECTED: 'DISCONNECTED',
  STORAGE_ACCESS_CHANGED: 'STORAGE_ACCESS_CHANGED',
} as const;

export type WalletEventName =
  (typeof WalletEvent)[keyof typeof WalletEvent];

export interface WalletEventData {
  OPEN: Record<string, never>;
  CLOSE: Record<string, never>;
  ACCOUNT_CHANGED: ConnectedAccount | null;
  NETWORK_CHANGED: {
    network: WalletNetwork;
  };
  COLOR_MODE_CHANGED: {
    colorMode: WalletColorMode;
  };
  DISCONNECTED: {
    reason: 'user_disconnected' | 'account_removed' | 'session_revoked';
  };
  STORAGE_ACCESS_CHANGED: {
    storageAccess: StorageAccessStatus;
  };
}

export type WalletRpcErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_PARAMS'
  | 'UNSUPPORTED_METHOD'
  | 'UNSUPPORTED_VERSION'
  | 'NOT_INITIALIZED'
  | 'DUPLICATE_REQUEST'
  | 'UNSUPPORTED_NETWORK'
  | 'NOT_CONNECTED'
  | 'ACCOUNT_NOT_FOUND'
  | 'WALLET_LOCKED'
  | 'USER_REJECTED'
  | 'INVALID_MESSAGE'
  | 'INVALID_TRANSACTION'
  | 'TRANSACTION_NETWORK_MISMATCH'
  | 'SIGNING_NOT_AVAILABLE'
  | 'SUBMIT_FAILED'
  | 'INTERNAL_ERROR';

export interface WalletRpcErrorDetails {
  source: 'jssdk';
  code?: number;
  message: string;
}

export interface WalletRpcError {
  code: WalletRpcErrorCode;
  message: string;
  details?: WalletRpcErrorDetails;
}

export type WalletRequestMessage<M extends WalletRequestMethod = WalletRequestMethod> =
  M extends 'CONNECT' | 'GET_PUBLIC_KEYS'
    ? {
        channel: typeof WALLET_CHANNEL;
        version: typeof WALLET_PROTOCOL_VERSION;
        target: typeof MILON_WALLET_TARGET;
        kind: 'request';
        requestId: string;
        method: M;
        params?: never;
      }
    : {
        channel: typeof WALLET_CHANNEL;
        version: typeof WALLET_PROTOCOL_VERSION;
        target: typeof MILON_WALLET_TARGET;
        kind: 'request';
        requestId: string;
        method: M;
        params: WalletMethodParams[M];
      };

export type WalletResponseMessage =
  | {
      channel: typeof WALLET_CHANNEL;
      version: typeof WALLET_PROTOCOL_VERSION;
      target: typeof MILON_MESSAGE_TARGET;
      kind: 'response';
      requestId: string;
      result: unknown;
      error?: never;
    }
  | {
      channel: typeof WALLET_CHANNEL;
      version: typeof WALLET_PROTOCOL_VERSION;
      target: typeof MILON_MESSAGE_TARGET;
      kind: 'response';
      requestId: string;
      result?: never;
      error: WalletRpcError;
    };

export type WalletEventMessage<E extends WalletEventName = WalletEventName> = {
  [Name in E]: {
    channel: typeof WALLET_CHANNEL;
    version: typeof WALLET_PROTOCOL_VERSION;
    target: typeof MILON_MESSAGE_TARGET;
    kind: 'event';
    event: Name;
    data: WalletEventData[Name];
  };
}[E];

const walletEventNames: readonly WalletEventName[] = Object.values(WalletEvent);

const walletRpcErrorCodes: readonly WalletRpcErrorCode[] = [
  'INVALID_REQUEST',
  'INVALID_PARAMS',
  'UNSUPPORTED_METHOD',
  'UNSUPPORTED_VERSION',
  'NOT_INITIALIZED',
  'DUPLICATE_REQUEST',
  'UNSUPPORTED_NETWORK',
  'NOT_CONNECTED',
  'ACCOUNT_NOT_FOUND',
  'WALLET_LOCKED',
  'USER_REJECTED',
  'INVALID_MESSAGE',
  'INVALID_TRANSACTION',
  'TRANSACTION_NETWORK_MISMATCH',
  'SIGNING_NOT_AVAILABLE',
  'SUBMIT_FAILED',
  'INTERNAL_ERROR',
];

export function isWalletResponse(value: unknown): value is WalletResponseMessage {
  if (!isProtocolEnvelope(value, 'response', MILON_MESSAGE_TARGET) || !hasNonEmptyRequestId(value)) {
    return false;
  }

  const hasResult = 'result' in value;
  const hasError = 'error' in value;
  return hasResult !== hasError && (!hasError || isWalletRpcError(value.error));
}

export function isWalletEvent(value: unknown): value is WalletEventMessage {
  if (
    !isProtocolEnvelope(value, 'event', MILON_MESSAGE_TARGET) ||
    typeof value.event !== 'string' ||
    !walletEventNames.includes(value.event as WalletEventName) ||
    !('data' in value)
  ) {
    return false;
  }

  switch (value.event) {
    case 'OPEN':
    case 'CLOSE':
      return isEmptyRecord(value.data);
    case 'ACCOUNT_CHANGED':
      return value.data === null || isConnectedAccount(value.data);
    case 'NETWORK_CHANGED':
      return isRecord(value.data) && isWalletNetwork(value.data.network);
    case 'COLOR_MODE_CHANGED':
      return isColorModeData(value.data);
    case 'DISCONNECTED':
      return (
        isRecord(value.data) &&
        (value.data.reason === 'user_disconnected' ||
          value.data.reason === 'account_removed' ||
          value.data.reason === 'session_revoked')
      );
    case 'STORAGE_ACCESS_CHANGED':
      return isStorageAccessData(value.data);
    default:
      return false;
  }
}

function isConnectedAccount(value: unknown): value is ConnectedAccount {
  return (
    isRecord(value) &&
    typeof value.address === 'string' &&
    typeof value.name === 'string' &&
    isWalletNetwork(value.network)
  );
}

function isWalletNetwork(value: unknown): value is WalletNetwork {
  return (
    value === 'mainnet' ||
    value === 'testnet' ||
    value === 'devnet' ||
    value === 'custom'
  );
}

function isColorModeData(value: unknown): value is { colorMode: WalletColorMode } {
  return (
    isRecord(value) &&
    !Array.isArray(value) &&
    Reflect.ownKeys(value).length === 1 &&
    (value.colorMode === 'light' || value.colorMode === 'dark')
  );
}

function isStorageAccessData(
  value: unknown,
): value is { storageAccess: StorageAccessStatus } {
  return (
    isRecord(value) &&
    Reflect.ownKeys(value).length === 1 &&
    (value.storageAccess === 'granted' || value.storageAccess === 'required')
  );
}

function isWalletRpcError(value: unknown): value is WalletRpcError {
  return (
    isRecord(value) &&
    typeof value.code === 'string' &&
    walletRpcErrorCodes.includes(value.code as WalletRpcErrorCode) &&
    typeof value.message === 'string' &&
    (value.details === undefined || isWalletRpcErrorDetails(value.details))
  );
}

function isWalletRpcErrorDetails(value: unknown): value is WalletRpcErrorDetails {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) =>
      key === 'source' || key === 'code' || key === 'message',
    ) &&
    value.source === 'jssdk' &&
    (value.code === undefined || typeof value.code === 'number') &&
    typeof value.message === 'string'
  );
}

function isProtocolEnvelope(
  value: unknown,
  kind: 'response' | 'event',
  target: typeof MILON_MESSAGE_TARGET,
): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    value.channel === WALLET_CHANNEL &&
    value.version === WALLET_PROTOCOL_VERSION &&
    value.target === target &&
    value.kind === kind
  );
}

function hasNonEmptyRequestId(value: Record<string, unknown>): boolean {
  return typeof value.requestId === 'string' && value.requestId.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isEmptyRecord(value: unknown): value is Record<string, never> {
  return isRecord(value) && Object.keys(value).length === 0;
}
