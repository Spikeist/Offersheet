/**
 * Static pages and site-wide config: the home page says what's available now, the privacy page
 * says what the code does (CLAUDE.md §14), and every response carries the security headers.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import Home from "./page";
import PrivacyPage from "./privacy/page";

/** Visible text, tags and entities removed. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

describe("home page", () => {
  const html = renderToStaticMarkup(createElement(Home));
  const text = textOf(html);

  it("badges the 'Why it's different' features that later phases build", () => {
    const why = text.slice(text.indexOf("Why it's different"), text.indexOf("Works with"));
    expect(why).toMatch(/Built on your season .* Coming soon/);
    expect(why).toMatch(/Offers people say yes to .* Coming soon/);
    expect(why.match(/Coming soon/g)).toHaveLength(2);
  });

  it("says what's available today, and lists Fantrax (public leagues) as Later", () => {
    expect(text).toContain("Available now: connect an ESPN or Sleeper league and check what Offer Sheet understood about it. Trade ideas are coming soon.");
    expect(text).toMatch(/Fantrax Public leagues only\. Later/);
  });
});

describe("privacy page", () => {
  const text = textOf(renderToStaticMarkup(createElement(PrivacyPage)));

  it("is dated September 29, 2026", () => {
    expect(text).toContain("Last updated September 29, 2026");
  });

  it("says how long each kind of data is kept, and that it's then deleted", () => {
    expect(text).toContain("League data (settings, rosters, schedule and transactions): about 10 minutes.");
    expect(text).toContain("A Sleeper username lookup (which leagues that username is in): 10 minutes.");
    expect(text).toContain("up to a week, so a saved copy can stand in if a source is down");
    expect(text).toContain("keeps a copy of what it fetched for a short time, then deletes it");
  });

  it("describes the SWID pseudonyms, espn_s2 and Forget exactly", () => {
    expect(text).toContain("replaces every member ID with a one-way pseudonym, so the saved copy holds no SWIDs");
    expect(text).toContain("Your espn_s2 cookie is never stored on our server or written to logs");
    expect(text).toContain("deletes the cookie right away. League data our server cached with it expires within about 10 minutes");
    expect(text).toContain("stops working after 12 hours");
  });
});

describe("security headers", () => {
  it("stop framing and MIME sniffing and trim the Referer on every path, without a script CSP", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    expect(rules).toHaveLength(1);
    expect(rules[0]?.source).toBe("/:path*");
    const headers = Object.fromEntries((rules[0]?.headers ?? []).map((h) => [h.key, h.value]));
    expect(headers).toEqual({
      "Content-Security-Policy": "frame-ancestors 'none'",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
    });
    expect(headers["Content-Security-Policy"]).not.toMatch(/script-src|default-src/);
  });
});
