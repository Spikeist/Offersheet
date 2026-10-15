/**
 * `npm run check:browser`: the parts that run without a browser (options, finding Chrome, the report and its name
 * cleaning, the server helpers, the sort and anchor rules, and Checkpoint 7b's rules: contracts.ts) and a syntax check of
 * the in-page JavaScript, which TypeScript never sees; the page's name replacer is also run here, against report.ts's, on
 * the same texts, and the server-HTML link reader on the footer as React renders it. The steps themselves need the
 * production build and Chrome: the script is their test. Every name here is fictional.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReportView } from "@/components/import/ReportView";
import { LeagueView } from "@/components/league/LeagueView";
import { PlayerDetail } from "@/components/league/PlayerTable";
import { leagueFixture, NOW as LEAGUE_NOW } from "@/components/league/testFixtures";
import { ValuesCredit } from "@/components/league/ValuesCredit";
import { SiteFooter } from "@/components/SiteFooter";
import { GOAL_LABEL, PRIZE_LABEL, PRIZE_TEXT_MESSAGES, PRIZES_HELP, PRIZES_LEGEND, buildSettingsView, prizeAmountText } from "@/components/settings/settingsView";
import { snapshot as settingsSnapshot } from "@/components/settings/testFixtures";
import { AnalysisResult } from "@/components/trades/AnalyzerPage";
import { evaluation, searchResult, steppedFull, tradeFantasyCalc, tradeSnapshot } from "@/components/trades/testFixtures";
import { TradeCard } from "@/components/trades/TradeCard";
import { FinderFrame } from "@/components/trades/TradeFinderPage";
import { config } from "@/engine/config";
import type { PlayerBlend } from "@/engine/leagueModel";
import type { LeagueSnapshot } from "@/engine/model";
import { titleDeltas } from "@/engine/reward";
import { PRIZE_KEYS, defaultTradeSettings, type TradeSettings } from "@/engine/settings";
import type { PartnerNumbers, TradeEvaluation } from "@/engine/tradeModel";
import { planBFixture } from "@/engine/tradeTestFixtures";
import type { ImportResponse } from "@/lib/api";
import { buildImportReport } from "@/lib/importReport";
import { buildLeagueView } from "@/lib/leagueView";
import { NOTICE_TEXT, UNKNOWN_SETTING_NOTICE } from "@/lib/notices";
import { bestTimeText, buildAnalysisView, buildFinderView, buildTradeCard, PROJECTIONS_SOURCE, SORT_OPTIONS } from "@/lib/tradeView";
import { RATING_PENDING_TEXT } from "@/lib/waiversView";
import { DEFAULT_MAX_SEARCH_SECONDS, SECOND_LEAGUE, USAGE, parseArgs, resolveArgs, type CheckBrowserArgs } from "./args";
import { chromeArgs, chromeCandidates, devtoolsUrl, exited, findChrome, killTree, waitForDevtools } from "./chrome";
import {
  APP_PAGES as CONTRACT_APP_PAGES,
  analyzerPartnerLineProblems,
  attributesOf,
  BLEND_WORDS,
  bareValueNumbers,
  breakdownLeaks,
  cardHelpsBoth,
  codeTokens,
  creditProblems,
  decodeEntities,
  DYNASTYPROCESS_DATA_URL,
  dynastyProcessLinkIssues,
  dynastyProcessLinksInHtml,
  fantasyCalcLinkIssues,
  fantasyCalcLinksInHtml,
  finderPartnerLineProblems,
  foreignResourcesInHtml,
  isDynastyProcessHref,
  linksInHtml,
  freshnessLineOk,
  headlineTopProblems,
  helpsBothListProblems,
  helpsBothStatusOk,
  helpsBothTagProblems,
  internalPaths,
  invalidPrizeProblems,
  isFantasyCalcHref,
  NAV_HREFS,
  noticeCount,
  noticeLeaks,
  oddsLabelProblems,
  pageValueLeaks,
  PARKER_QUIET_LINE,
  playoffWeightRead,
  prizeGroupProblems,
  requestNamesAddress,
  rowCount,
  valueLeaks,
  VALUES_CREDIT,
  waiverMoveProblems,
  waiverToggleKind,
  type CreditRead,
  type PrizeGroupRead,
  type WaiverMoveRead,
} from "./contracts";
import {
  CARD_HELPERS,
  CHECKED_GOAL,
  cleanCall,
  CSP_MARK,
  goalChoice,
  INSTRUMENT,
  NAME_REPLACER,
  PAGE_HELPERS,
  PLAYOFF_WEIGHT_SHOWN,
  READ_CARD_ODDS,
  READ_CARD_TEXTS,
  READ_FANTASYCALC_LINKS,
  READ_FINDER_NOTICES,
  READ_FINDER_TIMING,
  READ_IMPORT_NOTICES,
  READ_LEAGUE_VALUES,
  READ_MY_ODDS,
  READ_NAV_LINKS,
  READ_NOTICE_BANNERS,
  READ_PRIZE_LEAGUE,
  READ_SETTINGS_PRIZES,
  READ_SETTINGS_SCORING,
  READ_TRADING_LEAGUE,
  READ_WAIVERS,
  RESTORE_CALL,
  sanitizeCall,
  STOP_PLAYOFF_WEIGHT,
  typePrize,
  WAIVER_SHOW_ALL,
  waiverToggle,
  WATCH_PLAYOFF_WEIGHT,
} from "./inPage";
import { consoleCallKind, cspIssueText, isPlatformHost, isPlatformRead, isPrefetchRequest, keptText, logEntryKind, platformReadText, TEXT_KEEP_MAX } from "./page";
import {
  CheckReport,
  cleanValue,
  compileNameRules,
  cutText,
  formatLine,
  INFO_NOTE,
  leagueNamesScrubber,
  leftoverChecker,
  leftoverNames,
  mergeLeagueNames,
  nameRules,
  ownerNames,
  placeholderPairs,
  replaceNames,
  summaryLines,
  withholdLeftovers,
  WITHHELD,
  type LeagueNames,
} from "./report";
import { freePort, newestChange, productionBuild, StartError, startNextServer } from "./server";
import {
  APP_PAGES,
  BACK_LINK,
  bestTimeExpectation,
  expectedPrizeSplit,
  expectedTopPlaces,
  FINDER_DONE,
  FINDER_DONE_STATUS,
  freshnessExpectation,
  GOAL_CHOICES,
  isMissingPage404,
  MISSING_PAGE,
  NARROW_PHONE_WIDTH,
  noTopReason,
  parkersLeague,
  READ_SITE_FILES,
  readPathOf,
  sameRow,
  siteFileChecks,
  sidelessCards,
  skipReason,
  sortInversions,
  SORTS,
  STATIC_PAGES,
  STEPS,
  TECHNICAL_DETAILS,
  togglePressed,
  WAIVER_RATING_WAIT_MS,
  WAIVERS_HREF,
  WAIVERS_REVEALED,
  type SiteFiles,
  type TradingLeague,
} from "./steps";

const parsed = (argv: string[]) => {
  const p = parseArgs(argv);
  if ("error" in p) throw new Error(p.error);
  return p;
};
const resolved = (argv: string[], env: Record<string, string> = {}): CheckBrowserArgs => {
  const r = resolveArgs(parsed(argv), env);
  if ("error" in r) throw new Error(r.error);
  return r.args;
};

describe("options", () => {
  it("defaults: no network (--live off), the Import Report's team, headless, screenshots, §12's 10 seconds, one league", () => {
    expect(resolved([])).toEqual({ live: false, team: null, show: false, shots: true, maxSearchSeconds: DEFAULT_MAX_SEARCH_SECONDS, secondLeague: false, help: false });
    expect(DEFAULT_MAX_SEARCH_SECONDS).toBe(10);
  });

  it("reads --live, --team, --show, --no-shots, --max-search, --second-league and --help, with a space or an equals sign", () => {
    expect(resolved(["--live", "--team", "3", "--show", "--no-shots", "--max-search", "12"])).toEqual({ live: true, team: "3", show: true, shots: false, maxSearchSeconds: 12, secondLeague: false, help: false });
    // npm run check:browser --live --team=3 (the "--" left out, or dropped by the shell): npm kept both for itself.
    expect(resolved([], { npm_config_live: "true", npm_config_team: "3" })).toMatchObject({ live: true, team: "3" });
    expect(USAGE).toContain("npm run check:browser -- --live --team 3");
    expect(resolved(["--second-league"]).secondLeague).toBe(true);
    // The second league is the public ESPN test league of CLAUDE.md §17 Phase 0.
    expect(SECOND_LEAGUE).toEqual({ leagueId: "899513", season: "2026" });
    expect(resolved(["--team=7"]).team).toBe("7");
    expect(resolved(["-h"]).help).toBe(true);
  });

  it("refuses what it can't use, saying how", () => {
    expect(parseArgs(["--team"])).toEqual({ error: "--team needs a team id, for example --team 3." });
    expect(parseArgs(["--team", "../3"])).toEqual({ error: "--team needs a team id, for example --team 3." });
    expect(parseArgs(["--max-search", "0"])).toMatchObject({ error: expect.stringContaining("--max-search") });
    expect(parseArgs(["--max-search", "soon"])).toMatchObject({ error: expect.stringContaining("--max-search") });
    expect(parseArgs(["--teams", "3"])).toMatchObject({ error: expect.stringContaining("Unknown option: --teams") });
    expect(resolveArgs(parsed(["3"]), {})).toMatchObject({ error: expect.stringContaining("Unexpected argument: 3") });
  });

  it("takes the options npm kept for itself when the '--' was left out or dropped (seen with npm 10 on Windows PowerShell)", () => {
    // npm run check:browser --team 3 --show --no-shots
    expect(resolved(["3"], { npm_config_team: "true", npm_config_show: "true", npm_config_shots: "" })).toMatchObject({ team: "3", show: true, shots: false });
    // npm run check:browser --team=3 --max-search=15
    expect(resolved([], { npm_config_team: "3", npm_config_max_search: "15" })).toMatchObject({ team: "3", maxSearchSeconds: 15 });
    // npm run check:browser --second-league
    expect(resolved([], { npm_config_second_league: "true" }).secondLeague).toBe(true);
    expect(resolved([], { npm_config_shots: "false" }).shots).toBe(false);
    // npm run check:browser --max-search 15
    expect(resolved(["15"], { npm_config_max_search: "true" }).maxSearchSeconds).toBe(15);
    // The command line wins.
    expect(resolved(["--team", "5"], { npm_config_team: "3" }).team).toBe("5");
    expect(resolved(["--max-search", "8"], { npm_config_max_search: "15" }).maxSearchSeconds).toBe(8);
    expect(resolveArgs(parsed([]), { npm_config_team: "a/b" })).toEqual({ args: expect.objectContaining({ team: null }) });
  });

  it("says to put '--' first when npm split two options from their values (it doesn't say which was whose)", () => {
    // npm run check:browser --team 3 --max-search 15
    const both = resolveArgs(parsed(["3", "15"]), { npm_config_team: "true", npm_config_max_search: "true" });
    expect(both).toMatchObject({ error: expect.stringContaining('npm kept --team and --max-search for itself: put "--" before the options') });
    expect(resolveArgs(parsed(["x/y"]), { npm_config_team: "true" })).toEqual({ error: "--team needs a team id, for example --team 3." });
    expect(resolveArgs(parsed(["soon"]), { npm_config_max_search: "true" })).toMatchObject({ error: expect.stringContaining("--max-search") });
  });
});

describe("finding Chrome", () => {
  const WIN = { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)", LOCALAPPDATA: "C:\\Users\\someone\\AppData\\Local" };

  it("looks in the standard places, Chrome first, then Chromium and Edge (Windows names in any case)", () => {
    const win = chromeCandidates("win32", WIN);
    expect(win[0]).toBe("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
    expect(win).toContain("C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe");
    expect(win).toContain("C:\\Users\\someone\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe");
    expect(win.at(-1)).toMatch(/msedge\.exe$/);
    expect(chromeCandidates("win32", { PROGRAMFILES: "D:\\Apps" })[0]).toBe("D:\\Apps\\Google\\Chrome\\Application\\chrome.exe");
    const mac = chromeCandidates("darwin", { HOME: "/Users/someone" });
    expect(mac.slice(0, 2)).toEqual(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Users/someone/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]);
    const linux = chromeCandidates("linux", { PATH: "/usr/local/bin:/usr/bin" });
    expect(linux.slice(0, 2)).toEqual(["/usr/local/bin/google-chrome", "/usr/bin/google-chrome"]);
    expect(linux).toContain("/usr/bin/chromium");
  });

  it("uses CHROME_PATH when it names a file, says so when it doesn't, and says where it looked when nothing is found", () => {
    const only = (p: string) => (q: string) => q === p;
    expect(findChrome({ platform: "linux", env: { CHROME_PATH: "/opt/c/chrome", PATH: "/usr/bin" }, exists: only("/opt/c/chrome") })).toEqual({ path: "/opt/c/chrome" });
    expect(findChrome({ platform: "linux", env: { CHROME_PATH: "/opt/c/typo", PATH: "/usr/bin" }, exists: only("/usr/bin/google-chrome") })).toMatchObject({ error: expect.stringContaining("CHROME_PATH is set") });
    expect(findChrome({ platform: "win32", env: WIN, exists: only("C:\\Users\\someone\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe") })).toEqual({
      path: "C:\\Users\\someone\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
    });
    expect(findChrome({ platform: "darwin", env: {}, exists: () => false })).toMatchObject({ error: expect.stringContaining("set CHROME_PATH") });
  });

  it("runs it headless with a throwaway profile and DevTools on a port it picks", () => {
    const args = chromeArgs("D:\\x y\\profile", false);
    expect(args).toEqual(expect.arrayContaining(["--headless=new", "--remote-debugging-port=0", "--user-data-dir=D:\\x y\\profile", "--no-first-run", "--disable-extensions"]));
    expect(chromeArgs("p", true)).not.toContain("--headless=new");
    expect(devtoolsUrl("\nDevTools listening on ws://127.0.0.1:52011/devtools/browser/ab-12\n")).toBe("ws://127.0.0.1:52011/devtools/browser/ab-12");
    expect(devtoolsUrl("starting…")).toBeNull();
  });
});

describe("the report", () => {
  it("counts the checks and fails when any failed", () => {
    const r = new CheckReport();
    const seen: string[] = [];
    r.onLine = (l) => seen.push(`${l.step}:${l.status}`);
    r.ok("Connect", "fine");
    expect(r.check("League", false, "ok text", "fail text", ["a"])).toBe(false);
    r.skip("Analyzer", "no team");
    r.note("Trade Finder", "searchSeconds", 4.2);
    expect([r.count("ok"), r.count("FAIL"), r.count("skip"), r.failed()]).toEqual([1, 1, 1, true]);
    expect(seen).toEqual(["Connect:ok", "League:FAIL", "Analyzer:skip"]);
    expect(r.numbers).toEqual({ "Trade Finder": { searchSeconds: 4.2 } });
    expect(summaryLines(r)).toEqual(["1 passed, 1 failed, 1 skipped.", "Failed in: League."]);
    const clean = new CheckReport();
    clean.ok("Connect", "fine");
    expect(summaryLines(clean)).toEqual(["1 passed, 0 failed, 0 skipped.", "All checks passed."]);
  });

  it("says where the league's data differs from what a check expected (info) without failing the run (Phase 7b)", () => {
    const r = new CheckReport();
    r.ok("Notices", "fine");
    r.info("Notices", "Parker's league shows 1 notice (the planner expected none)", ["Some player has no projections."]);
    expect([r.count("info"), r.failed()]).toEqual([1, false]);
    expect(summaryLines(r)).toEqual(["1 passed, 0 failed, 0 skipped, 1 to look at.", "All checks passed.", INFO_NOTE]);
    expect(formatLine(r.lines[1]!)).toEqual(["  info  Parker's league shows 1 notice (the planner expected none)", "          - Some player has no projections."]);
    r.fail("League", "a code shows");
    expect(summaryLines(r)).toEqual(["1 passed, 1 failed, 0 skipped, 1 to look at.", "Failed in: League.", INFO_NOTE]);
  });

  it("prints a line with its first details", () => {
    const details = Array.from({ length: 10 }, (_, i) => `d${i}`);
    const lines = formatLine({ step: "League", status: "FAIL", text: "2 tap targets under 44 px", details }, 3);
    expect(lines).toEqual(["  FAIL  2 tap targets under 44 px", "          - d0", "          - d1", "          - d2", "          - and 7 more"]);
    expect(formatLine({ step: "x", status: "ok", text: "fine", details: [] })).toEqual(["  ok    fine"]);
  });

  it("replaces team, owner (each co-owner too) and league names with placeholders, longest first, keeping player names whole", () => {
    const names = {
      leagueName: "Fictional Dynasty League",
      teams: [
        { id: "3", name: "Gravel Gophers", ownerName: "Drake" },
        { id: "9", name: "Gophers", ownerName: "Quincy Vale & Rowan Vale" },
      ],
      players: ["Drake Moorcroft", "Tess Calloway"],
    };
    expect(ownerNames("Quincy Vale & Rowan Vale")).toEqual(["Quincy Vale & Rowan Vale", "Quincy Vale", "Rowan Vale"]);
    expect(ownerNames("  ")).toEqual([]);
    const pairs = placeholderPairs(names);
    expect(pairs[0]).toEqual(["Quincy Vale & Rowan Vale", "Owner 9"]);
    expect(pairs).toContainEqual(["Gravel Gophers", "Team 3"]);
    expect(pairs).toContainEqual(["Fictional Dynasty League", "<league name>"]);
    const s = leagueNamesScrubber(names);
    expect(s.scrubText("Trade with Gravel Gophers (Drake): you give Drake Moorcroft to Gophers, run by Rowan Vale, in Fictional Dynasty League.")).toBe(
      "Trade with Team 3 (Owner 3): you give Drake Moorcroft to Team 9, run by Owner 9, in <league name>.",
    );
    expect(s.scrubText("GRAVEL GOPHERS")).toBe("Team 3");
    expect(s.scrubText("gRaVeL gOpHeRs")).toBe("Team 3");
  });

  it("cleans a second league's names too (--second-league): its teams as Team L2-<id>, its league name as <league name>", () => {
    const first = { leagueName: "Fictional League", teams: [{ id: "3", name: "Gravel Gophers", ownerName: "Drake" }], players: ["Drake Moorcroft"] };
    const second = { leagueName: "Moonbeam Invitational", teams: [{ id: "3", name: "Quasar Quokkas", ownerName: "Rowan Vale" }], players: ["Tess Calloway"] };
    const both = mergeLeagueNames(first, second, "L2-");
    expect(both.teams.map((t) => t.id)).toEqual(["3", "L2-3"]);
    expect(both.players).toEqual(["Drake Moorcroft", "Tess Calloway"]);
    const s = leagueNamesScrubber(both);
    expect(s.scrubText("Gravel Gophers (Drake) in Fictional League; Quasar Quokkas (Rowan Vale) in Moonbeam Invitational")).toBe(
      "Team 3 (Owner 3) in <league name>; Team L2-3 (Owner L2-3) in <league name>",
    );
    expect(leftoverNames("Quasar Quokkas and the Moonbeam Invitational", both)).toBe(2);
    expect(leftoverNames(s.scrubText("Quasar Quokkas and the Moonbeam Invitational"), both)).toBe(0);
    // A third league keeps the second's league name.
    expect(mergeLeagueNames(both, { leagueName: "Third Cup", teams: [], players: [] }, "L3-").alsoLeagueNames).toEqual(["Moonbeam Invitational", "Third Cup"]);
  });

  it("counts the names left in cleaned output, ignoring public player names and names too short to replace", () => {
    const names = { leagueName: "Fictional League", teams: [{ id: "3", name: "Gravel Gophers", ownerName: "Drake" }, { id: "4", name: "Ox" }], players: ["Drake Moorcroft"] };
    const s = leagueNamesScrubber(names);
    expect(leftoverNames(s.scrubText("Team 3 (Drake) gives Drake Moorcroft, in Fictional League; Ox"), names)).toBe(0);
    expect(leftoverNames("Trade with gravel gophers", names)).toBe(1);
    expect(leftoverNames("Drake and the Fictional League", names)).toBe(2);
  });
});

describe("cleaning: a name that holds a player's name, overlaps one or equals one is replaced whole", () => {
  const names: LeagueNames = {
    leagueName: "Fictional League",
    teams: [
      { id: "3", name: "Tess Calloway Fan Club", ownerName: "Tess" },
      { id: "5", name: "Allen Wrench", ownerName: "Quincy Vale" },
    ],
    players: ["Tess Calloway", "Josh Allen"],
  };
  const s = leagueNamesScrubber(names);

  it("a team named after a player: the team's name goes, the player's stays (and the owner inside it too)", () => {
    expect(s.scrubText("Trade with Tess Calloway Fan Club: you give Tess Calloway")).toBe("Trade with Team 3: you give Tess Calloway");
    // What the old cleaning printed: the check now finds it.
    expect(leftoverNames("Trade with Tess Calloway Fan Club: you give Tess Calloway", names)).toBe(1);
    expect(leftoverNames("Trade with Team 3: you give Tess Calloway", names)).toBe(0);
  });

  it("a name overlapping a player's name in the text leaves no piece of itself", () => {
    expect(s.scrubText("you give Josh Allen Wrench")).toBe("you give Josh Team 5");
    expect(leftoverNames("you give Josh Allen Wrench", names)).toBe(1);
    // Two names overlapping each other: both placeholders, no piece left.
    const two = leagueNamesScrubber({ teams: [{ id: "1", name: "Alpha Beta" }, { id: "2", name: "Beta Gamma" }], players: [] });
    expect(two.scrubText("Alpha Beta Gamma!")).toBe("Team 1 / Team 2!");
  });

  it("a name equal to a player's name is replaced: the league's names come first", () => {
    const same = { teams: [{ id: "3", name: "Josh Allen" }], players: ["Josh Allen", "Allen Robinson"] };
    expect(leagueNamesScrubber(same).scrubText("Trade with Josh Allen")).toBe("Trade with Team 3");
    expect(leftoverNames("Trade with Josh Allen", same)).toBe(1);
  });
});

describe("cleaning: any case, any gap between words, URL-encoded; twice is once", () => {
  const names: LeagueNames = { teams: [{ id: "3", name: "Gravel  Gophers", ownerName: "Rowan\u00a0Vale" }, { id: "4", name: "A & B Club" }], players: [] };
  const s = leagueNamesScrubber(names);

  it("matches the page's whitespace-collapsed text, non-breaking spaces and URL encodings", () => {
    expect(s.scrubText("Gravel Gophers")).toBe("Team 3");
    expect(s.scrubText("gravel\u00a0gophers")).toBe("Team 3");
    expect(s.scrubText("Rowan Vale")).toBe("Owner 3");
    expect(s.scrubText("/trades?team=Gravel%20Gophers&x=A%20%26%20B%20Club")).toBe("/trades?team=Team 3&x=Team 4");
    expect(s.scrubText("q=Gravel+Gophers")).toBe("q=Team 3");
    expect(leftoverNames(["Gravel Gophers", "x"], names)).toBe(1);
    expect(leftoverNames("x=A%20%26%20B%20Club", names)).toBe(1);
  });

  it("leaves names inside placeholders alone, so cleaning twice changes nothing", () => {
    const short: LeagueNames = { teams: [{ id: "3", name: "Gravel Gophers", ownerName: "Tea" }, { id: "5", name: "Hots", ownerName: "Act" }], players: [] };
    const once = leagueNamesScrubber(short).scrubText("Team 3 vs Team 5 [REDACTED:ESPN_LEAGUE_ID]; tea time with Gravel Gophers");
    expect(once).toBe("Team 3 vs Team 5 [REDACTED:ESPN_LEAGUE_ID]; Owner 3 time with Team 3");
    expect(leagueNamesScrubber(short).scrubText(once)).toBe(once);
    expect(leftoverNames(once, short)).toBe(0);
  });

  it("finds the league id only as a whole number", () => {
    expect(leftoverNames("ids 123456 and 712345", null, ["12345"])).toBe(0);
    expect(leftoverNames("league 12345x", null, ["12345"])).toBe(1);
  });
});

describe("structured output: cleaned before it's serialized, cut after, withheld when a name is left", () => {
  const names: LeagueNames = { teams: [{ id: "3", name: 'The "Gravel" Gophers' }, { id: "4", name: "Back\\slash Bandits" }], players: [] };
  const s = leagueNamesScrubber(names);
  const value = { top: ['The "Gravel" Gophers: Y for Z', "Back\\slash Bandits: A for B"] };

  it("a name with a quote or a backslash is cleaned from the strings, before JSON.stringify escapes it", () => {
    // Serialized first, the names are escaped: neither the cleaning nor a check of the serialized text finds them.
    expect(s.scrubText(JSON.stringify(value))).toBe(JSON.stringify(value));
    expect(leftoverNames(JSON.stringify(value), names)).toBe(0);
    // Cleaned string by string, then serialized: no name.
    expect(JSON.stringify(cleanValue(value, s.scrubText))).toBe(JSON.stringify({ top: ["Team 3: Y for Z", "Team 4: A for B"] }));
    // The check reads the strings themselves.
    expect(withholdLeftovers(value, leftoverChecker(names)).withheld).toBe(2);
    expect(withholdLeftovers(cleanValue(value, s.scrubText), leftoverChecker(names)).withheld).toBe(0);
  });

  it("withholds every string (and key) that still holds a name", () => {
    const got = withholdLeftovers({ a: ["fine", "with The \"Gravel\" Gophers"], b: { 'The "Gravel" Gophers': 1, ok: 2 }, n: 4 }, leftoverChecker(names));
    expect(got).toEqual({ value: { a: ["fine", WITHHELD], b: { [`${WITHHELD} 1`]: 1, ok: 2 }, n: 4 }, withheld: 2 });
  });

  it("cuts only after cleaning: a cut name can't be found any more", () => {
    const long: LeagueNames = { teams: [{ id: "3", name: "Fictional Long Team Name" }], players: [] };
    const text = "See trade ideas with Fictional Long Team Name →";
    const scrub = leagueNamesScrubber(long).scrubText;
    expect(scrub(cutText(text, 41))).toBe("See trade ideas with Fictional Long Team…");
    expect(cutText(scrub(text), 41)).toBe("See trade ideas with Team 3 →");
    expect(cutText("short", 41)).toBe("short");
  });

  it("an event keeps its text whole, or only its length past the cap (never a piece)", () => {
    expect(keptText("TypeError: x")).toBe("TypeError: x");
    expect(keptText("x".repeat(TEXT_KEEP_MAX + 1))).toBe(`(a ${TEXT_KEEP_MAX + 1}-character text, not kept)`);
  });
});

describe("the in-page JavaScript", () => {
  it("compiles (TypeScript never checks it): the instrumentation, the helpers, the card reader, the sanitizer and its undo", () => {
    expect(() => new Function(INSTRUMENT)).not.toThrow();
    expect(() => new Function(`return (async () => {\n${PAGE_HELPERS}\n${CARD_HELPERS}\nreturn measure();\n})`)).not.toThrow();
    const call = sanitizeCall(nameRules({ teams: [{ id: "3", name: "Gravel Gophers", ownerName: "A" }, { id: "4", name: 'quote " and \\ slash' }], players: [] }, [["12345", "<league id>"]]));
    expect(() => new Function(`return (async () => {\n${PAGE_HELPERS}\n${call}\n})`)).not.toThrow();
    expect(() => new Function(`return (async () => {\n${PAGE_HELPERS}\n${RESTORE_CALL}\n})`)).not.toThrow();
    expect(() => new Function(`return (async () => {\n${PAGE_HELPERS}\n${READ_SITE_FILES}\n})`)).not.toThrow();
  });

  it("compiles Checkpoint 7b's readers, with the cleaning prelude where they return page text, and the expressions the steps wait on or tap", () => {
    const clean = cleanCall(nameRules({ leagueName: "Fictional League", teams: [{ id: "3", name: "Gravel Gophers", ownerName: 'quote " and \\ slash' }], players: [] }, [["12345", "<league id>"]]));
    const body = (reader: string) => `return (async () => {\n${PAGE_HELPERS}\n${CARD_HELPERS}\n${clean}\n${reader}\n})`;
    for (const reader of [
      READ_IMPORT_NOTICES,
      READ_CARD_TEXTS,
      READ_FANTASYCALC_LINKS,
      READ_LEAGUE_VALUES,
      READ_NOTICE_BANNERS,
      READ_FINDER_NOTICES,
      READ_FINDER_TIMING,
      READ_TRADING_LEAGUE,
      READ_NAV_LINKS,
      READ_WAIVERS,
      WATCH_PLAYOFF_WEIGHT,
      STOP_PLAYOFF_WEIGHT,
      READ_SETTINGS_SCORING,
    ]) {
      expect(() => new Function(body(reader)), reader.slice(0, 60)).not.toThrow();
    }
    for (const expression of [PLAYOFF_WEIGHT_SHOWN, WAIVER_SHOW_ALL, waiverToggle(1), WAIVERS_REVEALED, togglePressed(2), BACK_LINK]) {
      expect(() => new Function(body(`return (${expression});`)), expression.slice(0, 60)).not.toThrow();
    }
  });

  it("the cleaning prelude replaces the league's names as report.ts does (clean)", () => {
    const names: LeagueNames = { leagueName: "Fictional League", teams: [{ id: "3", name: "BIG_DAWGS Club", ownerName: "Rowan Vale" }, { id: "4", name: "Squad 4000" }], players: ["Tess Calloway"] };
    const rules = nameRules(names, [["12345", "<league id>"]]);
    const clean = new Function(`${cleanCall(rules)}\nreturn clean;`)() as (t: string | null) => string;
    const text = "Trade with BIG_DAWGS Club (Rowan Vale) for Squad 4000's star in Fictional League 12345; Tess Calloway stays.";
    expect(clean(text)).toBe(replaceNames(text, compileNameRules(rules)));
    // A team named like a code or a value is never taken for one once its name is replaced.
    expect(codeTokens(clean(text))).toEqual([]);
    expect(bareValueNumbers(clean(text))).toEqual([]);
    expect(clean(null)).toBe("");
  });

  it("reports every CSP violation the page sees, enforced or report-only, as a console error page.ts counts (Part B)", () => {
    expect(INSTRUMENT).toContain('document.addEventListener(\n    "securitypolicyviolation"');
    expect(INSTRUMENT).toContain(`console.error("${CSP_MARK} " + (e.disposition === "report" ? "report-only " : "")`);
    expect(CSP_MARK).toBe("[check:csp]");
  });

  it("the page's name replacer gives exactly what report.ts gives, on the same texts", () => {
    const page = new Function(`${NAME_REPLACER}\nreturn { replaceNamesIn, compileNames };`)() as {
      replaceNamesIn: (text: string, c: unknown) => string;
      compileNames: (r: unknown) => unknown;
    };
    const leagues: LeagueNames[] = [
      { leagueName: "Fictional Dynasty League", teams: [{ id: "3", name: "Gravel Gophers", ownerName: "Drake" }, { id: "9", name: "Gophers", ownerName: "Quincy Vale & Rowan Vale" }], players: ["Drake Moorcroft"] },
      { teams: [{ id: "3", name: "Tess Calloway Fan Club", ownerName: "Tess" }, { id: "5", name: "Allen Wrench", ownerName: "Tea" }], players: ["Tess Calloway", "Josh Allen"] },
      { teams: [{ id: "1", name: "Alpha Beta" }, { id: "2", name: "Beta Gamma" }, { id: "4", name: "A & B Club" }, { id: "6", name: 'The "Gravel" Gophers' }], players: [] },
    ];
    const texts = [
      "Trade with Gravel Gophers (Drake): you give Drake Moorcroft to Gophers, run by Rowan Vale, in Fictional Dynasty League.",
      "GRAVEL gophers and gravel\u00a0Gophers; Quincy  Vale",
      "Trade with Tess Calloway Fan Club: you give Tess Calloway; Josh Allen Wrench; tea time in Team 3",
      "Alpha Beta Gamma! A%20%26%20B%20Club, a+&+b club, The \"Gravel\" Gophers",
      "league 12345, not 123456 [REDACTED:ESPN_SWID]",
      "",
      "nothing here",
    ];
    for (const names of leagues) {
      const rules = nameRules(names, [["12345", "<league id>"]]);
      const ours = compileNameRules(rules);
      const theirs = page.compileNames(rules);
      for (const text of texts) expect(page.replaceNamesIn(text, theirs)).toBe(replaceNames(text, ours));
    }
  });

  it("the screenshot's replacer keeps the 3-character floor and players' names whole, and the league id as a whole number", () => {
    const page = new Function(`${NAME_REPLACER}\nreturn { replaceNamesIn, compileNames };`)() as {
      replaceNamesIn: (text: string, c: unknown) => string;
      compileNames: (r: unknown) => unknown;
    };
    const rules = nameRules({ teams: [{ id: "5", name: "Pip Squeaks", ownerName: "Pip" }, { id: "9", ownerName: "Al" }], players: ["Tom Pipkins", "Allen Robinson"] }, [["12345", "<league id>"]]);
    const c = page.compileNames(rules);
    expect(page.replaceNamesIn("Tom Pipkins and Allen Robinson play for Pip Squeaks; Pip runs it. Al too.", c)).toBe("Tom Pipkins and Allen Robinson play for Team 5; Owner 5 runs it. Al too.");
    expect(page.replaceNamesIn("league 12345 and 123456", c)).toBe("league <league id> and 123456");
  });
});

describe("what the browser reports (page.ts), Part B: CSP violations count wherever they show", () => {
  it("a browser log line about the Content-Security-Policy is a CSP violation at any level, a report-only one included", () => {
    expect(logEntryKind({ level: "error", source: "security", text: "Refused to load the script 'https://x.example/a.js' because it violates the following Content Security Policy directive: \"script-src 'self'\"." })).toBe("csp violation");
    expect(logEntryKind({ level: "warning", source: "security", text: "[Report Only] Refused to connect to 'https://x.example/' because it violates the following Content Security Policy directive: \"connect-src 'self'\"." })).toBe("csp violation");
    expect(logEntryKind({ level: "verbose", source: "other", text: "content-security-policy: something" })).toBe("csp violation");
  });

  it("other log lines: errors count but the network's (requests are watched apart); anything quieter doesn't", () => {
    expect(logEntryKind({ level: "error", source: "javascript", text: "Uncaught TypeError: x" })).toBe("console error");
    expect(logEntryKind({ level: "error", source: "network", text: "Failed to load resource" })).toBeNull();
    expect(logEntryKind({ level: "warning", source: "other", text: "Something deprecated" })).toBeNull();
  });

  it("a worker's CSP violation, which Chrome files only as an issue (Audits), in words; other issues aren't violations", () => {
    const issue = {
      code: "ContentSecurityPolicyIssue",
      details: {
        contentSecurityPolicyIssueDetails: {
          violatedDirective: "script-src",
          isReportOnly: false,
          contentSecurityPolicyViolationType: "kEvalViolation",
          sourceCodeLocation: { scriptId: "3", url: "http://127.0.0.1:3000/_next/static/chunks/w.js", lineNumber: 0, columnNumber: 56 },
        },
      },
    };
    expect(cspIssueText(issue)).toBe("CSP issue: script-src (kEvalViolation) at http://127.0.0.1:3000/_next/static/chunks/w.js:0");
    const reportOnly = { code: "ContentSecurityPolicyIssue", details: { contentSecurityPolicyIssueDetails: { violatedDirective: "connect-src", isReportOnly: true, contentSecurityPolicyViolationType: "kURLViolation", blockedURL: "https://x.example/" } } };
    expect(cspIssueText(reportOnly)).toBe("CSP issue: connect-src (kURLViolation, report-only) blocked https://x.example/");
    expect(cspIssueText({ code: "MixedContentIssue", details: {} })).toBeNull();
    expect(cspIssueText(undefined)).toBeNull();
  });

  it("console calls: the instrumentation's CSP report, then errors and failed asserts, then warnings", () => {
    expect(consoleCallKind("error", `${CSP_MARK} report-only script-src-elem blocked https://x.example/a.js`)).toBe("csp violation");
    expect(consoleCallKind("log", `${CSP_MARK} anything`)).toBe("csp violation");
    expect(consoleCallKind("error", "boom")).toBe("console error");
    expect(consoleCallKind("assert", "x")).toBe("console error");
    expect(consoleCallKind("warning", "careful")).toBe("console warning");
    expect(consoleCallKind("log", "fine")).toBeNull();
  });
});

describe("the public pages and the site's files (Part B, B3)", () => {
  const good: SiteFiles = {
    csp: "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self' https://api.sleeper.app https://lm-api-reads.fantasy.espn.com; frame-ancestors 'none'",
    cspReportOnly: null,
    permissions: "camera=()",
    poweredBy: null,
    manifest: {
      startUrl: "/league",
      icons: [
        { src: "/icons/icon-192.png", sizes: "192x192", purpose: "any", ok: true, type: "image/png" },
        { src: "/icons/icon-512.png", sizes: "512x512", purpose: "any", ok: true, type: "image/png" },
        { src: "/icons/maskable-512.png", sizes: "512x512", purpose: "maskable", ok: true, type: "image/png" },
      ],
    },
    icons: [
      { rel: "icon", href: "/favicon.ico", ok: true, type: "image/x-icon" },
      { rel: "icon", href: "/icon.svg?1", ok: true, type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-icon.png?2", ok: true, type: "image/png" },
    ],
    og: { ok: true, type: "image/png", width: "1200", height: "630", alt: true },
    robots: "User-Agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: http://127.0.0.1:3000/sitemap.xml\n",
    sitemap: ["/", "/connect", "/privacy", "/terms", "/feedback"].map((p) => `<url><loc>http://127.0.0.1:3000${p}</loc></url>`).join(""),
  };
  const failed = (f: SiteFiles) => siteFileChecks(f).filter(([ok]) => !ok).map(([, , why]) => why);

  it("checks Home, Privacy, Terms and Feedback, then a missing page, as the last step", () => {
    expect(STATIC_PAGES.map((p) => [p.step, p.pathname])).toEqual([
      ["Home", "/"],
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
      ["Feedback", "/feedback"],
    ]);
    expect(MISSING_PAGE).toMatchObject({ pathname: "/no-such-page", h1: "Page not found" });
    expect(STEPS.at(-1)).toMatchObject({ name: "Public pages", health: false });
  });

  it("runs the public pages even when the import stopped the steps before them: they need no league", () => {
    expect(STEPS.filter((s) => s.independent).map((s) => s.name)).toEqual(["Public pages"]);
    expect(STEPS.filter((s) => s.essential).map((s) => s.name)).toEqual(["Connect"]);
    const stop = "the league wasn't imported";
    expect(STEPS.map((s) => [s.name, skipReason(s, stop)])).toEqual([
      ...STEPS.slice(0, -1).map((s) => [s.name, `not checked: ${stop}`]),
      ["Public pages", null],
    ]);
    expect(STEPS.every((s) => skipReason(s, null) === null)).toBe(true);
  });

  it("the missing page's own 404 is the one failed request that step allows", () => {
    expect(isMissingPage404({ kind: "failed request", text: "HTTP 404 /no-such-page" })).toBe(true);
    expect(isMissingPage404({ kind: "failed request", text: "HTTP 404 /api/model/espn" })).toBe(false);
    expect(isMissingPage404({ kind: "failed request", text: "HTTP 500 /no-such-page" })).toBe(false);
    expect(isMissingPage404({ kind: "console error", text: "HTTP 404 /no-such-page" })).toBe(false);
  });

  it("passes a production build's files and headers, enforced or report-only", () => {
    expect(failed(good)).toEqual([]);
    expect(siteFileChecks(good)[0]?.[1]).toBe("the production build sends the full Content-Security-Policy (enforced)");
    const reportOnly = { ...good, csp: "frame-ancestors 'none'", cspReportOnly: good.csp };
    expect(failed(reportOnly)).toEqual([]);
    expect(siteFileChecks(reportOnly)[0]?.[1]).toBe("the production build sends the full Content-Security-Policy (report-only)");
  });

  it("fails what's missing or wrong, saying what it found", () => {
    expect(failed({ ...good, csp: "frame-ancestors 'none'" })).toEqual(["the home page's response has no full Content-Security-Policy (no script-src)", 'its connect-src is ""']);
    expect(failed({ ...good, csp: "script-src 'self'; connect-src 'self' https://api.sleeper.app" })).toEqual(["its connect-src is \"'self' https://api.sleeper.app\""]);
    expect(failed({ ...good, poweredBy: "Next.js" })).toEqual(["Permissions-Policy sent, X-Powered-By sent"]);
    const noMaskable = { ...good, manifest: { startUrl: "/league", icons: good.manifest?.icons.slice(0, 2) ?? [] } };
    expect(failed(noMaskable)).toHaveLength(1);
    expect(failed({ ...good, manifest: null })).toEqual(["no manifest linked, or it didn't load"]);
    expect(failed({ ...good, icons: good.icons.slice(0, 2) })).toHaveLength(1);
    expect(failed({ ...good, og: { ...good.og!, width: "800" } })).toEqual(["the sharing image: image/png, 800 × 630, alt text set"]);
    expect(failed({ ...good, robots: "User-Agent: *\nAllow: /\n" })).toEqual(["robots.txt doesn't say Disallow: /api/ and Sitemap:"]);
    expect(failed({ ...good, sitemap: "<url><loc>http://127.0.0.1:3000/</loc></url>" })).toEqual(["the sitemap lists /"]);
  });
});

describe("the checks' own rules", () => {
  const card = (helps: string | null, accept: string | null, overall: string | null, acceptThrough: string | null = null) => ({ helps, accept, acceptThrough, overall });

  it("Chance they accept is in order by the chance it goes through, when a card shows one (rank.ts sorts by P_complete)", () => {
    // A vetoed idea shows 80% they accept but 40% it goes through: after a 50% one is the right order.
    expect(sortInversions("Chance they accept", [card("40", "50%", "20"), card("45", "80%", "18", "40%")], "accept")).toEqual([]);
    expect(sortInversions("Chance they accept", [card("40", "40%", "20"), card("45", "50%", "18")], "accept")).toEqual(["Chance they accept: idea 1 shows 40%, idea 2 shows 50%"]);
    // Ideas that don't help come after, in their own order.
    expect(sortInversions("Chance they accept", [card("40", "40%", "20"), card("0", "90%", "0"), card("—", "95%", "—")], "accept")).toEqual([]);
    // Phase 4c: "<5%" (an estimate under 5%) sorts just under 5%, and a veto's "under 5% it goes through" reads the same.
    expect(sortInversions("Chance they accept", [card("40", "5%", "20"), card("45", "<5%", "18")], "accept")).toEqual([]);
    expect(sortInversions("Chance they accept", [card("40", "<5%", "20"), card("45", "5%", "18")], "accept")).toEqual(["Chance they accept: idea 1 shows <5%, idea 2 shows 5%"]);
    expect(sortInversions("Chance they accept", [card("40", "10%", "20"), card("45", "30%", "18", "<5%")], "accept")).toEqual([]);
  });

  it("Helps you and Overall are in order by their own numbers, unknown last", () => {
    expect(sortInversions("Helps you", [card("40", "40%", "20"), card("39", "90%", "25"), card("—", "90%", "—")], "helps")).toEqual([]);
    expect(sortInversions("Overall", [card("40", "40%", "20"), card("30", "90%", "25")], "overall")).toEqual(["Overall: idea 1 shows 20, idea 2 shows 25"]);
  });

  it("every idea gives and gets someone: a card without one under its heading is found", () => {
    const p = { name: "Fictional Player", text: "Fictional Player WR", tagged: false };
    expect(sidelessCards([{ give: [p], get: [p] }])).toEqual([]);
    expect(sidelessCards([{ give: [p], get: [p] }, { give: [], get: [p] }])).toEqual(['idea 2: 0 under "You give", 1 under "You get"']);
  });

  it("the header's first row is checked on a 320 px phone: boxes that overlap top to bottom share a row (review PG-4)", () => {
    expect(NARROW_PHONE_WIDTH).toBe(320);
    // The logo (44 px, centered) and the 22 px pill and the 44 px switcher beside them.
    const logo = { top: 8, bottom: 52 };
    expect(sameRow(logo, { top: 19, bottom: 41 })).toBe(true);
    expect(sameRow(logo, { top: 8, bottom: 52 })).toBe(true);
    // The switcher pushed to a row of its own, right under the logo's (the 44 px the header grew by).
    expect(sameRow(logo, { top: 52, bottom: 96 })).toBe(false);
    expect(sameRow({ top: 52, bottom: 96 }, logo)).toBe(false);
  });
});

describe("Checkpoint 7b: notices in plain words (§5.1)", () => {
  it("finds warning codes and the internals the planner named, but not lineup slot names or plain words", () => {
    expect(codeTokens("Two rules: ESPN_SCORING_UNMAPPED and FANTASYCALC_REDRAFT_UNAVAILABLE, ESPN_SCORING_UNMAPPED again")).toEqual(["ESPN_SCORING_UNMAPPED", "FANTASYCALC_REDRAFT_UNAVAILABLE"]);
    expect(codeTokens("SUPER_FLEX (QB/RB/WR/TE), REC_FLEX, D/ST, bonus_rec_te, A_B, Week 5")).toEqual([]);
    expect(noticeLeaks("Rule statId 89 at settings.scoringSettings.scoringItems[3]; player.id 4321; Matched to the player database: 98%")).toEqual([
      '"statId"',
      '"scoringItems"',
      '"player.id"',
      '"Matched to the player database"',
    ]);
    expect(noticeLeaks("PLAYER_UNKNOWN: Some player")).toEqual(["the code PLAYER_UNKNOWN"]);
    expect(noticeLeaks("Two rare rules aren't counted: 1-point safeties and blocked-kick return touchdowns. They almost never happen.")).toEqual([]);
  });

  it("finds the platforms' JSON paths, field names and stat-ID wording the adapters' warnings carry, but not plain words (review of the 7b checks)", () => {
    for (const leak of [
      "settings.scheduleSettings.playoffSeedingRule",
      "teams[].owners",
      "schedule[].winner",
      "teams[].roster.entries[].acquisitionType",
      "rosters[].settings.division",
      "status.isWaiverOrderEdited",
      "player.defaultPositionId",
      "3 player(s) have an ESPN position we don't know (defaultPositionId 5) and were left out.",
      "ESPN lists 2 keepers this season and 3 under keeperCountFuture.",
      "ESPN stat id 209 isn't counted.",
      "the stat IDs 101 and 102",
      // The adapters' ID-matching words (the notices say it plainly: "We could only identify …").
      "1 player isn't in any player ID source, so we matched him to the only active player with the same name.",
      "The player ID sources disagree about who 2 ESPN player ids in this league belong to.",
      "2 players matched a Sleeper id already used by another player.",
    ])
      expect(noticeLeaks(leak), leak).not.toEqual([]);
    for (const plain of [
      "Values: FantasyCalc · fantasycalc.com · offersheet.app@gmail.com · support.espn.com/hc/en-us/articles/360058038711",
      "e.g. a bye week; A.J. Brown and D.J. Moore; St. Louis vs. LV; Marvin Harrison Jr. (WR, ARI); C. McCaffrey",
      "D/ST, W/R/T, SUPER_FLEX, half-PPR, 12.5 pts, 1,283.7 lineup points, iPhone, DynastyProcess, JaMarr Chase, DeVonta Smith",
      "Projection source: ESPN's and Sleeper's projections, averaged. They differ by 6% on average in week 5 (160 rostered players), within the 10% we allow.",
      "Our reading of ESPN's setting: not yet checked on a league like yours. Read from ESPN's keeper count: ESPN has no dynasty setting.",
    ])
      expect(noticeLeaks(plain), plain).toEqual([]);
    expect(internalPaths("at settings.scheduleSettings.playoffSeedingRule and teams[].owners, by stat ID")).toEqual(["settings.scheduleSettings.playoffSeedingRule", "teams[].owners", "stat ID"]);
    // A path the named terms already cover is said once, by its term.
    expect(noticeLeaks("ESPN_SCORING_UNMAPPED · settings.scoringSettings.scoringItems[4] (statId 209)")).toEqual(["the code ESPN_SCORING_UNMAPPED", '"statId"', '"scoringItems"']);
  });

  it("reads the Notices tile as a number, and keeps the planner's quiet line for Parker's league", () => {
    expect([noticeCount("None"), noticeCount("1 notice"), noticeCount("3 notices"), noticeCount(" 2  notices "), noticeCount("Several"), noticeCount(null)]).toEqual([0, 1, 3, 2, null, null]);
    expect(PARKER_QUIET_LINE).toBe("Two rare rules aren't counted: 1-point safeties and blocked-kick return touchdowns. They almost never happen.");
    expect(TECHNICAL_DETAILS).toBe("Technical details (for bug reports)");
  });

  it("applies Parker's own expectations only with --team, on his league", () => {
    expect(parkersLeague({ team: "3" })).toBe(true);
    expect(parkersLeague({ team: null })).toBe(false);
  });
});

describe("Checkpoint 7b: FantasyCalc's values are never shown (5.4)", () => {
  it("finds the wordings the cards used until Phase 7b", () => {
    expect(valueLeaks("Trade value: You give 6,500, you get 5,400 · Values: FantasyCalc")).toHaveLength(3);
    expect(valueLeaks("By FantasyCalc's trade values, they get 18% more than they give, which makes a yes more likely.")).toHaveLength(2);
    expect(valueLeaks("By FantasyCalc’s values, the two sides are about even.")).toHaveLength(1);
    expect(valueLeaks("they give up about 9.3 times as much as they get")).toHaveLength(1);
    expect(valueLeaks("you'd get 22% less trade value than you give")).toHaveLength(1);
    // A card's facts are a term and its value (<dt>, <dd>): read without the colon, with values under 1,000 too.
    expect(valueLeaks("Trade value You give 650, you get 540 Values: FantasyCalc")).toHaveLength(1);
    expect(valueLeaks("Long-term value +350 for your roster, counting roster spots")).toHaveLength(1);
    expect(valueLeaks("Long-term value: −1,350 for your roster")).toHaveLength(2);
    expect(valueLeaks("Long-term value Up for your roster")).toEqual([]);
    // A printed odds figure read out in words isn't a comparison: "<1%" is said "less than 1%".
    expect(valueLeaks("Title odds <1% less than 1% · >99% more than 99% · <0.1% less than 0.1%")).toEqual([]);
  });

  it("finds a value-sized number with or without its commas, signed or not, with its context", () => {
    expect(bareValueNumbers("Long-term value: +1,350 for your roster")).toEqual(['the number 1,350 ("Long-term value: +1,350 for your roster")']);
    expect(bareValueNumbers("worth 6500 to them")).toHaveLength(1);
    expect(bareValueNumbers("−2,100 in value")).toHaveLength(1);
    // A comma or a period after a number in a sentence is punctuation; a decimal isn't a whole number.
    expect(bareValueNumbers("You give 6,500, you get 5,400.")).toHaveLength(2);
    expect(bareValueNumbers("a ratio of 1234.56, and 1,234.5")).toEqual([]);
  });

  it("leaves a card's own numbers alone: ROS points, odds, chances, the scale, the season, simulations, lineup points", () => {
    const card = [
      "Trade idea 1 Trade with Team 4 You give Fictional Player WR · DAL You get Other Player RB · MIN Out — expected back week 8",
      "Helps you 63 Chance they accept 35% Est. · Possible Overall 22 about 25% it goes through.",
      "Title odds 12.1% → 13.4% · Playoff odds 65% → 69% Win chance by week: Week 9: 68% → 64% · Week 13: 42% → 55%",
      "You get 1,142 ROS pts, give 1,018 Your starting lineup still gains 1,025 ROS pts: ROS points count each player's projected points.",
      "Your lineup +3.5 pts a week. These numbers weigh each player's trade value. Values: FantasyCalc (opens in a new tab)",
      "Helps you 63 ≈ +3.0 pts/week. Trade value: −0.4 pts/week equivalent. Played out your season 5,000 times in the 2026 season.",
      "They come out ahead on trade value, which makes a yes more likely. <5% under 5% it goes through 63 ≈ as good as adding 3 points a week",
    ].join(" ");
    expect(valueLeaks(card)).toEqual([]);
  });

  it("finds the wordings the app's own guard forbids too (src/lib/fantasyCalcHidden.test.ts), on a card or anywhere on the League page", () => {
    for (const leak of [
      "They get 14% more value.",
      "they give up 8.5% more trade value than they get",
      "Raises your roster's long-term value by 6%, counting roster spots.",
      "Costs 3% of your roster's long-term value, counting roster spots.",
      "Helps you from your odds alone: 41; counting trade value at your setting: 35.",
    ]) {
      expect(valueLeaks(leak), leak).not.toEqual([]);
      expect(pageValueLeaks(leak), leak).not.toEqual([]);
    }
    // The breakdowns' old numbers wherever they'd show (a chip, a partner card), the cards' old wordings, the "~" estimates.
    expect(pageValueLeaks("Worth +33 to Team 2 · costs you 6.1 pts/wk (Trade market 170)")).toHaveLength(1);
    expect(pageValueLeaks("Best of their trade chips: Trade value: You give 6,500")).toHaveLength(1);
    expect(pageValueLeaks("C. Olave (WR) ~1,234 · J. Doe ~ 87")).toHaveLength(2);
    // The League page's own words: the blend, its explainer, the scale, chips and totals (no bare numbers on this page).
    const page = [
      "His projection leans up toward the trade market's view, by the most it can: 35%. The trade market barely moves his projection.",
      "Then, for QB, RB, WR and TE with trade value, points per game are pulled halfway toward what our model gives healthy players with about the same trade value, at most 35% up or 25% down, so a projection the trade market disagrees with counts for less.",
      "Worth +33 to Team 2 · costs you 6.1 pts/wk · 1,283.7 lineup pts · 5,000 simulated seasons · Values: FantasyCalc (10 teams · half-PPR · 1 QB · redraft)",
      "63 ≈ as good as adding 3 points a week to your lineup this season together with 10% more long-term value for your roster.",
    ].join(" ");
    expect(pageValueLeaks(page)).toEqual([]);
  });

  it("finds the market's numbers in a League page breakdown, and the blend's words", () => {
    expect(breakdownLeaks("Our projection 210 · Trade market 170 · Used 190")).toHaveLength(2);
    expect(breakdownLeaks("Trade market: no comparison (top value at his position)")).toHaveLength(2);
    expect(breakdownLeaks("Our projection 313 · Trade market: no comparison (lowest value at his position) · Used 313")).toHaveLength(3);
    expect(breakdownLeaks("Used 77 (capped: what the uncapped blend would be 104)")).toHaveLength(1);
    const now = "His projection leans up toward the trade market's view. Per game, his projection moves halfway toward what our model gives healthy players with about the same trade value, at most 35% up or 25% down. Wk 5: 12.3 pts, 85% · Q";
    expect(breakdownLeaks(now)).toEqual([]);
    expect(BLEND_WORDS.test(now)).toBe(true);
    expect(BLEND_WORDS.test("The trade market barely moves his projection.")).toBe(true);
    expect(BLEND_WORDS.test("His projection leans down toward the trade market's view, by the most it can: 25%.")).toBe(true);
    expect(BLEND_WORDS.test("Trade market 170")).toBe(false);
  });

  it("checks a card's credit: the sentence, then the “Values: FantasyCalc” link with FantasyCalc's attributes, last", () => {
    const good: CreditRead = { lead: VALUES_CREDIT, link: { href: "https://fantasycalc.com", rel: "noopener", referrerPolicy: "origin", text: "Values: FantasyCalc", last: true } };
    expect(creditProblems(good)).toEqual([]);
    expect(creditProblems(null)).toEqual([`no "${VALUES_CREDIT}" line with a FantasyCalc link`]);
    expect(creditProblems({ ...good, lead: "Trade value: You give 6,500, you get 5,400 ·" })).toEqual(['the line before the link reads "Trade value: You give 6,500, you get 5,400 ·"']);
    expect(creditProblems({ ...good, link: { ...good.link!, rel: "noopener noreferrer", referrerPolicy: null } })).toEqual([
      'FantasyCalc link 1: rel is "noopener noreferrer", not exactly "noopener"',
      "FantasyCalc link 1: referrerpolicy is missing, not \"origin\"",
    ]);
    expect(creditProblems({ ...good, link: { ...good.link!, last: false, text: "FantasyCalc" } })).toEqual(['the link reads "FantasyCalc"', "something follows the link"]);
    expect(creditProblems({ lead: VALUES_CREDIT, link: null })).toEqual(["no link after the sentence"]);
  });
});

describe("Checkpoint 7b: FantasyCalc's links in the server's HTML (5.4)", () => {
  const footer = (a: string) => `<!DOCTYPE html><html><body><main><p>Page</p></main><footer class="mt-12"><nav aria-label="About"><a href="/privacy">Privacy</a></nav><p>Trade values: ${a}</p></footer></body></html>`;
  const fc = '<a href="https://fantasycalc.com" target="_blank" rel="noopener" referrerPolicy="origin" class="font-semibold">FantasyCalc</a>';

  it("reads the footer's link as React writes it (referrerPolicy in any case), and passes FantasyCalc's attributes", () => {
    const links = fantasyCalcLinksInHtml(footer(fc));
    expect(links).toEqual([{ href: "https://fantasycalc.com", rel: "noopener", referrerPolicy: "origin", inFooter: true, hiddenBy: null }]);
    expect(fantasyCalcLinkIssues(links, { requireFooter: true })).toEqual([]);
    // The real footer, rendered by React on the server.
    const rendered = fantasyCalcLinksInHtml(`<html><body>${renderToStaticMarkup(createElement(SiteFooter))}</body></html>`);
    expect(rendered).toEqual([expect.objectContaining({ href: "https://fantasycalc.com", rel: "noopener", referrerPolicy: "origin", inFooter: true, hiddenBy: null })]);
    expect(fantasyCalcLinkIssues(rendered, { requireFooter: true })).toEqual([]);
    // A card's "Values: FantasyCalc", outside the footer: its attributes count too.
    const credit = fantasyCalcLinksInHtml(`<article><p>${VALUES_CREDIT} ${renderToStaticMarkup(createElement(ValuesCredit))}</p></article>`);
    expect(credit).toEqual([expect.objectContaining({ rel: "noopener", referrerPolicy: "origin", inFooter: false })]);
  });

  it("fails a link without FantasyCalc's attributes, or a page without one in its footer", () => {
    const issues = (a: string) => fantasyCalcLinkIssues(fantasyCalcLinksInHtml(footer(a)), { requireFooter: true });
    expect(issues('<a href="https://fantasycalc.com" rel="noopener noreferrer" referrerpolicy="origin">FantasyCalc</a>')).toEqual(['FantasyCalc link 1 (footer): rel is "noopener noreferrer", not exactly "noopener"']);
    expect(issues('<a href="https://fantasycalc.com" rel="nofollow noopener" referrerpolicy="origin">FantasyCalc</a>')).toHaveLength(1);
    expect(issues('<a href="https://fantasycalc.com" rel="noopener">FantasyCalc</a>')).toEqual(['FantasyCalc link 1 (footer): referrerpolicy is missing, not "origin"']);
    expect(issues("<a href='https://fantasycalc.com/redraft' rel='noopener' REFERRERPOLICY='no-referrer'>FantasyCalc</a>")).toEqual(['FantasyCalc link 1 (footer): referrerpolicy is "no-referrer", not "origin"']);
    expect(issues("FantasyCalc")).toEqual(["no link to https://fantasycalc.com in the footer"]);
    // A link elsewhere doesn't stand in for the footer's; one to www. is still checked.
    const elsewhere = `<main>${fc}</main><footer><p>Trade values</p></footer>`;
    expect(fantasyCalcLinkIssues(fantasyCalcLinksInHtml(elsewhere), { requireFooter: true })).toEqual(["no link to https://fantasycalc.com in the footer"]);
    expect(fantasyCalcLinkIssues(fantasyCalcLinksInHtml('<p><a href="https://www.fantasycalc.com/" rel="noopener">x</a></p>'), { requireFooter: false })).toHaveLength(1);
  });

  it("doesn't count what a script holds, and says what hides a link from a reader without JavaScript", () => {
    const script = `<html><body><footer><p>Trade values</p></footer><script>self.__next_f.push([1,"<a href=\\"https://fantasycalc.com\\" rel=\\"noopener\\" referrerPolicy=\\"origin\\">"])</script><!-- <a href="https://fantasycalc.com"> --></body></html>`;
    expect(fantasyCalcLinksInHtml(script)).toEqual([]);
    const streamed = `<div hidden id="S:0">${footer(fc)}</div>`;
    expect(fantasyCalcLinksInHtml(streamed)[0]?.hiddenBy).toBe("div[hidden]");
    expect(fantasyCalcLinkIssues(fantasyCalcLinksInHtml(streamed), { requireFooter: true })).toEqual(["the footer's FantasyCalc link is hidden without JavaScript (inside div[hidden])"]);
    expect(fantasyCalcLinksInHtml(`<footer><details><summary>More</summary>${fc}</details></footer>`)[0]?.hiddenBy).toBe("details");
    expect(fantasyCalcLinksInHtml(`<footer><details open><summary>More</summary>${fc}</details></footer>`)[0]?.hiddenBy).toBeNull();
    expect(fantasyCalcLinksInHtml(`<footer><noscript>${fc}</noscript></footer>`)[0]?.hiddenBy).toBe("noscript");
    expect(fantasyCalcLinksInHtml(`<footer><p style="display: none">${fc}</p></footer>`)[0]?.hiddenBy).toBe("p[style]");
    // Void and self-closing elements (an icon's SVG) don't throw the open elements off; entities are read.
    const svg = `<footer><svg viewBox="0 0 8 8"><path d="M0 0h8"/><circle r="1"/></svg><img src="/x.png" alt="x"><br><p>${'<a href="https://fantasycalc.com?a=1&amp;b=2" rel="noopener" referrerPolicy="origin">FantasyCalc</a>'}</p></footer>`;
    expect(fantasyCalcLinksInHtml(svg)).toEqual([{ href: "https://fantasycalc.com?a=1&b=2", rel: "noopener", referrerPolicy: "origin", inFooter: true, hiddenBy: null }]);
    expect(fantasyCalcLinksInHtml(`<footer></footer><p>${fc}</p>`)[0]?.inFooter).toBe(false);
  });

  it("knows FantasyCalc's addresses, and every app page is read", () => {
    expect(["https://fantasycalc.com", "https://fantasycalc.com/", "http://www.fantasycalc.com/redraft", "https://FantasyCalc.com?x=1"].every(isFantasyCalcHref)).toBe(true);
    expect(["https://fantasycalc.com.evil.example", "https://notfantasycalc.com", "/fantasycalc", null, undefined].some(isFantasyCalcHref)).toBe(false);
    expect(APP_PAGES).toEqual(expect.arrayContaining(["/", "/league", "/trades", "/analyzer", "/settings", "/import", "/privacy", "/terms", "/feedback"]));
  });

  it("the app pages live in contracts.ts since Checkpoint 7c (npm run prod:deploy reads them there), re-exported by steps.ts unchanged", () => {
    expect(APP_PAGES).toBe(CONTRACT_APP_PAGES);
    expect([...APP_PAGES]).toEqual(["/", "/connect", "/import", "/league", "/trades", "/analyzer", "/settings", "/privacy", "/terms", "/feedback"]);
  });
});

describe("Checkpoint 7d: every page's footer credits DynastyProcess with a link to its data (planner reply to Checkpoint 7c, “Also”)", () => {
  const footer = (a: string) => `<!DOCTYPE html><html><body><main><p>Page</p></main><footer class="mt-12"><p>Projections and stats: Sleeper and ESPN · Player IDs: ${a} · NFL schedule: ESPN</p></footer></body></html>`;
  const dp = `<a href="${DYNASTYPROCESS_DATA_URL}" target="_blank" rel="noopener" class="font-semibold">DynastyProcess</a>`;

  it("passes the real footer, rendered by React on the server, reading the link's words", () => {
    const rendered = dynastyProcessLinksInHtml(`<html><body>${renderToStaticMarkup(createElement(SiteFooter))}</body></html>`);
    expect(rendered).toEqual([{ href: DYNASTYPROCESS_DATA_URL, rel: "noopener", referrerPolicy: null, inFooter: true, hiddenBy: null, text: "DynastyProcess" }]);
    expect(dynastyProcessLinkIssues(rendered)).toEqual([]);
    expect(dynastyProcessLinkIssues(dynastyProcessLinksInHtml(footer(dp)))).toEqual([]);
    expect(DYNASTYPROCESS_DATA_URL).toBe("https://github.com/dynastyprocess/data");
  });

  it("fails a footer without it, a link elsewhere, the wrong address, rel or words, or one hidden without JavaScript", () => {
    const issues = (a: string) => dynastyProcessLinkIssues(dynastyProcessLinksInHtml(footer(a)));
    expect(issues("DynastyProcess")).toEqual(["no link to DynastyProcess's data in the footer"]);
    expect(dynastyProcessLinkIssues(dynastyProcessLinksInHtml(`<main>${dp}</main><footer><p>Player IDs: DynastyProcess</p></footer>`))).toEqual(["no link to DynastyProcess's data in the footer"]);
    expect(issues('<a href="https://github.com/dynastyprocess" rel="noopener">DynastyProcess</a>')).toEqual([`the footer's DynastyProcess link goes to https://github.com/dynastyprocess, not ${DYNASTYPROCESS_DATA_URL}`]);
    expect(issues(`<a href="${DYNASTYPROCESS_DATA_URL}" rel="noopener noreferrer">DynastyProcess</a>`)).toEqual(['the footer\'s DynastyProcess link: rel is "noopener noreferrer", not exactly "noopener"']);
    expect(issues(`<a href="${DYNASTYPROCESS_DATA_URL}">DynastyProcess</a>`)).toEqual(['the footer\'s DynastyProcess link: rel is missing, not exactly "noopener"']);
    expect(issues(`<a href="${DYNASTYPROCESS_DATA_URL}" rel="noopener">their data</a>`)).toEqual(['the footer\'s DynastyProcess link reads "their data", not "DynastyProcess"']);
    expect(issues(`<details><summary>Credits</summary>${dp}</details>`)).toEqual(["the footer's DynastyProcess link is hidden without JavaScript (inside details)"]);
    // A script's copy of the markup isn't a link; words with markup and entities inside read as shown.
    expect(dynastyProcessLinksInHtml(`<footer></footer><script>self.__next_f.push([1,"${dp.replace(/"/g, '\\"')}"])</script>`)).toEqual([]);
    expect(linksInHtml(`<footer><a href="${DYNASTYPROCESS_DATA_URL}" rel="noopener"><span>Dynasty</span>Process &amp; co</a></footer>`, isDynastyProcessHref)[0]?.text).toBe("Dynasty Process & co");
  });

  it("knows DynastyProcess's addresses, and reads FantasyCalc's links as before", () => {
    expect([DYNASTYPROCESS_DATA_URL, "https://github.com/dynastyprocess", "http://www.github.com/dynastyprocess/data/blob/master/x.csv"].every(isDynastyProcessHref)).toBe(true);
    expect(["https://github.com/dynastyprocessx", "https://github.com/someone/dynastyprocess", "/dynastyprocess", null, undefined].some(isDynastyProcessHref)).toBe(false);
    // The shared reader leaves FantasyCalc's link as fantasyCalcLinksInHtml always read it (no words in its shape).
    const fc = '<footer><a href="https://fantasycalc.com" rel="noopener" referrerPolicy="origin">FantasyCalc</a></footer>';
    expect(fantasyCalcLinksInHtml(fc)).toEqual([{ href: "https://fantasycalc.com", rel: "noopener", referrerPolicy: "origin", inFooter: true, hiddenBy: null }]);
    expect(linksInHtml(fc, isFantasyCalcHref)[0]?.text).toBe("FantasyCalc");
  });
});

describe("Checkpoint 7c: nothing in a page's server HTML loads from another site (prod:deploy, planner reply to Checkpoint 7b, §2)", () => {
  const origin = "https://offersheet.vercel.app";

  it("the site's own scripts, styles, preloads and links pass, written relative or absolute", () => {
    const own = [
      '<script src="/_next/static/chunks/main.js" async=""></script>',
      '<script src="https://offersheet.vercel.app/_next/static/chunks/b.js"></script>',
      '<link rel="preload" as="script" href="/_next/static/chunks/a.js"/>',
      '<link rel="stylesheet" href="/_next/static/css/app.css" data-precedence="next"/>',
      '<link rel="icon" href="https://elsewhere.example/icon.png"/>', // an icon link isn't a fetch this rule reads (the CSP bounds it)
      '<a href="https://fantasycalc.com" rel="noopener" referrerpolicy="origin">FantasyCalc</a>',
      '<img src="data:image/png;base64,AAAA" alt=""/>',
      "<script>self.__next_f.push([1,\"<script src=\\\"https://cdn.example/x.js\\\"><iframe src=\\\"https://ads.example\\\">\"])</script>",
      '<!-- <script src="https://cdn.example/commented.js"></script> -->',
      "<style>.x{background:url(https://cdn.example/bg.png)}</style>",
    ].join("");
    expect(foreignResourcesInHtml(`<html><head>${own}</head><body></body></html>`, origin)).toEqual([]);
  });

  it("names every script, frame, object, preload, prefetch, stylesheet or <base> from another site, by host", () => {
    const foreign = [
      '<script src="https://cdn.example/x.js"></script>',
      '<script src="//cdn2.example/y.js"></script>',
      '<link rel="modulepreload" href="https://cdn3.example/z.js"/>',
      '<link rel="preload" as="script" href="https://cdn4.example/w.js"/>',
      '<link rel="dns-prefetch prefetch" href="https://cdn5.example/v.js"/>',
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=X"/>',
      '<iframe src="https://www.youtube.com/embed/x"></iframe>',
      '<embed src="https://flash.example/a.swf"/>',
      '<object data="https://obj.example/o"></object>',
      '<base href="https://evil.example/"/>',
      '<SCRIPT SRC="https://upper.example/u.js"></SCRIPT>',
    ].join("");
    expect(foreignResourcesInHtml(`<html><head>${foreign}</head></html>`, origin)).toEqual([
      "<script src> from cdn.example",
      "<script src> from cdn2.example",
      "<link rel=modulepreload> from cdn3.example",
      "<link rel=preload> from cdn4.example",
      "<link rel=prefetch> from cdn5.example",
      "<link rel=stylesheet> from fonts.googleapis.com",
      "<iframe src> from www.youtube.com",
      "<embed src> from flash.example",
      "<object data> from obj.example",
      "<base href> from evil.example",
      "<script src> from upper.example",
    ]);
    expect(foreignResourcesInHtml('<script src="http://offersheet.vercel.app/x.js"></script>', origin)).toEqual(["<script src> from offersheet.vercel.app"]); // another scheme is another origin
    expect(foreignResourcesInHtml("<p>x</p>", "not an origin")).toEqual(["the page's own address not an origin couldn't be read"]);
  });
});

describe("Checkpoint 7b: the Trade Finder's timing lines (5.3)", () => {
  it("reads the freshness line in each of its wordings", () => {
    for (const ok of [
      "Trade values updated 2 hours ago · Projections updated 5 hours ago.",
      "Trade values updated just now · Projections updated 1 minute ago.",
      "Trade values updated yesterday · Projections updated 3 days ago.",
      "Trade values updated 25 minutes ago.",
      "Projections updated 1 hour ago.",
      "Trade values updated 2 hours ago\u00a0· Projections updated 5 hours ago.",
    ])
      expect(freshnessLineOk(ok), ok).toBe(true);
    for (const bad of ["Trade values updated 2 hours ago", "Projections updated 5 hours ago · Trade values updated 2 hours ago.", "Trade values updated soon.", "Trade values: 6,500.", ""]) expect(freshnessLineOk(bad), bad).toBe(false);
  });

  const league = (over: Partial<TradingLeague> = {}): TradingLeague => ({
    settings: { regularSeasonWeeks: Array.from({ length: 14 }, (_, i) => i + 1), playoffWeeks: [15, 16, 17], tradeDeadline: { date: "2026-12-02T17:00:00.000Z" }, tradeReviewHours: 24 },
    currentWeek: 5,
    leagueWeek: null,
    lastWeek: 17,
    kickoffs: null,
    inputs: true,
    hasMarket: true,
    ...over,
  });

  it("expects “Best time to look:” in season before the deadline, in the words the league's review period gives (the app's own rules)", () => {
    const inSeason = bestTimeExpectation(league(), new Date("2026-10-06T12:00:00Z"));
    expect(inSeason.inSeason).toBe(true);
    expect(inSeason.text).toBe("Best time to look: Tuesday or Wednesday, after Monday night's game. Trade values and projections have caught up with the weekend, and a trade still has time to clear your league's 1-day review before Thursday.");
    expect(bestTimeExpectation(league(), new Date("2026-12-10T12:00:00Z")).inSeason).toBe(false);
    expect(bestTimeExpectation(league({ settings: { ...league().settings, tradeDeadline: { week: 4 } } }), new Date("2026-10-06T12:00:00Z")).inSeason).toBe(false);
    // Week 1 hasn't started until a kickoff of it has passed.
    expect(bestTimeExpectation(league({ currentWeek: 1 }), new Date("2026-09-08T12:00:00Z")).inSeason).toBe(false);
    expect(bestTimeExpectation(league({ currentWeek: 1, kickoffs: { 1: { KC: "2026-09-10T00:20:00Z" } } }), new Date("2026-09-11T12:00:00Z")).inSeason).toBe(true);
    expect(bestTimeExpectation(league({ settings: { ...league().settings, tradeReviewHours: null } }), new Date("2026-10-06T12:00:00Z")).text).toContain("clear your league's review before Thursday.");
    expect(bestTimeExpectation(league({ settings: { ...league().settings, tradeReviewHours: 48 } }), new Date("2026-10-06T12:00:00Z")).text).toContain("2-day review");
  });

  it("expects the freshness line by the app's own rule on the saved inputs' times, and none when they carry none (nothing to say: a skip)", () => {
    const now = new Date("2026-10-06T12:00:00Z");
    const projections = (fetchedAt: string) => [{ source: PROJECTIONS_SOURCE, fetchedAt }];
    expect(freshnessExpectation({ marketFetchedAt: "2026-10-06T10:00:00Z", sources: projections("2026-10-06T07:00:00Z") }, now)).toBe("Trade values updated 2 hours ago · Projections updated 5 hours ago.");
    expect(freshnessExpectation({ marketFetchedAt: null, sources: projections("2026-10-06T11:59:30Z") }, now)).toBe("Projections updated just now.");
    expect(freshnessExpectation({ marketFetchedAt: "2026-10-05T09:00:00Z", sources: [{ source: "ESPN projections", fetchedAt: "2026-10-06T07:00:00Z" }] }, now)).toBe("Trade values updated yesterday.");
    expect(freshnessExpectation({ marketFetchedAt: null, sources: [] }, now)).toBeNull();
    expect(freshnessExpectation({}, now)).toBeNull();
    for (const line of ["Trade values updated 2 hours ago · Projections updated 5 hours ago.", "Projections updated just now.", "Trade values updated yesterday."]) expect(freshnessLineOk(line), line).toBe(true);
  });
});

describe("Checkpoint 7b: Settings, the waiver view and the header (5.2, §6.1, §6.2)", () => {
  it("reads the playoff weight's line in each of its states", () => {
    expect(playoffWeightRead("set automatically from your odds. Working it out…")).toEqual({ state: "working", weight: null });
    expect(playoffWeightRead("1.6×, set automatically from your odds.")).toEqual({ state: "auto", weight: 1.6 });
    expect(playoffWeightRead("1.3× (the default: lineup changes don't move your odds right now).")).toEqual({ state: "default", weight: 1.3 });
    expect(playoffWeightRead("set automatically from your odds when the League page loads.")).toEqual({ state: "waiting", weight: null });
    expect(playoffWeightRead("1.25")).toEqual({ state: "other", weight: null });
  });

  it("knows the goal's three answers", () => {
    expect(GOAL_CHOICES).toEqual(["Only the champion", "Several prizes", "Making the playoffs"]);
  });

  it("accepts the waiver view's toggle with two lists, or three while a week is under way, and nothing else", () => {
    expect(waiverToggleKind(["Rest of season", "This week"])).toBe("two");
    expect(waiverToggleKind(["Rest of season", "Next week"])).toBe("two");
    expect(waiverToggleKind(["Rest of season", "This week", "Next week"])).toBe("three");
    expect(waiverToggleKind(["This week", "Rest of season"])).toBeNull();
    expect(waiverToggleKind(["Rest of season"])).toBeNull();
    expect(waiverToggleKind(["Rest of season", "This week", "Value"])).toBeNull();
    expect(WAIVERS_HREF).toBe("/league#waivers");
  });

  it("counts the rows the header's links sit in: six links, two rows", () => {
    const row = (top: number) => ({ top, bottom: top + 44 });
    expect(rowCount([row(60), row(60), row(60), row(104), row(104), row(104)])).toBe(2);
    expect(rowCount([row(60), row(61), row(60), row(104), row(104), row(150)])).toBe(3);
    expect(rowCount([row(60), row(60), row(60), row(60), row(60), row(60)])).toBe(1);
    expect(rowCount([])).toBe(0);
    expect(NAV_HREFS).toEqual(["/connect", "/import", "/league", "/league#waivers", "/trades", "/settings"]);
  });
});

describe("Checkpoint 7e: the waiver rows as moves (planner reply to Checkpoint 7d, items 3.1–3.4)", () => {
  const move = (over: Partial<WaiverMoveRead> = {}): WaiverMoveRead => ({ add: true, kind: "drop", main: "Helps you", mainValue: "27", outscores: true, locks: 1, lockNames: true, ...over });

  it("passes rows that read as one move with Helps you, the second number and a lock next to the drop", () => {
    expect(waiverMoveProblems([move(), move({ mainValue: "No gain" }), move({ kind: "open", locks: 0 })], { main: "Helps you", locks: true })).toEqual([]);
    // A move that can't be made: its number under the list's label, no second number, no lock (review of wave C, UI-C-4, UI-C-7).
    expect(waiverMoveProblems([move({ kind: "blocked", main: "Helps you", mainValue: "Can't add", outscores: false, locks: 0 })], { main: "Helps you", locks: true })).toEqual([]);
    expect(waiverMoveProblems([move({ kind: "blocked", main: "Lineup gain", mainValue: "No room", outscores: false, locks: 0 })], { main: "Lineup gain", locks: true })).toEqual([]);
    expect(waiverMoveProblems([move({ kind: "blocked", main: "Lineup gain", mainValue: "No room", outscores: false, locks: 2 })], { main: "Helps you", locks: true })).toEqual([
      "row 1 (can't be made) is labeled “Lineup gain”, not “Helps you”",
      "row 1 (can't be made) repeats 2 locks the untouchables line has",
    ]);
    // The one-week list: in points.
    expect(waiverMoveProblems([move({ main: "Lineup gain", mainValue: "+2.5 pts" })], { main: "Lineup gain", locks: true })).toEqual([]);
  });

  it("names each problem: no “Add”, nothing to make room, the wrong main number, a Helps you that isn't one, no second number, a missing or unnamed lock", () => {
    expect(waiverMoveProblems([move({ add: false })], { main: "Helps you", locks: true })).toEqual(["row 1 doesn't start “Add” with the player's name"]);
    expect(waiverMoveProblems([move({ kind: "none" })], { main: "Helps you", locks: true })).toEqual(["row 1 names no drop, open roster spot or reason he can't join"]);
    expect(waiverMoveProblems([move({ main: "Lineup gain", mainValue: "+1 pts" })], { main: "Helps you", locks: true })).toEqual(["row 1's main number is labeled “Lineup gain”, not “Helps you”"]);
    expect(waiverMoveProblems([move({ mainValue: "27%" })], { main: "Helps you", locks: true })).toEqual(["row 1's Helps you reads “27%”"]);
    expect(waiverMoveProblems([move({ outscores: false })], { main: "Helps you", locks: true })).toEqual(["row 1 doesn't say how his points compare with the drop's"]);
    expect(waiverMoveProblems([move({ locks: 0 })], { main: "Helps you", locks: true })).toEqual(["row 1 has no lock next to its drop"]);
    expect(waiverMoveProblems([move({ locks: 0 })], { main: "Helps you", locks: false })).toEqual([]);
    expect(waiverMoveProblems([move(), move({ lockNames: false })], { main: "Helps you", locks: true })).toEqual(["row 2's lock doesn't say what pressing it does"]);
  });

  it("waits a minute at most for the rating, and knows its words", () => {
    expect(WAIVER_RATING_WAIT_MS).toBe(60_000);
    expect(RATING_PENDING_TEXT).toBe("Rating these against your odds…");
  });
});

describe("Checkpoint 7c: league prizes on the Settings page, the cards and the League page (planner reply to Checkpoint 7b, §6)", () => {
  const view = (settings: Partial<TradeSettings>) => buildSettingsView({ snapshot: settingsSnapshot(), myTeamId: "1", settings: { ...defaultTradeSettings(), ...settings }, stored: true });
  /** The page's group as the reader returns it, made from the view model (what SettingsForm.tsx lays out), 44 px fields. */
  const asRead = (prizes: NonNullable<ReturnType<typeof view>["prizes"]>): PrizeGroupRead => ({
    help: prizes.help,
    fields: prizes.fields.map((f) => ({ label: f.label, value: f.value, height: 44, invalid: null, error: null, live: false })),
    split: prizes.split,
    warning: prizes.warning,
    goalLabels: 3,
  });
  const want = (settings: TradeSettings) => ({
    labels: PRIZE_KEYS.map((k) => PRIZE_LABEL[k]),
    help: PRIZES_HELP,
    values: PRIZE_KEYS.map((k) => prizeAmountText(settings.prizes[k])),
    split: expectedPrizeSplit(settings, { settings: { regularSeasonWeeks: settingsSnapshot().settings.regularSeasonWeeks, pointsOnly: false }, schedule: [] }),
  });

  it("passes the app's own group under “Several prizes”, the split as the check works it out, and catches what's wrong", () => {
    const settings = { ...defaultTradeSettings(), goal: "prizes" as const };
    const group = view(settings).prizes;
    if (!group) throw new Error("no prizes group");
    expect(prizeGroupProblems(asRead(group), want(settings))).toEqual([]);
    expect(want(settings).split).toBe("Your prizes split: 1st 60%, 2nd 30%, 3rd 10%.");
    // Parker's prizes; the weekly high score counted over the league's 14 weeks; nothing entered (the warning, no split).
    const parker = { ...settings, prizes: { first: 2000, second: 1600, third: 900, weeklyHigh: 0, pointsLeader: null } };
    expect(expectedPrizeSplit(parker, null)).toBe("Your prizes split: 1st 44%, 2nd 36%, 3rd 20%.");
    const weekly = { ...settings, prizes: { first: 100, second: null, third: null, weeklyHigh: 25, pointsLeader: null } };
    for (const s of [parker, weekly]) expect(prizeGroupProblems(asRead(view(s).prizes as NonNullable<ReturnType<typeof view>["prizes"]>), want(s))).toEqual([]);
    const empty = { ...settings, prizes: { first: null, second: null, third: null, weeklyHigh: null, pointsLeader: null } };
    expect(expectedPrizeSplit(empty, null)).toBeNull();
    expect(prizeGroupProblems(asRead(view(empty).prizes as NonNullable<ReturnType<typeof view>["prizes"]>), want(empty))).toEqual([]);
    // What it catches.
    const read = asRead(group);
    expect(prizeGroupProblems(null, want(settings))).toEqual(["no “Your league's prizes” group shows under “Several prizes”"]);
    expect(prizeGroupProblems({ ...read, help: "Enter your prizes." }, want(settings))).toEqual(["its help reads “Enter your prizes.”, not the planner's line"]);
    expect(prizeGroupProblems({ ...read, fields: read.fields.slice(0, 3) }, want(settings))).toHaveLength(2);
    expect(prizeGroupProblems({ ...read, fields: read.fields.map((f, i) => (i === 3 ? { ...f, height: 40 } : f)) }, want(settings))).toEqual(["“High score, each regular-season week” is 40 px tall (44 px at least)"]);
    expect(prizeGroupProblems({ ...read, fields: read.fields.map((f, i) => (i === 0 ? { ...f, invalid: "true" } : f)) }, want(settings))).toEqual(["“1st place” is marked invalid with nothing typed"]);
    expect(prizeGroupProblems({ ...read, split: "Your prizes split: 1st 100%." }, want(settings))).toEqual(["the split reads “Your prizes split: 1st 100%.”, not “Your prizes split: 1st 60%, 2nd 30%, 3rd 10%.”"]);
    expect(prizeGroupProblems({ ...read, goalLabels: 8 }, want(settings))).toEqual(["the goal's group holds 8 labels, not its three answers"]);
    expect(prizeGroupProblems({ ...read, split: null, warning: null }, { ...want(settings), split: null })).toEqual(["nothing says the amounts add up to nothing"]);
  });

  it("knows a field that says why it can't read what's typed, in a live region (review of the prizes UI, prizes-ui-3)", () => {
    const field = { label: "2nd place", value: "abc", height: 44, invalid: "true", error: PRIZE_TEXT_MESSAGES.notNumber, live: true };
    expect(invalidPrizeProblems(field, PRIZE_TEXT_MESSAGES.notNumber)).toEqual([]);
    expect(invalidPrizeProblems({ ...field, invalid: null, error: null, live: false }, PRIZE_TEXT_MESSAGES.notNumber)).toEqual(["aria-invalid is missing", `its message reads nothing, not “${PRIZE_TEXT_MESSAGES.notNumber}”`]);
    // The message shows on blur, after focus has moved on: outside a live region nothing announces it.
    expect(invalidPrizeProblems({ ...field, live: false }, PRIZE_TEXT_MESSAGES.notNumber)).toEqual(["its message isn't in a live region, so a screen reader doesn't announce it"]);
    expect(invalidPrizeProblems(undefined, PRIZE_TEXT_MESSAGES.notNumber)).toEqual(["the field is gone"]);
    // The reader asks the message's own place in the page.
    expect(READ_SETTINGS_PRIZES).toContain('live: !!(error && error.closest("[aria-live]"))');
  });

  it("expects the top-N odds line from the saved settings, and reads the cards' and the League page's odds by it", () => {
    expect(expectedTopPlaces(null)).toBeNull();
    expect(expectedTopPlaces({ goal: "title" })).toBeNull();
    // A league saved with "Top finishers too" reads as "Several prizes" on the prefilled 60 / 30 / 10: the top 3.
    expect(expectedTopPlaces({ goal: "balanced" })).toBe(3);
    expect(expectedTopPlaces({ goal: "prizes", prizes: { first: 60, second: 40, third: null, weeklyHigh: null, pointsLeader: null } })).toBe(2);
    expect(expectedTopPlaces({ goal: "prizes", prizes: { first: 60, second: null, third: null, weeklyHigh: 5, pointsLeader: null } })).toBeNull();
    // Why none, in the check lines' words: a fresh browser's answer, or a split paying neither 2nd nor 3rd.
    expect(noTopReason(null)).toBe("“Only the champion” is chosen");
    expect(noTopReason({ goal: "playoffs" })).toBe("“Making the playoffs” is chosen");
    expect(noTopReason({ goal: "prizes", prizes: { first: 60, second: null, third: null, weeklyHigh: 5, pointsLeader: null } })).toBe("the saved prizes pay no 2nd or 3rd place");
    // The cards' labels as the app makes them (tradeView.ts oddsViews) pass; anything else is caught.
    const reward = { goal: "prizes" as const, shares: { first: 0.5, second: 0.3, third: 0.2, weeklyHigh: 0, pointsLeader: 0 } };
    const e = { ...evaluation({ dCH: 0.01, dPO: 0.03 }), dPrizes: { first: 0.01, second: 0.01, third: 0.01, weeklyHigh: null, pointsLeader: 0 } };
    const baseline = { pPlayoffs: 0.6, pTitle: 0.1, prizes: { first: 0.1, second: 0.1, third: 0.1, weeklyHigh: 0, pointsLeader: 0.1 } };
    const labels = (r: typeof reward | null) => buildTradeCard(e, { snapshot: tradeSnapshot(), baseline, reward: r }).odds.map((o) => o.label);
    expect(oddsLabelProblems([labels(reward), labels(reward)], 3)).toEqual([]);
    expect(oddsLabelProblems([labels(null)], null)).toEqual([]);
    expect(oddsLabelProblems([labels(null)], 3, () => "idea 1")).toEqual(["idea 1: “Title odds” · “Playoff odds”"]);
    expect(oddsLabelProblems([labels(reward)], null)).toEqual(["odds line 1: “Title odds” · “Top 3 odds” · “Playoff odds”"]);
    expect(oddsLabelProblems([["Playoff odds", "Title odds"]], null)).toHaveLength(1);
    // The League page's lines (leagueView.ts myOddsOf), screen-reader words left out.
    expect(headlineTopProblems(["Your odds: 60% playoffs · 30% top 3 · 10.5% title", "As rosters stand: 58% playoffs · 29% top 3 · 9.9% title"], 3)).toEqual([]);
    expect(headlineTopProblems(["Your odds: 60% playoffs · 10.5% title"], null)).toEqual([]);
    expect(headlineTopProblems(["Your odds: 60% playoffs · 10.5% title"], 3)).toEqual(["“Your odds: 60% playoffs · 10.5% title” lacks one top-3 chance"]);
    expect(headlineTopProblems(["Your odds: 60% playoffs · 20% top 2 · 10.5% title"], null)).toEqual(["“Your odds: 60% playoffs · 20% top 2 · 10.5% title” shows a top-2 chance, though your league's prizes pay no 2nd or 3rd place"]);
    expect(headlineTopProblems(["Your odds: 60% playoffs · 20% top 2 · 10.5% title"], 3)).toHaveLength(1);
  });

  it("compiles its in-page readers, the typing and the taps (TypeScript never checks them)", () => {
    const body = (code: string) => `return (async () => {\n${PAGE_HELPERS}\n${CARD_HELPERS}\n${code}\n})`;
    for (const reader of [READ_SETTINGS_PRIZES, READ_PRIZE_LEAGUE, READ_CARD_ODDS, READ_MY_ODDS, typePrize("1st place", "$2,000", "enter"), typePrize("2nd place", 'quote " and \\ slash', "blur")]) {
      expect(() => new Function(body(reader)), reader.slice(0, 60)).not.toThrow();
    }
    for (const expression of [CHECKED_GOAL, goalChoice("prizes")]) expect(() => new Function(body(`return (${expression});`)), expression.slice(0, 60)).not.toThrow();
    // A field found by its own label, saved by Enter's keydown or the focus leaving (React's onBlur listens to focusout).
    expect(typePrize("1st place", "50", "enter")).toContain('new KeyboardEvent("keydown", { key: "Enter"');
    expect(typePrize("1st place", "abc", "blur")).toContain('new FocusEvent("focusout", { bubbles: true })');
    // The labels and words it looks for are the app's own.
    expect(Object.values(PRIZE_LABEL)).toEqual(["1st place", "2nd place", "3rd place", "High score, each regular-season week", "Most points in the regular season"]);
    expect(READ_SETTINGS_PRIZES).toContain(`byText("legend", "${PRIZES_LEGEND}")`);
    expect(GOAL_LABEL.prizes).toBe(GOAL_CHOICES[1]);
  });
});

