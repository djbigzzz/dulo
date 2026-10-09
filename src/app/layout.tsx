import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import WalletProvider from "@/components/wallet/WalletProvider";
import { AppShell } from "@/components/layout/AppShell";
import { RegisterSW } from "@/components/pwa/RegisterSW";
import { Toaster } from "@/components/ui/sonner";
import { APP_NAME, APP_URL, POSITIONING, SEASON_NAME } from "@/lib/config";

/**
 * "Live Broadcast" type (docs/DESIGN.md):
 *   Instrument Serif  headlines, questions and section names (`font-display`, one weight: 400);
 *   Archivo           numbers, labels and UI (`font-sans`), variable with its width axis so the
 *                     narrow scoreboard cut (`font-stretch-75%`) and the wide label cut
 *                     (`font-stretch-semi-expanded`) come from one file; italic only for FINAL stamps;
 *   IBM Plex Mono     price, source, age and time only (`font-mono`, `mono-meta`).
 */
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  style: ["normal", "italic"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

/** The Broadcast ground (--background, "ink"): the status bar, the splash and every icon sit on it. */
const THEME_COLOR = "#0b0b0c";
const TITLE = `${APP_NAME} — ${SEASON_NAME}`;

function safeUrl(u: string): URL | undefined {
  try {
    return new URL(u);
  } catch {
    return undefined;
  }
}

export const metadata: Metadata = {
  metadataBase: safeUrl(APP_URL),
  title: { default: TITLE, template: `%s · ${APP_NAME}` },
  description: POSITIONING,
  applicationName: APP_NAME,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.svg", type: "image/svg+xml", sizes: "192x192" },
      { url: "/icons/icon-512.svg", type: "image/svg+xml", sizes: "512x512" },
    ],
    // iOS ignores SVG touch icons; this one is a real 180x180 PNG.
    apple: [{ url: "/icons/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
    shortcut: ["/favicon.svg"],
  },
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    title: TITLE,
    description: POSITIONING,
    // Same per-pathname resolution as the canonical, against metadataBase (APP_URL).
    url: "./",
  },
  // og:image / twitter:image come from the file convention (src/app/opengraph-image.tsx, twitter-image.tsx).
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: POSITIONING,
  },
  // "./" resolves against each route's pathname (Next resolveRelativeUrl): "/" on the home page, "/quests"
  // on /quests. A bare "/" here would be inherited by every page and canonicalise them all to the home page.
  alternates: { canonical: "./" },
  // No `other: { "mobile-web-app-capable" }`: Next 15 already emits it from appleWebApp.capable (it was printed twice).
};

// themeColor / colorScheme belong in the viewport export in Next 14+ (metadata.themeColor is deprecated).
export const viewport: Viewport = {
  themeColor: THEME_COLOR,
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The next/font variable classes go on <html>, not <body>: globals.css reads
  // var(--font-archivo) and the others inside :root, which would be undefined if set on <body>.
  return (
    <html lang="en" className={`dark ${archivo.variable} ${instrumentSerif.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <body className="antialiased">
        <WalletProvider>
          <AppShell>{children}</AppShell>
          <Toaster theme="dark" position="top-center" closeButton />
        </WalletProvider>
        <RegisterSW />
      </body>
    </html>
  );
}
