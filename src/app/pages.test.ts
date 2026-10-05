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
import { CONTACT_EMAIL, CONTACT_PENDING, POLICY_FEATURES, type PolicyFeatures } from "@/lib/site";
import { HOUR, TTL } from "@/server/cache";
import { feedbackLimits, logLimits, rateLimits } from "@/server/limits";
import nextConfig, { BROWSER_FETCH_ORIGINS, FRAMING_ONLY_CSP, PERMISSIONS_POLICY, VERCEL_TOOLBAR_SOURCES, contentSecurityPolicy, securityHeaders } from "../../next.config";
import ErrorPage from "./error";
import { FeedbackGuide, feedbackDescription } from "./feedback/FeedbackGuide";
import FeedbackPage, { metadata as feedbackMetadata } from "./feedback/page";
import GlobalError from "./global-error";
import NotFound from "./not-found";
import Home from "./page";
import { PRIVACY_LAST_UPDATED, PrivacyPolicy, countedKinds } from "./privacy/PrivacyPolicy";
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
    // "We keep at most the newest 5,000 a month … a year after the last one that month."
    const sink = source("src/server/feedbackSink.ts");
    expect(sink).toMatch(/feedbackLimits\.maxPerMonth/);
    expect(sink).toMatch(/feedbackLimits\.retainDays/);
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

  it.each(ALL)("%o: says the rate limits count a one-way code of the IP address, never the address, kept at Upstash one window, from limits.ts (fact 3, review PG-6)", (f) => {
    const { text } = privacy(f);
    expect([rateLimits.import.windowS, rateLimits.model.windowS, rateLimits.session.windowS, rateLimits.feedback.windowS]).toEqual([600, 600, 600, 3600]);
    const longest = f.anonymousFeedback ? "an hour" : "10 minutes";
    expect(text).toContain(`To keep things fair, our server counts requests under a one-way code made from your IP address, never the address itself. The counts it keeps at Upstash are deleted within ${longest}.`);
    expect(text).toContain(
      `It counts them under a one-way code made from your IP address with a secret key, never the address itself. Each count kept at Upstash is deleted one window after it starts, so within ${longest}. A count a server holds in its memory is deleted soon after its window ends while that server keeps running, and is gone when it shuts down.`,
    );
    expect(text).not.toContain("deleted when their window ends");
  });

  it.each(ALL)("%o: says what the logs keep and for how long: Vercel's hour, our own 14 days, never league data (fact 5)", (f) => {
    const { text } = privacy(f);
    expect(logLimits.retainDays).toBe(14);
    expect(text).toContain(
      "keeps a log of the requests it serves for Offer Sheet for 1 hour on our plan: the method, the web address and its query, the status, the type of browser and the region. Vercel can see IP addresses.",
    );
    expect(text).toContain("Our own error log keeps, for 14 days, only which part of Offer Sheet had a problem and what kind");
    expect(text).toContain("Never league data, names, IDs, usernames, cookies or IP addresses.");
  });

  it.each(ALL)("%o: says Offer Sheet is independent of every service it reads or names, as the footer does, and links the terms", (f) => {
    const { html, text } = privacy(f);
    expect(text).toContain(
      "Offer Sheet is an independent project, not affiliated with or endorsed by ESPN, Sleeper, Yahoo, Fleaflicker, MyFantasyLeague, Fantrax, FantasyCalc or the NFL. See also the terms of use .",
    );
    expect(links(html).filter((l) => l.href === "/terms").map((l) => l.text)).toEqual(["terms of use"]);
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
  });

  it.each(ALL)("%o: says an installed iPhone app keeps its own saved leagues, and Safari's 7 days (fact 7)", (f) => {
    expect(privacy(f).text).toContain(
      "Safari may delete what a site saved in your browser, your saved leagues, settings and feedback included, after you use Safari for 7 days without visiting Offer Sheet. If you add Offer Sheet to your Home Screen, the app you open from there keeps its own saved leagues, apart from Safari's, so import your leagues again inside it.",
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
      "Your browser reads public ESPN leagues and Sleeper leagues straight from ESPN and Sleeper, and sends our server only the parts Offer Sheet needs. Our server still reads a league itself while you're connected with ESPN cookies (a private ESPN league needs them), when your browser can't, and when it can't use the copy your browser saved.",
    );
    expect(text).toContain(
      "Like any site your browser talks to, they see your IP address, which league (or Sleeper username) your browser asks for, and that the request comes from Offer Sheet. Your browser sends them no cookies with these requests.",
    );
    expect(text).toContain("Our server uses what your browser sends for that one request: it never saves it.");
    expect(text).toContain("If your browser can't reach ESPN or Sleeper (some ad blockers and work or school networks stop it), our server reads the league itself instead.");
    expect(text).toContain("It does the same for your ESPN leagues, public ones too, while you're connected with your ESPN cookies, which a private league needs (below).");
  });

  it.each(WITH_BROWSER)("%o: lists every league our server still reads itself, and never keeps what the browser sends (fact 2; review PG-1)", (f) => {
    const { text } = privacy(f);
    expect(text).toContain(
      "League data our server reads itself (private ESPN leagues, any ESPN league while you're connected with ESPN cookies, any league your browser couldn't read, and any league whose saved copy our server couldn't use): about 10 minutes.",
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
    expect(text).toContain(
      "When you open the League page, your browser sends the league it saved to our server (reading it again first when its copy is more than 10 minutes old), and our server adds the projections and trade values for its players and scores the projections with your league's scoring rules. If our server can't use the copy your browser sends (one saved before Offer Sheet read leagues in your browser, for example), it reads the league itself.",
    );
    expect(text).toContain("If you enter a username, your browser asks Sleeper which leagues it's in, to find your leagues and your team (if your browser can't reach Sleeper, our server asks instead and keeps that lookup for 10 minutes).");
  });
});

