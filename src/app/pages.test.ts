/**
 * Static pages and site-wide config: the home page says what's available now, the privacy page says what the code does
 * (CLAUDE.md §14), the terms and the feedback page say what Part B's public beta promises (planner reply to Checkpoint
 * 4c, B3), the error pages are the site's own, and every response carries the security headers (B4: a full
 * Content-Security-Policy in production builds only).
 *
 * Review PG-1: the privacy policy, the terms and the feedback page describe track BF's browser reading and track FB's
 * anonymous feedback only once they're built (src/lib/site.ts POLICY_FEATURES). Their words are pinned both ways, and
 * "the public pages describe what's built" fails while a flag and the code its sentences rest on disagree.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FANTASYCALC_OUTAGE_HOLD_MS, FANTASYCALC_OUTAGE_MAX_HOLD_MS } from "@/data/fantasyCalcValues";
import { config } from "@/engine/config";
import { FOOTER_INDEPENDENT } from "@/components/SiteFooter";
import { CONTACT_EMAIL, CONTACT_PENDING, POLICY_FEATURES, type PolicyFeatures } from "@/lib/site";
import { createBudget, createDailyQuota, msUntilUtcMidnight } from "@/server/budget";
import { HOUR, TTL } from "@/server/cache";
import { browserFetchLimits, budgets, feedbackLimits, logLimits, rateLimits, workLimits } from "@/server/limits";
import { StoredLogEventSchema } from "@/server/log";
import { FakeRedis } from "@/server/redis";
import nextConfig, { BROWSER_FETCH_ORIGINS, FRAMING_ONLY_CSP, PERMISSIONS_POLICY, VERCEL_TOOLBAR_SOURCES, contentSecurityPolicy, securityHeaders } from "../../next.config";
import ErrorPage from "./error";
import { FeedbackGuide, feedbackDescription } from "./feedback/FeedbackGuide";
import FeedbackPage, { metadata as feedbackMetadata } from "./feedback/page";
import GlobalError from "./global-error";
import NotFound from "./not-found";
import Home from "./page";
import { DAY_COUNT_DELETED, PRIVACY_LAST_UPDATED, PrivacyPolicy, countedKinds } from "./privacy/PrivacyPolicy";
import PrivacyPage from "./privacy/page";
import { TERMS_LAST_UPDATED, TermsOfUse } from "./terms/TermsOfUse";
import TermsPage from "./terms/page";

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

/** Every link in some markup: where it goes and its text. */
function links(html: string): Array<{ href: string | undefined; text: string; attrs: string }> {
  return [...html.matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs = "", inner = ""]) => ({
    href: /href="([^"]*)"/.exec(attrs)?.[1],
    text: textOf(inner).trim(),
    attrs,
  }));
}

/** The four ways the wave-2 features can stand: neither (today), each alone, both (Checkpoint 7a). */
const TODAY: PolicyFeatures = { browserReads: false, anonymousFeedback: false };
const BROWSER: PolicyFeatures = { browserReads: true, anonymousFeedback: false };
const FEEDBACK: PolicyFeatures = { browserReads: false, anonymousFeedback: true };
const BOTH: PolicyFeatures = { browserReads: true, anonymousFeedback: true };
const ALL = [TODAY, BROWSER, FEEDBACK, BOTH];
const WITHOUT_BROWSER = [TODAY, FEEDBACK];
const WITH_BROWSER = [BROWSER, BOTH];
const WITHOUT_FEEDBACK = [TODAY, BROWSER];
const WITH_FEEDBACK = [FEEDBACK, BOTH];

/** A page's text with these features on. */
function page(component: typeof PrivacyPolicy | typeof TermsOfUse | typeof FeedbackGuide, features: PolicyFeatures): { html: string; text: string } {
  const html = renderToStaticMarkup(createElement(component, { features }));
  return { html, text: textOf(html) };
}
const privacy = (f: PolicyFeatures) => page(PrivacyPolicy, f);
const terms = (f: PolicyFeatures) => page(TermsOfUse, f);
const feedback = (f: PolicyFeatures) => page(FeedbackGuide, f);

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const exists = (file: string) => existsSync(path.join(ROOT, file));
const source = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/** The code (not the tests) under some folders, file by file; a folder that doesn't exist has none. */
function sourcesUnder(...dirs: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(readFileSync(p, "utf8"));
    }
  };
  for (const d of dirs) if (exists(d)) walk(path.join(ROOT, d));
  return out;
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

  it("keeps the landing page's words (Part B, B3): the headline, the hero, the four pills, the free beta", () => {
    expect(text).toContain("Trades that help your team, and that your leaguemates will actually accept .");
    expect(text).toContain(
      "Offer Sheet reads your fantasy football league, works out what your team needs, and ranks trade ideas by how much they raise your playoff and title odds and how likely the other manager is to say yes.",
    );
    expect(text).toContain("Free No account needed Read-only No ads");
    expect(text).toContain("Fantasy football trade finder · Free beta");
  });

  it("lists ESPN and Sleeper as available, Yahoo as waiting for Yahoo's approval, and the other platforms as Later (Part B, B3)", () => {
    const works = text.slice(text.indexOf("Works with"));
    expect(works).toMatch(/ESPN Paste your league link\..* Available Sleeper Your username or a league ID\. Available Yahoo Sign in with your Yahoo account\. Waiting for Yahoo's approval Fleaflicker League ID\. Later MyFantasyLeague League ID\. Later Fantrax Public leagues only\. Later Manual entry for other sites Pick your scoring and paste your rosters\. Later/);
    expect(text).not.toContain("Coming soon");
    expect(text).not.toContain("Trade Score");
  });
});