describe("Checkpoint 7c: “Helps both” (planner reply to Checkpoint 7b, §7)", () => {
  const MIN = config.benefit.helpsThemMin;
  const read = (helps: string | null, helpsThem: string | null, helpsBothTag: boolean) => ({ helps, helpsThem, helpsBothTag });
  /** The partner's numbers (TradeEvaluation.them): Helps them `helps`, their odds before and after. */
  const them = (helps: number | null): PartnerNumbers => ({
    b: helps === null ? null : helps / 10,
    bWin: helps === null ? null : helps / 10,
    bFuture: null,
    lambda: null,
    b3: helps === null ? null : 4,
    helps,
    dPO: 0.04,
    dCH: 0.009,
    dPrizes: titleDeltas(0.009),
    before: { pPlayoffs: 0.41, pTitle: 0.06, prizes: { first: 0.06, second: null, third: null, weeklyHigh: 0, pointsLeader: 0 } },
  });
  const withThem = (e: TradeEvaluation, helps: number | null): TradeEvaluation => ({ ...e, them: them(helps) });
  const saved = () => ({ ok: true as const });
  const noFeedback = { outcome: null, report: null, version: null, versionKey: null, versionWords: null };

  it("the card step tries every sort the Finder offers, Overall last, and orders “Helps both” by Helps you", () => {
    expect(SORTS.map((s) => s.value).sort()).toEqual(SORT_OPTIONS.map((o) => o.value).sort());
    expect(SORTS.map((s) => s.label).sort()).toEqual(SORT_OPTIONS.map((o) => o.label).sort());
    expect(SORTS.at(-1)?.value).toBe("overall");
    const card = (helps: string | null) => ({ helps, accept: "40%", acceptThrough: null, overall: "10" });
    expect(sortInversions("Helps both", [card("50"), card("29"), card("29"), card("9")], "helpsBoth")).toEqual([]);
    expect(sortInversions("Helps both", [card("29"), card("50")], "helpsBoth")).toEqual(["Helps both: idea 1 shows 29, idea 2 shows 50"]);
  });

  it("the tag on exactly the cards that help both as printed: Helps you and Helps them each at least helpsThemMin (Helps you since Checkpoint 7d, planner reply to Checkpoint 7c, answer 5)", () => {
    expect(cardHelpsBoth(read("39", String(MIN), true), MIN)).toBe(true);
    expect(cardHelpsBoth(read(String(MIN), String(MIN), true), MIN)).toBe(true);
    for (const [helps, helpsThem] of [
      ["39", String(MIN - 1)],
      [String(MIN - 1), "40"],
      ["2", "14"],
      ["0", "40"],
      ["—", "40"],
      ["39", null],
      [null, "40"],
    ] as const)
      expect(cardHelpsBoth(read(helps, helpsThem, false), MIN), `${helps} / ${helpsThem}`).toBe(false);
    const cards = [read("39", "24", true), read("39", "4", false), read("0", "24", false), read("39", null, false), read("2", "14", false)];
    expect(helpsBothTagProblems(cards, MIN)).toEqual([]);
    expect(helpsBothTagProblems([read("2", "14", true)], MIN)).toEqual(["idea 1 shows “Helps both” at Helps you 2, Helps them 14"]);
    expect(helpsBothTagProblems([read("39", "4", true), read("39", "24", false)], MIN)).toEqual([
      "idea 1 shows “Helps both” at Helps you 39, Helps them 4",
      "idea 2 has no “Helps both” tag at Helps you 39, Helps them 24",
    ]);
    // The list: every card helps both and carries the tag.
    expect(helpsBothListProblems([read("50", "14", true), read("28", "44", true)], MIN)).toEqual([]);
    expect(helpsBothListProblems([read("50", "4", true), read("28", "44", false)], MIN, (i) => `card ${i + 1}`)).toEqual([
      "card 1 is on the “Helps both” list at Helps you 50, Helps them 4",
      "card 2 is on the “Helps both” list at Helps you 28, Helps them 44, untagged",
    ]);
  });

  it("the rules pass the app's own cards and words: the tag, the partner's line as the reader reads it, the list's status line", () => {
    const snapshot = tradeSnapshot();
    const tagged = withThem(evaluation({ key: "t", b: 6 }), 30);
    const short = withThem(evaluation({ key: "s", b: 3, give: ["105"] }), MIN - 1);
    const result = searchResult([tagged, short], { helpsBoth: { trades: [tagged], qualifying: 1, byChance: 0, lowerWouldAdd: false, dropped: { partnerCap: 0, core: 0, filler: 0, givenPlayer: 0 } } });
    for (const sort of SORT_OPTIONS.map((o) => o.value)) {
      const view = buildFinderView({ result, sort, snapshot, partnerId: null });
      const reads = view.cards.map((c) => ({ ...read(c.numbers.helps.value, c.them?.helps.value ?? null, c.helpsBothTag !== null), planBHelpsThem: JSON.stringify(c.planB ?? {}).includes("Helps them") }));
      expect(helpsBothTagProblems(reads, MIN), sort).toEqual([]);
      // Checkpoint 7d (planner reply to Checkpoint 7c, answer 3): the partner's line only with the tag (the short card has neither).
      expect(finderPartnerLineProblems(reads), sort).toEqual([]);
      const shortCard = view.cards.find((c) => c.key === "s");
      if (shortCard) expect(shortCard.them, sort).toBeNull();
      if (sort === "helpsBoth") {
        expect(helpsBothListProblems(reads, MIN)).toEqual([]);
        expect(helpsBothStatusOk(view.statusText, view.cards.length)).toBe(true);
      }
      // The partner's line names their odds as the rule wants, "in the same format as yours".
      expect(oddsLabelProblems(view.cards.flatMap((c) => (c.them ? [c.them.odds.map((o) => o.label)] : [])), null, undefined, "theirs"), sort).toEqual([]);
    }
    // The status line with one card, and with none.
    const one = buildFinderView({ result: { ...result, helpsBoth: { ...result.helpsBoth!, trades: [tagged] } }, sort: "helpsBoth", snapshot, partnerId: null });
    expect([one.statusText, helpsBothStatusOk(one.statusText, 1)]).toEqual(["Found 1 trade idea that helps both teams.", true]);
    const none = buildFinderView({ result: { ...result, helpsBoth: { ...result.helpsBoth!, trades: [] } }, sort: "helpsBoth", snapshot, partnerId: null });
    expect([none.statusText, helpsBothStatusOk(none.statusText, 0)]).toEqual(["No trades help both teams right now.", true]);
    expect(helpsBothStatusOk("Found 2 trade ideas.", 2)).toBe(false);
    // What inPage.ts's reader reads: the tag a leaf with its words; the partner's line's first item "Helps them" (a
    // one-line item's bold label), its number the next element; never read as one of my odds lines.
    const html = renderToStaticMarkup(createElement(TradeCard, { card: buildTradeCard(tagged, { snapshot }), rank: 1, feedback: noFeedback, onFeedback: saved }));
    expect(html).toMatch(/<span class="[^"]*">Helps both<\/span>/);
    expect(html).toMatch(/<p><span class="whitespace-nowrap" title="[^"]*"><span class="font-semibold">Helps them<\/span> <span class="tabular-nums">30<\/span><\/span><span aria-hidden="true">[^<]*<\/span><span class="sr-only">, <\/span><span class="whitespace-nowrap"><span class="font-semibold">Their title odds<\/span>/);
    expect(CARD_HELPERS).toContain('txt(labels[0]) === "Helps them"');
    expect(READ_CARD_ODDS).toContain('labels[0] !== "Helps them"');
    // The partner's labels against a top-3 league, and a list that reads otherwise.
    expect(oddsLabelProblems([["Their title odds", "Their top 3 odds", "Their playoff odds"]], 3, undefined, "theirs")).toEqual([]);
    expect(oddsLabelProblems([["Title odds", "Playoff odds"]], null, (i) => `idea ${i + 1}`, "theirs")).toEqual(["idea 1: “Title odds” · “Playoff odds”"]);
  });

  it("Checkpoint 7d: the partner's line on a Trade Finder card exactly with the tag, never in a Plan B box; on the Analyzer's card whatever it is (planner reply to Checkpoint 7c, answer 3)", () => {
    const line = (helps: string, helpsThem: string | null, helpsBothTag: boolean, planBHelpsThem = false) => ({ helps, helpsThem, helpsBothTag, planBHelpsThem });
    expect(finderPartnerLineProblems([line("39", "24", true), line("39", null, false), line("2", null, false)])).toEqual([]);
    expect(finderPartnerLineProblems([line("39", "4", false), line("39", null, true), line("39", "24", true, true)], (i) => `card ${i + 1}`)).toEqual([
      "card 1 shows “Helps them 4” without the “Helps both” tag",
      "card 2 is tagged “Helps both” without the partner's line",
      "card 3's “If they say no, try:” shows a partner's line",
    ]);
    // The Analyzer: the line whatever it is, the Finder's number when the Finder showed one, the same tag.
    expect(analyzerPartnerLineProblems(line("39", "0", false), { helpsThem: null, helpsBothTag: false }, MIN)).toEqual([]);
    expect(analyzerPartnerLineProblems(line("39", "24", true), { helpsThem: "24", helpsBothTag: true }, MIN)).toEqual([]);
    expect(analyzerPartnerLineProblems(line("39", null, false), { helpsThem: null, helpsBothTag: false }, MIN)).toEqual(["the Analyzer's card has no partner's line"]);
    expect(analyzerPartnerLineProblems(line("39", "22", false), { helpsThem: "24", helpsBothTag: true }, MIN)).toEqual([
      "the Analyzer's card reads Helps them 22, the Trade Finder's 24",
      "the Analyzer's card is not tagged “Helps both”, the Trade Finder's is",
      "the Analyzer's card has no “Helps both” tag at Helps you 39, Helps them 22",
    ]);
    // Its tag also follows its own printed scores (review of Checkpoint 7d, cards-export-3): a Trade Finder card shows Helps
    // them only with the tag, so an untagged one can't tell a trade that helps both from one that doesn't, and only the
    // Analyzer's card, which prints both scores, can show a tag the page failed to give. Before, a page that tagged neither
    // passed every check.
    expect(analyzerPartnerLineProblems(line("12", "15", false), { helpsThem: null, helpsBothTag: false }, MIN)).toEqual(["the Analyzer's card has no “Helps both” tag at Helps you 12, Helps them 15"]);
    expect(analyzerPartnerLineProblems(line("12", "15", true), { helpsThem: null, helpsBothTag: false }, MIN)).toEqual(["the Analyzer's card is tagged “Helps both”, the Trade Finder's isn't"]);
    expect(analyzerPartnerLineProblems(line(String(MIN - 1), "15", true), { helpsThem: null, helpsBothTag: true }, MIN)).toEqual([`the Analyzer's card shows “Helps both” at Helps you ${MIN - 1}, Helps them 15`]);
    // The app's own pages: a Finder card that doesn't help both (Helps them 4) shows no line, its Analyzer card "Helps them 4".
    const snapshot = tradeSnapshot();
    const e = withThem(evaluation({ key: "x", b: 6 }), 4);
    const finderCard = buildFinderView({ result: searchResult([e]), sort: "overall", snapshot, partnerId: null }).cards[0];
    const analyzerCard = buildAnalysisView({ evaluation: e, illegal: null, notes: [] }, snapshot).card;
    const asRead = (c: typeof finderCard) => line(c?.numbers.helps.value ?? "", c?.them?.helps.value ?? null, !!c?.helpsBothTag);
    expect(finderPartnerLineProblems([asRead(finderCard)])).toEqual([]);
    expect(asRead(finderCard).helpsThem).toBeNull();
    expect(analyzerPartnerLineProblems(asRead(analyzerCard ?? undefined), asRead(finderCard), MIN)).toEqual([]);
    expect(asRead(analyzerCard ?? undefined).helpsThem).toBe("4");
    // And a trade that helps both: both cards tagged, with the same line.
    const both = withThem(evaluation({ key: "y", b: 6 }), 30);
    const finderBoth = buildFinderView({ result: searchResult([both]), sort: "overall", snapshot, partnerId: null }).cards[0];
    const analyzerBoth = buildAnalysisView({ evaluation: both, illegal: null, notes: [] }, snapshot).card;
    expect([asRead(finderBoth).helpsBothTag, asRead(analyzerBoth ?? undefined).helpsBothTag]).toEqual([true, true]);
    expect(analyzerPartnerLineProblems(asRead(analyzerBoth ?? undefined), asRead(finderBoth), MIN)).toEqual([]);
    // The reader keeps a Plan B box apart: the box is the parent of its "If they say no, try:" heading, as TradeCard renders it.
    const planB = planBFixture({ partnerId: "2", give: ["105"], get: ["203"] });
    const boxed = renderToStaticMarkup(createElement(TradeCard, { card: buildTradeCard(withThem(evaluation({ planB }), 24), { snapshot }), rank: 1, feedback: noFeedback, onFeedback: saved }));
    expect(boxed).toMatch(/<div class="[^"]*"><p class="font-bold">If they say no, try:<\/p>/);
    expect(CARD_HELPERS).toContain('txt(p) === "If they say no, try:"');
    expect(CARD_HELPERS).toContain("planBHelpsThem: box ? !!partnerLine(box, null) : false");
  });

  it("FINDER_DONE reads every status line the Finder's done state can show, in every sort, and none of a search under way", () => {
    const snapshot = tradeSnapshot();
    const e = withThem(evaluation({ key: "t" }), 30);
    const withList = searchResult([e], { helpsBoth: { trades: [e], qualifying: 1, byChance: 0, lowerWouldAdd: false, dropped: { partnerCap: 0, core: 0, filler: 0, givenPlayer: 0 } } });
    const statuses = new Set<string>();
    for (const sort of SORT_OPTIONS.map((o) => o.value)) {
      for (const result of [
        withList,
        searchResult([e]),
        searchResult([]),
        searchResult([], { hidden: { byBenefit: 2, byMarket: 0 } }),
        searchResult([], { filter: { minChance: 0.5, qualifying: 0, few: true }, hidden: { byBenefit: 0, byMarket: 0, byChance: 3 } }),
        searchResult([], { notes: ["Your league's trade deadline has passed."], counts: { screened: 0, exact: 0, simScreen: 0, simFinal: 0 } }),
      ])
        statuses.add(buildFinderView({ result, sort, snapshot, partnerId: null }).statusText);
    }
    expect([...statuses].sort()).toEqual(
      [
        "Found 1 trade idea.",
        "Found 1 trade idea that helps both teams.",
        "No trade ideas at this minimum chance.",
        "No trade ideas found.",
        "No trade ideas right now.",
        "No trade ideas that help you.",
        "No trades help both teams right now.",
      ].sort(),
    );
    for (const s of statuses) expect(FINDER_DONE_STATUS.test(s), s).toBe(true);
    for (const s of ["Searching for trade ideas: screening trade ideas…", "Showing the trade ideas at your minimum chance…", "Search stopped.", "Loading projections…", "Loading your settings…"])
      expect(FINDER_DONE_STATUS.test(s), s).toBe(false);
    // The page's own copy of the rule (an expression TypeScript never checks) compiles, its pattern written in whole.
    expect(FINDER_DONE).toContain(FINDER_DONE_STATUS.toString());
    expect(() => new Function(`return (async () => {\n${PAGE_HELPERS}\nreturn (${FINDER_DONE});\n})`)).not.toThrow();
  });
});

