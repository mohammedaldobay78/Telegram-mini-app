interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: {
    user?: { id: number; first_name?: string; username?: string; photo_url?: string };
    start_param?: string;
  };
  colorScheme?: "light" | "dark";
  themeParams?: Record<string, string>;
  ready(): void;
  expand(): void;
  close(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  enableClosingConfirmation(): void;
  disableClosingConfirmation(): void;
  openInvoice(url: string, callback?: (status: string) => void): void;
  openTelegramLink(url: string): void;
  showAlert?(message: string): void;
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
    selectionChanged(): void;
  };
  MainButton?: {
    text: string;
    show(): void;
    hide(): void;
    setText(text: string): void;
    onClick(callback: () => void): void;
    offClick(callback: () => void): void;
    showProgress?(leaveActive?: boolean): void;
    hideProgress?(): void;
  };
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(callback: () => void): void;
    offClick(callback: () => void): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function getWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

export function initTelegram(): void {
  const app = getWebApp();
  if (!app) return;
  app.ready();
  app.expand();
  try {
    app.setHeaderColor("bg_color");
    app.setBackgroundColor("bg_color");
  } catch {
    // Older clients may not support the color API.
  }
}

export function rawInitData(): string {
  return getWebApp()?.initData ?? "";
}

export function startParam(): string {
  const app = getWebApp();
  return app?.initDataUnsafe?.start_param ?? "";
}

export function haptic(kind: "tap" | "success" | "error" | "select" = "tap"): void {
  const feedback = getWebApp()?.HapticFeedback;
  if (!feedback) return;
  try {
    if (kind === "tap") feedback.impactOccurred("light");
    else if (kind === "select") feedback.selectionChanged();
    else feedback.notificationOccurred(kind);
  } catch {
    // Haptics are best-effort.
  }
}

export function openInvoice(url: string): Promise<string> {
  return new Promise((resolve) => {
    const app = getWebApp();
    if (!app) {
      resolve("unsupported");
      return;
    }
    app.openInvoice(url, (status) => resolve(status));
  });
}

export function shareLink(url: string, text: string): void {
  const app = getWebApp();
  const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  if (app) app.openTelegramLink(share);
  else if (typeof window !== "undefined") window.open(share, "_blank");
}

export function setClosingConfirmation(enabled: boolean): void {
  const app = getWebApp();
  if (!app) return;
  try {
    if (enabled) app.enableClosingConfirmation();
    else app.disableClosingConfirmation();
  } catch {
    // no-op
  }
}