describe("the public pages describe what's built (review PG-1)", () => {
  it("each page shows its text with POLICY_FEATURES, the feedback page's description included", () => {
    expect(renderToStaticMarkup(createElement(PrivacyPage))).toBe(renderToStaticMarkup(createElement(PrivacyPolicy, { features: POLICY_FEATURES })));
    expect(renderToStaticMarkup(createElement(TermsPage))).toBe(renderToStaticMarkup(createElement(TermsOfUse, { features: POLICY_FEATURES })));
    expect(renderToStaticMarkup(createElement(FeedbackPage))).toBe(renderToStaticMarkup(createElement(FeedbackGuide, { features: POLICY_FEATURES })));
    expect(feedbackMetadata.description).toBe(feedbackDescription(POLICY_FEATURES));
  });

  it("browser reading (track BF) is described exactly when the browser's own HTTP client exists, with the code its sentences rest on", () => {
    const built = exists("src/lib/browserHttp.ts");
    expect(
      POLICY_FEATURES.browserReads,
      built
        ? "src/lib/browserHttp.ts exists: turn POLICY_FEATURES.browserReads on (src/lib/site.ts), check the privacy policy's \"Reading your league\" (fact 1) against the code, and update its LAST_UPDATED"
        : "POLICY_FEATURES.browserReads is on, but there's no src/lib/browserHttp.ts: the pages would describe browser reading that isn't built",
    ).toBe(built);
    if (!built) return;
    // "Your browser sends them no cookies with these requests."
    expect(source("src/lib/browserHttp.ts")).toMatch(/credentials:\s*["']omit["']/);
    // "Your browser then sends our server only the parts …" and "your browser sends the league it saved to our server".
    expect(exists("src/app/api/_lib/upload.ts")).toBe(true);
    expect(exists("src/server/importToken.ts")).toBe(true);
  });

  it("anonymous feedback (track FB) is described exactly when the feedback route exists, with the code its sentences rest on", () => {
    const built = exists("src/app/api/feedback/route.ts");
    expect(
      POLICY_FEATURES.anonymousFeedback,
      built
        ? "src/app/api/feedback/route.ts exists: turn POLICY_FEATURES.anonymousFeedback on (src/lib/site.ts), check the privacy policy's \"Anonymous feedback\" (fact 4), the terms and the feedback page against the code, and update LAST_UPDATED"
        : "POLICY_FEATURES.anonymousFeedback is on, but there's no src/app/api/feedback/route.ts: the pages would describe feedback that isn't sent",
    ).toBe(built);
    if (!built) return;
    expect(exists("src/lib/feedbackShare.ts")).toBe(true);
    // "turn off “Share anonymous feedback” on the Settings page"
    expect(sourcesUnder("src/components/settings", "src/app/settings").some((s) => s.includes("Share anonymous feedback"))).toBe(true);
    // "We keep at most the newest 100 a day … a year after the last one that day." (one list per day since the final
    // review's SEC-3)
    const sink = source("src/server/feedbackSink.ts");
    expect(sink).toMatch(/feedbackLimits\.maxPerDay/);
    expect(sink).toMatch(/feedbackLimits\.retainDays/);
    expect(sink).toMatch(/fb:\$\{new Date\(at\)\.toISOString\(\)\.slice\(0, 10\)\}/);
  });
});

describe("privacy page, whichever features are on", () => {
  it.each(ALL)("is dated %o, and ends with the contact line: a visible placeholder until there's an address", (f) => {
    const { text } = privacy(f);
    expect(PRIVACY_LAST_UPDATED).toBe("October 4, 2026");
    expect(text).toContain("Last updated October 4, 2026");
    expect(CONTACT_EMAIL).toBeNull();
    expect(text).toContain(`Contact: ${CONTACT_PENDING}`);
    expect(CONTACT_PENDING).toBe("to be added before launch");
  });

  it.each(ALL)("%o: says where the server's copies are kept, under keys that hide league IDs, and that a server's memory holds them no longer than it runs (fact 2, review PG-6)", (f) => {
    const { text } = privacy(f);
    expect(text).toContain(
      "These copies are kept at Upstash, the database service we use through Vercel, in its US East region, each filed under a code made with a secret key only our server has, so league IDs and usernames never appear in the database's keys, and each copy is encrypted with another such key before it is stored, so Upstash holds only text it can't read. Upstash deletes each copy when its time is up. Our servers may also hold copies in their memory: a server stops using a copy when its time is up and deletes it soon after while it keeps running, and everything in its memory is gone when it shuts down.",
    );
    // The old promise was stronger than the memory tier keeps (an idle server clears nothing until it runs again).
    expect(text).not.toContain("never longer than the times above");
    expect(text).toContain("up to a week, so a saved copy can stand in if a source is down");
    expect(text).toContain("filed under codes that hide league IDs, then deletes them.");
  });

  it.each(ALL)("%o: says closed weeks' transactions and matchups may be kept 6 hours, as both platforms' imports keep them (review PG-5)", (f) => {
    const { text } = privacy(f);
    expect(TTL.closedTransactions / HOUR).toBe(6);
    expect(text).toContain("Transactions and matchups from weeks that ended more than a week ago rarely change, so they may be kept for up to 6 hours.");
    // Sleeper's import keeps both a closed week's matchups and its transactions that long (CLOSED_WEEK_POLICY, pinned by
    // src/adapters/sleeper/fetch.test.ts); ESPN's keeps its transactions (src/adapters/espn/fetch.ts closedCache).
    // The ESPN cookies' Forget line names transactions only: ESPN's matchups come with the league itself (10 minutes).
    expect(text).toContain("deletes the cookie right away. League data our server copied with it expires within about 10 minutes (older weeks' transactions within 6 hours)");
  });

  it.each(ALL)("%o: says the request counts use codes made from the IP address and its block with a secret key, kept at Upstash one window, and the day's counts until the day ends, from limits.ts (fact 3; reviews PG-6, SEC-4, POL-1, POL-17, F2)", (f) => {
    const { text } = privacy(f);
    expect([rateLimits.import.windowS, rateLimits.model.windowS, rateLimits.session.windowS, rateLimits.feedback.windowS]).toEqual([600, 600, 600, 3600]);
    // The day's counts (src/server/budget.ts): the shares of the server's requests to ESPN and Sleeper only, the work
    // budget and the feedback copies, each key kept until the UTC day ends and a minute (the next test checks it against
    // the code).
    expect(Object.keys(budgets.perClientPerDay).sort()).toEqual(["espn", "sleeper"]);
    expect([budgets.clientKeyMarginMs, workLimits.keyMarginMs]).toEqual([60_000, 60_000]);
    expect(DAY_COUNT_DELETED).toBe("a minute after the day ends (midnight UTC)");
    const longest = f.anonymousFeedback ? "an hour" : "10 minutes";
    expect(text).toContain(
      `To keep things fair, our server counts requests under codes made from your IP address, and from the block of nearby addresses it's in, with a secret key, never the addresses themselves. The counts it keeps at Upstash are deleted within ${longest}, or for a count of the whole day, a minute after the day ends (midnight UTC).`,
    );
    expect(text).toContain(
      `, and how much it does in a day for one visitor and for the block of nearby addresses the visitor's address is in: the work of importing leagues and working out League pages, ${f.anonymousFeedback ? "the requests it makes to ESPN or Sleeper, and the anonymous feedback copies it takes" : "and the requests it makes to ESPN or Sleeper"}. It counts these under codes made from your IP address and from that block, each with a secret key, never the addresses themselves: without that key, a code can't be turned back into an address. Each short-window count kept at Upstash is deleted one window after it starts, so within ${longest}; each day's count, a minute after the day ends (midnight UTC). A count a server holds in its memory is deleted soon after its window or day ends while that server keeps running, and is gone when it shuts down.`,
    );
    expect(text).not.toContain("deleted when their window ends");
    // Review POL-17: an HMAC of an IP address can be undone by whoever holds the key (try every address), so not "one-way".
    expect(text).not.toContain("one-way code");
    // Review POL-1: the day's counts were missing, and every count read as gone within the window.
    expect(text).not.toContain(`The counts it keeps at Upstash are deleted within ${longest}.`);
  });

  it("the day's counts are deleted as the page says: src/server/budget.ts keeps each key under a visitor's or a block's code until the UTC day ends and a minute (reviews SEC-4, POL-1, F2)", async () => {
    // 00:05 UTC, the day's first requests: each key lives almost a whole day, never an hour.
    const now = Date.UTC(2026, 9, 4, 0, 5, 0);
    const dayEnd = msUntilUtcMidnight(now);
    expect(dayEnd + 60_000).toBe(23 * 60 * 60_000 + 55 * 60_000 + 60_000);
    // The shares of the server's requests to ESPN and Sleeper (per block of addresses).
    const shares = new FakeRedis(() => now);
    const budget = createBudget({ redis: shares, prefix: "os:test:", perClient: budgets.perClientPerDay });
    for (const platform of ["espn", "sleeper"] as const) expect(await budget.take(platform, now, "group-hmac")).toBe("ok");
    const shareKeys = shares.keys().filter((k) => k.includes("budget:client:"));
    expect(shareKeys).toHaveLength(2);
    for (const key of shareKeys) expect(shares.ttlMs(key)).toBe(dayEnd + budgets.clientKeyMarginMs);
    // The work budget and the feedback copies (per visitor and per block), as the process's own quotas are made.
    for (const quota of [
      { name: "work", perClient: workLimits.perClientPerDay, perGroup: workLimits.perGroupPerDay, perDay: workLimits.perDay },
      { name: "fbq", perClient: feedbackLimits.perClientPerDay, perGroup: feedbackLimits.perGroupPerDay },
    ]) {
      const redis = new FakeRedis(() => now);
      const q = createDailyQuota({ ...quota, redis, prefix: "os:test:" });
      expect(await q.charge(1, { client: "client-hmac", group: "group-hmac" }, now)).toBe("ok");
      const keys = redis.keys().filter((k) => k.includes("client-hmac") || k.includes("group-hmac"));
      expect(keys).toHaveLength(2);
      for (const key of redis.keys()) expect(redis.ttlMs(key)).toBe(dayEnd + workLimits.keyMarginMs);
    }
  });

  it.each(ALL)("%o: says what the logs keep and for how long: Vercel's hour, our own 14 days, never league data (fact 5)", (f) => {
    const { text } = privacy(f);
    expect(logLimits.retainDays).toBe(14);
    expect(text).toContain(
      "keeps a log of the requests it serves for Offer Sheet for 1 hour on our plan: the method, the web address and its query, the status, the type of browser and the region. Vercel can see IP addresses.",
    );
    expect(text).toContain("Our own error log keeps, for up to 14 days, only when something went wrong, which part of Offer Sheet had the problem and what kind");
    expect(text).toContain("Never league data, names, IDs, usernames, cookies or IP addresses.");
  });

  it.each(ALL)("%o: says Offer Sheet is independent of every service it reads or names, as the footer does, and links the terms", (f) => {
    const { html, text } = privacy(f);
    expect(text).toContain(
      "Offer Sheet is an independent project, not affiliated with or endorsed by ESPN, Sleeper, Yahoo, Fleaflicker, MyFantasyLeague, Fantrax, FantasyCalc, DynastyProcess or the NFL. See also the terms of use .",
    );
    expect(links(html).filter((l) => l.href === "/terms").map((l) => l.text)).toEqual(["terms of use"]);
  });

  it.each(ALL)("%o: the footer, the privacy page and the terms name the same services Offer Sheet isn't affiliated with (review POL-23)", (f) => {
    const named = (sentence: string, lead: string) => {
      const from = sentence.indexOf(lead);
      expect(from, `"${lead}" in: ${sentence}`).toBeGreaterThanOrEqual(0);
      const rest = sentence.slice(from + lead.length);
      return rest
        .slice(0, rest.indexOf("."))
        .split(/, | or /)
        .map((s) => s.replace(/^the /, "").trim());
    };
    const footer = named(FOOTER_INDEPENDENT, "affiliated with or endorsed by ");
    expect(footer).toContain("DynastyProcess");
    expect(named(privacy(f).text, "not affiliated with or endorsed by ")).toEqual(footer);
    expect(named(terms(f).text, "affiliated with, endorsed by or sponsored by ")).toEqual(footer);
  });

  it.each(ALL)("%o: names the providers and links their privacy policies (fact 6)", (f) => {
    const { html, text } = privacy(f);
    const external = links(html).filter((l) => l.href?.startsWith("https://"));
    expect(external.map((l) => [l.href, l.text])).toEqual([
      ["https://vercel.com/legal/privacy-policy", "Vercel's privacy policy"],
      ["https://upstash.com/trust/privacy.pdf", "Upstash's privacy policy"],
    ]);
    for (const l of external) expect(l.attrs).toContain('rel="noopener noreferrer"');
    expect(text).toContain(
      f.anonymousFeedback
        ? "Upstash keeps our server's copies, the request counts, the anonymous feedback and the error log"
        : "Upstash keeps our server's copies, the request counts and the error log",
    );
    // Review POL-6: where the server runs (vercel.json: the functions' one region, iad1, Washington, D.C.).
    expect((JSON.parse(source("vercel.json")) as { regions?: string[] }).regions).toEqual(["iad1"]);
    expect(text).toContain("Vercel hosts Offer Sheet and runs its server, in Vercel's US East region near Washington, D.C. ( Vercel's privacy policy ).");
  });

  it.each(ALL)("%o: says an installed iPhone app keeps its own saved leagues and settings, the sharing choice too, and Safari's 7 days (fact 7, review POL-16)", (f) => {
    const { text } = privacy(f);
    expect(text).toContain(
      "Safari may delete what a site saved in your browser, your saved leagues, settings and feedback included, after you use Safari for 7 days without visiting Offer Sheet.",
    );
    expect(text).toContain(
      f.anonymousFeedback
        ? "If you add Offer Sheet to your Home Screen, the app you open from there keeps its own saved leagues and settings, apart from Safari's, “Share anonymous feedback” included, so import your leagues again inside it, and turn sharing off there too if you want it off."
        : "If you add Offer Sheet to your Home Screen, the app you open from there keeps its own saved leagues and settings, apart from Safari's, so import your leagues again inside it.",
    );
  });

  it.each(ALL)("%o: says leagues are saved in this browser's IndexedDB until removed, with what goes with them, and that credentials never are (Phase 4c)", (f) => {
    const { text } = privacy(f);
    expect(text).toContain(
      "The leagues you import stay saved in this browser, with your team pick, your settings for each, the projections the League page loaded for them and any feedback you give on trade ideas, until you remove a league or clear this site's data.",
    );
    expect(text).toContain("Your browser saves each league you import in its IndexedDB storage (in a database called “offersheet”), next to any other leagues you've imported, until you remove it or clear this site's data.");
    expect(text).toContain("only a short code made from the league's ID, and its season");
    expect(text).toContain("deletes a league from this browser: its import, your team pick, its projections, and its settings and feedback");
    expect(text).toContain("They're never saved with your leagues. A private league you saved stays saved after they're gone, but reading it again needs them again.");
  });

  it.each(ALL)("%o: says what's kept with each league in this browser and how to remove it, the old copies included", (f) => {
    const { text } = privacy(f);
    expect(text).toContain("it's saved with that league, for its latest 500 trade ideas, under the same short code as that league's settings");
    expect(text).toContain("In the file your leagues are only numbered (league-1, league-2)");
    expect(text).toContain(
      "“Reset to defaults” on the Settings page removes a league's settings, “Delete saved feedback” removes all of your feedback, removing a league removes both for that league, and clearing this site's data in your browser removes everything.",
    );
    expect(text).toContain("(“offersheet:settings:v1” and “offersheet:feedback:v1”)");
  });

  it.each(ALL)("%o: says the League page's math and the trade pages run in the browser, and that their links carry only team and player ID numbers (Phase 4)", (f) => {
    const { text } = privacy(f);
    expect(text).toContain("Your browser saves the latest projections and values with the league, and uses them again for up to 6 hours.");
    expect(text).toContain("The League page's math (lineups, needs, trade partners, playoff odds) runs in your browser; your league isn't sent to anyone else to be analyzed.");
    expect(text).toContain("The Trade Finder and the Trade Analyzer use the same projections and values, kept and fetched the same way, and they search for and score trades in your browser too.");
    expect(text).toContain(
      "carries only that team's ID number and the players' ID numbers in its web address (never names or your league's ID; a trade opened from “If they say no, try” also says so there)",
    );
    expect(text).toContain("Offer Sheet never loads these addresses ahead of time, so our server sees one only when you open it, like any web address.");
  });

  it.each(ALL)("%o: says exactly what the Sleeper and FantasyCalc requests carry: shaped by the league's season, lineup and format, never by names or IDs", (f) => {
    const { text } = privacy(f);
    expect(text).toContain(
      "Sleeper's projection and stats requests carry only the season, week numbers up to your league's last playoff week, and the positions your league starts (for example, whether it uses a kicker or IDP).",
    );
    expect(text).toContain("The FantasyCalc request carries only your league's format");
    expect(text).toContain(
      "They never carry names or IDs. The other requests (player lists, player ID maps and the NFL schedule) don't depend on your league at all (the schedule only on the season), so nothing about you or your league is sent with them.",
    );
  });

  it.each(ALL)("%o: says FantasyCalc's lists are kept longer, and what an old one is used for, with config's numbers", (f) => {
    const { text } = privacy(f);
    const m = config.market;
    expect([FANTASYCALC_OUTAGE_HOLD_MS, FANTASYCALC_OUTAGE_MAX_HOLD_MS]).toEqual([5 * 60_000, 15 * 60_000]);
    expect(text).toContain(
      `FantasyCalc's trade value lists (public too, one per league format, not about any one league): up to ${m.fantasyCalcCurveDays} days. Once FantasyCalc answers, we don't ask it for that list again for a day. If it doesn't answer, we wait 5 minutes before asking it again (up to 15 while it stays down), and the newest saved list stands in for up to ${m.fantasyCalcStaleDays} days; after that, an older one is used only to work out our own estimates of trade values until FantasyCalc is back.`,
    );
    expect(text).not.toContain("at most once a day");
  });

  it.each(ALL)("%o: describes the SWID pseudonyms, espn_s2 and the 12-hour seal exactly", (f) => {
    const { text } = privacy(f);
    expect(text).toContain("replaces every member ID with a one-way pseudonym, so the saved copy holds no SWIDs");
    expect(text).toContain("Your espn_s2 cookie is never stored on our server or written to logs");
    expect(text).toContain("stops working after 12 hours");
  });

  it.each(ALL)("%o: says the ESPN cookies reach our server once in plain and then inside the encrypted cookie with every request, opened only to read the league (review POL-25)", (f) => {
    const { text } = privacy(f);
    // src/server/session.ts: the sealed cookie's Path is "/", so the browser sends it with every request to the site.
    expect(source("src/server/session.ts")).toMatch(/path:\s*"\/"/);
    expect(text).toContain("You type them into Offer Sheet once, and they travel to our server inside that request, never in a web address.");
    expect(text).toContain("Your browser sends that encrypted cookie back with each request to Offer Sheet, as browsers do with a site's cookies.");
    expect(text).toContain("Our server opens the encrypted cookie only to read your league, and sends your ESPN cookies only to ESPN.");
    expect(text).toContain(
      "If you connect with ESPN cookies, they're kept only in an encrypted cookie in your browser for this session. Our server opens it only to read your league, and sends them only to ESPN. They're never saved with your leagues.",
    );
    for (const claim of ["They travel from your browser to our server once", "only ever sent to ESPN"]) expect(text).not.toContain(claim);
  });

  it.each(ALL)("%o: says the error log keeps the time too, for up to 14 days (review POL-15)", (f) => {
    const { text } = privacy(f);
    // src/server/log.ts: each stored entry carries the time it was logged (`at`), and a day's list goes
    // logLimits.retainDays after the day began.
    expect(Object.keys(StoredLogEventSchema.shape)).toContain("at");
    expect(text).toContain(
      "Our own error log keeps, for up to 14 days, only when something went wrong, which part of Offer Sheet had the problem and what kind: an error code, the data source involved (ESPN or Sleeper, for example), the status it answered with, the error's type and how long the request took.",
    );
  });

  it.each(ALL)("%o: names whom it shares data with instead of saying it shares none (review POL-18)", (f) => {
    const { text } = privacy(f);
    expect(text).toContain(
      "No accounts, no ads and no tracking or analytics. We don't sell your data or share it with anyone but the services that run Offer Sheet and the sites it reads for you (below), and we don't build profiles of you or your leaguemates.",
    );
    expect(text).not.toContain("We don't sell or share your data");
  });
});

describe("privacy page without browser reading (today: our server reads every league)", () => {
  it.each(WITHOUT_BROWSER)("%o: says our server reads the league, and gets only what it needs to read it again", (f) => {
    const { text } = privacy(f);
    expect(text).toContain(
      "Our server reads your league from ESPN or Sleeper and scores each player's projections with your league's rules. The League page's math (lineups, needs, trade partners, playoff odds), the trade search and the Trade Analyzer all run in your browser.",
    );
    expect(text).toContain(
      "What's saved is read only in your browser: our server gets only what it needs to read a league again (its ID and season, and a Sleeper username you entered).",
    );
    expect(text).toContain(
      "When you connect a league, our server reads it from ESPN or Sleeper (a private ESPN league with the ESPN cookies you give it, below), turns it into the Import Report with public data it keeps itself, such as player lists and projections, and sends that to your browser.",
    );
    expect(text).toContain(
      "When you open the League page, our server reads your league again (usually from its short-lived copy) along with the projections and trade values for its players, and scores the projections with your league's scoring rules.",
    );
    expect(text).toContain("League data (settings, rosters, schedule and transactions): about 10 minutes.");
    expect(text).toContain("A Sleeper username lookup (which leagues that username is in): 10 minutes.");
    expect(text).toContain(
      "Sleeper leagues are public. If you enter a username, our server uses it only to look up your leagues and find your team, and keeps that lookup for 10 minutes.",
    );
    expect(text).toContain("Our server keeps copies of what it reads for a limited time (league data for about 10 minutes), filed under codes that hide league IDs, then deletes them.");
  });

  it.each(WITHOUT_BROWSER)("%o: says nothing of the browser reading leagues, or of what it sends", (f) => {
    const { text } = privacy(f);
    for (const claim of ["Your browser reads public ESPN leagues", "your browser reads it straight from ESPN or Sleeper", "your browser sends the league it saved", "your browser asks Sleeper", "League data your browser sends", "the league data your browser sends"]) {
      expect(text).not.toContain(claim);
    }
  });

  it.skipIf(POLICY_FEATURES.browserReads)("while the pages say so, the League page's requests carry only the league's ID and season and a Sleeper username (src/lib/api.ts)", () => {
    const api = source("src/lib/api.ts");
    const body = (name: string) => /\{([^}]*)\}/.exec(api.slice(api.indexOf(`export interface ${name}`)))?.[1] ?? "";
    const fields = (name: string) => [...body(name).matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]);
    const why = "the League page now sends more than the league's ID, season and username: turn POLICY_FEATURES.browserReads on if browser reading is built, else update the privacy policy's short version";
    expect(fields("EspnModelBody"), why).toEqual(["leagueId", "season", "refresh"]);
    expect(fields("SleeperModelBody"), why).toEqual(["season", "leagueId", "username", "refresh"]);
  });
});