describe("Checkpoint 7b: the Analyzer's link back isn't prefetched", () => {
  it("knows which requests name the link's address, team id included", () => {
    const href = "/trades?partner=3";
    expect(requestNamesAddress("/trades?partner=3&_rsc=1a2b3", href)).toBe(true);
    expect(requestNamesAddress("/trades?_rsc=1a2b3&partner=3", href)).toBe(true);
    expect(requestNamesAddress("/trades.rsc?partner=3", href)).toBe(true);
    // The header's own /trades (no team id), another team, another page: not the link's address.
    expect(requestNamesAddress("/trades?_rsc=1a2b3", href)).toBe(false);
    expect(requestNamesAddress("/trades?partner=31&_rsc=1a2b3", href)).toBe(false);
    expect(requestNamesAddress("/tradesx?partner=3", href)).toBe(false);
    expect(requestNamesAddress("/analyzer?partner=3", href)).toBe(false);
  });

  it("tells Next's prefetches by their header, in any case", () => {
    expect(isPrefetchRequest({ "Next-Router-Prefetch": "1", RSC: "1" })).toBe(true);
    expect(isPrefetchRequest({ "next-router-prefetch": "1" })).toBe(true);
    expect(isPrefetchRequest({ RSC: "1" })).toBe(false);
    expect(isPrefetchRequest(undefined)).toBe(false);
  });

  it("runs the new steps where they belong: Notices after League, Waivers after the Analyzer", () => {
    const names = STEPS.map((s) => s.name);
    expect(names.indexOf("Notices")).toBe(names.indexOf("League") + 1);
    expect(names.indexOf("Waivers")).toBe(names.indexOf("Analyzer") + 1);
    expect(names.indexOf("Settings")).toBe(names.indexOf("Waivers") + 1);
  });
});

