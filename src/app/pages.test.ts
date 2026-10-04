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

  it("describes how trade ideas work today without a badge: they're built (Phase 4), so nothing in 'Why it's different' is coming soon", () => {
    const why = text.slice(text.indexOf("Why it's different"), text.indexOf("Works with"));
    expect(why).toContain("Built on your season");
    expect(why).toContain("Offers people say yes to");
    expect(why).not.toContain("Coming soon");
  });

  it("badges 'Get ranked trade ideas' available, with the Analyzer, and nothing in How it works is coming soon", () => {
    const how = text.slice(text.indexOf("How it works"), text.indexOf("What a suggestion looks like"));
    expect(how).toMatch(/Get ranked trade ideas .* Or build your own trade and check it the same way\. Available now/);
    expect(how).not.toContain("Coming soon");
  });

  it("says what's available today, the League page and the trade pages included, and lists Fantrax (public leagues) as Later", () => {
    expect(text).toContain(
      "Available now: connect an ESPN or Sleeper league, check what Offer Sheet understood about it, see every team's playoff and title odds, needs, trade chips and rest-of-season projections on the League page, and get ranked trade ideas on the Trade Finder, or check your own in the Trade Analyzer.",
    );
    expect(text).not.toContain("Trade ideas are coming soon");
    expect(text).toMatch(/Fantrax Public leagues only\. Later/);
  });
});

describe("privacy page", () => {
  const text = textOf(renderToStaticMarkup(createElement(PrivacyPage)));

  it("is dated October 3, 2026", () => {
    expect(text).toContain("Last updated October 3, 2026");
  });

  it("says settings and trade feedback stay in local storage, never reach the server, and how to remove them", () => {
    expect(text).toContain("Your settings for each league, and any feedback you give on trade ideas, stay in this browser after you close the tab, until you reset or delete them on the Settings page or clear this site's data. They're never sent to our server.");
    expect(text).toContain("Your settings and trade feedback are the exception: they stay in local storage");
    expect(text).toContain("saved under “offersheet:settings:v1”");
    expect(text).toContain("saved under “offersheet:feedback:v1”, for the latest 500 trade ideas");
    expect(text).toContain("Your settings for each league, and any feedback you give on trade ideas, stay in this browser");
    expect(text).toContain("In the file your leagues are only numbered (league-1, league-2)");
    expect(text).toContain("“Reset to defaults” on the Settings page removes a league's settings, “Delete saved feedback” removes all of your feedback, and clearing this site's data in your browser removes both.");
  });

  it("says what the League page keeps and sends: projections in session storage, scored on the server, math in the browser, only the format to FantasyCalc", () => {
    expect(text).toContain("Your imported league, and the League page's projections for it, live in this browser tab and are gone when you close it.");
    expect(text).toContain(
      "Our server fetches the data and scores each player's projections with your league's rules. The League page's math (lineups, needs, trade partners, playoff odds), the trade search and the Trade Analyzer all run in your browser.",
    );
    expect(text).toContain("The League page's math (lineups, needs, trade partners, playoff odds) runs in your browser; your league isn't sent to anyone else to be analyzed.");
    expect(text).toContain("and scores the projections with your league's scoring rules.");
    expect(text).toContain("under “offersheet:model:v1”, for the league you imported");
    expect(text).toContain("The FantasyCalc request carries only your league's format");
    expect(text).toContain("player lists, projections and stats, FantasyCalc trade values, player ID maps and the NFL schedule");
    // The server does more than fetch (src/server/modelInputs.ts scores projections with the league's rules).
    expect(text).not.toContain("Our server only fetches the data");
  });

  it("says the trade pages run in the browser on the same inputs, and that their links carry only team and player ID numbers (Phase 4)", () => {
    expect(text).toContain("The Trade Finder and the Trade Analyzer use the same projections and values, kept and fetched the same way, and they search for and score trades in your browser too.");
    expect(text).toContain(
      "carries only that team's ID number and the players' ID numbers in its web address (never names or your league's ID; a trade opened from “If they say no, try” also says so there)",
    );
    expect(text).toContain("the Finder and the Analyzer put the team you pick and the trade you evaluate into their address the same way.");
    // The links are never prefetched (prefetch={false}), so this stays true.
    expect(text).toContain("Offer Sheet never loads these addresses ahead of time, so our server sees one only when you open it, like any web address.");
    expect(text).toContain("report a problem with it (on the Trade Finder or the Trade Analyzer), it's saved under “offersheet:feedback:v1”, for the latest 500 trade ideas");
    // Feedback is filed under the same short code as the league's settings (feedbackStore.ts: settingsStore.ts leagueKey).
    expect(text).toContain("Each record is filed under the same short code made from its league's ID as that league's settings.");
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
