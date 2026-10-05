/**
 * What search engines, link previews and "Install" read (planner reply to Checkpoint 4c, B3: "Installable: a PWA
 * manifest and icons"; "Sharing: an SEO title and description, and an Open Graph image"): the root layout's metadata
 * (the landing page's words, no page-claiming url), the site's address, the manifest, robots.txt, the sitemap, the
 * sharing image, the pages that ask not to be indexed, and the colors written into the icons and the browser chrome.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOGO_GOLD, LOGO_NAVY } from "@/components/logoGeometry";
import { LOCAL_SITE_URL, SHARE_DESCRIPTION, SHARE_IMAGE_ALT, SITE_DESCRIPTION, SITE_TITLE, THEME_COLOR, THEME_COLOR_DARK, siteHref, siteUrl } from "@/lib/site";

const css = readFileSync(join(__dirname, "globals.css"), "utf8");
const light = css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme: dark)"));
const dark = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"), css.indexOf("@theme inline"));
const token = (block: string, name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(block)?.[1];

/** A PNG's width, height and color type (IHDR; 2 = RGB, 6 = RGBA). */
function pngInfo(bytes: Uint8Array): { width: number; height: number; colorType: number } {
  const b = Buffer.from(bytes);
  expect(b.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(b.subarray(12, 16).toString("latin1")).toBe("IHDR");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b.readUInt8(25) };
}

describe("the site's address (src/lib/site.ts siteUrl)", () => {
  it("is https:// plus VERCEL_PROJECT_PRODUCTION_URL on Vercel, its origin only, else the stable copy's local address", () => {
    expect(siteUrl({}).href).toBe("http://127.0.0.1:3000/");
    expect(LOCAL_SITE_URL).toBe("http://127.0.0.1:3000");
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "offersheet.vercel.app" }).href).toBe("https://offersheet.vercel.app/");
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: " offersheet.app " }).href).toBe("https://offersheet.app/");
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "https://offersheet.app/some/path?x=1" }).href).toBe("https://offersheet.app/");
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "" }).href).toBe("http://127.0.0.1:3000/");
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "not a host" }).href).toBe("http://127.0.0.1:3000/");
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "user:pw@offersheet.app" }).href).toBe("http://127.0.0.1:3000/");
    expect(siteHref("/sitemap.xml", { VERCEL_PROJECT_PRODUCTION_URL: "offersheet.vercel.app" })).toBe("https://offersheet.vercel.app/sitemap.xml");
  });
});

describe("the root layout's metadata", () => {
  it("carries the landing page's title and descriptions word for word, with the page-title template", async () => {
    const { metadata } = await import("./layout");
    expect(metadata.title).toEqual({ default: "Offer Sheet — fantasy football trade finder", template: "%s · Offer Sheet" });
    expect(SITE_TITLE).toBe("Offer Sheet — fantasy football trade finder");
    expect(metadata.description).toBe(SITE_DESCRIPTION);
    expect(SITE_DESCRIPTION).toBe(
      "Offer Sheet reads your fantasy football league and ranks trade ideas by how much they raise your playoff and title odds, and how likely the other manager is to say yes. Free.",
    );
    expect(SHARE_DESCRIPTION).toBe("Trades that help your team, and that your leaguemates will actually accept. Free.");
  });

  it("shares as a website card with no url and no canonical (merging is shallow: every page would claim the home page's address)", async () => {
    const { metadata } = await import("./layout");
    expect(metadata.openGraph).toEqual({ type: "website", siteName: "Offer Sheet", title: SITE_TITLE, description: SHARE_DESCRIPTION, locale: "en_US" });
    expect(metadata.alternates).toBeUndefined();
    expect(String(metadata.metadataBase)).toBe(siteUrl().href);
    expect(metadata.appleWebApp).toEqual({ capable: true, title: "Offer Sheet", statusBarStyle: "default" });
  });

  it("colors the browser's chrome with the header's navy, light and dark (globals.css --navy)", async () => {
    const { viewport } = await import("./layout");
    expect(viewport.themeColor).toEqual([
      { media: "(prefers-color-scheme: light)", color: THEME_COLOR },
      { media: "(prefers-color-scheme: dark)", color: THEME_COLOR_DARK },
    ]);
    expect([token(light, "navy"), token(dark, "navy")]).toEqual([THEME_COLOR, THEME_COLOR_DARK]);
  });

  it("draws the icons in the light theme's gold and navy (globals.css --accent and --navy)", () => {
    expect([token(light, "accent"), token(light, "navy")]).toEqual([LOGO_GOLD, LOGO_NAVY]);
  });
});