describe("Checkpoint 7b: the rules pass the app's own pages, and catch its technical details (rendered from the app's test fixtures)", () => {
  /**
   * A page's words as the check reads them (inPage.ts pageText with `all` and `attributes`): every word a tap could show and
   * the title and aria-label texts, from the page's server-rendered markup, scripts and styles left out.
   */
  const words = (html: string): string => {
    const markup = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
    const hover: string[] = [];
    for (const m of markup.matchAll(/<[a-zA-Z][\w:-]*([^>]*?)\/?>/g)) {
      const attrs = attributesOf(m[1] ?? "");
      for (const name of ["title", "aria-label"]) {
        const v = attrs.get(name);
        if (v) hover.push(v);
      }
    }
    return decodeEntities([markup.replace(/<[^>]*>/g, " "), ...hover].join(" "))
      .replace(/\s+/g, " ")
      .trim();
  };
  const articles = (html: string): string[] => html.match(/<article\b[\s\S]*?<\/article>/g) ?? [];
  const saved = () => ({ ok: true as const });
  const noFeedback = { outcome: null, report: null, version: null, versionKey: null, versionWords: null };

  it("every notice the app can word (src/lib/notices.ts) reads plainly: no code, path, field name or stat ID", () => {
    const texts = Object.entries(NOTICE_TEXT)
      .map(([code, word]) => word({ code, message: "Week 5 and week 7 are the weeks named.", platformPath: "settings.scoringSettings[2]", teams: ["1"] }, { myTeamId: "1" }))
      .filter((t): t is string => typeof t === "string");
    texts.push(...Object.values(UNKNOWN_SETTING_NOTICE));
    expect(texts.length).toBeGreaterThan(40);
    for (const t of texts) expect(noticeLeaks(t), t).toEqual([]);
  });

  it("the Import Report: nothing internal above its technical details (closed parts and hover texts included); they hold the codes and paths", () => {
    const snapshot = {
      platform: "espn",
      leagueId: "4242",
      season: 2026,
      name: "The Gloopdorf Invitational",
      fetchedAt: "2026-10-05T12:00:00.000Z",
      currentWeek: 5,
      settings: {
        numTeams: 2,
        leagueType: "redraft",
        lineup: [{ slot: "QB", count: 1, eligible: ["QB"] }],
        benchSlots: 5,
        irSlots: 1,
        taxiSlots: 0,
        maxRosterSize: 7,
        scoring: {
          perStat: { pass_td: 4, rec: 1 },
          rules: [],
          unmapped: [
            { platformKey: "209", label: "1pt Safety", points: 1, scoredThisSeason: false },
            { platformKey: "93", label: "Blocked Punt or FG return for TD", points: 6, scoredThisSeason: false },
          ],
        },
        regularSeasonWeeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
        playoffWeeks: [15, 16, 17],
        playoffTeams: 2,
        playoffByes: 0,
        medianGame: false,
        pointsOnly: false,
        tradeDeadline: { week: 11 },
        tradeReview: "league_vote",
        tradeReviewHours: 24,
      },
      teams: [
        { id: "1", name: "Moonbeam Mudcats", ownerName: "Zorblax Quintavious", roster: ["777"], ir: [], taxi: [], record: { w: 2, l: 2, t: 0 }, pointsFor: 400, pointsAgainst: 390 },
        { id: "3", name: "Quasar Quokkas", ownerName: "Quenby Flapdoodle", roster: [], ir: [], taxi: [], record: { w: 2, l: 2, t: 0 }, pointsFor: 390, pointsAgainst: 400 },
      ],
      myTeamId: "1",
      players: { "777": { id: "777", name: "Trey Zorblax", pos: "QB", eligible: ["QB"], nflTeam: "GB", injury: "ACTIVE", ids: {} } },
      schedule: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((week) => ({ week, teamA: "1", teamB: "3", isPlayoff: false })),
      transactions: [],
      freeAgents: [],
      warnings: [
        { code: "ESPN_SCORING_UNMAPPED", message: "ESPN scoring rule “1pt Safety” (1 pts) isn't counted.", platformPath: "settings.scoringSettings.scoringItems[4] (statId 209)" },
        { code: "ESPN_SCORING_UNMAPPED", message: "ESPN scoring rule “Blocked Punt or FG return for TD” (6 pts) isn't counted.", platformPath: "settings.scoringSettings.scoringItems[8] (statId 93)" },
        { code: "ESPN_PLAYER_MATCHED_BY_NAME", message: "1 player isn't in any player ID source. Rostered: Trey Zorblax (QB, GB).", platformPath: "player.id", players: ["777"] },
        { code: "ESPN_SEEDING_TIEBREAKER_UNKNOWN", message: "ESPN's seeding rule wasn't one we know.", platformPath: "settings.scheduleSettings.playoffSeedingRule" },
        { code: "ESPN_POSITION_UNKNOWN", message: "1 player(s) have an ESPN position we don't know (defaultPositionId 99) and were left out.", platformPath: "player.defaultPositionId", teams: ["3"] },
        { code: "TRADES_DISABLED", message: "Trading is turned off in this league.", platformPath: "settings.disable_trades" },
      ],
    } as unknown as LeagueSnapshot;
    const view = buildImportReport({ snapshot, notes: ["Trades rebuilt from the rosters: teams[].roster.entries[].acquisitionType"] } as ImportResponse, { timeZone: "America/Chicago", myTeamId: "1" });
    const html = renderToStaticMarkup(createElement(ReportView, { view, onPickTeam: () => {} }));
    const at = html.indexOf('<details id="technical-details"');
    expect(at).toBeGreaterThan(0);
    const above = words(html.slice(0, at));
    // The quiet line and a notice are there, in plain words, and the scoring card's closed "All scoring rules" is read.
    expect(above).toContain(PARKER_QUIET_LINE);
    expect(above).toContain("Trading is turned off in your league");
    expect(above).toContain("All scoring rules");
    expect(noticeLeaks(above)).toEqual([]);
    expect(noticeLeaks(words(html.slice(at)))).toEqual(
      expect.arrayContaining([
        "the code ESPN_SCORING_UNMAPPED",
        '"statId"',
        '"scoringItems"',
        '"player.id"',
        'the path or field name "settings.scheduleSettings.playoffSeedingRule"',
        'the path or field name "player.defaultPositionId"',
        'the path or field name "teams[].roster.entries[].acquisitionType"',
      ]),
    );
  });

  it("the League page: no code, path or trade value anywhere, every player's breakdown and the market blend's words included", () => {
    const f = leagueFixture();
    const blends: Record<string, PlayerBlend> = {
      "101": { ours: 431.7, market: 289.3, used: 360.5, weight: 0.5 },
      "201": { ours: 123.4, market: 345.6, used: 166.59, weight: 0.5, clamped: "high" },
      "301": { ours: 313.2, market: 313.2, used: 313.2, weight: 0.5 },
    };
    for (const [id, blend] of Object.entries(blends)) {
      const pm = f.model.players[id];
      if (!pm) throw new Error(`fixture player ${id} missing`);
      f.model.players[id] = { ...pm, blend };
    }
    const view = buildLeagueView({ ...f, myTeamSource: "platform", timeZone: "America/Chicago", now: LEAGUE_NOW });
    const html = renderToStaticMarkup(createElement(LeagueView, { view, refresh: { onRefresh: () => {}, refreshing: false, error: null, status: null } }));
    const players = [...view.rosters.flatMap((r) => r.players), ...view.freeAgents.flatMap((g) => g.players)];
    const details = players.map((player) => renderToStaticMarkup(createElement(PlayerDetail, { player, showLineupCost: true })));
    const text = words([html, ...details].join(" "));
    expect(details.length).toBeGreaterThan(20);
    expect(details.filter((d) => BLEND_WORDS.test(decodeEntities(d)))).toHaveLength(3);
    expect(noticeLeaks(text)).toEqual([]);
    expect(pageValueLeaks(text)).toEqual([]);
  });

  it("the Trade Finder's page and cards (steps, Plan B, messages) and the Analyzer's card (Details): no code, path or trade value; each card credits FantasyCalc", () => {
    const snapshot = tradeSnapshot();
    const fantasyCalc = tradeFantasyCalc();
    const trades: TradeEvaluation[] = [
      evaluation({ key: "plain" }),
      evaluation({ key: "planB", planB: planBFixture({ partnerId: "2", give: ["105"], get: ["203"] }) }),
      { ...steppedFull(), key: "steps" },
    ];
    const finder = buildFinderView({ result: searchResult(trades, { hidden: { byBenefit: 1, byMarket: 2 } }), sort: "overall", snapshot, partnerId: null, fantasyCalc });
    const timing = { bestTime: bestTimeText({ tradeReviewHours: 24 }), freshness: "Trade values updated 2 hours ago · Projections updated 5 hours ago." };
    const page = renderToStaticMarkup(
      createElement(FinderFrame, { state: { kind: "done", view: finder }, teamName: "Moonbeam Mudcats", timing, controls: null, records: [], leagueKey: "espn:0000abcd", onFeedback: saved }),
    );
    expect(noticeLeaks(words(page))).toEqual([]);
    const analysis = buildAnalysisView({ evaluation: { ...trades[0]!, marketWeekly: -0.4 }, illegal: null, notes: [], helpsScale: null, baseline: { pPlayoffs: 0.62, pTitle: 0.09 } }, snapshot, undefined, { fantasyCalc });
    const analyzer = renderToStaticMarkup(createElement(AnalysisResult, { view: analysis, stale: false, records: [], leagueKey: "espn:0000abcd", leagueType: "redraft", onFeedback: saved }));
    expect(analyzer).toContain("How Helps you adds up for this trade.");
    const cards = [...articles(page), ...articles(analyzer)];
    expect(cards).toHaveLength(trades.length + 1);
    for (const card of cards) {
      const text = words(card);
      expect(valueLeaks(text), text.slice(0, 80)).toEqual([]);
      expect(noticeLeaks(text), text.slice(0, 80)).toEqual([]);
      expect(text).toContain(`${VALUES_CREDIT} Values: FantasyCalc`);
    }
    // A card the way they were before Phase 7b is caught.
    const old = renderToStaticMarkup(
      createElement(TradeCard, { card: { ...finder.cards[0]!, facts: [{ label: "Trade value", value: "You give 6,500, you get 5,400" }] }, rank: 1, feedback: noFeedback, onFeedback: saved }),
    );
    expect(valueLeaks(words(old))).toHaveLength(3);
  });
});