describe("privacy page with browser reading (track BF)", () => {
  it.each(WITH_BROWSER)("%o: says the browser reads public ESPN and Sleeper leagues itself, what ESPN and Sleeper see, and that no cookies go with it (fact 1)", (f) => {
    const { text } = privacy(f);
    expect(text).toContain(
      "Your browser reads public ESPN leagues and Sleeper leagues straight from ESPN and Sleeper, and sends our server only the parts Offer Sheet needs. Our server still reads some leagues itself: private ESPN leagues and any other ESPN league you import with ESPN cookies, and any league your browser can't read or whose saved copy our server can't use.",
    );
    expect(text).toContain(
      "Like any site your browser talks to, they see your IP address, which league (or Sleeper username) your browser asks for, and that the request comes from Offer Sheet. Your browser sends them no cookies with these requests.",
    );
    expect(text).toContain("Our server uses what your browser sends for that one request: it never saves it.");
    // What the upload holds (track BF: src/adapters/upload.ts trimEspnBody and trimSleeperBody, Sleeper's traded picks and
    // drafts among them (review POL-14), the Sleeper username's lookup for the user's team; src/lib/leagueFetch.ts never
    // sends a username's list of leagues).
    expect(text).toContain(
      "(the league's settings, teams and owners' names, rosters, schedule and results, and transactions; for ESPN also its free agents, projections and injured players' expected return dates; for Sleeper also its traded draft picks and drafts, and the username you entered, which finds your team)",
    );
    expect(text).toContain("If your browser can't reach ESPN or Sleeper (some ad blockers and work or school networks stop it), our server reads the league itself instead.");
    // Review POL-12: a league imported with ESPN cookies stays the server's to read (src/lib/modelStore.ts modelPlan, the
    // Import Report's Refresh: ImportResponse.usedEspnCookies), even after the cookies are forgotten; one imported without
    // them is read by the browser even while they're connected.
    expect(text).toContain(
      "It does the same for private ESPN leagues and any other ESPN league you import while you're connected with your ESPN cookies (below), and it keeps reading such a league itself, even after you forget the cookies.",
    );
    expect(text).not.toContain("while you're connected with ESPN cookies (a private ESPN league needs them)");
  });

  it.each(WITH_BROWSER)("%o: lists every league our server still reads itself, and never keeps what the browser sends (fact 2; reviews PG-1, POL-12)", (f) => {
    const { text } = privacy(f);
    expect(text).toContain(
      "League data our server reads itself (private ESPN leagues and any other ESPN league you import with ESPN cookies, any league your browser couldn't read, and any league whose saved copy our server couldn't use): about 10 minutes.",
    );
    expect(text).toContain("A Sleeper username lookup our server makes (which leagues that username is in): 10 minutes.");
    expect(text).toContain("League data your browser sends our server is never among these copies.");
    expect(text).toContain(
      "Our server keeps copies of what it reads itself for a limited time (league data for about 10 minutes), filed under codes that hide league IDs, then deletes them. It never keeps the league data your browser sends it.",
    );
    expect(text).not.toContain("What's saved is read only in your browser");
  });

  it.each(WITH_BROWSER)("%o: says the League page sends the saved league back, read again first when its copy is over 10 minutes old, and when the server reads it itself", (f) => {
    const { text } = privacy(f);
    // Review POL-11: a league saved before browser reading is over 10 minutes old, so the browser reads it again first;
    // the server reads it itself when it can't check the signature (src/server/importToken.ts: keys changed, too old).
    expect(text).toContain(
      "When you open the League page, your browser sends the league it saved to our server (reading it again first when its copy is more than 10 minutes old), and our server adds the projections and trade values for its players and scores the projections with your league's scoring rules. If our server can't check the copy your browser sends (after Offer Sheet's keys change, for example), it reads the league itself.",
    );
    expect(text).not.toContain("one saved before Offer Sheet read leagues in your browser");
    // The model routes' memory (src/app/api/model/memo.ts; the final review's SEC-1): the answer built from a signed import,
    // in the instance's memory only, until the token stops being good (its issue time plus tokenMaxAgeMs).
    expect(browserFetchLimits.tokenMaxAgeMs).toBe(15 * 60_000);
    for (const handler of ["src/app/api/model/espn/handler.ts", "src/app/api/model/sleeper/handler.ts"]) {
      expect(source(handler)).toMatch(/memo\(\)\.set\([^)]*issuedAt \+ browserFetchLimits\.tokenMaxAgeMs/);
    }
    expect(source("src/app/api/model/memo.ts")).toContain("never in Redis");
    expect(text).toContain(
      "So that the same copy sent again doesn't cost it the same work twice, a server keeps the projections and values it worked out from it in its memory, never at Upstash: it stops using them when that copy stops being good, 15 minutes after Offer Sheet read the league, and deletes them soon after while it keeps running.",
    );
    expect(text).toContain("If you enter a username, your browser asks Sleeper which leagues it's in, to find your leagues and your team (if your browser can't reach Sleeper, our server asks instead and keeps that lookup for 10 minutes).");
    // Review POL-13: the username goes with the League page's requests too (src/lib/leagueFetch.ts signedModelBody,
    // src/lib/modelStore.ts modelRequest).
    expect(text).toContain(
      "Your browser sends the username to our server with the league you import, and whenever the League page asks for that league's numbers, only to find your team there. It saves the username with each league you import with it, so it can find your team again.",
    );
  });
});