describe("privacy page without anonymous feedback (today: feedback stays in the browser)", () => {
  it.each(WITHOUT_FEEDBACK)("%o: says settings and feedback never leave the browser, and names no feedback the server keeps", (f) => {
    const { html, text } = privacy(f);
    expect(text).toContain("These are saved with each league in this browser's IndexedDB storage, so they're there the next time you use Offer Sheet. They're read only in your browser and never sent to our server.");
    for (const claim of ["Anonymous feedback", "anonymous copy", "Share anonymous feedback", "an hour for feedback", "a month, at Upstash"]) expect(text).not.toContain(claim);
    expect(text).toContain("our server limits how many requests one visitor can send in 10 minutes.");
    expect(links(html).filter((l) => l.href === "/settings" || l.href === "/feedback")).toEqual([]);
  });
});

describe("privacy page with anonymous feedback (track FB)", () => {
  it.each(WITH_FEEDBACK)("%o: lists what the anonymous copy holds and never holds, the day it arrived, how long it's kept, and how to turn it off (fact 4)", (f) => {
    const { html, text } = privacy(f);
    expect(text).toContain(
      "When you mark what happened to a trade idea or report a problem with it, your browser also sends Offer Sheet an anonymous copy, to improve its estimates: never your league's ID, names, usernames or the notes you type. You can turn this off in Settings.",
    );
    expect(text).toContain("Unless you turn it off, it also sends Offer Sheet an anonymous copy, used only to improve how Offer Sheet estimates trades.");
    for (const field of [
      "what you pressed (the outcome, or the report's reason) and which version of the idea you sent;",
      "the platform (ESPN or Sleeper), the season and the week;",
      "your league's format: the number of teams, whether it's redraft, keeper or dynasty, the points per catch and per passing touchdown, any tight-end premium, whether it starts a second quarterback, how many of each lineup slot it starts, and how many teams make the playoffs;",
      "your “What matters most” setting;",
      "the players in the trade, as ID numbers with their positions;",
      "a random code your browser makes for that one record",
    ]) {
      expect(text).toContain(field);
    }
    // The server adds the day it arrived (review PG-1).
    expect(text).toContain("Our server stores it with the day it arrived (the date, not the time).");
    expect(text).toContain(
      "It never holds your league's ID, team IDs, team or owner names, usernames, ESPN member IDs (SWIDs), cookies, the code your browser files your league under, or any note you type: notes stay in your browser.",
    );
    expect([feedbackLimits.maxPerMonth, feedbackLimits.retainDays]).toEqual([5_000, 365]);
    expect(text).toContain("We keep at most the newest 5,000 a month, at Upstash, and delete each month's feedback a year after the last one that month.");
    expect(text).toContain("To stop sending it, turn off “Share anonymous feedback” on the Settings page");
    expect(links(html).filter((l) => l.href === "/settings")).toHaveLength(1);
    expect(text).toContain(
      "Your settings never leave your browser, except your “What matters most” setting in the anonymous feedback above. Your feedback stays here too, apart from that anonymous copy, which leaves out your notes.",
    );
    expect(text).not.toContain("They're read only in your browser and never sent to our server.");
    expect(text).toContain("(10 minutes for imports and the League page, an hour for feedback)");
    expect(countedKinds(f)).toContain("feedback");
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
    expect(text).toContain("Every number Offer Sheet shows is an estimate: projections, playoff and title odds, “Helps you”, “Chance they accept” and “Overall”, and the trade values it quotes.");
    expect(text).toContain("You decide what to offer and what to accept, and those decisions are yours.");
    expect(text).toContain("ESPN's league data comes through an unofficial interface that ESPN doesn't support, so it can change or stop working at any time.");
    expect(text).toContain("trade values from FantasyCalc, player ID maps from DynastyProcess, and the NFL schedule from ESPN.");
    expect(text).toContain("It is not affiliated with, endorsed by or sponsored by ESPN, Sleeper, Yahoo, Fleaflicker, MyFantasyLeague, Fantrax, FantasyCalc, DynastyProcess or the NFL.");
    // The app downloads nothing from nflverse (src/data/nflSchedule.ts reads ESPN's schedule).
    expect(text).not.toContain("nflverse");
  });

  it.each(ALL)("%o: asks users to connect only their own or public leagues, keep cookies private, not scrape or resell values", (f) => {
    const { text } = terms(f);
    expect(text).toContain("connect only leagues you're in, or leagues their managers have made public;");
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
    expect(text).toContain("Offer Sheet may use an anonymous copy to improve its estimates.");
    expect(text).toContain("You can turn it off in Settings .");
  });
});

describe("feedback page (Part B, B3)", () => {
  it.each(ALL)("%o: explains the buttons on every trade idea, and has no form (nothing the public types is stored on the server), only the contact line", (f) => {
    const { html, text } = feedback(f);
    expect(text).toContain("Each trade idea on the Trade Finder and the Trade Analyzer has buttons for what happened: Sent, Accepted, Rejected and Countered.");
    expect(text).toContain("Doesn't help me, They'd never accept, Player info is wrong, League settings look wrong, or Other, with a note if you like.");
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
    expect(text).toContain("The privacy policy lists exactly what's sent and how long it's kept.");
    expect(links(html).map((l) => l.href)).toEqual(["/settings", "/privacy"]);
    expect(feedbackDescription(f)).toBe("How to tell Offer Sheet what happened to its trade ideas, or what went wrong: anonymous, and only if you want to.");
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
