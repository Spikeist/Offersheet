/**
 * npm run check:browser — the production build, end to end, in headless Chrome at phone width (planner reply to
 * Checkpoint 4, change 7: the Phase 4 review's browser harness, kept in the repo so it can be run again).
 *
 *   npm run build
 *   npm run check:browser -- --live --team 3        (options: npm run check:browser -- --help)
 *
 * It runs only with --live (planner reply to Checkpoint 4c, A5: scripts touch the network only when asked): without it,
 * it says so and exits 2 before anything starts.
 *
 * What it does:
 * 1. Checks it can run: a production build (.next/BUILD_ID: run `npm run build` first; a note when src/ changed after
 *    it), ESPN_LEAGUE_ID in .env.local (read with scripts/lib/env.ts, never printed), and Chrome (chrome.ts: CHROME_PATH
 *    or its usual install places).
 * 2. Starts `next start` on a free local port (server.ts) and Chrome, headless, with a throwaway profile in
 *    .cache/check-browser/profile (git-ignored with the rest of .cache/; emptied at the start, removed at the end), as a
 *    375 × 812 px phone (page.ts).
 * 3. Runs the steps (steps.ts): Connect and the public-link import, the Import Report and the team (--team <id>, else
 *    the report's own choice), the League page, the Trade Finder's full search (timed, with the engine's per-stage
 *    timings), a card's buttons, the Trade Analyzer, Settings, then the public pages (Home, Privacy, Terms, Feedback, a
 *    missing page) and the site's files and security headers (Part B; they need no league, so they run even when the
 *    import failed): no sideways scrolling, tap targets of at least 44 px, the header's first row on a 320 px phone,
 *    no console errors, CSP violations or failed requests, and "Harder to get" never on my own players. With
 *    --second-league (Phase 4c), also a second league (the public ESPN test league, args.ts SECOND_LEAGUE) added with
 *    the league switcher, switched to and back, then removed: each page shows the league it should, and settings and
 *    feedback stay per league. Its names are cleaned like the first league's ("Team L2-3").
 * 4. Prints one line per check as it goes, the numbers (timings and counts), and a summary; writes the same, cleaned,
 *    to .cache/check-browser/results.json, and screenshots (when on) to .cache/check-browser/shots/.
 * 5. Always stops Chrome and the server, whatever happened (an error, Ctrl+C, an uncaught exception): each process is
 *    tracked from the moment it's spawned, so one still starting is stopped too, and the exit hook kills every tree
 *    that's left. A profile that can't be removed (a Chrome left running) is said, with what to do.
 *
 * Privacy (CLAUDE.md §0.5–0.6; report.ts): every line is cleaned before it's printed: the .env.local values (the league
 * id among them) and, once the league is imported, its team, owner and league names, replaced by placeholders ("Team
 * 3", "Owner 3", "<league name>"); then cut (never before cleaning); then checked by report.ts leftoverNames, written
 * apart from the cleaning: a line that still holds a name is withheld, never printed. Numbers and the results file are
 * cleaned string by string before they're serialized (JSON escaping would hide a name with a quote from the
 * cleaning), and every string still holding a name is withheld from the file. The "Output" check fails when anything
 * was withheld, without saying what. Screenshots are taken while the page's own text has the same names replaced (put
 * back right after). The server's output is never printed, except the last lines of a start that failed.
 *
 * Exit code: 0 every check passed (skips allowed), 1 a check failed, 2 the check couldn't run, 130 stopped (Ctrl+C).
 */
import type { ChildProcess } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT, env } from "../lib/env";
import { installConsoleScrubber, loadSecretsIntoScrubber, registerScrubber, scrubEverything } from "../lib/redact";
import { isMainModule, liveRequiredText, setNetworkMode } from "../lib/runMode";
import { parseArgs, resolveArgs, SECOND_LEAGUE, USAGE, type CheckBrowserArgs } from "./args";
import { CdpClient } from "./cdp";
import { exited, findChrome, killTree, launchChrome, stopChrome, type RunningChrome } from "./chrome";
import { PageSession, PHONE } from "./page";
import { CheckReport, cleanValue, cutText, formatLine, leagueNamesScrubber, leftoverChecker, summaryLines, withholdLeftovers, WITHHELD, type LeftoverCheck } from "./report";
import { freePort, newestChange, productionBuild, StartError, startNextServer, stopServer, type RunningServer } from "./server";
import { healthCheck, skipReason, STEPS, type StepContext } from "./steps";

const OUT_DIR = path.join(ROOT, ".cache", "check-browser");
const PROFILE_DIR = path.join(OUT_DIR, "profile");
const SHOTS_DIR = path.join(OUT_DIR, "shots");
const RESULTS_FILE = path.join(OUT_DIR, "results.json");

/** A printed line is cut to this many characters, after cleaning. */
const PRINT_MAX = 500;
/** A string in the results file is cut to this many characters, after cleaning. */
const FILE_MAX = 4_000;

const PROFILE_HINT =
  "The throwaway browser profile (.cache/check-browser/profile) couldn't be removed: a Chrome from a check that was cut short may still be running. End it (on Windows: Task Manager, Google Chrome), then delete that folder.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");

