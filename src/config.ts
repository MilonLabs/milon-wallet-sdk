import type {
  NetworkServiceConfig,
  WalletColorMode,
  WalletNetwork,
  WalletNetworkInput,
} from './protocol.js';

export type {
  NetworkServiceConfig,
  WalletColorMode,
  WalletNetwork,
  WalletNetworkInput,
} from './protocol.js';

export interface MilonWalletProviderConfig extends NetworkServiceConfig {
  walletUrl: string;
  network?: WalletNetworkInput;
  app: {
    title: string;
  };
  colorMode?: WalletColorMode;
  container?: HTMLElement;
}

export interface ParsedProviderConfig
  extends Omit<MilonWalletProviderConfig, 'network' | 'app'>,
    NetworkServiceConfig {
  app: {
    title: string;
    icon: string;
  };
  walletOrigin: string;
  network: WalletNetwork[];
}

const DEFAULT_NETWORKS: readonly WalletNetwork[] = ['mainnet', 'testnet'];
const VALID_NETWORKS: readonly WalletNetwork[] = [
  'mainnet',
  'testnet',
  'devnet',
  'custom',
];

export function parseProviderConfig(
  config: MilonWalletProviderConfig,
): ParsedProviderConfig {
  const walletUrl = parseUrl(config.walletUrl, 'walletUrl');
  if (walletUrl.username || walletUrl.password) {
    throw new Error('walletUrl must not include credentials.');
  }
  if (walletUrl.protocol !== 'https:') {
    throw new Error('walletUrl must use HTTPS.');
  }

  const network = normalizeNetwork(config.network, 'init');
  const services = parseNetworkServices(config);
  const title = config.app.title.trim() || getCurrentHostname();
  if (title.length > 100) {
    throw new Error('app.title must be between 1 and 100 characters.');
  }
  const icon = getDappIconUrl();
  if (
    config.colorMode !== undefined &&
    config.colorMode !== 'light' &&
    config.colorMode !== 'dark'
  ) {
    throw new Error('colorMode must be "light" or "dark".');
  }

  if (
    config.container !== undefined &&
    (typeof HTMLElement === 'undefined' ||
      !(config.container instanceof HTMLElement))
  ) {
    throw new Error('container must be an HTMLElement.');
  }

  return {
    walletUrl: walletUrl.toString(),
    walletOrigin: walletUrl.origin,
    network,
    ...services,
    app: {
      title,
      icon,
    },
    ...(config.colorMode === undefined ? {} : { colorMode: config.colorMode }),
    ...(config.container === undefined ? {} : { container: config.container }),
  };
}

export function normalizeNetwork(
  value: unknown,
  mode: 'init' | 'update',
): WalletNetwork[] {
  if (value === undefined && mode === 'init') {
    return [...DEFAULT_NETWORKS];
  }
  if (!Array.isArray(value) && typeof value === 'string') {
    value = [value];
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('Invalid network parameter.');
  }

  const normalized: WalletNetwork[] = [];
  for (const network of value) {
    if (
      typeof network !== 'string' ||
      !VALID_NETWORKS.includes(network as WalletNetwork)
    ) {
      throw new TypeError('Invalid network parameter.');
    }
    if (!normalized.includes(network as WalletNetwork)) {
      normalized.push(network as WalletNetwork);
    }
  }
  return normalized;
}

export function parseNetworkServices(
  config: NetworkServiceConfig,
): NetworkServiceConfig {
  const services: NetworkServiceConfig = {};
  for (const field of ['rpc', 'indexer', 'prover'] as const) {
    const value = config[field];
    if (value !== undefined) {
      if (typeof value !== 'string') {
        throw new TypeError(field + ' must be a string.');
      }
      services[field] = value;
    }
  }
  return services;
}

function parseUrl(value: string, fieldName: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(fieldName + ' must be a valid URL.');
  }
}

function getCurrentHostname(): string {
  const hostname = globalThis.location?.hostname;
  if (hostname) {
    return hostname;
  }

  throw new Error('Unable to determine the dapp hostname.');
}

function getDappIconUrl(): string {
  const documentLinks = globalThis.document?.querySelectorAll('link') ?? [];
  for (const link of documentLinks) {
    const rel = link
      .getAttribute('rel')
      ?.trim()
      .toLowerCase()
      .split(/\s+/) ?? [];
    if (!rel.includes('icon')) {
      continue;
    }

    const href = link.getAttribute('href')?.trim();
    const iconUrl = href === undefined ? undefined : resolveIconUrl(href);
    if (iconUrl) {
      return iconUrl;
    }
  }

  const fallbackUrl = globalThis.location?.href;
  if (!fallbackUrl) {
    throw new Error('Unable to determine the dapp icon URL.');
  }

  const iconUrl = resolveIconUrl('/favicon.ico', fallbackUrl);
  if (!iconUrl) {
    throw new Error('Unable to determine the dapp icon URL.');
  }
  return iconUrl;
}

function resolveIconUrl(href: string, baseUrl = globalThis.location?.href): string | undefined {
  if (!baseUrl) {
    return undefined;
  }

  try {
    const url = new URL(href, baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
