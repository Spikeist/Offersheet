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
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
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

  it("says what's available today, the League page included, and lists Fantrax (public leagues) as Later", () => {
    expect(text).toContain(
      "Available now: connect an ESPN or Sleeper league, check what Offer Sheet understood about it, and see every team's playoff and title odds, needs, trade chips and rest-of-season projections on the League page. Trade ideas are coming soon.",
    );
    expect(text).toMatch(/Fantrax Public leagues only\. Later/);
  });
});

describe("privacy page", () => {
  const text = textOf(renderToStaticMarkup(createElement(PrivacyPage)));

  it("is dated September 30, 2026", () => {
    expect(text).toContain("Last updated September 30, 2026");
  });

  it("says what the League page keeps and sends: projections in session storage, scored on the server, math in the browser, only the format to FantasyCalc", () => {
    expect(text).toContain("Your imported league, and the League page's projections for it, live in this browser tab and are gone when you close it.");
    expect(text).toContain("Our server fetches the data and scores each player's projections with your league's rules. The League page's math (lineups, needs, trade partners, playoff odds) runs in your browser.");
    expect(text).toContain("The League page's math (lineups, needs, trade partners, playoff odds) runs in your browser; your league isn't sent to anyone else to be analyzed.");
    expect(text).toContain("and scores the projections with your league's scoring rules.");
    expect(text).toContain("under “offersheet:model:v1”, for the league you imported");
    expect(text).toContain("The FantasyCalc request carries only your league's format");
    expect(text).toContain("player lists, projections and stats, FantasyCalc trade values, player ID maps and the NFL schedule");
    // The server does more than fetch (src/server/modelInputs.ts scores projections with the league's rules).
    expect(text).not.toContain("Our server only fetches the data");
  });

  it("says exactly what the Sleeper requests carry: they're shaped by the league's season length and lineup (src/server/modelInputs.ts), never by names or IDs", () => {
    expect(text).toContain(
      "Sleeper's projection and stats requests carry only the season, week numbers up to your league's last playoff week, and the positions your league starts (for example, whether it uses a kicker or IDP).",
    );
    expect(text).toContain(
      "They never carry names or IDs. The other requests (player lists, player ID maps and the NFL schedule) don't depend on your league at all (the schedule only on the season), so nothing about you or your league is sent with them.",
    );
    expect(text).not.toContain("aren't about any league.");
    expect(text).not.toMatch(/Nothing about you or your league is sent with the other requests/);
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