describe("the browser's own reads of a league (Part B, track BF)", () => {
  it("are the two league APIs only, recorded without any id or username", () => {
    expect(isPlatformRead("https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/12345678?view=mSettings")).toBe(true);
    expect(isPlatformRead("https://api.sleeper.app/v1/state/nfl")).toBe(true);
    expect(isPlatformRead("https://api.sleeper.app.evil.example/v1")).toBe(false);
    expect(isPlatformRead("https://fantasy.espn.com/football/league?leagueId=12345678")).toBe(false);
    const espn = platformReadText("https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/12345678?view=mSettings&view=mTeam", "GET");
    expect(espn).toBe("GET lm-api-reads.fantasy.espn.com view=mSettings,mTeam");
    expect(platformReadText("https://api.sleeper.app/v1/league/123456789012345678/matchups/3", "GET")).toBe("GET api.sleeper.app/v1/league/#/matchups/#");
    expect(platformReadText("https://api.sleeper.app/v1/user/zorblaxq", "GET")).toBe("GET api.sleeper.app/v1/user/…");
    expect(platformReadText("https://api.sleeper.app/v1/user/123/leagues/nfl/2026", "OPTIONS")).toBe("OPTIONS api.sleeper.app/v1/user/#/leagues/nfl/#");
    for (const t of [espn, platformReadText("https://api.sleeper.app/v1/user/zorblaxq", "GET")]) expect(t).not.toMatch(/12345678|zorblaxq/);
  });

  it("count only the league-data requests as reads; anything else to those hosts is the server's to read, a problem (review BF-R6)", () => {
    const espnLeague = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/12345678";
    for (const url of [
      `${espnLeague}?view=mSettings&view=mTeam&view=mRoster&view=mMatchup&view=mStatus`,
      `${espnLeague}?view=mTransactions2&scoringPeriodId=3`,
      `${espnLeague}?view=kona_player_info&scoringPeriodId=4`,
      `${espnLeague}?view=kona_playercard`,
      "https://api.sleeper.app/v1/state/nfl",
      "https://api.sleeper.app/v1/user/zorblaxq",
      "https://api.sleeper.app/v1/user/123/leagues/nfl/2026",
      "https://api.sleeper.app/v1/league/123456789012345678",
      "https://api.sleeper.app/v1/league/123456789012345678/users",
      "https://api.sleeper.app/v1/league/123456789012345678/rosters",
      "https://api.sleeper.app/v1/league/123456789012345678/matchups/3",
      "https://api.sleeper.app/v1/league/123456789012345678/transactions/2",
      "https://api.sleeper.app/v1/league/123456789012345678/traded_picks",
      "https://api.sleeper.app/v1/league/123456789012345678/drafts",
      // Checkpoint 7c: the winners bracket (the 3rd-place game) is the league's own data, read in the browser too.
      "https://api.sleeper.app/v1/league/123456789012345678/winners_bracket",
    ])
      expect(isPlatformRead(url), url).toBe(true);
    // ...and said without its id, by its own word.
    expect(platformReadText("https://api.sleeper.app/v1/league/123456789012345678/winners_bracket", "GET")).toBe("GET api.sleeper.app/v1/league/#/winners_bracket");
    for (const url of [
      "https://api.sleeper.app/projections/nfl/2026/5?season_type=regular&position[]=QB",
      "https://api.sleeper.app/stats/nfl/2026/3?season_type=regular&position[]=QB",
      "https://api.sleeper.app/v1/players/nfl",
      "https://api.sleeper.app/v1/league/123456789012345678/losers_bracket",
      "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026?view=proTeamSchedules_wl",
      "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leaguedefaults/3?view=kona_player_info",
      `${espnLeague}?view=mSettings&view=kona_game_state`,
      `${espnLeague}`,
    ]) {
      expect(isPlatformRead(url), url).toBe(false);
      expect(isPlatformHost(url), url).toBe(true);
    }
    expect(isPlatformHost("https://api.sleeper.app.evil.example/v1")).toBe(false);
    // Said without ids, but with what it was.
    expect(platformReadText("https://api.sleeper.app/projections/nfl/2026/5?season_type=regular", "GET")).toBe("GET api.sleeper.app/projections/nfl/#/#");
  });

  it("say which path read the league: the browser (seen reading ESPN), the server (after the browser tried, or not), or unknown", () => {
    expect(readPathOf("browser", 12)).toMatchObject({ readBy: "browser", text: "read the league in this browser, straight from ESPN (12 requests), and sent it up (track BF)" });
    expect(readPathOf("browser", 0).readBy).toBe("unknown");
    expect(readPathOf("server", 1)).toMatchObject({ readBy: "server", text: expect.stringContaining("fell back") });
    expect(readPathOf("server", 0)).toMatchObject({ readBy: "server", text: expect.stringContaining("didn't run") });
    expect(readPathOf(null, 0).readBy).toBe("unknown");
  });
});