describe("privacy page without anonymous feedback (today: feedback stays in the browser)", () => {
  it.each(WITHOUT_FEEDBACK)("%o: says settings and feedback never leave the browser, and names no feedback the server keeps", (f) => {
    const { html, text } = privacy(f);
    expect(text).toContain("These are saved with each league in this browser's IndexedDB storage, so they're there the next time you use Offer Sheet. They're read only in your browser and never sent to our server.");
    for (const claim of ["Anonymous feedback", "anonymous copy", "Share anonymous feedback", "an hour for feedback", "a month, at Upstash", "turn sharing off"]) expect(text).not.toContain(claim);
    expect(text).toContain(
      "our server limits how many requests one visitor can send in 10 minutes, and how much it does in a day for one visitor and for the block of nearby addresses the visitor's address is in: the work of importing leagues and working out League pages, and the requests it makes to ESPN or Sleeper.",
    );
    expect(links(html).filter((l) => l.href === "/settings" || l.href === "/feedback")).toEqual([]);
  });
});

describe("privacy page with anonymous feedback (track FB)", () => {
  it.each(WITH_FEEDBACK)("%o: lists what the anonymous copy holds and never holds, the day it arrived, how long it's kept, and how to turn it off (fact 4)", (f) => {
    const { html, text } = privacy(f);
    expect(text).toContain(
      "When you mark what happened to a trade idea or report a problem with it, your browser also sends Offer Sheet an anonymous copy, to help improve it: never your league's ID, names, usernames or the notes you type. You can turn this off in Settings.",
    );
    // Review POL-8: "Player info is wrong" and "League settings look wrong" reports go to the adapters' bug queue too
    // (CLAUDE.md §11 "How the data is used"), so not "only to improve how Offer Sheet estimates trades".
    expect(text).toContain("Unless you turn it off, it also sends Offer Sheet an anonymous copy, used only to improve Offer Sheet: how it estimates trades, and anything it reads or shows wrong.");
    for (const field of [
      // Review POL-10: each copy is the record as it stands (src/lib/feedbackShare.ts feedbackEventOf), and clearing sends one
      // without what was cleared.
      "the trade idea's outcome and report reason as they stand after your press (when you clear one, a copy without it follows, so the earlier copies no longer count), and which version of the idea you sent;",
      "the platform (ESPN or Sleeper), the season and the week;",
      "your league's format: the number of teams, whether it's redraft, keeper or dynasty, the points per catch and per passing touchdown, any tight-end premium, whether it starts a second quarterback, how many of each lineup slot it starts, and how many teams make the playoffs;",
      "your “What matters most” setting;",
      // Review FB-R7: the version sent, when it isn't the card's trade (src/lib/feedbackShare.ts versionTrade).
      "the players in the trade, and in the version you sent when it differs, as ID numbers with their positions;",
      // Review POL-9: the sent version's own estimate and inputs (feedbackShare.ts versionAccept, versionInputs).
      "for the version you sent: Offer Sheet's estimate for it, and what that estimate and its score were worked out from;",
      "a random code your browser makes for that one record",
    ]) {
      expect(text).toContain(field);
    }
    expect(text).not.toContain("what you pressed (the outcome, or the report's reason)");
    // The server adds the day it arrived (review PG-1).
    expect(text).toContain("Our server stores it with the day it arrived (the date, not the time).");
    expect(text).toContain(
      "It never holds your league's ID, team IDs, team or owner names, usernames, ESPN member IDs (SWIDs), cookies, the code your browser files your league under, or any note you type: notes stay in your browser.",
    );
    // One list per day of arrival since the final review's SEC-3 (src/server/feedbackSink.ts feedbackDayKey).
    expect([feedbackLimits.maxPerDay, feedbackLimits.retainDays]).toEqual([100, 365]);
    expect(text).toContain("We keep at most the newest 100 a day, at Upstash, and delete each day's feedback a year after the last one that day.");
    expect(text).not.toContain("a month, at Upstash");
    // Reviews FB-R2, POL-4: scripts/feedback-pull.ts writes one file a month and deletes a month's file on its first run a
    // year after that month's newest copy (pruneFeedbackFiles), and nothing between runs, so the page commits to a run at
    // least once a month: a month's older days stay up to a month longer than in the store, plus the gap between runs.
    expect(source("scripts/feedback-pull.ts")).toMatch(/data-local\/feedback-server\/<env>\/<YYYY-MM>\.json/);
    expect(text).toContain(
      "Offer Sheet's developer downloads it from there to study it, at least once a month, and keeps each month's download until a year after that month's last copy, deleting it at the first download after that, so a downloaded copy is kept at most about two months longer than at Upstash.",
    );
    expect(text).not.toContain("on the same schedule");
    // Reviews FB-R3, POL-3, SEC-6: every copy carries its record's random code, but only the browser (and an export) knows
    // whose it is; the players, the format and the week could still point to a public league. Delete recalls nothing sent.
    // The feedback route's daily copy quota (src/server/budget.ts feedbackQuota) counts copies per visitor and block until
    // the day ends: said, so "nothing ties it to you" doesn't overclaim.
    expect(text).toContain(
      "Offer Sheet stores nothing with a copy that ties it to you: no IP address, account, league ID or name. (The day's limit on copies counts them under codes made from your IP address and its block, above, and those counts are deleted a minute after the day ends (midnight UTC).) Each copy carries its record's random code, but only your browser (and any file you save with “Export feedback”) keeps that code with your feedback, so only someone with your browser or that file could match copies to you by it. Still, the players in a trade, with your league's format and the week, could lead someone who searched public leagues to yours. Offer Sheet never tries to match copies to anyone. Turning sharing off stops new copies; deleting your saved feedback doesn't take back copies already sent.",
    );
    expect(text).toContain("It includes each record's random code, which matches it to its anonymous copies.");
    // Review POL-7: the month cap can drop copies sooner, and the downloads hold some too.
    expect(text).toContain("Anonymous copies already sent aren't affected: they're deleted on their own schedule (above).");
    for (const claim of ["isn't linked to you", "no way to pick out yours", "can't tell which copies are yours", "stays only in your browser", "for their year"]) expect(text).not.toContain(claim);
    expect(text).toContain("To stop sending it, turn off “Share anonymous feedback” on the Settings page");
    expect(links(html).filter((l) => l.href === "/settings")).toHaveLength(1);
    expect(text).toContain(
      "Your settings never leave your browser, except your “What matters most” setting in the anonymous feedback above. Your feedback stays here too, apart from that anonymous copy, which leaves out your notes.",
    );
    expect(text).not.toContain("They're read only in your browser and never sent to our server.");
    expect(text).toContain("(10 minutes for imports, the League page and ESPN cookies, an hour for feedback)");
    expect(countedKinds(f)).toContain("feedback");
    // Track FB: the saved record keeps the random code its copies carry (src/lib/feedbackStore.ts FeedbackRecord.rid), and
    // the week, season and goal its numbers were computed for (FeedbackRecord.basis, VersionInputs.week; review FB-R6).
    expect(text).toContain(
      "along with your “What matters most” setting. It also keeps the week and season Offer Sheet's numbers were worked out for, your “What matters most” setting for the trade's own numbers, and the random code its anonymous copies carry (above).",
    );
  });

  it.each(WITHOUT_FEEDBACK)("%o: says nothing of a random code, downloads or copies already sent", (f) => {
    const { text } = privacy(f);
    for (const claim of ["random code", "downloads it", "copies already sent", "week and season"]) expect(text).not.toContain(claim);
  });
});

