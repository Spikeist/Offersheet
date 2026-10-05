import type { MetadataRoute } from "next";
import { siteHref } from "@/lib/site";

/**
 * robots.txt (planner reply to Checkpoint 4c, B3, "Sharing"): crawlers may read every page but the API routes (all POST
 * and per user; nothing to index), and the sitemap says which pages are worth it. The pages that show only what this
 * browser saved (the Import Report, League, Trade Finder, Trade Analyzer and Settings) also ask not to be indexed
 * (robots: { index: false } in their metadata): to a crawler they're empty shells. Always the same, whatever the
 * deployment: Vercel already sends X-Robots-Tag: noindex on preview deployments, and a robots.txt that depended on the
 * build's environment could block the real site if a preview build were ever promoted to production.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: siteHref("/sitemap.xml"),
  };
}