describe("the server helpers", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "offer-sheet-check-browser-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("finds the production build by its BUILD_ID, and the newest source change", async () => {
    expect(productionBuild(dir)).toBeNull();
    await mkdir(path.join(dir, ".next"));
    await writeFile(path.join(dir, ".next", "BUILD_ID"), "abc");
    const built = Date.parse("2026-10-03T10:00:00Z");
    await utimes(path.join(dir, ".next", "BUILD_ID"), built / 1000, built / 1000);
    expect(productionBuild(dir)?.builtAt).toBe(built);
    await mkdir(path.join(dir, "src", "deep"), { recursive: true });
    await writeFile(path.join(dir, "src", "deep", "a.ts"), "x");
    const later = Date.parse("2026-10-03T11:00:00Z");
    await utimes(path.join(dir, "src", "deep", "a.ts"), later / 1000, later / 1000);
    expect(newestChange(path.join(dir, "src"))).toBe(later);
    expect(newestChange(path.join(dir, "missing"))).toBe(0);
  });

  it("finds a free local port", async () => {
    const port = await freePort();
    expect(Number.isInteger(port) && port > 0 && port < 65536).toBe(true);
  });

  const gone = (c: ChildProcess | null) => !!c && (c.exitCode !== null || c.signalCode !== null);

  it("stops a browser that never opens DevTools before giving up, and reads the URL from one that does", async () => {
    const stuck = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    await expect(waitForDevtools(stuck, 300)).rejects.toThrow(/didn't open DevTools/);
    expect(gone(stuck)).toBe(true);
    const ready = spawn(process.execPath, ["-e", "console.error('DevTools listening on ws://127.0.0.1:9/devtools/browser/x'); setInterval(() => {}, 1000)"], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    try {
      await expect(waitForDevtools(ready, 20_000)).resolves.toBe("ws://127.0.0.1:9/devtools/browser/x");
    } finally {
      killTree(ready);
      await exited(ready, 5_000);
    }
  }, 30_000);

  it("hands the server over as soon as it's started, and stops one that never answers before giving up", async () => {
    // A stand-in for Next.js that never listens.
    const bin = path.join(dir, "node_modules", "next", "dist", "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, "next"), "setInterval(() => {}, 1000);\n");
    let child: ChildProcess | null = null;
    await expect(
      startNextServer(dir, await freePort(), {
        timeoutMs: 800,
        onSpawn: (c) => {
          child = c;
        },
      }),
    ).rejects.toBeInstanceOf(StartError);
    expect(gone(child)).toBe(true);
  }, 30_000);
});
