/**
 * Static pages and site-wide config: the home page says what's available now, the privacy page says what the code does
 * (CLAUDE.md §14), the terms and the feedback page say what the public beta promises (planner reply to Checkpoint 4c, B3),
 * the error pages are the site's own, and every response carries the security headers (B4: a full Content-Security-Policy
 * in production builds only).
 *
 * Review PG-1: the privacy policy, the terms and the feedback page describe track BF's browser reading and track FB's
 * anonymous feedback only once they're built (src/lib/site.ts POLICY_FEATURES). Their words are pinned both ways, and
 * "the public pages describe what's built" fails while a flag and the code its sentences rest on disagree.
 *
 * Checkpoint 7b (planner reply to Checkpoint 7a, 3, 4 and 5.4): the privacy policy is shorter, and each statement cut went
 * with its test ("says none of what was cut" keeps them out). New: the cookie line, with a scan of the code that could set
 * a cookie; feedback kept 12 months with no download promise; the public-data archive; the daily totals; FantasyCalc's
 * facts; the contact address on all three pages; the terms' new rules and age 13; no person's name anywhere.
 *
 * The review of that text: the sentences resting on Checkpoint 7b work not built yet (FantasyCalc's values never shown,
 * the public-data archive, feedback studied in totals only) follow flags of their own, tied to the code both ways like
 * Part B's; what the server holds in memory, FantasyCalc's 3 hours as the cache keeps them, the ESPN cookie section's
 * words, and the contact inbox at Google are pinned; the detailed part's length is held at the count the planner gets.
 *
 * Checkpoint 7c (planner reply to Checkpoint 7b, section 3: "approved, with small edits"): the line on your rights before
 * the contact line (the privacy page only, whatever the features); three more flags, each tied to its code both ways and
 * each changing only its own words: dailyLevels (the archive sentence names the daily rest-of-season levels the cron saves
 * under snap:lvl:), prizeShares (the anonymous copy's prize split, once its server schema holds a prize field, under any
 * name and at any depth) and helpsThem (“Helps them” among the terms' estimates, once the app has a “Helps both” sort or
 * words the score anywhere its pages are worded); the detailed part at most 1,300 words.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import { FANTASYCALC_LINK } from "@/components/league/ValuesCredit";
import { FOOTER_INDEPENDENT, SiteFooter } from "@/components/SiteFooter";
import { config } from "@/engine/config";
import { FEEDBACK_MAX_RECORDS } from "@/lib/feedbackStore";
import { CONTACT_EMAIL, POLICY_FEATURES, SHARE_IMAGE_ALT, SHARE_IMAGE_TAGLINE, SITE_NAME, type PolicyFeatures } from "@/lib/site";
import { SORT_OPTIONS } from "@/lib/tradeView";
import { createBudget, createDailyQuota, msUntilUtcMidnight } from "@/server/budget";
import { DAY, FANTASYCALC_RETAIN_MS, HOUR, MINUTE, STALE_PUBLIC_RETAIN_MS, TTL } from "@/server/cache";
import { FeedbackEventSchema, feedbackDayTtlMs } from "@/server/feedbackSink";
import { browserFetchLimits, budgets, feedbackLimits, logLimits, rateLimits, snapshotLimits, usageLimits, workLimits } from "@/server/limits";
import { StoredLogEventSchema } from "@/server/log";
import { LEVEL_TOTALS } from "@/server/projectionLevels";
import { FakeRedis } from "@/server/redis";
import { SESSION_SEAL_TTL_SECONDS } from "@/server/session";
import { dayRetainMs } from "@/server/snapshots";
import nextConfig, { BROWSER_FETCH_ORIGINS, FRAMING_ONLY_CSP, PERMISSIONS_POLICY, VERCEL_TOOLBAR_SOURCES, contentSecurityPolicy, securityHeaders } from "../../next.config";
import ErrorPage from "./error";
import { FeedbackGuide, feedbackDescription } from "./feedback/FeedbackGuide";
import FeedbackPage, { metadata as feedbackMetadata } from "./feedback/page";
import GlobalError from "./global-error";
import NotFound from "./not-found";
import Home from "./page";
import { PRIVACY_LAST_UPDATED, PrivacyPolicy, durationWords, feedbackKeptWords, listWords } from "./privacy/PrivacyPolicy";
import PrivacyPage, { metadata as privacyMetadata } from "./privacy/page";
import { TERMS_LAST_UPDATED, TermsOfUse } from "./terms/TermsOfUse";
import TermsPage, { metadata as termsMetadata } from "./terms/page";

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

/** Checkpoint 7b's three (FantasyCalc's values never shown, the public-data archive, feedback studied in totals): all off, or all on (since 2026-10-05). */
const LATER_OFF = { fantasyCalcHidden: false, publicArchive: false, feedbackTotalsOnly: false } as const;
const LATER_ON = { fantasyCalcHidden: true, publicArchive: true, feedbackTotalsOnly: true } as const;
/**
 * Checkpoint 7c's three (planner reply to Checkpoint 7b, section 3: the daily levels in the archive sentence, the prize split
 * in the anonymous copy's, “Helps them” among the terms' estimates): all off or all on; "Checkpoint 7c's switches change only
 * their own words" turns each one alone.
 */
const CHECKPOINT_7C_OFF = { dailyLevels: false, prizeShares: false, helpsThem: false } as const;
const CHECKPOINT_7C_ON = { dailyLevels: true, prizeShares: true, helpsThem: true } as const;
/** Every way Part B's two features can stand (neither, each alone, both: Checkpoint 7a on), each with Checkpoint 7b's three off and on, and Checkpoint 7c's three off and on. */
const ALL: PolicyFeatures[] = [
  { browserReads: false, anonymousFeedback: false },
  { browserReads: true, anonymousFeedback: false },
  { browserReads: false, anonymousFeedback: true },
  { browserReads: true, anonymousFeedback: true },
].flatMap((partB) => [LATER_OFF, LATER_ON].flatMap((later) => [CHECKPOINT_7C_OFF, CHECKPOINT_7C_ON].map((c7c) => ({ ...partB, ...later, ...c7c }))));
const WITHOUT_BROWSER = ALL.filter((f) => !f.browserReads);
const WITH_BROWSER = ALL.filter((f) => f.browserReads);
const WITHOUT_FEEDBACK = ALL.filter((f) => !f.anonymousFeedback);
const WITH_FEEDBACK = ALL.filter((f) => f.anonymousFeedback);
/** Every feature on: the longest the pages get. */
const ALL_ON: PolicyFeatures = { browserReads: true, anonymousFeedback: true, ...LATER_ON, ...CHECKPOINT_7C_ON };

/** The archive sentence (with publicArchive), and with the daily rest-of-season levels (dailyLevels; planner reply to Checkpoint 7b, question 4 and section 3). */
const ARCHIVE =
  "We also keep public data, Sleeper's pre-game projections and FantasyCalc's daily lists for the league formats in use, up to 2 seasons, to measure how accurate our numbers are. It's never shown and says nothing about any league or person beyond which formats were in use each day.";
const ARCHIVE_WITH_LEVELS =
  "We also keep public data, Sleeper's pre-game projections, its daily rest-of-season projections in standard scoring formats, and FantasyCalc's daily lists for the league formats in use, up to 2 seasons, to measure how accurate our numbers are. It's never shown and says nothing about any league or person beyond which formats were in use each day.";
/** What the anonymous copy's sentence says of the reward setting, and with the prize split (prizeShares; the planner's words, section 3). */
const WEIGH_WORDS = "how you weigh the title against the playoffs";
const PRIZE_WORDS = "how your league splits its prizes (as shares, never amounts)";
/** The terms' estimates, and with “Helps them” (helpsThem; section 3: "when it ships, add it to the terms' list of estimates"). */
const ESTIMATES = "The numbers Offer Sheet works out are estimates: projections, playoff and title odds, “Helps you”, “Chance they accept” and “Overall”.";
const ESTIMATES_WITH_HELPS_THEM = "The numbers Offer Sheet works out are estimates: projections, playoff and title odds, “Helps you”, “Helps them”, “Chance they accept” and “Overall”.";
/** Your rights (section 3: "on the privacy page, add this line before 'Contact'"), the planner's words. */
const RIGHTS = "Email us to ask what we hold about you or to have it deleted.";

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

/** The code (not the tests) under some folders, file by file (paths from the project root, with "/"); a missing folder has none. */
function sourceFiles(...dirs: string[]): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push({ file: path.relative(ROOT, p).split(path.sep).join("/"), text: readFileSync(p, "utf8") });
    }
  };
  for (const d of dirs) if (exists(d)) walk(path.join(ROOT, d));
  return out;
}
const sourcesUnder = (...dirs: string[]): string[] => sourceFiles(...dirs).map((f) => f.text);

