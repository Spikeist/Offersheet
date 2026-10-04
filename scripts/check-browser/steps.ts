/**
 * The checks of `npm run check:browser`, page by page, in the order a user goes (each a step of the report):
 *
 * 1. Connect (/connect, a full load): the league link box and the Import button on the first screen (§14 item 1),
 *    the layout; then the public-link import with ESPN_LEAGUE_ID (and ESPN_SEASON when set), timed.
 * 2. Import Report: the layout; the team: --team <id> picked in "Which team is yours?", else the report's own choice.
 * 3. League (the nav's link): built and timed; the layout; "Harder to get" never on my own players (my roster, my rows
 *    in the tables, "You could give" in the partner cards), and my team marked. The places it counts in must be found:
 *    a table row marked mine (one per table at most), and a "You could give" line in every partner card (the cards
 *    that link to the Trade Finder for their team).
 * 4. Trade Finder (the nav's link): a full search in the production worker, timed from the first progress update to
 *    the results (at most --max-search seconds, §12's 10 by default), with the engine's own per-stage timings; every
 *    card with its three numbers and both sides ("You give", "You get"); "Harder to get" never on a player I'd give;
 *    the layout. With no team picked: the page asks for one.
 * 5. Trade card (the first idea): the three sorts reorder the ideas without a new search (Chance they accept by the
 *    chance it goes through when the card shows one: the sort's own number, rank.ts; among the ideas that help); an
 *    outcome button (Rejected; on a card that shows two versions the first outcome asks which one, and the step picks the first) saves and clears; Report saves a reason and a
 *    note, and Undo removes it; the message's Copy puts it on the clipboard; the report form's tap targets.
 * 6. Analyzer (the card's "Open in Analyzer"): it evaluates the same trade with the same three numbers as the card;
 *    both sides shown, no tag on mine; the layout; "Back to the Trade Finder" shows the ideas again.
 * 7. Settings (the nav's link): the layout; a setting saves in this browser and "Reset to defaults" clears it.
 * 8. Home and Privacy (full loads): the layout.
 * After each step: no console errors (page or worker), uncaught exceptions, failed requests to the app, or requests to
 * any other site. Screenshots, when on, go to the shots folder after the page's names are replaced with placeholders,
 * put back right after (one that can't be saved is a skip: it's a record to look at, not a check of the app).
 *
 * Texts these checks look for are the app's own (status lines, headings, button names); when one changes, the check
 * that reads it fails loudly rather than passing by accident: a check that counts something somewhere first checks it
 * found that somewhere. Page texts come back whole: the entry point cleans them, then cuts them (report.ts).
 */
import { LEAGUE_ID_PLACEHOLDER, nameRules, type CheckReport, type LeagueNames } from "./report";
import { sanitizeCall } from "./inPage";
import type { CheckBrowserArgs } from "./args";
import type { PageSession } from "./page";

export interface CardInfo {
  heading: string;
  give: Array<{ name: string; text: string; tagged: boolean }>;
  get: Array<{ name: string; text: string; tagged: boolean }>;
  tagsOnMySide: number;
  helps: string | null;
  /** The big "Chance they accept" number (P_accept). */
  accept: string | null;
  /** "about N% it goes through" under the numbers when the league's review could veto it (P_complete), else null. */
  acceptThrough: string | null;
  overall: string | null;
  analyzerHref: string | null;
  /** The card's Analyzer link opens the card's own trade (its key's partner and players). */
  linkIsOwnTrade: boolean;
  hasPitch: boolean;
  feedback: Array<{ label: string; pressed: boolean }>;
}

interface Measure {
  pageOverflow: boolean;
  scrollWidth: number;
  clientWidth: number;
  loose: string[];
  looseCount: number;
  small: string[];
  smallCount: number;
  targets: number;
}