let server: RunningServer | null = null;
let chrome: RunningChrome | null = null;
let cdp: CdpClient | null = null;
let stopping: Promise<void> | null = null;
/** Every process started, from the moment it exists, and whether it leads its own process group (the server, outside Windows). */
const spawned = new Set<{ child: ChildProcess; group: boolean }>();

/** Removes a folder, retrying while Windows still holds files the browser just let go of; false when it can't. */
async function removeDir(dir: string): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return true;
    } catch {
      await sleep(250 * (attempt + 1));
    }
  }
  return false;
}

/**
 * Stops the browser, then the server, then anything still starting, then removes the throwaway profile (once, whoever
 * asks first).
 */
function stopAll(): Promise<void> {
  stopping ??= (async () => {
    const browser = chrome;
    const client = cdp;
    if (browser) await stopChrome(browser, client ? () => client.send("Browser.close", {}, undefined, 5_000) : undefined);
    client?.close();
    if (server) await stopServer(server);
    // A process stopped while it started (Ctrl+C, or a start that failed half way) never became `chrome` or `server`.
    for (const p of spawned) killTree(p.child, p.group);
    for (const p of spawned) await exited(p.child, 5_000);
    if (!(await removeDir(PROFILE_DIR))) console.error(PROFILE_HINT);
  })();
  return stopping;
}

/** Last resort on exit (an uncaught exception exits at once): kill every process tree left, synchronously. */
process.on("exit", () => {
  for (const p of spawned) killTree(p.child, p.group);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`\nStopping (${signal})…`);
    void stopAll().finally(() => process.exit(130));
  });
}

/** Thrown when a stop was asked for while something was starting: nothing new is started after it. */
class Stopped extends Error {
  constructor() {
    super("stopped");
    this.name = "Stopped";
  }
}

/** The numbers worth keeping, one per line; each value cleaned before it's serialized (the header). */
function printNumbers(report: CheckReport, say: (text: string) => void): void {
  const steps = Object.entries(report.numbers);
  if (!steps.length) return;
  say("\nNumbers");
  for (const [step, values] of steps) {
    say(`  ${step}`);
    for (const [key, value] of Object.entries(values)) {
      if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
        say(`    ${key}:`);
        for (const v of value) say(`      ${v}`);
      } else {
        say(`    ${key}: ${typeof value === "object" && value !== null ? JSON.stringify(cleanValue(value, scrubEverything)) : String(value)}`);
      }
    }
  }
}

