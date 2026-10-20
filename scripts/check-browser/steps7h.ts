/**
 * Checkpoint 7h's checks of `npm run check:browser` (planner reply to Checkpoint 7g, reports/planner-reply-7g.md), in the steps'
 * order (steps.ts STEPS; inPage7h.ts reads the pages, contracts7h.ts decides):
 *
 * - Step "What if" (section 4), after the Analyzer step: from the Trade Finder's own link to the Trade Analyzer, the mode switch
 *   ("Trade with a team" | "What if": two 44 px buttons, aria-pressed following a tap), then a change built from the page's own
 *   lists: one of my players taken off (the first of my active players the form lists) and one put on (the first the picker
 *   lists from the first other team at his position, else at any position), "Evaluate change". The result: Helps you with
 *   "Helps you here counts your odds only.", my odds before → after in the cards' forms (the top-N line exactly when the saved
 *   settings call for it), the weekly line when it shows, the planner's line ("Other teams don't change. To see a real trade,
 *   use the Analyzer with a partner."), the players taken off and put on, no chance they accept, Overall, offers, Plan B or
 *   feedback buttons, and an address carrying the change as player ids only (whatIfProblems); no FantasyCalc value
 *   (contracts.ts valueLeaks); its releases at an IR return worded as a trade card's (releaseLineProblems, "this change" read
 *   as "this trade"); the layout at 375 px. Then back to "Trade with a team", which shows the trade's form again.
 * - In step "Waivers" (section 5; waiverDetailsChecks, called from steps.ts waiverMoveChecks on each list of the toggle): on the
 *   rated "Rest of season", every move that can be made carries odds lines in its details and a move that can't none; the first
 *   row that helps (else the first that can be made) has its "Details" tapped: aria-expanded true, its panel shown, keyboard
 *   focus kept on it, "Your odds: without a pickup → with this one (from N simulated seasons)" with the lines in order and the
 *   cards' forms, no FantasyCalc value; tapped again, folded with focus kept. "This week" and "Next week" (and a season list in
 *   points) carry no odds lines (waiverOddsCoverageProblems).
 * - Step "Thorough search" (section 3), after the Waivers step, on the Trade Finder's ideas for every team: the switch there, a
 *   44 px switch, off by default, its help "… Takes about N seconds." with N what this tab's normal searches give (engine
 *   thorough.ts thoroughSeconds); turned on, a new search runs to the end with the progress bar and Stop, the settings line
 *   says up to 3 players a side, every idea shows its three numbers, both sides and at most 3 players a side; its time (from
 *   the first progress to the ideas) and the ideas it found, how many of them new, in an info line (planner: "aim for under 60
 *   seconds on Parker's computer in his 12-team league": a measurement, not a failure); the layout. Turned off, the normal
 *   search's ideas come back at once, as they were, without a search (sameIdeasProblems).
 * - Under "Several prizes" (steps.ts prizeOddsChecks, with the cards'): the rated waiver rows' odds lines and the what-if's carry
 *   the top-N line (waiverPrizeOddsChecks, and whatIfRun with `under`).
 * - In step "Trade card" (section 1, "With cards closed, the Trade Finder shows at least 2 ideas per screen"; closedIdeasChecks,
 *   called from steps.ts cardStep at its start): the closed ideas a phone screen, measured with the league's own team names on
 *   the page, in numbers only; an ok line at the planner's 2 or above, an info line under it (never a failure).
 */
