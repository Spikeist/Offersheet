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
import { DEFAULT_MAX_SEARCH_SECONDS, parseArgs, resolveArgs, type CheckBrowserArgs } from "./args";
import { chromeArgs, chromeCandidates, devtoolsUrl, exited, findChrome, killTree, waitForDevtools } from "./chrome";
import { CARD_HELPERS, INSTRUMENT, NAME_REPLACER, PAGE_HELPERS, RESTORE_CALL, sanitizeCall } from "./inPage";
import { keptText, TEXT_KEEP_MAX } from "./page";
import {
  CheckReport,
  cleanValue,
  compileNameRules,
  cutText,
  formatLine,
  leagueNamesScrubber,
  leftoverChecker,
  leftoverNames,
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
import { sidelessCards, sortInversions } from "./steps";

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
  it("defaults: the Import Report's team, headless, screenshots, §12's 10 seconds", () => {
    expect(resolved([])).toEqual({ team: null, show: false, shots: true, maxSearchSeconds: DEFAULT_MAX_SEARCH_SECONDS, help: false });
    expect(DEFAULT_MAX_SEARCH_SECONDS).toBe(10);
  });

  it("reads --team, --show, --no-shots, --max-search and --help, with a space or an equals sign", () => {
    expect(resolved(["--team", "3", "--show", "--no-shots", "--max-search", "12"])).toEqual({ team: "3", show: true, shots: false, maxSearchSeconds: 12, help: false });
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

  it("takes the options npm kept for itself when the '--' was dropped (npm 10 on Windows PowerShell)", () => {
    // npm run check:browser --team 3 --show --no-shots
    expect(resolved(["3"], { npm_config_team: "true", npm_config_show: "true", npm_config_shots: "" })).toMatchObject({ team: "3", show: true, shots: false });
    // npm run check:browser --team=3 --max-search=15
    expect(resolved([], { npm_config_team: "3", npm_config_max_search: "15" })).toMatchObject({ team: "3", maxSearchSeconds: 15 });
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

describe("the checks' own rules", () => {
  const card = (helps: string | null, accept: string | null, overall: string | null, acceptThrough: string | null = null) => ({ helps, accept, acceptThrough, overall });

  it("Chance they accept is in order by the chance it goes through, when a card shows one (rank.ts sorts by P_complete)", () => {
    // A vetoed idea shows 80% they accept but 40% it goes through: after a 50% one is the right order.
    expect(sortInversions("Chance they accept", [card("40", "50%", "20"), card("45", "80%", "18", "40%")], "accept")).toEqual([]);
    expect(sortInversions("Chance they accept", [card("40", "40%", "20"), card("45", "50%", "18")], "accept")).toEqual(["Chance they accept: idea 1 shows 40%, idea 2 shows 50%"]);
    // Ideas that don't help come after, in their own order.
    expect(sortInversions("Chance they accept", [card("40", "40%", "20"), card("0", "90%", "0"), card("—", "95%", "—")], "accept")).toEqual([]);
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