describe("the web app manifest", () => {
  it("names the app, opens on the League page in its own window, in the header's navy", async () => {
    const manifest = (await import("./manifest")).default();
    expect(manifest).toMatchObject({
      id: "/",
      name: "Offer Sheet",
      short_name: "Offer Sheet",
      start_url: "/league",
      scope: "/",
      display: "standalone",
      background_color: THEME_COLOR,
      theme_color: THEME_COLOR,
      lang: "en-US",
      categories: ["sports"],
    });
    expect(manifest.description?.length).toBeLessThanOrEqual(300);
    expect(manifest.prefer_related_applications).toBeUndefined();
  });

  it("lists 192 and 512 px icons for any use and a separate maskable one, each a real file in public/ of that size", async () => {
    const manifest = (await import("./manifest")).default();
    expect(manifest.icons?.map((i) => [i.src, i.sizes, i.purpose])).toEqual([
      ["/icons/icon-192.png", "192x192", "any"],
      ["/icons/icon-512.png", "512x512", "any"],
      ["/icons/maskable-512.png", "512x512", "maskable"],
    ]);
    for (const icon of manifest.icons ?? []) {
      const file = join(__dirname, "..", "..", "public", icon.src);
      expect(existsSync(file)).toBe(true);
      const { width, height } = pngInfo(readFileSync(file));
      expect(`${width}x${height}`).toBe(icon.sizes);
      expect(icon.type).toBe("image/png");
    }
  });
});

describe("robots.txt and the sitemap", () => {
  it("robots.txt lets crawlers read every page but the API, and points to the sitemap", async () => {
    const robots = (await import("./robots")).default();
    expect(robots).toEqual({ rules: { userAgent: "*", allow: "/", disallow: "/api/" }, sitemap: siteHref("/sitemap.xml") });
  });

  it("the sitemap lists the pages anyone can read, at absolute addresses", async () => {
    const sitemap = (await import("./sitemap")).default();
    expect(sitemap.map((e) => e.url)).toEqual(["/", "/connect", "/privacy", "/terms", "/feedback"].map((p) => siteHref(p)));
  });

  it("the pages that show only this browser's saved data ask not to be indexed; the public pages don't", async () => {
    const hidden = await Promise.all([import("./import/page"), import("./league/page"), import("./trades/page"), import("./analyzer/page"), import("./settings/page")]);
    for (const page of hidden) expect(page.metadata.robots).toEqual({ index: false });
    const open = await Promise.all([import("./connect/page"), import("./privacy/page"), import("./terms/page"), import("./feedback/page")]);
    for (const page of open) expect(page.metadata.robots).toBeUndefined();
  });
});

describe("the sharing image (opengraph-image.tsx)", () => {
  it("is a 1200 × 630 PNG with alt text that says what it shows", async () => {
    const image = await import("./opengraph-image");
    expect(image.size).toEqual({ width: 1200, height: 630 });
    expect(image.contentType).toBe("image/png");
    expect(image.alt).toBe(SHARE_IMAGE_ALT);
    expect(SHARE_IMAGE_ALT).toBe("Offer Sheet: trades that help your team, and that your leaguemates will actually accept. Free, for ESPN and Sleeper leagues. Beta.");
    const res = image.default();
    expect(res.headers.get("content-type")).toBe("image/png");
    const info = pngInfo(new Uint8Array(await res.arrayBuffer()));
    expect([info.width, info.height]).toEqual([1200, 630]);
  }, 30_000);
});
