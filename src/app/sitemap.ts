import type { MetadataRoute } from "next";
import { siteHref } from "@/lib/site";

/**
 * The sitemap (planner reply to Checkpoint 4c, B3, "Sharing"): the pages anyone can read, at the site's address
 * (src/lib/site.ts siteUrl). The pages that show only what this browser saved (the Import Report, League, the trade
 * pages and Settings) aren't listed, and ask not to be indexed. A metadata route file exports only its default.
 */
const PUBLIC_PATHS = ["/", "/connect", "/privacy", "/terms", "/feedback"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((p) => ({ url: siteHref(p) }));
}
