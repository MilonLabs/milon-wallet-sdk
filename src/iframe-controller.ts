import type { ParsedProviderConfig } from './config.js';
import type { WalletColorMode } from './protocol.js';

const CONTAINER_WIDTH = 360;
const CONTAINER_HEIGHT = 680;
const CONTAINER_MARGIN = 20;
const NARROW_SCREEN_QUERY = '(max-width: 640px)';
const POSITION_LEFT_KEY = 'milon-wallet-sdk:modal-left';
const POSITION_TOP_KEY = 'milon-wallet-sdk:modal-top';
const INSET_TOP_INDEX = 0;
const INSET_LEFT_INDEX = 3;
const COLOR_MODE_STYLES: Record<
  WalletColorMode,
  {
    background: string;
    border: string;
    ink: string;
    boxShadow: string;
  }
> = {
  light: {
    background: '#ffffff',
    border: '#e5e7eb',
    ink: '#111827',
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.18)',
  },
  dark: {
    background: '#111111',
    border: '#2d2d2d',
    ink: '#f5f5f5',
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.48)',
  },
};

export class IframeController {
  #container: HTMLElement | null = null;
  #dragHandle: HTMLElement | null = null;
  #iframe: HTMLIFrameElement | null = null;
  #dragOffset: { x: number; y: number } | null = null;
  #colorMode: WalletColorMode;

  constructor(
    private readonly config: ParsedProviderConfig,
    private readonly onClose: () => void | Promise<void> = () => undefined,
  ) {
    this.#colorMode = config.colorMode ?? 'light';
  }

  mount(): HTMLIFrameElement {
    if (this.#iframe) {
      return this.#iframe;
    }

    const container = document.createElement('section');
    container.dataset.milonWalletContainer = 'true';
    Object.assign(container.style, {
      position: 'fixed',
      zIndex: '2147483647',
      display: 'none',
      flexDirection: 'column',
      overflow: 'hidden',
      boxSizing: 'border-box',
      border: '1px solid',
      borderRadius: '8px',
      pointerEvents: 'auto',
    });

    const dragHandle = document.createElement('div');
    dragHandle.setAttribute('aria-label', 'Move wallet');
    Object.assign(dragHandle.style, {
      flex: '0 0 40px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      boxSizing: 'border-box',
      borderBottom: '1px solid',
      cursor: 'move',
      userSelect: 'none',
      touchAction: 'none',
      font: '500 12px/1.2 system-ui, sans-serif',
    });
    dragHandle.addEventListener('pointerdown', this.#startDrag);

    const title = document.createElement('span');
    title.textContent = 'Milon Wallet';

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.dataset.milonWalletClose = 'true';
    closeButton.setAttribute('aria-label', 'Close wallet');
    closeButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13.2 2.8 8 8m0 0-5.2 5.2M8 8l5.2 5.2M8 8 2.8 2.8" stroke="currentColor" stroke-width="2" stroke-linecap="square"/></svg>';
    Object.assign(closeButton.style, {
      display: 'grid',
      width: '24px',
      height: '24px',
      placeItems: 'center',
      padding: '0',
      border: '0',
      background: 'transparent',
      color: 'inherit',
      cursor: 'pointer',
    });
    closeButton.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
    });
    closeButton.addEventListener('click', () => {
      void Promise.resolve(this.onClose()).catch(() => undefined);
    });
    dragHandle.append(title, closeButton);

    const iframe = document.createElement('iframe');
    iframe.src = this.config.walletUrl;
    iframe.title = 'Milon Wallet';
    iframe.setAttribute(
      'sandbox',
      [
        'allow-scripts',
        'allow-forms',
        'allow-same-origin',
        'allow-storage-access-by-user-activation',
        'allow-popups',
      ].join(' '),
    );
    iframe.setAttribute(
      'allow',
      ['clipboard-write', 'storage-access'].join('; '),
    );
    Object.assign(iframe.style, {
      display: 'none',
      flex: '1 1 auto',
      width: '100%',
      minHeight: '0',
      border: '0',
    });