export interface StepContext {
  page: PageSession;
  report: CheckReport;
  args: CheckBrowserArgs;
  /** ESPN_LEAGUE_ID: typed into the page, never printed. */
  leagueId: string;
  /** ESPN_SEASON, when set. */
  season: string | undefined;
  /** Where screenshots go; null: none. */
  shotsDir: string | null;
  /** The imported league's names (null until the import): screenshots replace them, and the league id, with placeholders. */
  names: LeagueNames | null;
  /** Called once the imported league's names are known (the entry point cleans the output with them). */
  onNames: (names: LeagueNames) => void;
  /** My team's id once known (null: none picked). */
  myTeam: string | null;
  /** The Trade Finder's first card, for the Analyzer's comparison. */
  firstCard: CardInfo | null;
  /** Why the remaining steps can't run (a failed import), or null. */
  stop: string | null;
  /** Screenshot files written. */
  shots: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const seconds = (ms: number) => Math.round(ms / 100) / 10;
const pl = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The in-page mark every timeline is measured from. */
async function mark(page: PageSession): Promise<number> {
  return page.run<number>("return performance.now();");
}

function layoutChecks(ctx: StepContext, step: string, m: Measure, where = "the page"): void {
  const sideways = m.pageOverflow ? `${where} scrolls sideways (${m.scrollWidth} px wide at ${m.clientWidth} px)` : `${pl(m.looseCount, "element")} reach past the right edge`;
  ctx.report.check(step, !m.pageOverflow && m.looseCount === 0, `no sideways scrolling at ${m.clientWidth} px`, sideways, m.loose);
  ctx.report.check(step, m.smallCount === 0, `tap targets at least 44 px tall (${m.targets} checked)`, `${pl(m.smallCount, "tap target")} under 44 px tall or 24 px wide`, m.small);
}

async function measurePage(ctx: StepContext): Promise<Measure> {
  return ctx.page.run<Measure>("return measure();");
}

async function screenshot(ctx: StepContext, name: string): Promise<void> {
  if (!ctx.shotsDir) return;
  try {
    ctx.shots.push(...(await ctx.page.screenshots(ctx.shotsDir, name, sanitizeCall(nameRules(ctx.names, [[ctx.leagueId, LEAGUE_ID_PLACEHOLDER]])))));
  } catch (err) {
    // A screenshot is a record for a person to look at, not a check of the app: a failed one is a skip.
    ctx.report.skip(ctx.page.step, `the screenshot "${name}" couldn't be saved (${err instanceof Error ? err.name : "error"}; --no-shots turns them off)`);
  }
}

/** The step's console errors, exceptions, failed requests and requests to other sites, as one check. */
export function healthCheck(ctx: StepContext, step: string): void {
  const events = ctx.page.eventsOf(step);
  const bad = events.filter((e) => e.kind !== "console warning");
  const warnings = events.length - bad.length;
  if (warnings) ctx.report.note(step, "consoleWarnings", warnings);
  ctx.report.check(
    step,
    bad.length === 0,
    "no console errors, failed requests or requests to other sites",
    `${pl(bad.length, "problem")} in the browser`,
    bad.map((e) => `${e.kind} (${e.where}): ${e.text}`),
  );
}

// ---------------------------------------------------------------------------------------------
// 1. Connect

export async function connectStep(ctx: StepContext): Promise<void> {
  const step = "Connect";
  const { page, report } = ctx;
  page.step = step;
  await page.navigate("/connect");
  await page.waitFor(`document.getElementById("espn-league")`, 30_000, "the league link box");
  await sleep(500);
  const first = await page.run<{ viewport: number; input: { bottom: number } | null; button: { bottom: number } | null; m: Measure }>(`
    const input = document.getElementById("espn-league");
    const button = [...document.querySelectorAll("button[type=submit]")].find((b) => txt(b).includes("Import"));
    return { viewport: innerHeight, input: input ? box(input) : null, button: button ? box(button) : null, m: measure() };
  `);
  report.check(
    step,
    !!first.input && !!first.button && first.input.bottom <= first.viewport && first.button.bottom <= first.viewport,
    `the league link box and the Import button are on the first screen (the button ends at ${first.button?.bottom ?? "?"} of ${first.viewport} px)`,
    first.input && first.button ? `the Import button ends at ${first.button.bottom} px, below the first screen (${first.viewport} px)` : "the league link box or the Import button is missing",
  );
  layoutChecks(ctx, step, first.m);
  await screenshot(ctx, "01-connect");

  // The public-link import: the id typed (React's setter, then the input event), the season when ESPN_SEASON names one.
  await page.run(`setInput(document.getElementById("espn-league"), ${JSON.stringify(ctx.leagueId)}); return true;`);
  if (ctx.season) {
    const picked = await page.run<boolean>(`
      const s = document.getElementById("espn-season");
      if (!s || ![...s.options].some((o) => o.value === ${JSON.stringify(ctx.season)})) return false;
      if (s.value !== ${JSON.stringify(ctx.season)}) setSelect(s, ${JSON.stringify(ctx.season)});
      return true;
    `);
    if (!picked) report.note(step, "season", "ESPN_SEASON isn't one of the Connect page's seasons: its default was used");
  }
  const recognized = await page.waitFor<boolean>(`[...document.querySelectorAll("span")].some((e) => /^League \\d+$/.test(txt(e)))`, 10_000, "the league id to be recognized").catch(() => false);
  if (!recognized) {
    report.fail(step, "the link box didn't recognize ESPN_LEAGUE_ID as a league id");
    ctx.stop = "the import couldn't start";
    return;
  }
  const started = Date.now();
  await page.click(`[...document.querySelectorAll("button[type=submit]")].find((b) => txt(b).includes("Import"))`, "the Import button");
  const outcome = await page
    .waitFor<string>(
      `location.pathname === "/import" && document.getElementById("my-team") ? "ok" : (() => { const e = [...document.querySelectorAll("[role=alert], .text-danger-fg")].map(txt).filter((t) => t.length > 3)[0]; return e ? "error: " + e : null; })()`,
      240_000,
      "the import",
      250,
    )
    .catch((err: unknown) => `error: ${err instanceof Error ? err.message : "the import didn't finish"}`);
  const took = seconds(Date.now() - started);
  report.note(step, "importSeconds", took);
  if (outcome !== "ok") {
    report.fail(step, `the import didn't work: ${outcome.replace(/^error: /, "")}`);
    ctx.stop = "the league wasn't imported";
    return;
  }
  report.ok(step, `imported the league through its public link in ${took} s`);

  // The imported league's names: from here on, every line printed and every screenshot uses placeholders.
  const names = await page.run<LeagueNames | null>(`
    try {
      const s = JSON.parse(sessionStorage.getItem("offersheet:import:v1")).response.snapshot;
      return { leagueName: s.name, teams: s.teams.map((t) => ({ id: String(t.id), name: t.name, ownerName: t.ownerName })), players: Object.values(s.players).map((p) => p.name).filter(Boolean) };
    } catch (e) { return null; }
  `);
  if (!names) {
    report.fail(step, "the imported league isn't in this tab's storage (offersheet:import:v1)");
    ctx.stop = "the import wasn't stored";
    return;
  }
  ctx.names = names;
  ctx.onNames(names);
  report.note(step, "teams", names.teams.length);
}

// ---------------------------------------------------------------------------------------------
// 2. Import Report

export async function importReportStep(ctx: StepContext): Promise<void> {
  const step = "Import Report";
  const { page, report, args } = ctx;
  page.step = step;
  await page.waitFor(`document.getElementById("my-team")`, 30_000, "the Import Report");
  await sleep(400);
  layoutChecks(ctx, step, await measurePage(ctx));
  const choice = await page.run<{ value: string; options: string[] }>(`
    const sel = document.getElementById("my-team");
    return { value: sel.value, options: [...sel.options].map((o) => o.value).filter(Boolean) };
  `);
  ctx.myTeam = choice.value || null;
  if (args.team) {
    if (!choice.options.includes(args.team)) {
      report.fail(step, `team ${args.team} isn't in this league (its team ids: ${choice.options.join(", ")})`);
    } else {
      await page.run(`setSelect(document.getElementById("my-team"), ${JSON.stringify(args.team)}); return true;`);
      const kept = await page.waitFor<boolean>(`document.getElementById("my-team").value === ${JSON.stringify(args.team)}`, 10_000, "the team pick").catch(() => false);
      await sleep(400);
      if (report.check(step, kept, `picked team ${args.team} as yours`, `picking team ${args.team} didn't stick`)) ctx.myTeam = args.team;
    }
  } else if (ctx.myTeam) {
    report.ok(step, `kept the Import Report's choice: team ${ctx.myTeam}`);
  } else {
    report.skip(step, "no team picked (pass --team <id>): the Trade Finder, card and Analyzer checks need one");
  }
  report.note(step, "myTeam", ctx.myTeam);
  await screenshot(ctx, "02-import-report");
}

// ---------------------------------------------------------------------------------------------
// 3. League

const LEAGUE_READY = `(() => { if (location.pathname !== "/league") return null; const none = noImport(); if (none) return "error: the page says " + none; const l = statusLines(); if (l.some((t) => t === "Your League page is ready." || t === "The numbers are up to date.")) return "ready"; const a = alerts(); return a.length ? "error: " + a[0] : null; })()`;

export async function leagueStep(ctx: StepContext): Promise<void> {
  const step = "League";
  const { page, report } = ctx;
  page.step = step;
  const started = Date.now();
  await page.click(`navLink("/league")`, "the nav's League link");
  const state = await page.waitFor<string>(LEAGUE_READY, 400_000, "the League page", 250).catch((err: unknown) => `error: ${err instanceof Error ? err.message : "it didn't load"}`);
  const took = seconds(Date.now() - started);
  report.note(step, "readySeconds", took);
  if (!report.check(step, state === "ready", `built the League page in ${took} s`, `the League page didn't load: ${state.replace(/^error: /, "")}`)) return;
  await sleep(600);
  layoutChecks(ctx, step, await measurePage(ctx));

  if (!ctx.myTeam) {
    report.skip(step, `"Harder to get" on your own players: no team picked`);
  } else {
    const tags = await page.run<{ marked: boolean; roster: number; row: number; youCanGive: number; others: number; myRowTables: number; tablesWithSeveral: number; partnerCards: number; cardsWithoutGive: number }>(`
      const rosters = [...document.querySelectorAll("details")].filter((d) => d.querySelector("summary") && d.querySelector("table"));
      const myRosters = rosters.filter((d) => hasYouBadge(d.querySelector("summary")));
      const myRows = [...document.querySelectorAll("tbody tr")].filter((tr) => { const th = tr.querySelector("th"); return th && hasYouBadge(th); });
      const giveLines = [...document.querySelectorAll("p")].filter((p) => txt(p).startsWith("You could give"));
      // Partner cards: the list items that link to the Trade Finder for their team.
      const partnerCards = [...new Set([...document.querySelectorAll("a[href^='/trades?partner=']")].map((a) => a.closest("li")).filter(Boolean))];
      const rowsPerTable = new Map();
      for (const tr of myRows) { const t = tr.closest("table"); rowsPerTable.set(t, (rowsPerTable.get(t) || 0) + 1); }
      const count = (els) => els.reduce((n, e) => n + tagLeaves(e).length, 0);
      const mine = count(myRosters) + count(myRows) + count(giveLines);
      return {
        marked: myRosters.length > 0,
        roster: count(myRosters),
        row: count(myRows),
        youCanGive: count(giveLines),
        others: tagLeaves(document).length - mine,
        myRowTables: rowsPerTable.size,
        tablesWithSeveral: [...rowsPerTable.values()].filter((n) => n > 1).length,
        partnerCards: partnerCards.length,
        cardsWithoutGive: partnerCards.filter((li) => ![...li.querySelectorAll("p")].some((p) => txt(p).startsWith("You could give"))).length,
      };
    `);
    report.check(step, tags.marked, "your team is marked (its roster opens with a You badge)", "no roster carries the You badge: your team isn't marked");
    // Where the tags are counted must be found, or the next check would pass with nothing to count.
    const anchors: string[] = [];
    if (tags.myRowTables === 0) anchors.push("no table row is marked as your team (a You badge in the row's heading cell)");
    if (tags.tablesWithSeveral) anchors.push(`${pl(tags.tablesWithSeveral, "table")} mark more than one row as your team`);
    if (tags.cardsWithoutGive) anchors.push(`${tags.cardsWithoutGive} of ${pl(tags.partnerCards, "partner card")} have no "You could give" line`);
    report.check(
      step,
      anchors.length === 0,
      `found your rows (${pl(tags.myRowTables, "table")}) and every partner card's "You could give" line (${pl(tags.partnerCards, "card")})`,
      `the places your players show couldn't all be found, so the tag check below can't be trusted`,
      anchors,
    );
    const mine = tags.roster + tags.row + tags.youCanGive;
    report.check(
      step,
      mine === 0,
      `no "Harder to get" tag on your own players (${pl(tags.others, "tag")} on other teams' players)`,
      `"Harder to get" shows on your own players ${pl(mine, "time")}`,
      [`your roster: ${tags.roster}`, `your rows in the tables: ${tags.row}`, `"You could give" in the partner cards: ${tags.youCanGive}`],
    );
  }
  await screenshot(ctx, "03-league");
}

// ---------------------------------------------------------------------------------------------
// 4. Trade Finder

const FINDER_DONE = `(() => { if (location.pathname !== "/trades") return null; const none = noImport(); if (none) return "error: the page says " + none; const l = statusLines(); if (l.some((t) => /^Found \\d+ trade ideas?\\./.test(t) || /^No trade ideas/.test(t))) return "done"; const a = alerts(); return a.length ? "error: " + a[0] : null; })()`;

interface EngineAnswer {
  t: number;
  type: string;
  timings?: Record<string, number> | null;
  counts?: Record<string, number> | null;
  shown?: number | null;
}

/** The cards without a player under "You give" or "You get" (pure): every trade idea gives and gets someone. */
export function sidelessCards(cards: ReadonlyArray<Pick<CardInfo, "give" | "get">>): string[] {
  return cards.flatMap((c, i) => (c.give.length && c.get.length ? [] : [`idea ${i + 1}: ${c.give.length} under "You give", ${c.get.length} under "You get"`]));
}

/**
 * The places a sort leaves out of order (pure; rank.ts sortTrades): each card's number for that sort, highest first.
 * Chance they accept orders by the chance it goes through (P_complete) when the card shows one, else by the big
 * number, among the ideas that help (Helps you above 0; the others follow in their own order).
 */
export function sortInversions(label: string, cards: ReadonlyArray<Pick<CardInfo, "helps" | "accept" | "acceptThrough" | "overall">>, sort: "helps" | "accept" | "overall"): string[] {
  const num = (v: string | null) => (v === null || v === "—" ? -1 : parseFloat(v.replace("%", "")));
  const shown = cards.map((c, i) => ({ i, value: sort === "accept" ? (c.acceptThrough ?? c.accept) : c[sort], helps: num(c.helps) }));
  const ordered = sort === "accept" ? shown.filter((c) => c.helps > 0) : shown;
  const out: string[] = [];
  for (let k = 1; k < ordered.length; k++) {
    const a = ordered[k - 1] as (typeof shown)[number];
    const b = ordered[k] as (typeof shown)[number];
    if (num(b.value) > num(a.value)) out.push(`${label}: idea ${a.i + 1} shows ${a.value}, idea ${b.i + 1} shows ${b.value}`);
  }
  return out;
}

export async function finderStep(ctx: StepContext): Promise<void> {
  const step = "Trade Finder";
  const { page, report, args } = ctx;
  page.step = step;
  const from = await mark(page);
  const started = Date.now();
  await page.click(`navLink("/trades")`, "the nav's Trades link");

  if (!ctx.myTeam) {
    const asks = await page
      .waitFor<string>(`location.pathname === "/trades" && (noImport() ? "no import" : txt(document.querySelector("main") || document.body).includes("Pick your team on the Import Report to see trade ideas.") ? "asks" : null)`, 120_000, "the Trade Finder")
      .catch(() => "no answer");
    report.check(step, asks === "asks", "with no team picked, it asks you to pick yours first", asks === "no import" ? "the Trade Finder says no league is imported" : "with no team picked, the Trade Finder doesn't ask for one");
    layoutChecks(ctx, step, await measurePage(ctx));
    report.skip(step, "the trade search: no team picked");
    await screenshot(ctx, "04-trade-finder");
    return;
  }

  const state = await page.waitFor<string>(FINDER_DONE, 300_000, "the trade search", 50).catch((err: unknown) => `error: ${err instanceof Error ? err.message : "it didn't finish"}`);
  const wall = seconds(Date.now() - started);
  if (!report.check(step, state === "done", "the trade search finished", `the trade search didn't finish: ${state.replace(/^error: /, "")}`)) return;
  await sleep(500);

  const timeline = await page.run<{ firstProgress: number | null; done: number | null; engine: EngineAnswer[]; longtasks: number[]; status: string }>(`
    const ev = eventsSince(${from}).filter((e) => e.path.startsWith("/trades"));
    const pb = ev.find((e) => e.pb !== null);
    const done = ev.find((e) => /Found \\d+ trade idea|No trade ideas/.test(e.status));
    return { firstProgress: pb ? pb.t : null, done: done ? done.t : null, engine: engineSince(${from}), longtasks: longtasksSince(${from}), status: statusLines().find((t) => /^Found|^No trade ideas/.test(t)) || "" };
  `);
  const answer = timeline.engine.filter((e) => e.type === "trades").at(-1);
  const searchSeconds = timeline.firstProgress !== null && timeline.done !== null ? seconds(timeline.done - timeline.firstProgress) : null;
  report.note(step, "wallSeconds", wall);
  report.note(step, "searchSeconds", searchSeconds);
  if (answer?.timings) report.note(step, "engineMs", Object.fromEntries(Object.entries(answer.timings).map(([k, v]) => [k, Math.round(v)])));
  if (answer?.counts) report.note(step, "counts", answer.counts);
  report.note(step, "longestMainThreadTaskMs", timeline.longtasks.length ? Math.max(...timeline.longtasks) : 0);
  const shownSearch = searchSeconds ?? wall;
  report.check(
    step,
    shownSearch <= args.maxSearchSeconds,
    `a full search took ${shownSearch} s in the production worker (target ${args.maxSearchSeconds} s; ${wall} s from the tap)`,
    `a full search took ${shownSearch} s, over the ${args.maxSearchSeconds} s target`,
  );

  const cards = await page.run<CardInfo[]>("return allCards();", { cards: true });
  report.note(step, "ideas", cards.length);
  report.ok(step, `${timeline.status || "done"} (${pl(cards.length, "card")})`);
  if (cards.length) {
    const missing = cards.map((c, i) => (c.helps && c.accept && c.overall ? null : `idea ${i + 1}: ${c.helps ?? "?"} · ${c.accept ?? "?"} · ${c.overall ?? "?"}`)).filter((x): x is string => !!x);
    report.check(step, missing.length === 0, "every idea shows Helps you, Chance they accept and Overall", `${pl(missing.length, "idea")} lack one of the three numbers`, missing);
    // Both sides, under their headings: the tag check below counts what's under "You give".
    const sideless = sidelessCards(cards);
    report.check(step, sideless.length === 0, `every idea shows what you give and what you get`, `${pl(sideless.length, "idea")} lack a "You give" or "You get" player`, sideless);
    const tagged = cards.map((c, i) => (c.tagsOnMySide ? `idea ${i + 1}: ${c.give.map((g) => g.name).join(" + ")}` : null)).filter((x): x is string => !!x);
    const theirs = cards.reduce((n, c) => n + c.get.filter((g) => g.tagged).length, 0);
    report.check(step, tagged.length === 0, `no "Harder to get" tag on a player you'd give (${pl(theirs, "tag")} on players you'd get)`, `"Harder to get" shows on a player you'd give in ${pl(tagged.length, "idea")}`, tagged);
    ctx.firstCard = cards[0] ?? null;
    report.note(step, "top", cards.slice(0, 3).map((c) => `${c.heading}: ${c.give.map((g) => g.name).join(" + ")} for ${c.get.map((g) => g.name + (g.tagged ? " (Harder to get)" : "")).join(" + ")} = ${c.helps} · ${c.accept} · ${c.overall}`));
  }
  layoutChecks(ctx, step, await measurePage(ctx));
  await screenshot(ctx, "04-trade-finder");
}

// ---------------------------------------------------------------------------------------------
// 5. A trade card's buttons

const SORTS = [
  { value: "helps", label: "Helps you" },
  { value: "accept", label: "Chance they accept" },
  { value: "overall", label: "Overall" },
] as const;

export async function cardStep(ctx: StepContext): Promise<void> {
  const step = "Trade card";
  const { page, report } = ctx;
  page.step = step;
  if (!ctx.firstCard) {
    report.skip(step, ctx.myTeam ? "no trade idea to try the buttons on" : "no team picked");
    return;
  }

  // The sorts: each reorders the ideas from the highest down (sortInversions), and none starts a new search.
  const from = await mark(page);
  const inversions: string[] = [];
  for (const sort of SORTS) {
    const cards = await page.run<CardInfo[]>(`setSelect(document.getElementById("finder-sort"), ${JSON.stringify(sort.value)}); await sleep(400); return allCards();`, { cards: true });
    inversions.push(...sortInversions(sort.label, cards, sort.value));
  }
  const searched = await page.run<boolean>(`return eventsSince(${from}).some((e) => e.pb !== null);`);
  report.check(step, inversions.length === 0 && !searched, "the three sorts reorder the ideas, highest first, without searching again", searched ? "changing the sort started a new search" : "a sort leaves the ideas out of order", inversions);

  const first = `document.querySelector("article")`;
  const readFeedback = `(() => { try { return JSON.parse(localStorage.getItem("offersheet:feedback:v1") || "[]"); } catch (e) { return []; } })()`;

  // An outcome button: on, saved in this browser; pressed again, cleared.
  const button = (label: string) => `[...${first}.querySelectorAll("div[role=group] button")].find((b) => visibleText(b).replace("✓", "").trim() === ${JSON.stringify(label)})`;
  await page.click(button("Rejected"), "the Rejected button");
  // Since Phase 4b, the first outcome pressed on a card that shows two versions (offer-first steps or a Plan B) asks which
  // version first ("Which version did they turn down?"): the check then measures the choice and picks its first version.
  const chooser = `[...${first}.querySelectorAll("fieldset")].find((f) => /^Which version/.test(txt(f.querySelector("legend") || f)))`;
  const pressedOrAsked = await page
    .waitFor<boolean>(`(() => { const b = ${button("Rejected")}; return (b && b.getAttribute("aria-pressed") === "true") || !!(${chooser}); })()`, 5_000, "the outcome to save or to ask which version")
    .catch(() => false);
  let chose = false;
  if (pressedOrAsked && (await page.run<boolean>(`return !!(${chooser});`))) {
    const choice = await page.run<{ buttons: number; small: number }>(`const bs = [...(${chooser}).querySelectorAll("button")]; return { buttons: bs.length, small: bs.filter((b) => b.getBoundingClientRect().height < 44).length };`);
    report.check(step, choice.buttons >= 3 && choice.small === 0, "the version choice offers the card's versions and Cancel, each at least 44 px tall", choice.buttons < 3 ? "the version choice has fewer than two versions and Cancel" : `${pl(choice.small, "button")} in the version choice under 44 px`);
    await page.click(`[...(${chooser}).querySelectorAll("button")][0]`, "the first version offered");
    chose = true;
  }
  const on = await page
    .waitFor<boolean>(`(() => { const b = ${button("Rejected")}; return b && b.getAttribute("aria-pressed") === "true" && ${readFeedback}.some((r) => r.outcome && r.outcome.kind === "rejected"${chose ? " && typeof r.version === \"string\"" : ""}); })()`, 5_000, "the outcome to save")
    .catch(() => false);
  await page.click(button("Rejected"), "the Rejected button");
  const off = await page
    .waitFor<boolean>(`(() => { const b = ${button("Rejected")}; return b && b.getAttribute("aria-pressed") === "false" && !${readFeedback}.some((r) => r.outcome && r.outcome.kind === "rejected"); })()`, 5_000, "the outcome to clear")
    .catch(() => false);
  report.check(step, on && off, `an outcome button (Rejected${chose ? ", after choosing which version" : ""}) saves in this browser and clears when pressed again`, on ? "pressing Rejected again didn't clear it" : "pressing Rejected didn't save it");

  // Report: a reason and a note saved; Undo removes it. The open form's tap targets count too.
  const reportButton = `[...${first}.querySelectorAll("button")].find((b) => visibleText(b) === "Report a problem")`;
  await page.click(reportButton, "Report a problem");
  const form = await page.waitFor<{ reasons: number; m: Measure }>(`(() => { const f = ${first}.querySelector("form"); return f && f.querySelectorAll("input[type=radio]").length ? { reasons: f.querySelectorAll("input[type=radio]").length, m: measure(f) } : null; })()`, 5_000, "the report form").catch(() => null);
  if (!form) {
    report.fail(step, "Report a problem didn't open its reasons");
  } else {
    report.check(step, form.m.smallCount === 0, `the report form's tap targets are at least 44 px tall (${form.m.targets} checked)`, `${pl(form.m.smallCount, "tap target")} in the report form under 44 px`, form.m.small);
    await page.click(`${first}.querySelectorAll("form input[type=radio]")[1].closest("label")`, "a report reason");
    await page.run(`setInput(${first}.querySelector("form textarea"), "check:browser test note"); return true;`);
    await page.click(`${first}.querySelector("form button[type=submit]")`, "Save report");
    const saved = await page
      .waitFor<boolean>(`[...${first}.querySelectorAll("p")].some((p) => txt(p).startsWith("Reported:")) && ${readFeedback}.some((r) => r.report && r.report.note === "check:browser test note")`, 5_000, "the report to save")
      .catch(() => false);
    let undone = false;
    if (saved) {
      await page.click(`[...${first}.querySelectorAll("button")].find((b) => visibleText(b) === "Undo")`, "Undo");
      undone = await page
        .waitFor<boolean>(`!!${reportButton} && !${readFeedback}.some((r) => r.report)`, 5_000, "the report to be removed")
        .catch(() => false);
    }
    report.check(step, saved && undone, `Report saves a reason and a note (${form.reasons} reasons offered), and Undo removes it`, saved ? "Undo didn't remove the report" : "Save report didn't save it");
  }

  // The message to send them: opened, then Copy (a trusted tap) puts it on the clipboard.
  if (!ctx.firstCard.hasPitch) {
    report.skip(step, "the first idea has no message to copy");
  } else {
    const details = `[...${first}.querySelectorAll("details")].find((d) => txt(d.querySelector("summary")).startsWith("Message to send them"))`;
    await page.click(`${details}.querySelector("summary")`, "Message to send them");
    await page.click(`${details}.querySelector("button")`, "Copy message");
    const copied = await page
      .waitFor<string>(`(() => { const b = ${details}.querySelector("button"); const t = b ? txt(b) : ""; return t === "Copied!" ? "copied" : t.startsWith("Select the text") ? "refused" : null; })()`, 5_000, "the copy")
      .catch(() => "no answer");
    const clip = await page.run<{ same: boolean; read: boolean }>(`
      const d = ${details};
      const text = d ? txt(d.querySelector("div p")) : "";
      try { const c = await navigator.clipboard.readText(); return { same: txt({ textContent: c }) === text, read: true }; } catch (e) { return { same: false, read: false }; }
    `);
    report.check(
      step,
      copied === "copied" && (clip.same || !clip.read),
      clip.read ? "Copy puts the message to send them on the clipboard" : "Copy says Copied! (the clipboard couldn't be read back here)",
      copied === "refused" ? "Copy says the browser refused the clipboard" : copied === "copied" ? "the clipboard doesn't hold the message" : "Copy didn't answer",
    );
  }
  report.check(
    step,
    !!ctx.firstCard.analyzerHref?.startsWith("/analyzer?") && ctx.firstCard.linkIsOwnTrade,
    "the card links to the Trade Analyzer with its own trade",
    ctx.firstCard.analyzerHref ? "the card's Analyzer link names another trade than the card's" : "the card has no Open in Analyzer link",
  );
}

// ---------------------------------------------------------------------------------------------
// 6. Trade Analyzer

const ANALYZER_DONE = `(() => { if (location.pathname !== "/analyzer") return null; const none = noImport(); if (none) return "error: the page says " + none; const l = statusLines(); if (l.some((t) => /^Evaluated/.test(t))) return "evaluated"; if (l.some((t) => /^This trade can't be made/.test(t))) return "illegal"; const a = alerts(); return a.length ? "error: " + a[0] : null; })()`;

export async function analyzerStep(ctx: StepContext): Promise<void> {
  const step = "Analyzer";
  const { page, report } = ctx;
  page.step = step;
  const card = ctx.firstCard;
  if (!card?.analyzerHref) {
    report.skip(step, ctx.myTeam ? "no trade idea to open" : "no team picked");
    return;
  }
  const started = Date.now();
  await page.click(`ownAnalyzerLink(document.querySelector("article"))`, "Open in Analyzer");
  const state = await page.waitFor<string>(ANALYZER_DONE, 120_000, "the evaluation", 50).catch((err: unknown) => `error: ${err instanceof Error ? err.message : "it didn't finish"}`);
  const took = seconds(Date.now() - started);
  report.note(step, "evaluateSeconds", took);
  if (!report.check(step, state === "evaluated", `opened and evaluated the first idea in ${took} s`, state === "illegal" ? "the Analyzer says the first idea can't be made" : `the evaluation didn't finish: ${state.replace(/^error: /, "")}`)) return;
  await sleep(400);

  const shown = await page.run<CardInfo | null>(`const a = document.querySelector("article"); return a ? cardData(a) : null;`, { cards: true });
  if (!shown) {
    report.fail(step, "the evaluation shows no trade card");
  } else {
    const same = shown.helps === card.helps && shown.accept === card.accept && shown.overall === card.overall;
    report.check(
      step,
      same,
      `the same three numbers as the Trade Finder's card (${shown.helps} · ${shown.accept} · ${shown.overall})`,
      `its numbers differ from the Trade Finder's card`,
      [`Trade Finder: ${card.helps} · ${card.accept} · ${card.overall}`, `Analyzer: ${shown.helps} · ${shown.accept} · ${shown.overall}`],
    );
    // Both sides first (the tag check counts under "You give"), then the tags.
    const sideless = sidelessCards([shown]);
    if (report.check(step, sideless.length === 0, "it shows what you give and what you get", `its card lacks a "You give" or "You get" player`, sideless)) {
      report.check(step, shown.tagsOnMySide === 0, `no "Harder to get" tag on a player you'd give`, `"Harder to get" shows on a player you'd give`);
    }
  }
  layoutChecks(ctx, step, await measurePage(ctx));
  await screenshot(ctx, "05-analyzer");

  const from = await mark(page);
  const back = Date.now();
  await page.click(`[...document.querySelectorAll("a")].find((a) => txt(a) === "Back to the Trade Finder")`, "Back to the Trade Finder");
  const again = await page.waitFor<string>(FINDER_DONE, 120_000, "the Trade Finder again", 50).catch(() => "no");
  // The worker answers each search it runs; a page that remembered the ideas asks it nothing (its progress bar can flash for one render).
  const searchedAgain = await page.run<boolean>(`return engineSince(${from}).some((e) => e.type === "trades");`).catch(() => false);
  report.check(
    step,
    again === "done",
    `Back to the Trade Finder shows the ideas again in ${seconds(Date.now() - back)} s (${searchedAgain ? "after a new search" : "remembered, no new search"})`,
    "Back to the Trade Finder didn't show the ideas again",
  );
}

// ---------------------------------------------------------------------------------------------
// 7. Settings

const MAX_LEGEND = "Most players per side";

export async function settingsStep(ctx: StepContext): Promise<void> {
  const step = "Settings";
  const { page, report } = ctx;
  page.step = step;
  await page.click(`navLink("/settings")`, "the nav's Settings link");
  const ready = await page
    .waitFor<string>(`location.pathname === "/settings" && (noImport() ? "no import" : byText("legend", ${JSON.stringify(MAX_LEGEND)}) ? "ready" : null)`, 60_000, "the Settings page")
    .catch(() => "no answer");
  if (!report.check(step, ready === "ready", "the Settings page opened", ready === "no import" ? "the Settings page says no league is imported" : "the Settings page didn't open (its players-per-side choice is missing)")) return;
  await sleep(400);
  layoutChecks(ctx, step, await measurePage(ctx));
  await screenshot(ctx, "06-settings");

  const stored = `(() => { try { return Object.values(JSON.parse(localStorage.getItem("offersheet:settings:v1") || "{}")); } catch (e) { return []; } })()`;
  const option = (n: number) => `[...byText("legend", ${JSON.stringify(MAX_LEGEND)}).closest("fieldset").querySelectorAll("label")].find((l) => txt(l).startsWith(${JSON.stringify(String(n))}))`;
  const alreadyThree = await page.run<boolean>(`return ${stored}.some((s) => s && s.maxPerSide === 3);`);
  await page.click(option(alreadyThree ? 2 : 3), "a players-per-side choice");
  const want = alreadyThree ? 2 : 3;
  const saved = await page
    .waitFor<boolean>(`statusLines().some((t) => t.startsWith("Saved")) && ${stored}.some((s) => s && s.maxPerSide === ${want})`, 10_000, "the setting to save")
    .catch(() => false);
  let reset = false;
  if (saved) {
    const hasReset = await page.run<boolean>(`return !!byText("button", "Reset to defaults");`);
    if (hasReset) {
      await page.click(`byText("button", "Reset to defaults")`, "Reset to defaults");
      reset = await page.waitFor<boolean>(`!${stored}.some((s) => s && s.maxPerSide === ${want} && ${want} !== 2)`, 5_000, "the reset").catch(() => false);
    }
  }
  report.check(step, saved && reset, `a setting (${MAX_LEGEND}: ${want}) saves in this browser, and Reset to defaults clears it`, saved ? "Reset to defaults didn't clear the saved setting" : "the setting wasn't saved");
}

// ---------------------------------------------------------------------------------------------
// 8. Home and Privacy

export async function staticPagesStep(ctx: StepContext): Promise<void> {
  for (const [step, pathname, shot] of [
    ["Home", "/", "07-home"],
    ["Privacy", "/privacy", "08-privacy"],
  ] as const) {
    ctx.page.step = step;
    await ctx.page.navigate(pathname);
    const loaded = await ctx.page.waitFor<boolean>(`!!document.querySelector("h1")`, 30_000, `the ${step} page`).catch(() => false);
    if (!ctx.report.check(step, loaded, `the page loaded`, `the page didn't load`)) continue;
    await sleep(500);
    layoutChecks(ctx, step, await measurePage(ctx));
    await screenshot(ctx, shot);
    healthCheck(ctx, step);
  }
}

/**
 * The steps, in order, with the health check after each (the static pages check their own). An essential step that
 * stops (the import) leaves nothing for the others to check: they're skipped.
 */
export const STEPS: ReadonlyArray<{ name: string; run: (ctx: StepContext) => Promise<void>; health: boolean; essential?: true }> = [
  { name: "Connect", run: connectStep, health: true, essential: true },
  { name: "Import Report", run: importReportStep, health: true },
  { name: "League", run: leagueStep, health: true },
  { name: "Trade Finder", run: finderStep, health: true },
  { name: "Trade card", run: cardStep, health: true },
  { name: "Analyzer", run: analyzerStep, health: true },
  { name: "Settings", run: settingsStep, health: true },
  { name: "Home and Privacy", run: staticPagesStep, health: false },
];

