/**
 * `npm run check:browser`: the parts that run without a browser (options, finding Chrome, the report and its name
 * cleaning, the server helpers, the sort and anchor rules) and a syntax check of the in-page JavaScript, which
 * TypeScript never sees; the page's name replacer is also run here, against report.ts's, on the same texts. The steps
 * themselves need the production build and Chrome: the script is their test. Every name here is fictional.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MAX_SEARCH_SECONDS, SECOND_LEAGUE, USAGE, parseArgs, resolveArgs, type CheckBrowserArgs } from "./args";
import { chromeArgs, chromeCandidates, devtoolsUrl, exited, findChrome, killTree, waitForDevtools } from "./chrome";
import { CARD_HELPERS, CSP_MARK, INSTRUMENT, NAME_REPLACER, PAGE_HELPERS, RESTORE_CALL, sanitizeCall } from "./inPage";
import { consoleCallKind, cspIssueText, isPlatformHost, isPlatformRead, keptText, logEntryKind, platformReadText, TEXT_KEEP_MAX } from "./page";
import {
  CheckReport,
  cleanValue,
  compileNameRules,
  cutText,
  formatLine,
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
import { isMissingPage404, MISSING_PAGE, NARROW_PHONE_WIDTH, READ_SITE_FILES, readPathOf, sameRow, siteFileChecks, sidelessCards, skipReason, sortInversions, STATIC_PAGES, STEPS, type SiteFiles } from "./steps";

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
    ])
      expect(isPlatformRead(url), url).toBe(true);
    for (const url of [
      "https://api.sleeper.app/projections/nfl/2026/5?season_type=regular&position[]=QB",
      "https://api.sleeper.app/stats/nfl/2026/3?season_type=regular&position[]=QB",
      "https://api.sleeper.app/v1/players/nfl",
      "https://api.sleeper.app/v1/league/123456789012345678/winners_bracket",
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