/** Words in some text (anything with a letter or digit). */
const wordCount = (s: string): number => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Source without its comments (block and line comments; "//" after a colon or a quote, as in a URL, stays), so a pattern finds only code. */
const codeOf = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");

/**
 * Every field of a zod object schema at any depth, with its path ("versionInputs.features.g"): through optional and nullable
 * fields, arrays, records and unions, so a field is found wherever it's added and under whatever name.
 */
function schemaFields(schema: z.ZodType, at = ""): Array<{ path: string; schema: z.ZodType }> {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) return schemaFields(schema.unwrap() as z.ZodType, at);
  if (schema instanceof z.ZodArray) return schemaFields(schema.element as z.ZodType, at);
  if (schema instanceof z.ZodRecord) return schemaFields(schema.valueType as z.ZodType, at);
  if (schema instanceof z.ZodUnion) return (schema.options as readonly z.ZodType[]).flatMap((option) => schemaFields(option, at));
  if (!(schema instanceof z.ZodObject)) return [];
  return Object.entries(schema.shape as Record<string, z.ZodType>).flatMap(([key, field]) => {
    const path = at ? `${at}.${key}` : key;
    return [{ path, schema: field }, ...schemaFields(field, path)];
  });
}

/**
 * Where the app showed FantasyCalc's values or compared them, as Checkpoint 7b's review found it (planner reply to Checkpoint
 * 7a, 5.4: "Remove every FantasyCalc value number and value comparison from the cards, reasons, pitch messages, League page
 * and Analyzer Details"). POLICY_FEATURES.fantasyCalcHidden may be on only while none of these is left.
 */