describe("terms page (Part B, B3)", () => {
  it.each(ALL)("%o: is dated, has the outline's sections in order, and ends with the contact line", (f) => {
    const { html, text } = terms(f);
    expect(TERMS_LAST_UPDATED).toBe("October 4, 2026");
    expect(text).toContain("Last updated October 4, 2026");
    const headings = [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1]);
    expect(headings).toEqual([
      "What Offer Sheet is",
      "Estimates, not promises",
      "Where the data comes from",
      "Not affiliated",
      "Your part",
      "Feedback",
      "A beta can change",
      "No warranty",
      "Changes and contact",
    ]);
    expect(text.trim().endsWith(`Contact: ${CONTACT_PENDING}`)).toBe(true);
  });

  it.each(ALL)("%o: says what Offer Sheet is: free, non-commercial, a beta, read-only, no accounts", (f) => {
    expect(terms(f).text).toContain(
      "Offer Sheet is a free, non-commercial project, offered as a beta. It reads your fantasy football league and suggests trades. It only reads: it never sends offers, changes lineups or posts anything for you. There are no accounts, no ads and nothing to buy.",
    );
  });

  it.each(ALL)("%o: says the numbers are estimates and the decisions are yours, and names the sources it reads, the NFL schedule ESPN's (review PG-2)", (f) => {
    const { text } = terms(f);
    // Review POL-21: the league's own records, points and settings are the platform's, not estimates.
    expect(text).toContain("The numbers Offer Sheet works out or quotes are estimates: projections, playoff and title odds, “Helps you”, “Chance they accept” and “Overall”, and the trade values it shows.");
    expect(text).not.toContain("Every number Offer Sheet shows is an estimate");
    expect(text).toContain("You decide what to offer and what to accept, and those decisions are yours.");
    expect(text).toContain("ESPN's league data comes through an unofficial interface that ESPN doesn't support, so it can change or stop working at any time.");
    expect(text).toContain("trade values from FantasyCalc, player ID maps from DynastyProcess, and the NFL schedule from ESPN.");
    expect(text).toContain("It is not affiliated with, endorsed by or sponsored by ESPN, Sleeper, Yahoo, Fleaflicker, MyFantasyLeague, Fantrax, FantasyCalc, DynastyProcess or the NFL.");
    // The app downloads nothing from nflverse (src/data/nflSchedule.ts reads ESPN's schedule).
    expect(text).not.toContain("nflverse");
  });

  it.each(ALL)("%o: asks users to connect only their own or public leagues, keep cookies private, not scrape or resell values", (f) => {
    const { text } = terms(f);
    // Review POL-22 (Parker's call at Checkpoint 7a): Sleeper leagues are public by design, so "made public" read oddly.
    expect(text).toContain("connect only leagues you're in, or public ones (any Sleeper league, or an ESPN league its manager made viewable to the public);");
    expect(text).toContain("keep your ESPN cookies to yourself: they work like a password");
    expect(text).toContain("not scrape Offer Sheet, point automated tools at it, overload it, or get around its limits;");
    expect(text).toContain("not sell, republish or reuse its trade values or other data, commercially or in bulk.");
  });

  it.each(ALL)("%o: says saved leagues stay until removed or the browser clears them, as the privacy page explains (review PG-7), and that there's no warranty", (f) => {
    const { text } = terms(f);
    expect(text).toContain("The leagues you saved stay in your browser until you remove them or your browser clears them (the privacy policy says when).");
    expect(text).toContain("Offer Sheet is provided “as is”, without warranties of any kind.");
  });

  it.each(WITHOUT_FEEDBACK)("%o: says feedback stays in the browser (linking the privacy policy), with no opt-out to name", (f) => {
    const { html, text } = terms(f);
    expect(text).toContain("When you mark what happened to a trade idea or report a problem with one, it's saved in your browser only: Offer Sheet doesn't receive it. The privacy policy says what's kept.");
    expect(links(html).map((l) => l.href)).toEqual(["/privacy"]);
    expect(text).not.toContain("anonymous");
  });

  it.each(WITH_FEEDBACK)("%o: says feedback is anonymous with an opt-out (linking the privacy policy and Settings)", (f) => {
    const { html, text } = terms(f);
    expect(links(html).map((l) => l.href)).toEqual(["/privacy", "/settings"]);
    expect(text).toContain("Offer Sheet may use an anonymous copy to improve its estimates and fix what it gets wrong.");
    // Review POL-9: the privacy policy lists what's sent, summarizing some of it, so not "exactly".
    expect(text).toContain("The privacy policy says what's sent.");
    expect(text).not.toContain("exactly");
    expect(text).toContain("You can turn it off in Settings .");
  });
});

