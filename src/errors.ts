import type {
  WalletRpcError,
  WalletRpcErrorCode,
  WalletRpcErrorDetails,
} from './protocol.js';

export class MilonWalletError extends Error {
  readonly code: WalletRpcErrorCode;
  readonly details: WalletRpcErrorDetails | undefined;

  constructor(error: WalletRpcError) {
    const message = error.details
      ? `${error.message} [JSSDK${error.details.code === undefined ? '' : ` ${error.details.code}`}] ${error.details.message}`
      : error.message;
    super(message);
    this.name = 'MilonWalletError';
    this.code = error.code;
    this.details = error.details;
  }
}