import { config } from "@/engine/config";
import { thoroughSeconds } from "@/engine/thorough";
import { ANALYZER_MODES, WHAT_IF_ODDS_ONLY, WHAT_IF_OTHER_TEAMS } from "@/lib/whatIfView";
import { ODDS_FRAME, RATING_PENDING_TEXT } from "@/lib/waiversView";
import { pageValueLeaks, releaseLineProblems, valueLeaks } from "./contracts";
import {
  asTradeWords,
  closedIdeasOf,
  closedIdeasText,
  IDEAS_PER_SCREEN_GOAL,
  newIdeas,
  oddsOrderProblems,
  oversizedIdeas,
  sameIdeasProblems,
  thoroughEstimate,
  thoroughSummaryProblems,
  thoroughSwitchProblems,
  waiverDetailsProblems,
  waiverOddsCoverageProblems,
  whatIfProblems,
  whatIfSwitchProblems,
  type ClosedIdeaRead,
  type IdeaSummary,
  type ThoroughSwitchRead,
  type WaiverRowRead,
  type WhatIfRead,
  type WhatIfSwitchRead,
} from "./contracts7h";
import { READ_PRIZE_LEAGUE, READ_WAIVERS, WAIVER_REST } from "./inPage";
import {
  READ_CLOSED_IDEAS,
  READ_FINDER_SUMMARY,
  READ_WAIVER_ODDS,
  READ_WHAT_IF,
  READ_WHAT_IF_CHOICES,
  READ_WHAT_IF_MOVES,
  READ_WHAT_IF_SWITCH,
  WHAT_IF_HELPERS,
  readThorough,
  readWaiverRow,
  thoroughSwitch,
  waiverDetailsButton,
  whatIfRow,
} from "./inPage7h";
import { PHONE } from "./page";
import { cleaning, expectedTopPlaces, FINDER_DONE, FINDER_DONE_STATUS, layoutChecks, mark, measurePage, noTopReason, screenshot, sidelessCards, waiverFoldOpen, type CardInfo, type StepContext } from "./steps";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const seconds = (ms: number) => Math.round(ms / 100) / 10;
const pl = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The tab's saved settings' top-N line (steps.ts cardOddsChecks' rule: contracts.ts expectedTopPlaces), and why there's none. */
async function savedPlaces(ctx: StepContext): Promise<{ places: 2 | 3 | null; why: string }> {
  const saved = (await ctx.page.run<{ settings: unknown } | null>(READ_PRIZE_LEAGUE).catch(() => null))?.settings ?? null;
  return { places: expectedTopPlaces(saved), why: noTopReason(saved) };
}

// ---------------------------------------------------------------------------------------------
// Section 1: the Trade Finder's ideas a phone screen, every card closed

/** The key of the card step's numbers that holds the closed ideas' measure (contracts7h.ts ClosedIdeas). */
export const CLOSED_IDEAS_NOTE = "closedIdeas";

/**
 * The planner's goal for the closed cards (reply to Checkpoint 7g, §1: "With cards closed, the Trade Finder shows at least 2
 * ideas per screen"), measured on the page as a user sees it: the league's own team names, never the placeholders a screenshot
 * puts in their place. The review of the first review's fix found why it matters: "Trade idea N" shares the heading's line, and
 * saves its own, only while "Trade with <team>" fits beside it (about 214 px at 375 px, 207 px from idea 10 on: about 11
 * characters of team name), and the dumps' "Team N" names always fit, so a harness on them, or a measure after the names are
 * replaced (shots.ts), reads the best case. So the card step runs this at its start, once every card's "now or after this
 * week" number is in and before the clutter-1 shot replaces the names (steps.ts cardStep), every card closed as the page opens
 * them. Numbers only (inPage7h.ts READ_CLOSED_IDEAS reads geometry, no text): the ideas' heights, the gap, what an idea takes and
 * the ideas a phone screen (PHONE.height), noted under CLOSED_IDEAS_NOTE, with on how many "Trade idea N" shares the heading's
 * line. An ok line at the planner's goal or above; an info line under it: a league's own names and ideas can put it there, and
 * what to trim then is the lead's call, so it's said, never a failure. A skip when it can't be measured (contracts7h.ts
 * closedIdeasOf).
 */
export async function closedIdeasChecks(ctx: StepContext, step: string): Promise<void> {
  const { page, report } = ctx;
  const read = await page.run<ClosedIdeaRead[]>(READ_CLOSED_IDEAS).catch(() => null);
  const measured = read ? closedIdeasOf(read, PHONE.height) : { why: "couldn't read the Trade Finder's list" };
  if ("why" in measured) {
    report.skip(step, `the closed ideas a phone screen: ${measured.why}`);
    return;
  }
  report.note(step, CLOSED_IDEAS_NOTE, measured);
  const text = closedIdeasText(measured);
  if (measured.perScreen >= IDEAS_PER_SCREEN_GOAL) report.ok(step, text);
  else report.info(step, text);
}

// ---------------------------------------------------------------------------------------------
// Section 4: "What if"

/** The Trade Finder's link to the Trade Analyzer (an expression; the one analyzerBackLinkCheck taps). */
const FINDER_ANALYZER_LINK = `[...document.querySelectorAll("main a")].find((a) => a.getAttribute("href") === "/analyzer")`;

/** How long a what-if's evaluation may take: one run of 20,000 seasons, after the worker's context (about 1–2 s cold in Node). */
const WHAT_IF_WAIT_MS = 90_000;

interface WhatIfChoicesRead {
  shown: boolean;
  take: Array<{ index: number; text: string; pos: string | null; ir: boolean; checked: boolean; disabled: boolean }>;
  put: Array<{ index: number; text: string; pos: string | null; ir: boolean; checked: boolean; disabled: boolean }>;
  from: Array<{ value: string; label: string }>;
  positions: Array<{ value: string; label: string }>;
  prompt: string | null;
}

const run = <T>(ctx: StepContext, body: string, clean = false) => ctx.page.run<T>((clean ? cleaning(ctx) : "") + WHAT_IF_HELPERS + body, { cards: true });

/** An expression with the what-if helpers in scope (WHAT_IF_HELPERS), for a wait or a tap. */
export function withWhatIf(expression: string): string {
  return `(() => { ${WHAT_IF_HELPERS} return (${expression}); })()`;
}

/** Sets one of the picker's selects (React's change event) and waits for its list to follow. */
async function pickFrom(ctx: StepContext, label: "From" | "Position", value: string): Promise<void> {
  await run(ctx, `const s = whatIfSelect(${JSON.stringify(label)}); if (s) setSelect(s, ${JSON.stringify(value)}); return true;`);
  await sleep(250);
}

/**
 * Builds a change on the Analyzer's "What if" from the page's own lists and evaluates it (the file header): the switch to "What
 * if", my first active player off, the first player of the first other team at his position on (else at any position),
 * "Evaluate change". Returns the result as read, with what was taken off and put on, or null (said in the report) when it couldn't
 * get that far. `full`: the switch's own checks too (the What if step; the prize check only needs the result). `under` opens each
 * line with the setting it's read under.
 */
export async function whatIfRun(ctx: StepContext, step: string, opts: { full: boolean; under?: string }): Promise<{ read: WhatIfRead; took: string; put: string; ms: number } | null> {
  const { page, report } = ctx;
  const lead = opts.under ? `${opts.under}, ` : "";
  const [tradeLabel, whatIfLabel] = ANALYZER_MODES.map((m) => m.label) as [string, string];
  const ready = await page.waitFor<boolean>(withWhatIf(`location.pathname === "/analyzer" && !!whatIfSwitch()`), 60_000, "the Analyzer's “What to evaluate” switch").catch(() => false);
  if (!ready) {
    report.fail(step, `${lead}the Trade Analyzer shows no “What to evaluate” switch (“${tradeLabel}” | “${whatIfLabel}”)`);
    return null;
  }
  if (opts.full) {
    const before = await run<WhatIfSwitchRead | null>(ctx, READ_WHAT_IF_SWITCH);
    const problems = whatIfSwitchProblems(before, [tradeLabel, whatIfLabel], tradeLabel);
    report.check(step, problems.length === 0, `the Analyzer opens on “${tradeLabel}”, its switch's two buttons each at least 44 px tall`, "the Analyzer's mode switch isn't as it should be", problems);
  }
  await page.click(withWhatIf(`whatIfModeButton(${JSON.stringify(whatIfLabel)})`), `“${whatIfLabel}”`);
  const shown = await page.waitFor<boolean>(withWhatIf(`(() => { const b = whatIfModeButton(${JSON.stringify(whatIfLabel)}); return !!b && b.getAttribute("aria-pressed") === "true" && whatIfShown(); })()`), 5_000, "the what-if form").catch(() => false);
  if (opts.full) {
    const after = await run<WhatIfSwitchRead | null>(ctx, READ_WHAT_IF_SWITCH);
    const problems = whatIfSwitchProblems(after, [tradeLabel, whatIfLabel], whatIfLabel);
    report.check(step, shown && problems.length === 0, `a tap on “${whatIfLabel}” shows its form, aria-pressed following it`, `a tap on “${whatIfLabel}” didn't show its form as it should`, shown ? problems : ["the form with “Take off” and “Put on” isn't shown", ...problems]);
  }
  if (!shown) {
    if (!opts.full) report.fail(step, `${lead}a tap on “${whatIfLabel}” didn't show its form`);
    return null;
  }

  // One of my players off: the first active one the form lists (by position, then name).
  let choices = await run<WhatIfChoicesRead>(ctx, READ_WHAT_IF_CHOICES, true);
  const take = choices.take.find((r) => !r.ir && !r.disabled && !r.checked) ?? null;
  if (!take) {
    report.fail(step, `${lead}the what-if form lists none of your players to take off`);
    return null;
  }
  await page.click(withWhatIf(whatIfRow("take", take.index)), `“${take.text}” under “Take off”`);
  // One player on: the first other team's first player at his position (else at any position).
  const team = choices.from.find((o) => o.value !== "any" && o.value !== "free-agents") ?? null;
  if (team) await pickFrom(ctx, "From", team.value);
  const pos = choices.positions.find((o) => o.label === take.pos) ?? null;
  if (pos) await pickFrom(ctx, "Position", pos.value);
  choices = await run<WhatIfChoicesRead>(ctx, READ_WHAT_IF_CHOICES, true);
  if (!choices.put.some((r) => !r.disabled && !r.checked) && pos) {
    await pickFrom(ctx, "Position", "any");
    choices = await run<WhatIfChoicesRead>(ctx, READ_WHAT_IF_CHOICES, true);
  }
  const put = choices.put.find((r) => !r.disabled && !r.checked) ?? null;
  if (!put) {
    report.fail(step, `${lead}the what-if picker lists nobody to put on (it says “${choices.prompt ?? ""}”)`);
    return null;
  }
  await page.click(withWhatIf(whatIfRow("put", put.index)), `“${put.text}” under “Put on”`);
  await sleep(200);

  const started = Date.now();
  await page.click(withWhatIf("whatIfEvaluate()"), "Evaluate change");
  const state = await page
    .waitFor<string>(withWhatIf(`(() => { const s = whatIfStatus() || ""; if (/^Evaluated/.test(s)) return "evaluated"; if (/^This change can't be made/.test(s)) return "illegal"; const p = whatIfPanel(); const al = p ? p.querySelector("[role=alert]") : null; return al ? "error: " + txt(al) : null; })()`), WHAT_IF_WAIT_MS, "the what-if's evaluation", 50)
    .catch(() => "no answer");
  const ms = Date.now() - started;
  await sleep(300);
  const read = await run<WhatIfRead>(ctx, READ_WHAT_IF, true);
  if (state === "no answer" || state.startsWith("error: ")) {
    report.fail(step, state === "no answer" ? `${lead}the what-if wasn't evaluated within ${seconds(WHAT_IF_WAIT_MS)} s (its status line reads “${read.status ?? ""}”)` : `${lead}the what-if couldn't be evaluated: the page says “${state.slice("error: ".length)}”`);
    return null;
  }
  return { read, took: take.text, put: put.text, ms };
}

/**
 * Step "What if" (the file header): opened from the Trade Finder's link to the Analyzer, a change built and evaluated (whatIfRun),
 * held to whatIfProblems, valueLeaks and the release contract, the layout at 375 px, then the trade's form again.
 */
export async function whatIfStep(ctx: StepContext): Promise<void> {
  const step = "What if";
  const { page, report } = ctx;
  page.step = step;
  if (!ctx.myTeam) {
    report.skip(step, "the Analyzer's “What if” changes your roster: no team picked");
    return;
  }
  if ((await page.run<string>("return location.pathname;")) !== "/trades") {
    await page.click(`navLink("/trades")`, "the nav's Trades link");
    await page.waitFor<string>(FINDER_DONE, 300_000, "the Trade Finder", 50).catch(() => null);
  }
  if (!(await page.run<boolean>(`return !!${FINDER_ANALYZER_LINK};`))) {
    report.fail(step, "the Trade Finder has no link to the Trade Analyzer");
    return;
  }
  await page.click(FINDER_ANALYZER_LINK, "the Trade Finder's link to the Trade Analyzer");
  await whatIfChecks(ctx, step);
}

/**
 * The "What if" step's checks on the Trade Analyzer as it opens (whatIfStep, after the Trade Finder's link; exported so an
 * offline harness can run them on the real components).
 */
export async function whatIfChecks(ctx: StepContext, step: string): Promise<void> {
  const { page, report } = ctx;
  const done = await whatIfRun(ctx, step, { full: true });
  if (!done) return;
  const { read } = done;
  report.note(step, "evaluateSeconds", seconds(done.ms));
  const { places, why } = await savedPlaces(ctx);
  const problems = whatIfProblems(read, { oddsOnly: WHAT_IF_ODDS_ONLY, otherTeams: WHAT_IF_OTHER_TEAMS, removed: 1, added: 1, places });
  const c = read.card;
  const odds = c ? c.odds.map((o) => `${o.label} ${o.value}`).join(" · ") : "";
  report.note(step, "change", `took off ${done.took}, put on ${done.put}: Helps you ${c?.helps ?? "?"}; ${odds}`);
  report.check(
    step,
    problems.length === 0,
    `taking off ${done.took} and putting on ${done.put} evaluates in ${seconds(done.ms)} s: Helps you ${c?.helps ?? "?"} with “${WHAT_IF_ODDS_ONLY}”, ${odds}${places ? "" : ` (no top-N line: ${why})`}${c?.weekly ? `, ${c.weekly.label}: ${c.weekly.items.join(" · ")}` : ""}, the planner's line about other teams, and no chance they accept, Overall, offers, Plan B or feedback buttons; the address carries the change as player ids only`,
    `${pl(problems.length, "problem")} with the what-if's result`,
    problems,
  );
  const leaks = valueLeaks(read.text);
  report.check(step, leaks.length === 0, "no FantasyCalc value or value comparison in the what-if's result (hover texts included)", `${pl(leaks.length, "trade value")} in the what-if's result: Offer Sheet never displays FantasyCalc's values (their condition 4)`, leaks);
  const moves = await run<string[]>(ctx, READ_WHAT_IF_MOVES, true);
  const releases = moves.filter((l) => / returns from IR\b/.test(l)).map(asTradeWords);
  if (releases.length) {
    const wrong = releaseLineProblems(releases, "trade");
    report.check(step, wrong.length === 0, `its ${pl(releases.length, "release")} at an IR return read as a trade card's`, `${pl(wrong.length, "release line")} of the what-if read otherwise than a trade card's`, wrong);
  }
  layoutChecks(ctx, step, await measurePage(ctx));
  await screenshot(ctx, "05c-what-if");

  // Back to the trade: its form shows again, the what-if's waits hidden.
  const [tradeLabel] = ANALYZER_MODES.map((m) => m.label) as [string];
  await page.click(withWhatIf(`whatIfModeButton(${JSON.stringify(tradeLabel)})`), `“${tradeLabel}”`);
  const back = await page
    .waitFor<boolean>(withWhatIf(`(() => { const b = whatIfModeButton(${JSON.stringify(tradeLabel)}); return !!b && b.getAttribute("aria-pressed") === "true" && !whatIfShown(); })()`), 5_000, "the trade's form")
    .catch(() => false);
  report.check(step, back, `“${tradeLabel}” shows the trade's form again, the what-if hidden`, `a tap on “${tradeLabel}” didn't bring the trade's form back`);
}

/**
 * Under "Several prizes" (steps.ts prizeOddsChecks, on the Analyzer it opened for the first idea): the what-if's odds lines carry
 * the top-N line the saved settings call for (whatIfRun, then the odds' order).
 */
export async function whatIfPrizeOddsChecks(ctx: StepContext, step: string, under: string): Promise<void> {
  const done = await whatIfRun(ctx, step, { full: false, under });
  if (!done) return;
  const { places } = await savedPlaces(ctx);
  const c = done.read.card;
  if (!c) {
    ctx.report.fail(step, `${under}, the what-if shows no card${done.read.illegal ? `: “${done.read.illegal}”` : ""}`);
    return;
  }
  const problems = oddsOrderProblems(c.odds.map((o) => o.label), places, "the what-if's odds lines");
  ctx.report.check(step, problems.length === 0, `${under}, the what-if's odds lines read ${c.odds.map((o) => `“${o.label}”`).join(" · ")}`, `${under}, the what-if's odds lines aren't as the saved settings call for`, problems);
}

// ---------------------------------------------------------------------------------------------
// Section 5: Waiver upgrades' odds lines

interface WaiverOddsRow {
  id: string | null;
  list: string | null;
  blocked: boolean;
  helps: boolean;
  odds: boolean;
  labels: string[];
}

/**
 * One list's odds lines (the file header; called on each list of the toggle from steps.ts waiverMoveChecks, with the list's label
 * and whether it's rated): which rows carry them (waiverOddsCoverageProblems), then on a rated list one row's "Details" tapped
 * open and closed (waiverDetailsProblems) and read for trade values.
 */
export async function waiverDetailsChecks(ctx: StepContext, step: string, label: string, rated: boolean): Promise<void> {
  const { page } = ctx;
  const name = `“${label}”`;
  let rows = await page.run<WaiverOddsRow[]>(READ_WAIVER_ODDS);
  const candidate = (list: WaiverOddsRow[]) => list.find((r) => r.id && r.helps && !r.blocked && r.odds) ?? list.find((r) => r.id && !r.blocked && r.odds) ?? null;
  // No move above the fold to open (Parker's second league: its one "Rest of season" row is folded): the fold opened for the
  // reading, and closed again at the end.
  const fold = rated && !candidate(rows) && (await page.run<boolean>(`const b = ${WAIVER_REST}; return !!b && b.getAttribute("aria-expanded") === "false";`));
  if (fold) {
    await page.click(WAIVER_REST, "the list's fold");
    if (await page.waitFor<boolean>(waiverFoldOpen(true), 5_000, "the fold to open").catch(() => false)) rows = await page.run<WaiverOddsRow[]>(READ_WAIVER_ODDS);
  }
  try {
    await rowDetailsChecks(ctx, step, name, label, rated, rows, candidate(rows));
  } finally {
    if (fold) {
      await page.click(WAIVER_REST, "the list's fold again");
      await page.waitFor<boolean>(waiverFoldOpen(false), 5_000, "the fold to close").catch(() => false);
    }
  }
}

/** waiverDetailsChecks' checks on the rows read (`row`: the one to tap, null when none can be). */
async function rowDetailsChecks(ctx: StepContext, step: string, name: string, label: string, rated: boolean, rows: WaiverOddsRow[], row: WaiverOddsRow | null): Promise<void> {
  const { page, report } = ctx;
  if (!rows.length) {
    report.skip(step, `the odds lines on ${name}: it shows no row`);
    return;
  }
  const coverage = waiverOddsCoverageProblems(rows, rated, label);
  const withOdds = rows.filter((r) => r.odds).length;
  report.check(
    step,
    coverage.length === 0,
    rated ? `${name}: ${withOdds} of ${pl(rows.length, "row")} ${withOdds === 1 ? "carries" : "carry"} your odds before → after in their details, every move that can be made` : `${name} stays in points: no row carries odds lines`,
    `${pl(coverage.length, "problem")} with ${name}'s odds lines`,
    coverage,
  );
  if (!rated) return;
  if (!row?.id) {
    report.skip(step, `a row's “Details” on ${name}: no move that can be made`);
    return;
  }
  const id = row.id;
  const read = () => page.run<WaiverRowRead>(cleaning(ctx) + readWaiverRow(id));
  const before = await read();
  await page.click(waiverDetailsButton(id), "a row's “Details”");
  await page.waitFor<boolean>(`(() => { const b = ${waiverDetailsButton(id)}; return !!b && b.getAttribute("aria-expanded") === "true"; })()`, 5_000, "the row's details to open").catch(() => false);
  await sleep(150);
  const open = await read();
  await page.click(waiverDetailsButton(id), "the row's “Details” again");
  await page.waitFor<boolean>(`(() => { const b = ${waiverDetailsButton(id)}; return !!b && b.getAttribute("aria-expanded") === "false"; })()`, 5_000, "the row's details to fold").catch(() => false);
  await sleep(150);
  const closed = await read();
  const { places, why } = await savedPlaces(ctx);
  const problems = waiverDetailsProblems(before, open, closed, { rated, frame: ODDS_FRAME, places });
  const lines = open.odds.map((o) => `${o.label} ${o.value}`).join(" · ");
  report.check(
    step,
    problems.length === 0,
    `${name}: a row's “Details” opens with a tap, keyboard focus kept on it: “Your odds: ${open.frame ?? ""}”, ${lines}${places ? "" : ` (no top-N line: ${why})`}; another tap folds it, focus kept`,
    `${pl(problems.length, "problem")} with a row's “Details” on ${name}`,
    problems,
  );
  const leaks = pageValueLeaks(open.text);
  report.check(step, leaks.length === 0, `no trade-market number or value comparison in that row's details`, `${pl(leaks.length, "trade value")} in a waiver row's details: Offer Sheet never displays FantasyCalc's values (their condition 4)`, leaks);
}

/**
 * Under "Several prizes" (steps.ts prizeOddsChecks, on the League page built again): once "Rest of season" is rated, every row's
 * odds lines carry the top-N line the saved settings call for (oddsOrderProblems on each row's labels, read from its details,
 * which are in the page while hidden).
 */
export async function waiverPrizeOddsChecks(ctx: StepContext, step: string, under: string): Promise<void> {
  const { page, report } = ctx;
  const started = Date.now();
  let status = (await page.run<{ status?: string | null }>(READ_WAIVERS)).status ?? null;
  while (status === RATING_PENDING_TEXT && Date.now() - started < 60_000) {
    await sleep(250);
    status = (await page.run<{ status?: string | null }>(READ_WAIVERS)).status ?? null;
  }
  const rows = (await page.run<WaiverOddsRow[]>(READ_WAIVER_ODDS)).filter((r) => r.odds);
  if (!rows.length) {
    report.skip(step, `${under}, the waiver rows' odds lines: no rated row carries them${status === RATING_PENDING_TEXT ? " (the rating didn't come within 60 s)" : ""}`);
    return;
  }
  const { places } = await savedPlaces(ctx);
  const problems = rows.flatMap((r, i) => oddsOrderProblems(r.labels, places, `waiver row ${i + 1}`));
  const want = ["Title odds", ...(places ? [`Top ${places} odds`] : []), "Playoff odds"].join(" · ");
  report.check(step, problems.length === 0, `${under}, the ${pl(rows.length, "waiver row")}' odds lines read “${want}”`, `${under}, ${pl(problems.length, "waiver row")}' odds lines read otherwise than “${want}”`, problems);
}

// ---------------------------------------------------------------------------------------------
// Section 3: the Thorough search

/** The switch's label (TradeFinderPage.tsx THOROUGH_LABEL; a test ties the two). */
export const THOROUGH_LABEL = "Thorough search";

/** How long the step waits for a Thorough search (the planner's aim is 60 s on Parker's 12-team league; a phone takes longer). */
export const THOROUGH_WAIT_MS = 360_000;

/** "At once": the normal search's ideas back within this, with no search. */
export const THOROUGH_BACK_MS = 5_000;

interface EngineAnswer {
  t: number;
  type: string;
  timings?: Record<string, number> | null;
  counts?: Record<string, number> | null;
}

/** The ideas on the page, as contracts7h.ts reads them. */
async function ideasOnPage(ctx: StepContext): Promise<{ cards: CardInfo[]; ideas: IdeaSummary[] }> {
  const cards = await ctx.page.run<CardInfo[]>("return allCards();", { cards: true });
  return { cards, ideas: cards.map((c) => ({ heading: c.heading, give: c.give.map((g) => g.name), get: c.get.map((g) => g.name), helps: c.helps, accept: c.accept, overall: c.overall })) };
}

/** The estimates this tab's normal searches let the page show (engine thorough.ts thoroughSeconds), with none among them. */
export function thoroughEstimates(totals: readonly number[], partners: number): number[] {
  return [...new Set([thoroughSeconds(null, partners), ...totals.filter((t) => Number.isFinite(t) && t > 0).map((t) => thoroughSeconds(t, partners))])];
}

/** Step "Thorough search" (the file header). */
export async function thoroughStep(ctx: StepContext): Promise<void> {
  const step = "Thorough search";
  const { page, report } = ctx;
  page.step = step;
  if (!ctx.myTeam) {
    report.skip(step, "the Thorough search: no team picked");
    return;
  }
  await page.click(`navLink("/trades")`, "the nav's Trades link");
  let state = await page.waitFor<string>(FINDER_DONE, 300_000, "the Trade Finder", 50).catch(() => "no answer");
  // The ideas for every team (the Analyzer step leaves one partner's).
  if (state === "done" && (await page.run<string>(`const s = document.getElementById("finder-partner"); return s ? s.value : "";`))) {
    await page.run(`setSelect(document.getElementById("finder-partner"), ""); return true;`);
    await sleep(300);
    state = await page.waitFor<string>(`!new URLSearchParams(location.search).get("partner") && ${FINDER_DONE}`, 300_000, "the Trade Finder for every team", 50).catch(() => "no answer");
  }
  // A remembered search shows a tick after the page's status line can still read the last one's: let it settle, then again.
  await sleep(800);
  if (state === "done") state = await page.waitFor<string>(FINDER_DONE, 300_000, "the Trade Finder", 50).catch(() => "no answer");
  if (!report.check(step, state === "done", "the Trade Finder shows its ideas for every team", "the Trade Finder didn't show its ideas for every team")) return;
  const normal = await ideasOnPage(ctx);
  const summaryBefore = await page.run<string | null>(READ_FINDER_SUMMARY);
  const partners = await page.run<number>(`const s = document.getElementById("finder-partner"); return s ? [...s.options].filter((o) => o.value).length : 0;`);
  const totals = (await page.run<EngineAnswer[]>("return engineSince(0);")).filter((e) => e.type === "trades").map((e) => e.timings?.total ?? Number.NaN);
  const off = await page.run<ThoroughSwitchRead>(readThorough(THOROUGH_LABEL));
  const allowed = thoroughEstimates(totals, Math.max(1, partners));
  const offProblems = thoroughSwitchProblems(off, { label: THOROUGH_LABEL, checked: false, seconds: allowed });
  const estimate = thoroughEstimate(off.help);
  if (!report.check(step, offProblems.length === 0, `“${THOROUGH_LABEL}” is a 44 px switch, off by default, its help saying “Takes about ${estimate ?? "?"} seconds.”`, `the “${THOROUGH_LABEL}” switch isn't as it should be`, offProblems)) {
    if (!off.found) return;
  }
  report.note(step, "estimateSeconds", estimate);

  // On: a new search, to the end, with the progress bar and Stop.
  const from = await mark(page);
  await page.click(thoroughSwitch(THOROUGH_LABEL), `“${THOROUGH_LABEL}”`);
  const stop = await page.waitFor<boolean>(`!!byText("button", "Stop")`, 15_000, "the Thorough search's Stop").catch(() => false);
  const started = Date.now();
  const finished = await page
    .waitFor<string>(`engineSince(${from}).some((e) => e.type === "trades" || e.type === "error") && ${FINDER_DONE}`, THOROUGH_WAIT_MS, "the Thorough search", 100)
    .catch((err: unknown) => `error: ${err instanceof Error ? err.message : "it didn't finish"}`);
  const wall = seconds(Date.now() - started);
  if (!report.check(step, finished === "done", "turned on, the Thorough search ran to the end", `the Thorough search didn't finish: ${finished.replace(/^error: /, "")}`)) return;
  await sleep(500);
  const timeline = await page.run<{ firstProgress: number | null; done: number | null; engine: EngineAnswer[] }>(`
    const ev = eventsSince(${from}).filter((e) => e.path.startsWith("/trades"));
    const pb = ev.find((e) => e.pb !== null);
    const done = ev.find((e) => e.pb === null && e.status.split(" | ").some((t) => ${FINDER_DONE_STATUS.toString()}.test(t)) && (!pb || e.t > pb.t));
    return { firstProgress: pb ? pb.t : null, done: done ? done.t : null, engine: engineSince(${from}) };
  `);
  const answer = timeline.engine.filter((e) => e.type === "trades").at(-1);
  const took = timeline.firstProgress !== null && timeline.done !== null ? seconds(timeline.done - timeline.firstProgress) : null;
  report.check(step, timeline.firstProgress !== null && stop, "it showed the progress bar and Stop while it searched", timeline.firstProgress === null ? "no progress bar showed while it searched" : "no Stop button showed while it searched");
  const found = await ideasOnPage(ctx);
  const summaryOn = await page.run<string | null>(READ_FINDER_SUMMARY);
  const onSwitch = await page.run<ThoroughSwitchRead>(readThorough(THOROUGH_LABEL));
  const max = Math.max(3, Math.floor(config.search.thorough.maxPerSide));
  const missing = found.cards.map((c, i) => (c.helps && c.accept && c.overall ? null : `idea ${i + 1}: ${c.helps ?? "?"} · ${c.accept ?? "?"} · ${c.overall ?? "?"}`)).filter((x): x is string => !!x);
  const problems = [
    ...(onSwitch.checked ? [] : ["the switch reads off"]),
    ...missing,
    ...sidelessCards(found.cards),
    ...oversizedIdeas(found.ideas, max),
    ...thoroughSummaryProblems(summaryBefore, summaryOn, summaryBefore, max).filter((p) => p.startsWith("with")),
  ];
  report.check(
    step,
    problems.length === 0,
    `its ${pl(found.cards.length, "idea")} each show Helps you, Chance they accept and Overall, both sides and at most ${max} players a side; the settings line reads “${summaryOn ?? ""}”`,
    `${pl(problems.length, "problem")} with the Thorough search's ideas`,
    problems,
  );
  const fresh = newIdeas(normal.ideas, found.ideas);
  report.note(step, "thoroughSeconds", took ?? wall);
  report.note(step, "ideas", found.cards.length);
  report.note(step, "newIdeas", fresh);
  if (answer?.timings) report.note(step, "engineMs", Object.fromEntries(Object.entries(answer.timings).map(([k, v]) => [k, Math.round(v)])));
  if (answer?.counts) report.note(step, "counts", answer.counts);
  report.note(step, "top", found.ideas.slice(0, 3).map((i) => `${i.heading}: ${i.give.join(" + ")} for ${i.get.join(" + ")} = ${i.helps} · ${i.accept} · ${i.overall}`));
  report.info(
    step,
    `the Thorough search took ${took ?? wall} s in the production worker (its help said about ${estimate ?? "?"} seconds) and found ${pl(found.cards.length, "idea")}, ${fresh} of them not among the normal search's ${normal.cards.length}`,
  );
  layoutChecks(ctx, step, await measurePage(ctx), "the page", "with the Thorough search's ideas: ");
  await screenshot(ctx, "04b-thorough-search");

  // Off: the normal search's ideas back at once, as they were, without a search.
  const offFrom = await mark(page);
  const back = Date.now();
  await page.click(thoroughSwitch(THOROUGH_LABEL), `“${THOROUGH_LABEL}” again`);
  const again = await page
    .waitFor<string>(`(() => { const i = [...document.querySelectorAll("main input[type=checkbox]")].find((x) => { const l = x.closest("label"); return !!l && txt(l) === ${JSON.stringify(THOROUGH_LABEL)}; }); return !!i && !i.checked && ${FINDER_DONE} === "done" ? "done" : null; })()`, 60_000, "the normal search's ideas", 50)
    .catch(() => "no answer");
  // The list as it was, read until it shows (the status line can read "done" a tick before the remembered ideas replace the
  // Thorough search's), at most THOROUGH_BACK_MS from the tap.
  let after = await ideasOnPage(ctx);
  while (again === "done" && sameIdeasProblems(normal.ideas, after.ideas).length && Date.now() - back < THOROUGH_BACK_MS) {
    await sleep(100);
    after = await ideasOnPage(ctx);
  }
  const backMs = Date.now() - back;
  await sleep(300);
  const searched = await page.run<boolean>(`return engineSince(${offFrom}).some((e) => e.type === "trades");`);
  const summaryAfter = await page.run<string | null>(READ_FINDER_SUMMARY);
  const backProblems = [
    ...(again === "done" ? [] : ["the normal search's ideas didn't show again"]),
    ...(searched ? ["it searched again"] : []),
    ...(backMs <= THOROUGH_BACK_MS ? [] : [`it took ${seconds(backMs)} s`]),
    ...sameIdeasProblems(normal.ideas, after.ideas),
    ...thoroughSummaryProblems(summaryBefore, summaryOn, summaryAfter, max).filter((p) => p.startsWith("turned off")),
  ];
  report.check(
    step,
    backProblems.length === 0,
    `turned off, the normal search's ${pl(after.cards.length, "idea")} come back as they were in ${seconds(backMs)} s, without a search`,
    "turned off, the normal search's ideas didn't come back as they were, at once",
    backProblems,
  );
}