describe("feedback page (Part B, B3)", () => {
  it.each(ALL)("%o: explains the buttons on every trade idea, and has no form (nothing the public types is stored on the server), only the contact line", (f) => {
    const { html, text } = feedback(f);
    expect(text).toContain("Each trade idea on the Trade Finder and the Trade Analyzer has buttons for what happened: Sent, Accepted, Rejected and Countered.");
    // Review POL-20: the button reads "Report a problem", and its note goes with any reason.
    expect(source("src/components/trades/FeedbackControls.tsx")).toContain("Report a problem<span");
    expect(text).toContain(
      "If something looks wrong, press “Report a problem” and pick a reason (Doesn't help me, They'd never accept, Player info is wrong, League settings look wrong, or Other), and add a note if you like.",
    );
    expect(text).toContain("Every press is saved with that league in this browser.");
    expect(html).not.toMatch(/<(form|textarea|input)\b/);
    expect(text).toContain(`Contact: ${CONTACT_PENDING}`);
  });

  it.each(WITHOUT_FEEDBACK)("%o: says presses stay in this browser and nothing is sent, with Export feedback", (f) => {
    const { html, text } = feedback(f);
    expect(text).toContain("Here's how to record what happens to Offer Sheet's trade ideas, and how to reach us.");
    expect(text).toContain("It stays in this browser, notes included: Offer Sheet doesn't receive it.");
    expect(text).toContain("“Export feedback” on the Settings page downloads everything you've saved, notes included, as a file.");
    expect(text).toContain("The privacy policy says what's kept.");
    expect(text).not.toContain("anonymous");
    expect(links(html).map((l) => l.href)).toEqual(["/settings", "/privacy"]);
    expect(feedbackDescription(f)).toBe("How to record what happens to Offer Sheet's trade ideas, and how to reach us.");
  });

  it.each(WITH_FEEDBACK)("%o: says what the anonymous copy holds, that notes stay, and how to turn it off", (f) => {
    const { html, text } = feedback(f);
    expect(text).toContain("Offer Sheet learns from what happens to its trade ideas. Here's how to tell it.");
    expect(text).toContain("A note you type with a report stays in this browser. It's never sent.");
    expect(text).toContain("To stop sending copies, turn off “Share anonymous feedback” on the Settings page");
    expect(text).toContain("Never your league's ID, names or usernames.");
    expect(text).toContain("an anonymous copy also goes to Offer Sheet, to help improve it:");
    // Review POL-9: not "exactly" (the policy summarizes some fields).
    expect(text).toContain("The privacy policy lists what's sent and how long it's kept.");
    expect(text).not.toContain("exactly");
    expect(links(html).map((l) => l.href)).toEqual(["/settings", "/privacy"]);
    // Review POL-19: sharing is on unless turned off, so not "only if you want to".
    expect(feedbackDescription(f)).toBe("How to tell Offer Sheet what happened to its trade ideas, or what went wrong. The copies it gets are anonymous, and you can turn them off.");
  });
});

