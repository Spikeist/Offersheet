import type { MetadataRoute } from "next";
import { APP_DESCRIPTION, SITE_NAME, THEME_COLOR } from "@/lib/site";

/**
 * The web app manifest (planner reply to Checkpoint 4c, B3: "Installable: a PWA manifest and icons"), served at
 * /manifest.webmanifest and linked from every page by Next (on Vercel previews with crossorigin="use-credentials", so it
 * loads behind Vercel Authentication). Static: made once at build time.
 *
 * - What Chrome needs to offer "Install" (web.dev install criteria): a name, a start_url, display "standalone", and
 *   192 and 512 px icons; HTTPS on the real site. The maskable icon is its own entry (purpose "maskable" alone, never
 *   "any maskable" on one icon). The icons come from scripts/make-icons.ts.
 * - No service worker: installing from the browser's menu works without one, and one could serve stale code after a
 *   deploy. Offer Sheet needs the network anyway.
 * - start_url "/league": an installed app opens on your league (it says what to do when none is imported yet).
 *   ⚠️ A question for Parker at Checkpoint 7a: /league or the home page.
 * - Colors: the site header's navy (THEME_COLOR: globals.css --navy), the light theme's theme-color too.
 * - iPhone: Safari reads these icons too, but apple-icon.png (180 px, opaque) wins there.
 * A metadata route file exports only what Next reads (the default), so the color lives in src/lib/site.ts.
 */

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: APP_DESCRIPTION,
    start_url: "/league",
    scope: "/",
    display: "standalone",
    background_color: THEME_COLOR,
    theme_color: THEME_COLOR,
    lang: "en-US",
    dir: "ltr",
    categories: ["sports"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