    container.append(dragHandle, iframe);
    (this.config.container ?? document.body).append(container);
    this.#container = container;
    this.#dragHandle = dragHandle;
    this.#iframe = iframe;
    this.#applyColorMode();
    this.#applyLayout();
    window.addEventListener('resize', this.#handleResize);
    return iframe;
  }

  setColorMode(colorMode: WalletColorMode): void {
    this.#colorMode = colorMode;
    this.#applyColorMode();
  }

  show(): void {
    const iframe = this.mount();
    this.#applyLayout();
    this.#container!.style.display = 'flex';
    iframe.style.display = 'block';
  }

  hide(): void {
    if (this.#iframe) {
      this.#iframe.style.display = 'none';
      this.#container!.style.display = 'none';
    }
  }

  get contentWindow(): Window | null {
    return this.#iframe?.contentWindow ?? null;
  }

  getContainerBounds(): {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null {
    if (!this.#container) {
      return null;
    }

    const rect = this.#container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
    }

    if (this.#isNarrowScreen()) {
      const width = window.innerWidth;
      const height = Math.min(660, window.innerHeight * 0.95);
      return {
        left: 0,
        top: window.innerHeight - height,
        width,
        height,
      };
    }

    const computedStyle = window.getComputedStyle(this.#container);
    const inlineStyle = this.#container.style;
    const width =
      parsePixelValue(inlineStyle.width) ??
      parsePixelValue(computedStyle.width) ??
      Math.min(CONTAINER_WIDTH, window.innerWidth);
    const height =
      parsePixelValue(inlineStyle.height) ??
      parsePixelValue(computedStyle.height) ??
      Math.min(CONTAINER_HEIGHT, window.innerHeight);
    const left =
      parsePixelValue(inlineStyle.left) ??
      parsePixelValue(computedStyle.left) ??
      parseInsetValue(inlineStyle.inset, INSET_LEFT_INDEX) ??
      parseInsetValue(computedStyle.inset, INSET_LEFT_INDEX) ??
      this.#readStylePosition('left');
    const top =
      parsePixelValue(inlineStyle.top) ??
      parsePixelValue(computedStyle.top) ??
      parseInsetValue(inlineStyle.inset, INSET_TOP_INDEX) ??
      parseInsetValue(computedStyle.inset, INSET_TOP_INDEX) ??
      this.#readStylePosition('top');

    return {
      left,
      top,
      width,
      height,
    };
  }

  destroy(): void {
    window.removeEventListener('resize', this.#handleResize);
    document.removeEventListener('pointermove', this.#moveDrag);
    document.removeEventListener('pointerup', this.#finishDrag);
    document.removeEventListener('pointercancel', this.#finishDrag);
    this.#container?.remove();
    this.#container = null;
    this.#dragHandle = null;
    this.#iframe = null;
    this.#dragOffset = null;
  }

  #applyColorMode(): void {
    if (!this.#container || !this.#dragHandle || !this.#iframe) {
      return;
    }

    const styles = COLOR_MODE_STYLES[this.#colorMode];
    Object.assign(this.#container.style, {
      background: styles.background,
      borderColor: styles.border,
      boxShadow: styles.boxShadow,
    });
    Object.assign(this.#dragHandle.style, {
      borderBottomColor: styles.border,
      color: styles.ink,
    });
    this.#iframe.style.background = styles.background;
  }

  #startDrag = (event: PointerEvent): void => {
    if (!this.#container || this.#isNarrowScreen()) {
      return;
    }

    const left = this.#readStylePosition('left');
    const top = this.#readStylePosition('top');
    this.#dragOffset = { x: event.clientX - left, y: event.clientY - top };
    const target = event.currentTarget;
    if (target instanceof HTMLElement && typeof target.setPointerCapture === 'function') {
      target.setPointerCapture(event.pointerId);
    }
    document.addEventListener('pointermove', this.#moveDrag);
    document.addEventListener('pointerup', this.#finishDrag);
    document.addEventListener('pointercancel', this.#finishDrag);
  };

  #moveDrag = (event: PointerEvent): void => {
    if (!this.#container || !this.#dragOffset || this.#isNarrowScreen()) {
      return;
    }

    this.#setDesktopPosition(
      event.clientX - this.#dragOffset.x,
      event.clientY - this.#dragOffset.y,
    );
  };

  #finishDrag = (): void => {
    if (this.#container && !this.#isNarrowScreen()) {
      this.#persistPosition();
    }
    this.#dragOffset = null;
    document.removeEventListener('pointermove', this.#moveDrag);
    document.removeEventListener('pointerup', this.#finishDrag);
    document.removeEventListener('pointercancel', this.#finishDrag);
  };

  #handleResize = (): void => {
    this.#applyLayout();
  };

  #applyLayout(): void {
    if (!this.#container) {
      return;
    }

    if (this.#isNarrowScreen()) {
      Object.assign(this.#container.style, {
        width: '100vw',
        height: 'min(660px, 95vh)',
        left: '0px',
        top: 'auto',
        right: '0px',
        bottom: '0px',
        borderRadius: '8px 8px 0 0',
      });
      return;
    }

    Object.assign(this.#container.style, {
      width: `${Math.min(CONTAINER_WIDTH, window.innerWidth)}px`,
      height: `${Math.min(CONTAINER_HEIGHT, window.innerHeight)}px`,
      right: 'auto',
      bottom: 'auto',
      borderRadius: '8px',
    });
    const storedLeft = this.#readStoredPosition(POSITION_LEFT_KEY);
    const storedTop = this.#readStoredPosition(POSITION_TOP_KEY);
    this.#setDesktopPosition(
      storedLeft ?? window.innerWidth - this.#containerWidth() - CONTAINER_MARGIN,
      storedTop ?? CONTAINER_MARGIN,
    );
    this.#persistPosition();
  }