describe("error pages (Part B, B3: branded)", () => {
  it("not found: says so, with ways back home and to your league as 44 px buttons", () => {
    const html = renderToStaticMarkup(createElement(NotFound));
    expect(textOf(html)).toContain("Page not found There's no page at this address.");
    const out = links(html);
    expect(out.map((l) => [l.href, l.text])).toEqual([
      ["/", "Go to the home page"],
      ["/league", "Open your league"],
    ]);
    for (const l of out) expect(l.attrs).toContain("min-h-11");
  });

  it("an error: a Try again button and the home page, saying saved leagues are safe, never the error's own message", () => {
    const err = Object.assign(new Error("Team of Somebody broke"), { digest: "x" });
    const html = renderToStaticMarkup(createElement(ErrorPage, { error: err, retry: () => undefined }));
    expect(textOf(html)).toContain("Something went wrong Offer Sheet couldn't show this page. Your saved leagues, settings and feedback are still in this browser.");
    expect(html).toMatch(/<button type="button" class="[^"]*min-h-11[^"]*">Try again<\/button>/);
    expect(html).not.toContain("Somebody");
  });

  it("a root layout error: its own document with the site's styles and mark, the same choices", () => {
    const html = renderToStaticMarkup(createElement(GlobalError, { error: new Error("boom"), retry: () => undefined }));
    expect(html.startsWith("<html")).toBe(true);
    expect(html).toContain("<title>Something went wrong · Offer Sheet</title>");
    expect(html).toContain('<svg viewBox="0 0 32 32" aria-hidden="true"');
    expect(textOf(html)).toContain("Something went wrong");
    expect(html).toMatch(/>Try again<\/button>/);
    expect(html).not.toContain("boom");
  });
});

