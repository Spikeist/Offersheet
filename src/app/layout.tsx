import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { SHARE_DESCRIPTION, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, THEME_COLOR, THEME_COLOR_DARK, siteUrl } from "@/lib/site";
import "./globals.css";

/**
 * Every page's metadata (planner reply to Checkpoint 4c, B3: the landing page's title, description, og:title and
 * og:description carried over; "Sharing: an SEO title and description, and an Open Graph image"; src/lib/site.ts):
 * - title: the landing page's on the home page, "<page> · Offer Sheet" elsewhere.
 * - metadataBase: the site's address (siteUrl), so the sharing image's URL is absolute. Next itself uses the preview's
 *   own address on Vercel previews and http://localhost in `next dev`.
 * - openGraph: no url (and no canonical): metadata merges shallowly, so a url here would make every page claim the home
 *   page's address. The image is src/app/opengraph-image.tsx (Next adds it, and copies it into the Twitter card).
 * - appleWebApp: on an iPhone, "Add to Home Screen" opens Offer Sheet as an app named "Offer Sheet" (Next writes
 *   mobile-web-app-capable). The manifest (src/app/manifest.ts) and the icons (icon.svg, favicon.ico, apple-icon.png)
 *   are linked by Next from their files.
 */
export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: SITE_TITLE, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: { type: "website", siteName: SITE_NAME, title: SITE_TITLE, description: SHARE_DESCRIPTION, locale: "en_US" },
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLOR },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLOR_DARK },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        <a href="#main" className="sr-only rounded-lg bg-accent px-3 py-2 font-bold text-navy focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-8">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
