import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import WalletProvider from "@/components/wallet/WalletProvider";
import { AppShell } from "@/components/layout/AppShell";
import { RegisterSW } from "@/components/pwa/RegisterSW";
import { Toaster } from "@/components/ui/sonner";
import { APP_NAME, APP_URL, POSITIONING, SEASON_NAME } from "@/lib/config";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** Display serif for page titles and landing headlines only (`font-display`); UI text stays Geist. */
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const THEME_COLOR = "#0a0908";
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
  // var(--font-geist-sans) inside :root, which would be undefined if set on <body>.
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable}`} suppressHydrationWarning>
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