const FANTASYCALC_DISPLAYS: ReadonlyArray<{ what: string; file: string; pattern: RegExp }> = [
  // The value line's own template ("You give ${side(e.proposal.give)}, …") or its label; the Analyzer's draft summary ("You
  // give Bo Nix; you get Travis Kelce.") names players and isn't one.
  { what: "the trade card's value line (“Trade value: You give …, you get …”)", file: "src/lib/tradeView.ts", pattern: /You give \$\{side\(|label: "Trade value"/ },
  { what: "the Analyzer's Details (“you'd get 12% more trade value than you give”)", file: "src/lib/tradeView.ts", pattern: /trade value than \$\{who\} give/ },
  { what: "the reasons and the pitch (“By FantasyCalc's trade values, …”)", file: "src/engine/explain.ts", pattern: /By FantasyCalc's trade values|FantasyCalc's trade values, you/ },
  { what: "the League page's Value column and player breakdown", file: "src/components/league/PlayerTable.tsx", pattern: /<ValueText\b/ },
  { what: "How to read (“The trade values on the card are FantasyCalc's own”)", file: "src/components/trades/HowToRead.tsx", pattern: /trade values on the card are FantasyCalc/ },
  // The market blend's line in a player's breakdown: the market's points ("Trade market 170", a price that rises with his
  // FantasyCalc value), ours before the blend (with the ROS shown, it gives the market's back), what the uncapped blend
  // "would be", and which end of FantasyCalc's range he's at ("no comparison (top value at his position)").
  { what: "the League page's player breakdown (“Our projection 210 · Trade market 170 · Used 190”)", file: "src/lib/leagueView.ts", pattern: /Our projection \$\{|Trade market \$\{|would be \$\{|top value at his position|no comparison \(/ },
  // The long-term value change in percents ("Raises your roster's long-term value by 6%").
  { what: "the long-term value reasons (“Raises your roster's long-term value by 6%”)", file: "src/engine/explain.ts", pattern: /long-term value by \$\{|% of your roster's long-term value/ },
  // An exchange rate between trade value and points: with it, the Analyzer's "Trade value: −0.4 pts/week equivalent."
  // reads back as the trade's own value comparison.
  { what: "Settings' rate for Protect my trade value (“giving 25% more trade value than you get costs about 0.4 points a week”)", file: "src/components/settings/settingsView.ts", pattern: /more trade value than you get costs/ },
];

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
    // "We keep anonymous feedback for up to 12 months, then delete it." (one list per day since the final review's SEC-3,
    // each deleted feedbackLimits.retainDays after its UTC day began, feedbackDayTtlMs: a day's first copy is kept 365 days,
    // a later one less, never more)
    const sink = source("src/server/feedbackSink.ts");
    expect(sink).toMatch(/feedbackLimits\.maxPerDay/);
    expect(sink).toMatch(/fb:\$\{new Date\(at\)\.toISOString\(\)\.slice\(0, 10\)\}/);
    const dayStart = Date.UTC(2026, 9, 13);
    expect([feedbackDayTtlMs(dayStart), feedbackDayTtlMs(dayStart + 15 * HOUR), feedbackDayTtlMs(dayStart + DAY - 1)]).toEqual([
      feedbackLimits.retainDays * DAY,
      feedbackLimits.retainDays * DAY - 15 * HOUR,
      (feedbackLimits.retainDays - 1) * DAY + 1,
    ]);
  });

  it("FantasyCalc's values are said to be never shown (5.4) exactly when nothing known shows them or compares them", () => {
    const shown = FANTASYCALC_DISPLAYS.filter(({ file, pattern }) => exists(file) && pattern.test(codeOf(source(file)))).map((d) => d.what);
    if (POLICY_FEATURES.fantasyCalcHidden) {
      expect(shown, "POLICY_FEATURES.fantasyCalcHidden is on, but these still show FantasyCalc's values: the privacy policy and the terms would say they're never shown").toEqual([]);
    } else {
      expect(
        shown.length,
        "nothing known shows FantasyCalc's values any more: check every page against the planner's reply to Checkpoint 7a, 5.4 (no value number or comparison on the cards, in the reasons and pitches, on the League page or in the Analyzer's Details), then turn POLICY_FEATURES.fantasyCalcHidden on (src/lib/site.ts) and update both LAST_UPDATED dates",
      ).toBeGreaterThan(0);
    }
  });

  it("the public-data archive (4.4, 6.3) is described exactly when a Vercel cron runs, with its route in the app", () => {
    const crons = (JSON.parse(source("vercel.json")) as { crons?: Array<{ path: string }> }).crons ?? [];
    expect(
      POLICY_FEATURES.publicArchive,
      crons.length
        ? "vercel.json runs a cron: check the privacy policy's archive sentence against it (Sleeper's pre-game projections and FantasyCalc's daily lists, at Upstash, up to 2 seasons, never shown), then turn POLICY_FEATURES.publicArchive on (src/lib/site.ts) and update PRIVACY_LAST_UPDATED"
        : "POLICY_FEATURES.publicArchive is on, but vercel.json runs no cron: the privacy policy would describe an archive nothing keeps",
    ).toBe(crons.length > 0);
    for (const { path: route } of crons) expect(exists(`src/app${route.split("?")[0] ?? ""}/route.ts`), route).toBe(true);
  });

  it("studying anonymous feedback in totals only (4.3) is described exactly when `npm run feedback:pull`, which saves the copies themselves, is gone", () => {
    const scripts = (JSON.parse(source("package.json")) as { scripts?: Record<string, string> }).scripts ?? {};
    const savesCopies = "feedback:pull" in scripts || exists("scripts/feedback-pull.ts");
    expect(
      POLICY_FEATURES.feedbackTotalsOnly,
      savesCopies
        ? "POLICY_FEATURES.feedbackTotalsOnly is on, but `npm run feedback:pull` still saves the anonymous copies themselves (data-local/feedback-server/): the privacy policy would say only totals are kept"
        : "`npm run feedback:pull` is gone: check that what replaced it reads the copies from Upstash and saves only totals and fitted numbers (planner reply to Checkpoint 7a, 4.3), then turn POLICY_FEATURES.feedbackTotalsOnly on (src/lib/site.ts) and update PRIVACY_LAST_UPDATED",
    ).toBe(!savesCopies);
  });

  it("the daily rest-of-season levels (Checkpoint 7c; question 4) are in the archive sentence exactly when the snapshot cron saves them under snap:lvl:, with the code its words rest on", () => {
    // Line ends as Unix ones (a Windows checkout with core.autocrlf has CRLF ones), so the run's body ends at "\n}\n".
    const unix = (file: string) => codeOf(source(file).replace(/\r\n/g, "\n"));
    const snapshots = unix("src/server/snapshots.ts");
    const run = snapshots.slice(snapshots.indexOf("export async function runSnapshots"));
    const built = snapshots.includes("snap:lvl:") && /\bsnapshotLevels\(/.test(run.slice(0, run.indexOf("\n}\n") + 1));
    expect(
      POLICY_FEATURES.dailyLevels,
      built
        ? "the snapshot cron saves the day's rest-of-season levels (src/server/snapshots.ts, snap:lvl:): check the privacy policy's archive sentence against them (Sleeper's own projections in its standard scoring formats, never a league's, up to 2 seasons, never shown), then turn POLICY_FEATURES.dailyLevels on (src/lib/site.ts) and, after launch day, update PRIVACY_LAST_UPDATED"
        : "POLICY_FEATURES.dailyLevels is on, but the snapshot cron saves no levels under snap:lvl: (src/server/snapshots.ts runSnapshots): the privacy policy would describe a daily copy nothing keeps",
    ).toBe(built);
    if (!built) return;
    // "in standard scoring formats": Sleeper's own standard, half-PPR and PPR totals as it serves them (src/server/
    // projectionLevels.ts), and nothing there reads a league's scoring, the market blend or FantasyCalc.
    expect(LEVEL_TOTALS).toEqual(["pts_std", "pts_half_ppr", "pts_ppr"]);
    const imports = [...unix("src/server/projectionLevels.ts").matchAll(/^import [\s\S]*?;$/gm)].map((m) => m[0]);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((i) => /scoring|blend|market|fantasyCalc|engine\/league/i.test(i))).toEqual([]);
    // "up to 2 seasons": a day's levels go when its other records do, retainDays after the day began (dayRetainMs, pinned below).
    expect(snapshots).toMatch(/projectionLevelsKey\([^)]*\), value, \{ nx: true, px: dayRetainMs\(record\.day\b/);
    // "It's never shown": only the cron and `npm run snapshot:pull` read them; no page, component, worker or engine code does.
    expect(sourceFiles("src/app", "src/components", "src/lib", "src/engine", "src/workers").filter((f) => /projectionLevels/.test(codeOf(f.text))).map((f) => f.file)).toEqual([]);
  });

  it("the anonymous copy's prize split (Checkpoint 7c; sections 3 and 6) is described exactly when the copy's server schema holds a prize field, under any name and at any depth, each as whole-percent shares and never amounts", () => {
    // Every field of the copy (zod 4 keeps the cross-field refinements inside the object schema). The walk reaches the
    // copy's own fields, nested ones, and those behind optional, nullable and array fields: else finding no prize field
    // could mean finding nothing.
    const fields = schemaFields(FeedbackEventSchema);
    expect(fields.map((f) => f.path)).toEqual(expect.arrayContaining(["goal", "format.ppr", "trade.give.id", "versionInputs.goal", "versionInputs.features.g"]));
    // Any field named for prizes, wherever section 6 adds it (the plan: `prizes`, at the top level and in the version
    // inputs). Review of Checkpoint 7c's policy track: matching the one name `prizes` at the top level let a `prizeShares`
    // field, or one in the version inputs, slip by with the switch off.
    const prizes = fields.filter((f) => /prize/i.test(f.path.slice(f.path.lastIndexOf(".") + 1)));
    const paths = prizes.map((f) => f.path).join(", ");
    expect(
      POLICY_FEATURES.prizeShares,
      prizes.length
        ? `the anonymous copy's server schema holds a prize field (${paths}; src/server/feedbackSink.ts): check the privacy policy's anonymous copy sentence against it (as shares, never amounts: the planner's words), then turn POLICY_FEATURES.prizeShares on (src/lib/site.ts) and, after launch day, update PRIVACY_LAST_UPDATED`
        : "POLICY_FEATURES.prizeShares is on, but the anonymous copy's server schema (src/server/feedbackSink.ts FeedbackEventSchema) holds no prize field: the privacy policy would say the copy holds how your league splits its prizes",
    ).toBe(prizes.length > 0);
    for (const { path: at, schema } of prizes) {
      // "as shares": whole percents of the prizes' total ($2,000 / $1,600 / $900 go as 44 / 36 / 20).
      expect(schema.safeParse({ first: 44, second: 36, third: 20, weeklyHigh: 0, pointsLeader: 0 }).success, `${at}: whole-percent shares`).toBe(true);
      // "never amounts": the amounts as typed, or shares finer than a whole percent, are refused.
      expect(schema.safeParse({ first: 2000, second: 1600, third: 900, weeklyHigh: 0, pointsLeader: 0 }).success, `${at}: amounts`).toBe(false);
      expect(schema.safeParse({ first: 44.4, second: 35.6, third: 20, weeklyHigh: 0, pointsLeader: 0 }).success, `${at}: fractions of a percent`).toBe(false);
      // Shares of the whole season's prizes (Checkpoint 7c, the prize split's server rule): they add up to 100, so amounts
      // that happen to be small (60 / 30 / 5) don't pass for shares either.
      expect(schema.safeParse({ first: 60, second: 30, third: 5, weeklyHigh: 0, pointsLeader: 0 }).success, `${at}: shares that don't add up to 100`).toBe(false);
    }
  });

  it("“Helps them” (Checkpoint 7c; sections 3 and 7) is among the terms' estimates exactly when the app shows the score: a “Helps both” sort, or “Helps them” where its pages are worded", () => {
    // Either sign counts, whatever the sort's full label and whichever file words the score (review of Checkpoint 7c's
    // policy track: matching the one label "Helps both" let a "Helps both teams" sort with a "Helps them 24" line slip by
    // with the switch off). Where the pages are worded: src/lib, src/components and src/app, but the policy pages (the
    // terms name the estimate) and the API routes.
    const sorts = SORT_OPTIONS.filter((o) => /\bhelps both\b/i.test(o.label)).map((o) => `the “${o.label}” sort (src/lib/tradeView.ts SORT_OPTIONS)`);
    const ui = sourceFiles("src/lib", "src/components", "src/app").filter((f) => !/^src\/app\/(privacy|terms|feedback|api)\//.test(f.file));
    // The scan reads the words the cards show today, so finding no "Helps them" means there's none.
    expect(ui.some((f) => codeOf(f.text).includes("Helps you")), "the scan finds “Helps you”").toBe(true);
    const shown = ui.filter((f) => codeOf(f.text).includes("Helps them")).map((f) => f.file);
    const built = sorts.length + shown.length > 0;
    expect(
      POLICY_FEATURES.helpsThem,
      built
        ? `the app shows “Helps them” (${[...sorts, ...shown].join(", ")}): check that the cards and the Analyzer show the score, then turn POLICY_FEATURES.helpsThem on (src/lib/site.ts) so the terms list it among the estimates, and, after launch day, update TERMS_LAST_UPDATED`
        : "POLICY_FEATURES.helpsThem is on, but the app has no “Helps both” sort and no “Helps them” where its pages are worded: the terms would list an estimate the app doesn't show",
    ).toBe(built);
    if (!built) return;
    // The estimate the terms name: the score itself, where the cards and the Analyzer are worded.
    expect(shown, "“Helps them” shown").not.toEqual([]);
  });

  it("the guards read code, not comments: a display mentioned only in a comment doesn't count", () => {
    expect(codeOf('const a = `You give ${x}`; // By FantasyCalc\'s trade values\n/* <ValueText /> */ const url = "https://fantasycalc.com";')).toBe(
      'const a = `You give ${x}`; \n const url = "https://fantasycalc.com";',
    );
  });
});

describe("privacy page, whichever features are on", () => {
  it.each(ALL)("%o: is dated, and gives Offer Sheet's contact address as a mail link, just after the line on your rights (planner reply to Checkpoint 7a, 3; Checkpoint 7b, 3)", (f) => {
    const { html, text } = privacy(f);
    // The launch day (Parker, 2026-10-07); Checkpoint 7c's edits come before launch, so they keep it.
    expect(PRIVACY_LAST_UPDATED).toBe("October 13, 2026");
    expect(text).toContain("Last updated October 13, 2026");
    expect(CONTACT_EMAIL).toBe("offersheet.app@gmail.com");
    expect(text).toContain("Contact: offersheet.app@gmail.com");
    expect(links(html).filter((l) => l.href?.startsWith("mailto:")).map((l) => [l.href, l.text])).toEqual([["mailto:offersheet.app@gmail.com", "offersheet.app@gmail.com"]]);
    expect(text).not.toContain("to be added before launch");
    // "Your rights: on the privacy page, add this line before 'Contact'", in its own paragraph, whatever the features.
    expect(text).toContain(`Offer Sheet isn't directed at children under 13. If this policy changes, we'll update it here and change the date above. ${RIGHTS} Contact: offersheet.app@gmail.com`);
    expect(html).toContain(`>${RIGHTS}</p>`);
    expect(text.match(/Email us/g)).toHaveLength(1);
    // The privacy page's only: the terms and the feedback page share the contact line, not this one.
    expect(terms(f).text).not.toContain(RIGHTS);
    expect(feedback(f).text).not.toContain(RIGHTS);
    expect(links(html).filter((l) => l.href === "/terms").map((l) => l.text)).toEqual(["terms of use"]);
  });

  it.each(ALL)("%o: keeps the short version first, with the cookie line, whom it shares data with, and the planner's words for the limits (4.1, 4.2)", (f) => {
    const { html, text } = privacy(f);
    expect([...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1])[0]).toBe("The short version");
    expect(text).toContain("Offer Sheet sets no cookies, except one encrypted cookie if you connect a private ESPN league.");
    // Review POL-18: whom it shares data with, rather than "we share none".
    expect(text).toContain(
      "No accounts, no ads and no tracking or analytics. We don't sell your data or share it with anyone but the services that run Offer Sheet and the sites it reads for you (below), and we don't build profiles of you or your leaguemates.",
    );
    expect(text).toContain("Offer Sheet only reads your league. It can't send offers or change anything.");
    expect(text).toContain("The leagues you import stay saved in this browser, with your team pick, settings, projections and feedback, until you remove a league or clear this site's data.");
    expect(text).toContain("Our server has per-visitor limits, counted under codes made from your IP address with a secret key, deleted within a day.");
    expect(text).toContain(
      "If you connect with ESPN cookies, they're kept only in that encrypted cookie, for this browser session. Our server opens it only to read your league, and sends them only to ESPN.",
    );
  });

  it("the cookie line holds: only the ESPN session's connect and forget requests set a cookie, and no other code can (4.1)", () => {
    const code = sourceFiles("src");
    const filesMatching = (re: RegExp) => code.filter((f) => re.test(f.text)).map((f) => f.file).sort();
    // The one place a Set-Cookie header is written (iron-session's jar and the forget fallback, both in session.ts).
    expect(filesMatching(/["']set-cookie["']/i)).toEqual(["src/server/session.ts"]);
    expect(filesMatching(/\bgetIronSession\b/)).toEqual(["src/server/session.ts"]);
    expect(filesMatching(/\bopenSession\s*\(/)).toEqual(["src/server/session.ts"]);
    // Only the ESPN session route saves or forgets it (reading it sets nothing: readEspnCredentials drops its headers).
    expect(filesMatching(/\b(saveEspnCredentials|forgetEspnCredentials)\s*\(/)).toEqual(["src/app/api/session/espn/handler.ts", "src/server/session.ts"]);
    expect(source("src/server/session.ts")).toMatch(/const session = await openSession\(request, new Headers\(\), env\);/);
    // No other way to set one: Next's cookies(), a response's cookies, document.cookie or the Cookie Store API.
    expect(filesMatching(/\bcookies\s*\(\s*\)|\.cookies\.(set|delete)\s*\(|document\.cookie|\bcookieStore\b/)).toEqual([]);
    // The cookie: encrypted (sealed), httpOnly, its Max-Age and Expires dropped (gone when the browser closes), sent with
    // every request to the site (Path=/: review POL-25), the seal good for SESSION_SEAL_TTL_SECONDS (the next test).
    const session = source("src/server/session.ts");
    expect(session).toMatch(/cookieOptions:\s*\{\s*httpOnly:\s*true,[^}]*path:\s*"\/"/);
    expect(session).toMatch(/const \{ maxAge, expires, \.\.\.rest \} = options;/);
    expect(session).toMatch(/ttl: SESSION_SEAL_TTL_SECONDS,/);
    // "They reach our server inside a request, never in a web address": the session route reads them from a POST body.
    const route = source("src/app/api/session/espn/handler.ts");
    expect(route).toMatch(/readJsonBody\(request, espnSessionBodySchema\)/);
    expect(route).not.toMatch(/searchParams/);
  });

  it.each(ALL)("%o: says how the ESPN cookies are kept, sent and ended, with the seal's own hours (review of Checkpoint 7b's text)", (f) => {
    const { text } = privacy(f);
    expect(SESSION_SEAL_TTL_SECONDS % 3600).toBe(0);
    expect(text).toContain("They work like a password, so we treat them like one. We never ask for your ESPN password.");
    expect(text).toContain(
      `They reach our server inside a request, never in a web address, and go into a cookie encrypted with a key only our server has and hidden from the page's scripts. Your browser sends it with each request to Offer Sheet and deletes it when you close your browser; even if your browser restores its session, it stops working after ${SESSION_SEAL_TTL_SECONDS / 3600} hours.`,
    );
    expect(text).toContain("Our server never stores or logs your espn_s2 cookie, and your ESPN cookies are never saved with your leagues.");
  });

  it.each(ALL)("%o: says what the browser keeps, for how long, and how to delete it (Phase 4c; 4.2: no database name, tab codes or old keys)", (f) => {
    const { text } = privacy(f);
    expect(FEEDBACK_MAX_RECORDS).toBe(500);
    expect(text).toContain(
      "Your browser saves each league you import: what the Import Report shows (settings, teams and owners' names, rosters, schedule and transactions), its ID, your team pick and settings, the projections and trade values our server sent, and your feedback on trade ideas, notes included, for the latest 500 ideas.",
    );
    expect(text).toContain(f.anonymousFeedback ? "Your settings never leave your browser, except the one setting the anonymous feedback includes." : "Your settings and feedback never leave your browser.");
    expect(text).toContain("The math (lineups, odds, trade ideas) runs in your browser.");
    expect(text).toContain(
      "To delete: “Remove” in the league menu deletes a league and what's saved with it (its settings and feedback stay while another season of it is saved). On the Settings page, “Reset to defaults” removes a league's settings and “Delete saved feedback” your feedback; clearing this site's data removes everything.",
    );
  });

  it.each(ALL)("%o: says what the server keeps, for how long, under hidden and encrypted keys, and when what it holds in memory goes (fact 2; review PG-6)", (f) => {
    const { text } = privacy(f);
    expect([TTL.league, TTL.closedTransactions, STALE_PUBLIC_RETAIN_MS]).toEqual([10 * MINUTE, 6 * HOUR, 7 * DAY]);
    expect(text).toContain(
      `Our server keeps copies of what it reads${f.browserReads ? " itself" : ""}, then deletes them: league data after about 10 minutes (older weeks' transactions and matchups after up to 6 hours), a Sleeper username lookup after 10 minutes, public data that isn't about any league after up to a week, and FantasyCalc's trade value lists after up to 90 days, in case FantasyCalc is down.`,
    );
    // Review of Checkpoint 7b's text (it had dropped when memory copies go): src/server/cache.ts MemoryLruCache and
    // src/app/api/model/memo.ts never serve what's due, delete it on a later read, write or sweep while the instance works,
    // and hold nothing past the process.
    expect(text).toContain(
      "The copies are kept at Upstash under codes made with a secret key, so league IDs and usernames never appear there, and encrypted, so Upstash can't read them. A private ESPN league's copies are also filed under a fingerprint of your cookies, so typing its ID isn't enough to see them, and ESPN member IDs (SWIDs) are replaced with one-way pseudonyms. Anything our servers hold in memory stops being used once it's due, is deleted soon after while the server keeps working, and is gone when it shuts down.",
    );
    // The ESPN cookies' Forget line names transactions only: ESPN's matchups come with the league itself (10 minutes). Review
    // of Phase 7b: an import read with the cookies is signed too, and the League page sends it back while it's fresh
    // (src/lib/modelStore.ts modelPlan, before it looks at usedEspnCookies), so the model route keeps what it works out from
    // it (ESPN's league-scored projections included) in memory until the import's token expires: 15 minutes, not 10.
    expect(browserFetchLimits.tokenMaxAgeMs).toBe(15 * MINUTE);
    expect(source("src/app/api/model/espn/handler.ts")).toContain("memo().set(key, text, body.signed.issuedAt + browserFetchLimits.tokenMaxAgeMs");
    expect(text).toContain(
      "“Forget my credentials” on the Connect page (or “Forget my ESPN cookies” on the Import Report) deletes the cookie right away; league data our server copied or worked out with it is deleted within about 15 minutes (older weeks' transactions within 6 hours).",
    );
  });

  it.each(ALL)("%o: says FantasyCalc isn't asked again for a format's list it has, by the cache's own refresh time, how long its lists are kept, and what its links tell it (5.4; review of Checkpoint 7b's text)", (f) => {
    const { text } = privacy(f);
    expect(FANTASYCALC_RETAIN_MS).toBe(config.market.fantasyCalcCurveDays * DAY);
    expect(config.market.fantasyCalcCurveDays).toBe(90);
    // Not "at most once every 3 hours": TTL.fantasyCalc holds off a refresh only after a usable list (src/data/
    // fantasyCalcValues.ts caches no other answer, and its outage gate asks again within 15 minutes).
    expect(text).toContain(`Once it has a format's list, it doesn't ask FantasyCalc for it again for ${durationWords(TTL.fantasyCalc)}, and asks only when needed.`);
    expect(text).not.toMatch(/at most once/);
    expect(text).toContain("If you follow a link to FantasyCalc, it can see that you came from Offer Sheet, but not from which page.");
    // Every FantasyCalc link: noopener without noreferrer or nofollow, and only the origin as the referrer.
    expect(FANTASYCALC_LINK).toEqual({ href: "https://fantasycalc.com", target: "_blank", rel: "noopener", referrerPolicy: "origin" });
  });

  it("durationWords and listWords say times and lists in words", () => {
    expect([durationWords(DAY), durationWords(HOUR), durationWords(3 * HOUR), durationWords(15 * MINUTE)]).toEqual(["a day", "an hour", "3 hours", "15 minutes"]);
    expect([listWords([]), listWords(["a"]), listWords(["a", "b"]), listWords(["a", "b", "c"])]).toEqual(["", "a", "a and b", "a, b and c"]);
    expect([feedbackKeptWords(365), feedbackKeptWords(180)]).toEqual(["12 months", "180 days"]);
  });

  it.each(ALL)("%o: describes the public data kept to measure accuracy, up to 2 seasons and never shown, saying it shows which league formats were in use each day, with the daily rest-of-season levels once they're kept too (4.4, 6.3; review of Phase 7b; Checkpoint 7c)", (f) => {
    // src/server/snapshots.ts: a week of projections expires snapshotLimits.retainDays after its last write; a day's
    // FantasyCalc lists, saved only for the formats League page builds read that day or the day before, and the day's index
    // naming their formats, retainDays after that day began (dayRetainMs). So the archive says which formats were in use
    // each day, for 2 seasons, and no longer: the review found one index a season kept them up to about 3 years, and the
    // page saying the archive "isn't about any league or person" while "Daily totals" said formats were noted for 3 days.
    // Not "data we fetch anyway": a run fetches what the model builds' cache doesn't already hold. Checkpoint 7c (planner
    // reply to Checkpoint 7b, question 4 and section 3): a day's levels go by the same day rule, and come from Sleeper's own
    // standard formats, never a league's, so the second sentence holds with them as it is.
    expect(snapshotLimits.retainDays).toBe(2 * 365);
    expect(dayRetainMs("2026-10-07", Date.parse("2026-10-07T00:00:00.000Z"))).toBe(snapshotLimits.retainDays * DAY);
    const { text } = privacy(f);
    if (f.publicArchive) expect(text).toContain(f.dailyLevels ? ARCHIVE_WITH_LEVELS : ARCHIVE);
    else expect(text).not.toContain("pre-game projections");
    if (!f.publicArchive || !f.dailyLevels) expect(text).not.toContain("rest-of-season");
    expect(text).not.toContain("isn't about any league or person");
  });

  it.each(ALL)("%o: says the daily totals are about nobody, kept about 13 months, and leaves the limits to the short version (4.2; 2.7; 6.3)", (f) => {
    const { text } = privacy(f);
    // src/app/api/cron/snapshot/formats.ts: League page builds note the formats they read, a set per UTC day kept
    // snapshotLimits.formatsInUseRetainDays, so the cron knows which FantasyCalc lists to save. That's which formats were in
    // use each day, which the archive's sentence says is kept up to 2 seasons, so the totals don't name it again (review
    // of Phase 7b: "for 3 days" read as all the archive kept of it).
    expect(snapshotLimits.formatsInUseRetainDays).toBe(3);
    expect(text).toContain(
      "Each day (UTC), our server counts the leagues imported, League pages built, the work they took, requests refused and requests made to each source, and keeps these totals about 13 months. None of this says who made the requests.",
    );
    expect(text).not.toContain("for 3 days");
    // src/server/usage.ts keeps each day's counters usageLimits.retainDays after the day's last count: about 13 months.
    expect(Math.round((usageLimits.retainDays * 12) / 365)).toBe(13);
    // The limits are said once, in the short version, in the planner's words (the review: the detail repeated them).
    expect(text.match(/per-visitor limits/g)).toHaveLength(1);
    // Review POL-17: an HMAC of an IP address can be undone by whoever holds the key, so never "one-way".
    expect(text).not.toContain("one-way code");
  });

  it("the limits' counts go within a day: a window's at Upstash within an hour, a day's a minute after the UTC day ends (reviews SEC-4, POL-1, F2)", async () => {
    // @upstash/ratelimit's fixed window keeps a count one window after it starts.
    const windows = Object.values(rateLimits).flatMap((v) => (typeof v === "object" && "windowS" in v ? [v.windowS] : []));
    expect(windows.length).toBeGreaterThanOrEqual(4);
    for (const w of windows) expect(w).toBeLessThanOrEqual(3600);
    expect([budgets.clientKeyMarginMs, workLimits.keyMarginMs]).toEqual([MINUTE, MINUTE]);
    // 00:05 UTC, the day's first requests: each key lives until the day ends and a minute, never longer.
    const now = Date.UTC(2026, 9, 4, 0, 5, 0);
    const dayEnd = msUntilUtcMidnight(now);
    expect(dayEnd + MINUTE).toBe(23 * HOUR + 56 * MINUTE);
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
      expect(redis.keys().filter((k) => k.includes("client-hmac") || k.includes("group-hmac"))).toHaveLength(2);
      for (const key of redis.keys()) expect(redis.ttlMs(key)).toBe(dayEnd + workLimits.keyMarginMs);
    }
  });

  it.each(ALL)("%o: says what the logs keep and for how long: Vercel's hour, our own 14 days with the time, never league data (fact 5; review POL-15)", (f) => {
    const { text } = privacy(f);
    expect(logLimits.retainDays).toBe(14);
    // src/server/log.ts: each stored entry carries the time it was logged (`at`) and the route.
    expect(Object.keys(StoredLogEventSchema.shape)).toEqual(expect.arrayContaining(["at", "route", "code", "platform", "status", "errorName", "ms"]));
    // Review of Phase 7b: not "only what went wrong": the snapshot cron logs every run, done or not (one line a day).
    expect(source("src/app/api/cron/snapshot/handler.ts")).toContain('logEvent({ event: "snapshot_run"');
    expect(text).toContain(
      "Vercel, our host, logs each request it serves (its web address and the browser type, for example), keeps that log for 1 hour, and can see IP addresses. Our own log keeps errors and a few routine events, where and when (an error code and the source involved, for example), for up to 14 days: never league data, names, IDs, usernames, cookies or IP addresses.",
    );
    expect(text).not.toContain("only what went wrong");
  });

  it.each(ALL)("%o: names the providers, where they run, Upstash's backups off and what it keeps, and the contact inbox at Google, linking their privacy policies (fact 6; planner reply to Checkpoint 7a, 1)", (f) => {
    const { html, text } = privacy(f);
    const external = links(html).filter((l) => l.href?.startsWith("https://"));
    expect(external.map((l) => [l.href, l.text])).toEqual([
      ["https://vercel.com/legal/privacy-policy", "Vercel's privacy policy"],
      ["https://upstash.com/trust/privacy.pdf", "Upstash's privacy policy"],
      ["https://policies.google.com/privacy", "Google's privacy policy"],
    ]);
    for (const l of external) expect(l.attrs).toContain('rel="noopener noreferrer"');
    // Review POL-6: where the server runs (vercel.json: the functions' one region, iad1, Washington, D.C.).
    expect((JSON.parse(source("vercel.json")) as { regions?: string[] }).regions).toEqual(["iad1"]);
    expect(text).toContain("Vercel hosts Offer Sheet and runs its server, in its US East region near Washington, D.C. ( Vercel's privacy policy ).");
    const kept = ["our server's copies", "the per-visitor counts", "the daily totals", ...(f.publicArchive ? ["the public data above"] : []), ...(f.anonymousFeedback ? ["the anonymous feedback"] : []), "the error log"];
    expect(text).toContain(`Upstash, our database service, in its US East region with backups turned off, keeps ${listWords(kept)} ( Upstash's privacy policy ).`);
    // Review of Checkpoint 7b's text: the pages publish a Gmail address, so the policy says what mail to it leaves with Google.
    expect(text).toContain(`Contact: ${CONTACT_EMAIL}`);
    expect(CONTACT_EMAIL.endsWith("@gmail.com")).toBe(true);
    expect(text).toContain("Google keeps the emails you send us (your address and message) in Offer Sheet's Gmail inbox, used only to answer you. Ask, and we'll delete them ( Google's privacy policy ).");
  });

  it.each(ALL)("%o: says Safari may delete what's saved after 7 days, and an installed app may keep its own (4.5: 'may' until checked on an iPhone)", (f) => {
    expect(privacy(f).text).toContain(
      `Safari may delete what Offer Sheet saved if you use Safari for 7 days without visiting Offer Sheet. A Home Screen app may keep its own saved leagues and settings${f.anonymousFeedback ? " (“Share anonymous feedback” included)" : ""}, apart from Safari's, so you may need to import your leagues there again.`,
    );
  });

  it.each(ALL)("%o: says what the other sources get: no names or IDs, and that FantasyCalc's values are never shown only once nothing shows them (4.2; 5.4)", (f) => {
    const { text } = privacy(f);
    expect(text).toContain(
      `Our server also downloads public data: player lists, projections and stats from Sleeper, the NFL schedule from ESPN, player ID maps from DynastyProcess, and trade values from FantasyCalc${f.fantasyCalcHidden ? ", which Offer Sheet uses in its own numbers but never shows" : ""}. These requests carry no names or IDs, only things like the season, the week and your league's format.`,
    );
    if (!f.fantasyCalcHidden) expect(text).not.toMatch(/never shows|doesn't show/);
  });

  it.each(ALL)("%o: says none of what was cut: the database's name, tabs' codes, old storage keys, the trade pages' addresses, the server's memory of signed imports, exact windows, downloads (4.2, 4.3)", (f) => {
    const { text } = privacy(f);
    for (const cut of [
      "IndexedDB",
      "“offersheet”",
      "session storage",
      "Your tabs tell each other",
      "offersheet:settings:v1",
      "offersheet:feedback:v1",
      "If you used Offer Sheet before",
      "in its web address",
      "ahead of time",
      "never at Upstash",
      "doesn't cost it the same work twice",
      "10 minutes for imports",
      "an hour for feedback",
      "a minute after the day ends",
      "the newest 100 a day",
      "downloads it",
      "once a month",
      "two months",
      "a year after",
      "nflverse",
    ]) {
      expect(text, cut).not.toContain(cut);
    }
  });

  it("the detailed part (after the short version) stays within the planner's 1,300 words, every feature on (4.2; planner reply to Checkpoint 7b, 3)", () => {
    // The planner asked for "about 1,000 words". Checkpoint 7b reported 1,249 with every feature on: after the duplicates and
    // the log's field list went, the review's additions (what the server holds in memory, when memory copies go, the cookie
    // after a restored session, the contact inbox at Google) and the facts the reply added (the archive, the daily totals,
    // FantasyCalc) are what's over. The review of Phase 7b's corrections (the archive's formats in use, Forget's 15
    // minutes, the log's routine events) fit by dropping the daily totals' formats sentence and a few words. The cap was
    // 1,250 until the planner's reply to Checkpoint 7b, section 3: "Word cap: raise the test's cap to 1,300 words to fit
    // these" (the line on your rights, the daily levels, the prize split: 1,273 with every switch on). Longer needs the planner.
    const detail = (f: PolicyFeatures) => {
      const { text } = privacy(f);
      return text.slice(text.indexOf("Reading your league"));
    };
    expect(wordCount(detail(ALL_ON))).toBeLessThanOrEqual(1_300);
    expect(wordCount(detail(POLICY_FEATURES))).toBeLessThanOrEqual(wordCount(detail(ALL_ON)));
  });
});

describe("privacy page without browser reading (our server reads every league)", () => {
  it.each(WITHOUT_BROWSER)("%o: says our server reads the league, and gets only what it needs to read it again", (f) => {
    const { text } = privacy(f);
    expect(text).toContain(
      "Our server reads your league from ESPN or Sleeper and scores its players' projections with your league's rules. The League page, the trade search and the Trade Analyzer do their math in your browser.",
    );
    expect(text).toContain(
      "When you connect a league, our server reads it from ESPN or Sleeper (a private ESPN league with the ESPN cookies you give it, below) and adds public data to make the Import Report.",
    );
    expect(text).toContain(
      "Opening the League page has our server read your league again (usually from its short-lived copy) and add projections and trade values for its players; it gets only what it needs to read the league (its ID and season, and a Sleeper username).",
    );
    expect(text).toContain("A Sleeper username you enter is used only to find your leagues and your team. Your browser saves it with those leagues, to find your team again.");
    expect(text).toContain("Our server keeps copies of what it reads for a limited time (league data for about 10 minutes), filed under codes that hide league IDs, then deletes them.");
  });

  it.each(WITHOUT_BROWSER)("%o: says nothing of the browser reading leagues, or of what it sends", (f) => {
    const { text } = privacy(f);
    for (const claim of ["Your browser reads public ESPN leagues", "your browser reads it straight from ESPN or Sleeper", "sends the saved league to our server", "your browser (or our server", "your browser sends", "it reads itself"]) {
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
  it.each(WITH_BROWSER)("%o: says the browser reads public ESPN and Sleeper leagues itself, without cookies, what those sites see, and what our server does with what it's sent (fact 1)", (f) => {
    const { text } = privacy(f);
    expect(text).toContain(
      "Your browser reads public ESPN leagues and Sleeper leagues straight from ESPN and Sleeper, and sends our server only the parts Offer Sheet needs. Our server still reads some leagues itself, such as private ESPN leagues.",
    );
    expect(text).toContain(
      `Your browser reads public ESPN and Sleeper leagues without cookies, but as with any site, ESPN and Sleeper see your IP address, which league it asks for, and that the request comes from Offer Sheet. It sends our server only the parts Offer Sheet uses (the ones it saves, below, and extras such as ESPN's projections). Our server doesn't save them, but holds the numbers it works out from them in memory for up to ${durationWords(browserFetchLimits.tokenMaxAgeMs)}.`,
    );
    // Review of Checkpoint 7b's text: not "never keeps" (the model routes keep what they built from a saved league in memory).
    expect(text).toContain(
      "Our server keeps copies of what it reads itself for a limited time (league data for about 10 minutes), filed under codes that hide league IDs, then deletes them. It never adds the league data your browser sends it to those copies.",
    );
    expect(text).not.toMatch(/never keeps|doesn't keep them/);
  });

  it("what our server holds in memory from a saved league: the model routes' answers, in memory only, until the import's token runs out, 15 minutes after the league was read", () => {
    expect(durationWords(browserFetchLimits.tokenMaxAgeMs)).toBe("15 minutes");
    for (const route of ["src/app/api/model/espn/handler.ts", "src/app/api/model/sleeper/handler.ts"]) {
      expect(source(route), route).toMatch(/memo\(\)\.set\(key, text, body\.signed\.issuedAt \+ browserFetchLimits\.tokenMaxAgeMs, now\.getTime\(\)\)/);
    }
    // In the instance's memory, never at Upstash (no Redis in the memo), and nothing served once due.
    const memo = source("src/app/api/model/memo.ts");
    expect(codeOf(memo)).not.toMatch(/redis|Redis/);
    expect(memo).toMatch(/if \(now >= e\.expiresAt\) \{\s*drop\(key\);\s*return undefined;/);
  });

  it.each(WITH_BROWSER)("%o: lists when our server reads a league itself, and what the Sleeper username and the League page send (reviews POL-11, POL-12, POL-13)", (f) => {
    const { text } = privacy(f);
    // A league imported with ESPN cookies stays the server's to read (src/lib/modelStore.ts modelPlan, the Import Report's
    // Refresh: ImportResponse.usedEspnCookies), even after the cookies are forgotten; a saved copy the server can't check
    // (src/server/importToken.ts) is read again on the server.
    expect(text).toContain(
      "Our server reads a league itself for private ESPN leagues and any ESPN league imported with ESPN cookies (even after you forget them), when your browser can't (some ad blockers and networks block it), and when our server can't use the copy your browser saved.",
    );
    expect(text).toContain(
      "If you enter a Sleeper username, your browser (or our server, if your browser can't) asks Sleeper which leagues it's in. The username is saved with those leagues and sent to our server with their requests, only to find your team.",
    );
    expect(text).toContain("Opening the League page sends the saved league to our server, which adds projections and trade values for its players.");
  });
});

describe("privacy page without anonymous feedback (feedback stays in the browser)", () => {
  it.each(WITHOUT_FEEDBACK)("%o: names no feedback the server keeps, and no way to turn it off", (f) => {
    const { html, text } = privacy(f);
    for (const claim of ["Anonymous feedback", "anonymous copy", "Share anonymous feedback", "12 months", "random code", "copies already sent", "turn sharing off"]) expect(text).not.toContain(claim);
    expect(links(html).filter((l) => l.href === "/settings" || l.href === "/feedback")).toEqual([]);
  });
});

describe("privacy page with anonymous feedback (track FB)", () => {
  it.each(WITH_FEEDBACK)("%o: lists what the anonymous copy holds and never holds, and that it can't be tied to you but could point to a public league (fact 4; reviews POL-3, POL-9, POL-10, SEC-6)", (f) => {
    const { text } = privacy(f);
    expect(text).toContain(
      "When you mark what happened to a trade idea or report a problem with it, your browser also sends Offer Sheet an anonymous copy, to help improve it: never your league's ID, names, usernames or the notes you type. We keep it for up to 12 months. You can turn this off in Settings.",
    );
    // "main scoring settings": src/lib/feedbackEvent.ts FeedbackEventFormat's points per catch, per passing touchdown and
    // tight-end premium; its slots by the positions they take; superflex is a lineup spot. The reward setting: how the title
    // is weighed against the playoffs, and with prizeShares (Checkpoint 7c; planner reply to Checkpoint 7b, sections 3 and
    // 6) the prize split, in the planner's words.
    expect(text).toContain(
      `Each anonymous copy is used only to improve Offer Sheet. It holds what you pressed and which version you sent; the platform, season and week; your league's format (teams, league type, main scoring settings, lineup and playoff spots) and ${f.prizeShares ? PRIZE_WORDS : WEIGH_WORDS}; the players as ID numbers with positions; Offer Sheet's numbers for the trade and what they came from; a random code that links later changes to the same record; and the date it arrived.`,
    );
    expect(text).not.toContain(f.prizeShares ? WEIGH_WORDS : PRIZE_WORDS);
    expect(text).toContain(
      "It never holds your league's ID in any form, team IDs, team or owner names, usernames, ESPN member IDs, cookies, your IP address or your notes. Only your browser, and a file you export, can tell which copies are yours, though the players, format and week could lead someone who searched public leagues to yours. We never try to match copies to anyone.",
    );
    // The setting is named by what it weighs, not its label (Checkpoint 7b rewords it: planner reply to Checkpoint 7a, 5.2).
    expect(text).not.toContain("What matters most");
  });

  it.each(WITH_FEEDBACK)("%o: keeps it up to 12 months, says it's studied only in totals once that's so, promises no downloads, and says how to turn it off (4.3)", (f) => {
    const { html, text } = privacy(f);
    expect(feedbackLimits.retainDays).toBe(365);
    const totals = " When we study it, we keep only totals and the numbers our estimates learn from it, never individual copies.";
    expect(text).toContain(`We keep anonymous feedback for up to 12 months, then delete it.${f.feedbackTotalsOnly ? totals : ""} Turning off`);
    if (!f.feedbackTotalsOnly) expect(text).not.toContain("individual copies");
    expect(text).toContain(
      "Turning off “Share anonymous feedback” on the Settings page stops new copies; deleting your saved feedback doesn't take back copies already sent (more on the feedback page ).",
    );
    expect(links(html).filter((l) => l.href === "/settings")).toHaveLength(1);
    expect(links(html).filter((l) => l.href === "/feedback")).toHaveLength(1);
    for (const claim of ["developer", "downloads it", "a year"]) expect(text).not.toContain(claim);
  });
});

describe("terms page (Part B, B3; Checkpoint 7b: planner reply to Checkpoint 7a, 4 'Terms')", () => {
  it.each(ALL)("%o: is dated, has its sections in order, and ends with Offer Sheet's contact address", (f) => {
    const { html, text } = terms(f);
    expect(TERMS_LAST_UPDATED).toBe("October 13, 2026"); // the launch day (Parker, 2026-10-07)
    expect(text).toContain("Last updated October 13, 2026");
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
    expect(text.trim().endsWith(`Contact: ${CONTACT_EMAIL}`)).toBe(true);
    expect(links(html).filter((l) => l.href === `mailto:${CONTACT_EMAIL}`)).toHaveLength(1);
  });

  it.each(ALL)("%o: says what Offer Sheet is: free, non-commercial, a beta, read-only, no accounts", (f) => {
    expect(terms(f).text).toContain(
      "Offer Sheet is a free, non-commercial project, offered as a beta. It reads your fantasy football league and suggests trades. It only reads: it never sends offers, changes lineups or posts anything for you. There are no accounts, no ads and nothing to buy.",
    );
  });

  it.each(ALL)("%o: says its own numbers are estimates (“Helps them” once it ships) and the decisions are yours, that FantasyCalc's values are used but never shown once nothing shows them, and names the sources (reviews PG-2, POL-21; 5.4; Checkpoint 7c)", (f) => {
    const { text } = terms(f);
    // “Helps them” too once it ships (helpsThem; Checkpoint 7c: planner reply to Checkpoint 7b, sections 3 and 7).
    expect(text).toContain(f.helpsThem ? ESTIMATES_WITH_HELPS_THEM : ESTIMATES);
    if (!f.helpsThem) expect(text).not.toContain("Helps them");
    expect(text).not.toContain("the trade values it shows");
    expect(text).toContain("You decide what to offer and what to accept, and those decisions are yours.");
    expect(text).toContain(
      `League data comes from ESPN and Sleeper, projections and stats from Sleeper and ESPN, trade values from FantasyCalc${f.fantasyCalcHidden ? " (Offer Sheet uses them in its own numbers and doesn't show them)" : ""}, player ID maps from DynastyProcess, and the NFL schedule from ESPN.`,
    );
    if (!f.fantasyCalcHidden) expect(text).not.toContain("doesn't show them");
    expect(text).toContain("ESPN's league data comes through an unofficial interface that ESPN doesn't support, so it can change or stop working at any time.");
    expect(text).toContain("It is not affiliated with, endorsed by or sponsored by ESPN, Sleeper, Yahoo, Fleaflicker, MyFantasyLeague, Fantrax, FantasyCalc, DynastyProcess or the NFL.");
    // The app downloads nothing from nflverse (src/data/nflSchedule.ts reads ESPN's schedule).
    expect(text).not.toContain("nflverse");
  });

  it.each(ALL)("%o: 'Your part' in the planner's words: age 13, leagues you may view, no collecting information about others, cookies kept private, no scraping or reselling", (f) => {
    const { html, text } = terms(f);
    expect(text).toContain("You must be at least 13 to use Offer Sheet. When you use it, you agree to these rules:");
    const part = /<h2[^>]*>Your part<\/h2>[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? "";
    expect([...part.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => textOf(m[1] ?? "").trim())).toEqual([
      "connect only leagues you're in, or leagues you're allowed to view (Sleeper leagues are public; an ESPN league is public only if its manager made it viewable);",
      "don't use Offer Sheet to collect information about other people;",
      "keep your ESPN cookies private: they work like a password, so never share them, and paste them into Offer Sheet only on a computer you trust;",
      "don't scrape Offer Sheet, point automated tools at it, overload it, or get around its limits;",
      "don't sell, republish or reuse Offer Sheet's numbers or data, commercially or in bulk.",
    ]);
  });

  it.each(ALL)("%o: says saved leagues stay until removed or the browser clears them, as the privacy page explains (review PG-7), and that there's no warranty", (f) => {
    const { text } = terms(f);
    expect(text).toContain("The leagues you saved stay in your browser until you remove them or your browser clears them (the privacy policy says when).");
    expect(text).toContain("Offer Sheet is provided “as is”, without warranties of any kind.");
  });

  it.each(WITHOUT_FEEDBACK)("%o: says feedback stays in the browser (linking the privacy policy), with no opt-out to name", (f) => {
    const { html, text } = terms(f);
    expect(text).toContain("When you mark what happened to a trade idea or report a problem with one, it's saved in your browser only: Offer Sheet doesn't receive it. The privacy policy says what's kept.");
    expect(links(html).map((l) => l.href)).toEqual(["/privacy", `mailto:${CONTACT_EMAIL}`]);
    expect(text).not.toContain("anonymous");
  });

  it.each(WITH_FEEDBACK)("%o: says feedback is anonymous with an opt-out (linking the privacy policy and Settings)", (f) => {
    const { html, text } = terms(f);
    expect(links(html).map((l) => l.href)).toEqual(["/privacy", "/settings", `mailto:${CONTACT_EMAIL}`]);
    expect(text).toContain("Offer Sheet may use an anonymous copy to improve its estimates and fix what it gets wrong.");
    // Review POL-9: the privacy policy lists what's sent, summarizing some of it, so not "exactly".
    expect(text).toContain("The privacy policy says what's sent.");
    expect(text).not.toContain("exactly");
    expect(text).toContain("You can turn it off in Settings .");
  });

  it.each(ALL)("%o: the footer and the terms name the same services Offer Sheet isn't affiliated with (review POL-23)", (f) => {
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
    expect(named(terms(f).text, "affiliated with, endorsed by or sponsored by ")).toEqual(footer);
  });
});

describe("feedback page (Part B, B3)", () => {
  it.each(ALL)("%o: explains the buttons on every trade idea, and has no form (nothing the public types is stored on the server), only the contact address", (f) => {
    const { html, text } = feedback(f);
    expect(text).toContain("Each trade idea on the Trade Finder and the Trade Analyzer has buttons for what happened: Sent, Accepted, Rejected and Countered.");
    // Review POL-20: the button reads "Report a problem", and its note goes with any reason.
    expect(source("src/components/trades/FeedbackControls.tsx")).toContain("Report a problem<span");
    expect(text).toContain(
      "If something looks wrong, press “Report a problem” and pick a reason (Doesn't help me, They'd never accept, Player info is wrong, League settings look wrong, or Other), and add a note if you like.",
    );
    expect(text).toContain("Every press is saved with that league in this browser.");
    expect(html).not.toMatch(/<(form|textarea|input)\b/);
    expect(text).toContain(`Contact: ${CONTACT_EMAIL}`);
  });

  it.each(WITHOUT_FEEDBACK)("%o: says presses stay in this browser and nothing is sent, with Export feedback", (f) => {
    const { html, text } = feedback(f);
    expect(text).toContain("Here's how to record what happens to Offer Sheet's trade ideas, and how to reach us.");
    expect(text).toContain("It stays in this browser, notes included: Offer Sheet doesn't receive it.");
    // The export leaves out the value ratios (planner reply to Checkpoint 7b, Q5: "Keep the feedback page's sentence about
    // the export accurate"; feedbackStore.ts EXPORT_LEFT_OUT), so never "everything".
    expect(text).toContain("“Export feedback” on the Settings page downloads what you've saved as a file, notes included. It leaves out the trade-value comparisons behind Offer Sheet's estimates.");
    expect(text).not.toContain("everything you've saved");
    expect(text).toContain("The privacy policy says what's kept.");
    expect(text).not.toContain("anonymous");
    expect(links(html).map((l) => l.href)).toEqual(["/settings", "/privacy", `mailto:${CONTACT_EMAIL}`]);
    expect(feedbackDescription(f)).toBe("How to record what happens to Offer Sheet's trade ideas, and how to reach us.");
  });

  it.each(WITH_FEEDBACK)("%o: says what the anonymous copy holds, that notes stay, and how to turn it off", (f) => {
    const { html, text } = feedback(f);
    expect(text).toContain("Offer Sheet learns from what happens to its trade ideas. Here's how to tell it.");
    expect(text).toContain("A note you type with a report stays in this browser. It's never sent.");
    expect(text).toContain("To stop sending copies, turn off “Share anonymous feedback” on the Settings page");
    // The export leaves out the value ratios the anonymous copies keep (planner reply to Checkpoint 7b, Q5).
    expect(text).toContain("“Export feedback”, also on the Settings page, downloads what you've saved as a file, notes included. It leaves out the trade-value comparisons behind Offer Sheet's estimates.");
    expect(text).not.toContain("everything you've saved");
    expect(text).toContain("Never your league's ID, names or usernames.");
    expect(text).toContain("an anonymous copy also goes to Offer Sheet, to help improve it:");
    // Review POL-9: not "exactly" (the policy summarizes some fields).
    expect(text).toContain("The privacy policy lists what's sent and how long it's kept.");
    expect(text).not.toContain("exactly");
    expect(links(html).map((l) => l.href)).toEqual(["/settings", "/privacy", `mailto:${CONTACT_EMAIL}`]);
    // Review POL-19: sharing is on unless turned off, so not "only if you want to".
    expect(feedbackDescription(f)).toBe("How to tell Offer Sheet what happened to its trade ideas, or what went wrong. The copies it gets are anonymous, and you can turn them off.");
  });
});

describe("Checkpoint 7c's switches change only their own words (planner reply to Checkpoint 7b, section 3)", () => {
  // Each switch, turned on alone from every way the others can stand, changes its own sentence on its own page, shown only
  // where its sentence is (the archive with publicArchive, the anonymous copy with anonymousFeedback), and nothing else on
  // the privacy policy, the terms or the feedback page: so sections 6 and 7 can turn theirs on whenever they ship.
  const SWITCHES = [
    { flag: "dailyLevels", page: "privacy", on: ARCHIVE_WITH_LEVELS, off: ARCHIVE, shown: (f: PolicyFeatures) => f.publicArchive },
    { flag: "prizeShares", page: "privacy", on: PRIZE_WORDS, off: WEIGH_WORDS, shown: (f: PolicyFeatures) => f.anonymousFeedback },
    { flag: "helpsThem", page: "terms", on: ESTIMATES_WITH_HELPS_THEM, off: ESTIMATES, shown: () => true },
  ] as const;
  const PAGES = { privacy, terms, feedback } as const;

  it.each(SWITCHES.flatMap((s) => ALL.map((f) => [s.flag, f] as const)))("%s, from %o", (flag, base) => {
    const s = SWITCHES.find((x) => x.flag === flag);
    if (!s) throw new Error(flag);
    const on: PolicyFeatures = { ...base, [flag]: true };
    const off: PolicyFeatures = { ...base, [flag]: false };
    for (const [name, render] of Object.entries(PAGES)) {
      const [onText, offText] = [render(on).text, render(off).text];
      if (name !== s.page) {
        expect(onText, name).toBe(offText);
        continue;
      }
      expect(onText.includes(s.on), `${name} shows ${flag}'s words`).toBe(s.shown(on));
      expect(offText.includes(s.on), name).toBe(false);
      expect(onText.replace(s.on, s.off), name).toBe(offText);
    }
  });
});

describe("Offer Sheet's name only, no person's (planner reply to Checkpoint 7a, 3)", () => {
  // No names are listed here: `npm run check:leaks` (the pre-commit check) already fails on any real-name word in src/,
  // which is where every page's words live. These pin the places a person's name would go: the credits, the metadata, the
  // manifest, the sharing image and the contact address.
  const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;

  it("the copyright, the metadata, the manifest and the sharing image name Offer Sheet, and the only address any page shows is Offer Sheet's own", async () => {
    const { metadata } = await import("./layout");
    const manifest = (await import("./manifest")).default();
    expect(SITE_NAME).toBe("Offer Sheet");
    expect(textOf(renderToStaticMarkup(createElement(SiteFooter)))).toContain("© 2026 Offer Sheet");
    expect([metadata.authors, metadata.creator, metadata.publisher]).toEqual([undefined, undefined, undefined]);
    expect([metadata.applicationName, metadata.openGraph?.siteName, metadata.appleWebApp && typeof metadata.appleWebApp === "object" ? metadata.appleWebApp.title : undefined]).toEqual([SITE_NAME, SITE_NAME, SITE_NAME]);
    expect([manifest.name, manifest.short_name]).toEqual([SITE_NAME, SITE_NAME]);
    // The sharing image's words: the name, the home page's headline and the tagline (src/app/opengraph-image.tsx).
    expect(source("src/app/opengraph-image.tsx")).toMatch(/\{SITE_NAME\}[\s\S]*HEADLINE[\s\S]*\{SHARE_IMAGE_TAGLINE\}/);
    expect([SHARE_IMAGE_TAGLINE, SHARE_IMAGE_ALT]).toEqual(["Free · ESPN and Sleeper · Beta", "Offer Sheet: trades that help your team, and that your leaguemates will actually accept. Free, for ESPN and Sleeper leagues. Beta."]);
    // The contact address is Offer Sheet's own, and no page shows any other.
    expect(CONTACT_EMAIL).toBe("offersheet.app@gmail.com");
    const shown: Array<[string, string]> = [
      ["privacy", privacy(POLICY_FEATURES).text],
      ["terms", terms(POLICY_FEATURES).text],
      ["feedback", feedback(POLICY_FEATURES).text],
      ["home", textOf(renderToStaticMarkup(createElement(Home)))],
      ["footer", textOf(renderToStaticMarkup(createElement(SiteFooter)))],
      ["not found", textOf(renderToStaticMarkup(createElement(NotFound)))],
      ["metadata", JSON.stringify([metadata, privacyMetadata, termsMetadata, feedbackMetadata, manifest])],
    ];
    for (const [where, text] of shown) expect([...text.matchAll(EMAIL)].map((m) => m[0]).filter((e) => e !== CONTACT_EMAIL), where).toEqual([]);
    // The terms speak of Offer Sheet's "maker", never a named one.
    expect(terms(POLICY_FEATURES).text).toContain("As far as the law allows, its maker isn't liable");
  });

  it("no tracking or analytics: no analytics or error-tracking package, and production scripts load only from the site itself", () => {
    const pkg = JSON.parse(source("package.json")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(names.filter((n) => /analytics|speed-insights|posthog|mixpanel|segment|gtag|plausible|amplitude|hotjar|sentry|datadog|logrocket/i.test(n))).toEqual([]);
    const csp = Object.fromEntries(contentSecurityPolicy({ vercelPreview: false }).split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)]));
    expect(csp["script-src"]).toEqual(["'self'", "'unsafe-inline'"]);
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
