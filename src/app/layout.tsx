import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { Providers } from "./providers";
import { BottomNav } from "@/components/bottom-nav";

export const metadata: Metadata = {
  title: "Earn Money",
  description: "Tap, watch ads, rent workers and redeem coins for Telegram gifts.",
  applicationName: "Earn Money",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0b1120",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      </head>
      <body>
        <Providers>
          <div className="mx-auto min-h-dvh w-full max-w-md pb-[calc(env(safe-area-inset-bottom)+88px)]">
            {children}
          </div>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
