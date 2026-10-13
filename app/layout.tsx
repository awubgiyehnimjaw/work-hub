import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Script from "next/script";

export const metadata: Metadata = {
  title: "Work Hub",
  description: "Single-user work hub for Frame.io reviews, calendar, and to-dos.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
  // iOS Safari ignores the manifest's `display`/icons for "Add to Home
  // Screen" and instead reads these apple-specific meta tags: `capable`
  // is what makes the installed app launch without Safari's chrome
  // (mirrors manifest.json's `display: "standalone"` for Android/Chrome).
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Work Hub",
  },
};

export const viewport: Viewport = {
  themeColor: "#111827",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        {/* Registered after the page is interactive, not blocking initial
            render. Registration failures (e.g. unsupported browser, or the
            request getting caught by an unauthenticated session) are
            logged, not thrown - a missing service worker should never
            break the dashboard itself. */}
        <Script id="register-service-worker" strategy="afterInteractive">
          {`
            if ("serviceWorker" in navigator) {
              window.addEventListener("load", function () {
                navigator.serviceWorker.register("/sw.js").catch(function (error) {
                  console.error("Service worker registration failed", error);
                });
              });
            }
          `}
        </Script>
      </body>
    </html>
  );
}