  #setDesktopPosition(left: number, top: number): void {
    if (!this.#container) {
      return;
    }

    const maxLeft = Math.max(0, window.innerWidth - this.#containerWidth());
    const maxTop = Math.max(0, window.innerHeight - this.#containerHeight());
    this.#container.style.left = `${Math.min(Math.max(left, 0), maxLeft)}px`;
    this.#container.style.top = `${Math.min(Math.max(top, 0), maxTop)}px`;
  }

  #persistPosition(): void {
    if (!this.#container) {
      return;
    }

    try {
      localStorage.setItem(POSITION_LEFT_KEY, String(this.#readStylePosition('left')));
      localStorage.setItem(POSITION_TOP_KEY, String(this.#readStylePosition('top')));
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
  }

  #readStoredPosition(key: string): number | null {
    try {
      const value = localStorage.getItem(key);
      if (value === null) {
        return null;
      }
      const position = Number(value);
      return Number.isFinite(position) ? position : null;
    } catch {
      return null;
    }
  }

  #readStylePosition(property: 'left' | 'top'): number {
    return Number.parseFloat(this.#container?.style[property] ?? '0') || 0;
  }

  #containerWidth(): number {
    return this.#container?.clientWidth || Math.min(CONTAINER_WIDTH, window.innerWidth);
  }

  #containerHeight(): number {
    return this.#container?.clientHeight || Math.min(CONTAINER_HEIGHT, window.innerHeight);
  }

  #isNarrowScreen(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia(NARROW_SCREEN_QUERY).matches;
  }
}

function parsePixelValue(value: string): number | null {
  const trimmedValue = value.trim();
  if (!trimmedValue.endsWith('px')) {
    return null;
  }

  const parsedValue = Number.parseFloat(trimmedValue);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function parseInsetValue(value: string, index: number): number | null {
  const values = value.trim().split(/\s+/).filter(Boolean);
  if (values.length === 0 || values.length > 4) {
    return null;
  }

  const expandedValues =
    values.length === 1
      ? [values[0], values[0], values[0], values[0]]
      : values.length === 2
        ? [values[0], values[1], values[0], values[1]]
        : values.length === 3
          ? [values[0], values[1], values[2], values[1]]
          : values;
  return parsePixelValue(expandedValues[index] ?? '');
}