describe("security headers", () => {
  const byKey = (headers: Array<{ key: string; value: string }>) => Object.fromEntries(headers.map((h) => [h.key, h.value]));

  it("next.config sends them on every path, without X-Powered-By; outside a production build only framing is limited", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    const rules = (await nextConfig.headers?.()) ?? [];
    expect(rules).toHaveLength(1);
    expect(rules[0]?.source).toBe("/:path*");
    // Vitest isn't a production build: the development set.
    expect(byKey(rules[0]?.headers ?? [])).toEqual(byKey(securityHeaders({ NODE_ENV: "test" })));
    expect(byKey(securityHeaders({ NODE_ENV: "development" }))).toEqual({
      "Content-Security-Policy": "frame-ancestors 'none'",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
    });
    expect(FRAMING_ONLY_CSP).toBe("frame-ancestors 'none'");
  });

  it("a production build sends the full policy: the site's own sources, inline scripts and styles, the two league APIs to connect to, nothing to frame", () => {
    const headers = byKey(securityHeaders({ NODE_ENV: "production" }));
    expect(headers["Content-Security-Policy"]).toBe(
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.sleeper.app https://lm-api-reads.fantasy.espn.com; worker-src 'self'; manifest-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    );
    expect(headers["Content-Security-Policy-Report-Only"]).toBeUndefined();
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Permissions-Policy"]).toBe(PERMISSIONS_POLICY);
    // No eval anywhere (zod runs jitless in the browser), no blob: workers, no upgrade-insecure-requests (the stable copy is http).
    expect(headers["Content-Security-Policy"]).not.toMatch(/unsafe-eval|blob:|upgrade-insecure-requests|vercel\.live/);
    expect(BROWSER_FETCH_ORIGINS).toEqual(["https://api.sleeper.app", "https://lm-api-reads.fantasy.espn.com"]);
    // The clipboard stays allowed: the trade cards' Copy button writes to it.
    expect(PERMISSIONS_POLICY).not.toContain("clipboard");
  });

  it("a Vercel preview build also allows the Vercel Toolbar's sources, and frames only from vercel.live", () => {
    const csp = contentSecurityPolicy({ vercelPreview: true });
    const directives = Object.fromEntries(csp.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)]));
    expect(directives["script-src"]).toEqual(["'self'", "'unsafe-inline'", "https://vercel.live"]);
    expect(directives["connect-src"]).toEqual(["'self'", ...BROWSER_FETCH_ORIGINS, "https://vercel.live", "wss://ws-us3.pusher.com"]);
    expect(directives["img-src"]).toEqual(["'self'", "data:", "https://vercel.live", "https://vercel.com", "blob:"]);
    expect(directives["frame-src"]).toEqual(["https://vercel.live"]);
    expect(directives["font-src"]).toEqual(["'self'", "https://vercel.live", "https://assets.vercel.com"]);
    expect(directives["frame-ancestors"]).toEqual(["'none'"]);
    for (const [name, sources] of Object.entries(VERCEL_TOOLBAR_SOURCES)) for (const s of sources) expect(directives[name]).toContain(s);
    expect(byKey(securityHeaders({ NODE_ENV: "production", VERCEL_ENV: "preview" }))["Content-Security-Policy"]).toBe(csp);
    expect(byKey(securityHeaders({ NODE_ENV: "production", VERCEL_ENV: "production" }))["Content-Security-Policy"]).toBe(contentSecurityPolicy({ vercelPreview: false }));
  });

  it("OFFERSHEET_CSP_REPORT_ONLY=1 reports the full policy instead of enforcing it, while framing stays forbidden", () => {
    const headers = byKey(securityHeaders({ NODE_ENV: "production", OFFERSHEET_CSP_REPORT_ONLY: "1" }));
    expect(headers["Content-Security-Policy"]).toBe("frame-ancestors 'none'");
    // The report-only copy leaves frame-ancestors out (the enforced copy already forbids framing); the rest is the full policy.
    expect(headers["Content-Security-Policy-Report-Only"]).toBe(contentSecurityPolicy({ vercelPreview: false }).replace("; frame-ancestors 'none'", ""));
    expect(headers["Content-Security-Policy-Report-Only"]).not.toContain("frame-ancestors");
    expect(byKey(securityHeaders({ NODE_ENV: "production", VERCEL_ENV: "preview", OFFERSHEET_CSP_REPORT_ONLY: "1" }))["Content-Security-Policy-Report-Only"]).toContain("https://vercel.live");
    // Only a production build has the full policy at all.
    expect(byKey(securityHeaders({ NODE_ENV: "development", OFFERSHEET_CSP_REPORT_ONLY: "1" }))["Content-Security-Policy-Report-Only"]).toBeUndefined();
  });
});