async function run(args: CheckBrowserArgs): Promise<number> {
  const build = productionBuild(ROOT);
  if (!build) {
    console.error("No production build found. Run npm run build first, then npm run check:browser -- --live.");
    return 2;
  }
  const leagueId = env("ESPN_LEAGUE_ID");
  if (!leagueId) {
    console.error("ESPN_LEAGUE_ID is blank in .env.local. Fill it in with your league's id, then run this again.");
    return 2;
  }
  const found = findChrome();
  if ("error" in found) {
    console.error(found.error);
    return 2;
  }

  console.log(
    `Offer Sheet browser check: the production build at ${PHONE.width} px, your ESPN league through its public link${args.secondLeague ? `, then the public test league ${SECOND_LEAGUE.leagueId} (${SECOND_LEAGUE.season}) as a second league` : ""}.`,
  );
  console.log(`Build: ${new Date(build.builtAt).toISOString()}.`);
  if (newestChange(path.join(ROOT, "src")) > build.builtAt) console.log("Note: files in src/ changed after that build. This checks the build as it is: run npm run build for the current code.");
  mkdirSync(OUT_DIR, { recursive: true });
  if (!(await removeDir(PROFILE_DIR))) {
    console.error(PROFILE_HINT);
    return 2;
  }
  if (args.shots) await removeDir(SHOTS_DIR);

  // The check for names left after cleaning: the league id at first, its names too once it's imported (held on an
  // object: TypeScript doesn't follow a let assigned in a callback).
  const check: { leftovers: LeftoverCheck } = { leftovers: leftoverChecker(null, [leagueId]) };
  let withheldLines = 0;
  /** Prints a line: cleaned, then cut, then printed only when no name is left in it (the header). */
  const say = (text: string): void => {
    const line = cutText(scrubEverything(text), PRINT_MAX);
    if (check.leftovers(line) > 0) {
      withheldLines++;
      console.log(`          ${WITHHELD}`);
      return;
    }
    console.log(line);
  };

  try {
    const port = await freePort();
    server = await startNextServer(ROOT, port, { onSpawn: (child) => spawned.add({ child, group: process.platform !== "win32" }) });
    if (stopping) throw new Stopped();
    chrome = await launchChrome(found.path, { profileDir: PROFILE_DIR, show: args.show, onSpawn: (child) => spawned.add({ child, group: false }) });
    if (stopping) throw new Stopped();
    cdp = await CdpClient.connect(chrome.wsUrl);
    const version = await cdp.send<{ product?: string }>("Browser.getVersion");
    console.log(`Server: next start on port ${port}. Browser: ${version.product ?? "Chrome"} (${args.show ? "visible" : "headless"}), ${PHONE.width} x ${PHONE.height} px.`);
    const page = await PageSession.open(cdp, server.origin);

    const report = new CheckReport();
    let shownStep = "";
    report.onLine = (line) => {
      if (line.step !== shownStep) {
        shownStep = line.step;
        say(`\n${line.step}`);
      }
      for (const l of formatLine(line)) say(l);
    };
    const ctx: StepContext = {
      page,
      report,
      args,
      leagueId,
      season: env("ESPN_SEASON"),
      shotsDir: args.shots ? SHOTS_DIR : null,
      names: null,
      // Called again with both leagues' names when --second-league adds one (report.ts mergeLeagueNames).
      onNames: (names) => {
        registerScrubber(leagueNamesScrubber(names));
        check.leftovers = leftoverChecker(names, [leagueId]);
      },
      myTeam: null,
      firstCard: null,
      stop: null,
      shots: [],
    };
    for (const step of STEPS) {
      const skipped = skipReason(step, ctx.stop);
      if (skipped) {
        report.skip(step.name, skipped);
        continue;
      }
      try {
        await step.run(ctx);
      } catch (err) {
        report.fail(step.name, `the step stopped: ${err instanceof Error ? err.message : String(err)}`);
        if (step.essential) ctx.stop ??= `the ${step.name} step stopped`;
      }
      if (step.health) healthCheck(ctx, step.name);
    }
    // Anything the browser reported after the last step, and the server's own error lines.
    page.step = "After the checks";
    await sleep(500);
    if (page.eventsOf(page.step).some((e) => e.kind !== "console warning" && e.kind !== "platform read")) healthCheck(ctx, page.step);
    const appErrors = server.appErrors();
    report.check("Server", appErrors.length === 0, "the app logged no errors on the server", `the app logged ${appErrors.length} error line(s) on the server`, appErrors);

    printNumbers(report, say);
    const results = () => ({
      version: 1,
      ranAt: new Date().toISOString(),
      build: new Date(build.builtAt).toISOString(),
      browser: version.product ?? null,
      viewport: { width: PHONE.width, height: PHONE.height },
      team: ctx.myTeam,
      lines: report.lines,
      numbers: report.numbers,
      events: page.events,
      shots: ctx.shots.map(rel),
    });
    // Cleaned string by string (numbers equal to an .env.local value too), then cut, then checked: a string that still
    // holds a name is withheld from the file (the header).
    const secrets = loadSecretsIntoScrubber();
    const fileResults = () => withholdLeftovers(cleanValue(secrets.scrubDeep(results()), (s) => cutText(scrubEverything(s), FILE_MAX)), check.leftovers);
    const withheld = withheldLines + fileResults().withheld;
    report.check(
      "Output",
      withheld === 0,
      "no team, owner or league name in the lines printed or the results file",
      `${withheld} printed line(s) or results value(s) still held one of the league's names after cleaning: they were withheld, not printed or written`,
    );
    // Again, so the file has the Output line too.
    writeFileSync(RESULTS_FILE, JSON.stringify(fileResults().value, null, 1) + "\n");
    console.log("");
    if (ctx.shots.length) console.log(`Screenshots (names replaced by placeholders): ${rel(SHOTS_DIR)}/ (${ctx.shots.length} files).`);
    console.log(`Results (cleaned): ${rel(RESULTS_FILE)}.`);
    for (const line of summaryLines(report)) console.log(line);
    return report.failed() ? 1 : 0;
  } catch (err) {
    if (stopping) return 130;
    if (err instanceof StartError) {
      console.error(err.message);
      for (const line of err.tail.slice(-15)) console.error(`  | ${line}`);
    } else {
      console.error(`The check couldn't run: ${err instanceof Error ? err.message : String(err)}`);
    }
    return 2;
  } finally {
    await stopAll();
  }
}

async function main(): Promise<void> {
  installConsoleScrubber();
  const parsed = parseArgs(process.argv.slice(2));
  // Without npm's "--", the options arrive as npm settings: read them from there too (args.ts).
  const resolved = "error" in parsed ? parsed : resolveArgs(parsed, process.env);
  if ("error" in resolved) {
    console.error(resolved.error);
    process.exit(2);
  }
  const args = resolved.args;
  if (args.help) {
    console.log(USAGE);
    process.exit(0);
  }
  // The network only when asked (planner reply to Checkpoint 4c, A5): it imports your league from ESPN. Exit 2 is this
  // check's "couldn't run". The guard is set either way; the production server it starts inherits it ("live").
  setNetworkMode(args.live);
  if (!args.live) {
    console.error(liveRequiredText("check:browser", "imports your league from ESPN in the production build", "npm run check:browser -- --live --team 3"));
    process.exit(2);
  }
  process.exit(await run(args));
}

// Run only as a script (an exact path: scripts/lib/runMode.ts isMainModule).
if (isMainModule(import.meta.url)) void main();
