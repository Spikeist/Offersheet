/**
 * The Trade Finder and Trade Analyzer pages (CLAUDE.md §13, §14 items 4–5; Phase 4 wave 2 decision M13), rendered
 * statically (first render only, no DOM): every state of the Finder around one status line that stays in place, the
 * progress bar and Stop, the cards with every §13 field (the three numbers with "Est.", risk flags apart, values with
 * their FantasyCalc link, ROS points, forced moves, reasons, the pitch with Copy, Open in Analyzer, the feedback
 * buttons in each state), the Analyzer's form and result, and 44 px targets. A small made-up league.
 */
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { config } from "@/engine/config";
import { titleDeltas } from "@/engine/reward";
import { defaultTradeSettings } from "@/engine/settings";
import type { PartnerNumbers, TradeEvaluation } from "@/engine/tradeModel";
import type { CardFeedback, FinderView, TradeCardView } from "@/lib/tradeView";
import {
  FROM_PLAN_B_NOTE,
  HELPS_THEM_TITLE,
  OFFERS_FAILED_TEXT,
  OFFERS_LOADING_TEXT,
  OFFERS_NONE_TEXT,
  PLAN_B_HEADING,
  PROJECTIONS_SOURCE,
  analyzerChoices,
  buildAnalysisView,
  buildFinderView,
  buildLadderView,
  buildTradeCard,
  cardVersions,
  finderTimingLines,
  minChanceNote,
  progressView,
  settingsSummary,
  type LadderView,
} from "@/lib/tradeView";
import { AnalysisResult, AnalyzerForm, AnalyzerPage, analysisStatus } from "./AnalyzerPage";
import { FeedbackControls, VERSION_QUESTION, VersionChooser, chosenVersionChange, outcomeAction } from "./FeedbackControls";
import { HowToRead, PREFER_LISTED_WORDS, acceptCapWords, helpsScaleWords, helpsThemValueWords, helpsThemWords, nowOrLaterWords, offersWords, planBGainWords, planBShareWords, planBWords, rosterMovesWords, weeklyLineWords } from "./HowToRead";
import { OffersPanel, TradeCard, type OffersState } from "./TradeCard";
import { FinderControls, FinderFrame, TradeFinderPage, finderStatus, needsRefilter, refilterProgress, runShown, searchKeyFor, type FinderState } from "./TradeFinderPage";
import { GLOOP_PREMIUM, SNOOT_PREMIUM, TRADE_MARKET, evaluation, searchResult, steppedFull, tradeFantasyCalc, tradeSnapshot } from "./testFixtures";

const snapshot = tradeSnapshot();
/** FantasyCalc's own values for the cards (Phase 4c: the card's one value number). */
const FC = tradeFantasyCalc();
const noop = () => {};
/** The no-break space before the card's dot separators (TradeCard.tsx SEP; final review of Phase 4c, finding PAGES-7). */
const NBSP = String.fromCharCode(0xa0);
const saved = () => ({ ok: true as const });
const NONE: CardFeedback = { outcome: null, report: null, version: null, versionKey: null, versionWords: null };

/**
 * The partner's numbers on an evaluation (Checkpoint 7c; TradeEvaluation.them, which the fixtures don't set): Helps them
 * `helps` (null: their scale unknown), their title odds 6.0% → 6.9% and playoff odds 41% → 45% from the same runs.
 */
const withThem = (e: TradeEvaluation, helps: number | null, over: Partial<PartnerNumbers> = {}): TradeEvaluation => ({
  ...e,
  them: {
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
    ...over,
  },
});

/** Plan B's heading as React writes it into HTML (its apostrophe escaped): "If they won&#x27;t move: try …" (Checkpoint 7e). */
const PLAN_B_HTML = PLAN_B_HEADING.replace(/'/g, "&#x27;");

/** A card's own "How to offer it" summary (How to read's paragraph names it too, in bold). */
const OFFERS_SUMMARY = /<summary[^>]*><span>How to offer it<span class="sr-only">/;

/** Visible text, tags and the entities React writes removed. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

const view = (trades = [evaluation({ key: "a" }), evaluation({ key: "b", b: 6, pComplete: 0.3, give: ["105"] })], over: Parameters<typeof searchResult>[1] = {}): FinderView =>
  buildFinderView({ result: searchResult(trades, over), sort: "overall", snapshot, partnerId: null, fantasyCalc: FC });

const STATES: Record<string, FinderState> = {
  fetching: { kind: "fetching" },
  fetchError: { kind: "fetchError", message: "ESPN isn't responding right now.", onRetry: noop },
  noTeam: { kind: "noTeam" },
  settings: { kind: "settings" },
  searching: { kind: "searching", progress: progressView({ stage: "screening", done: 120, total: 480 }), onStop: noop, previous: null },
  stopped: { kind: "stopped", onAgain: noop, previous: null },
  error: { kind: "error", message: "Something went wrong while crunching the numbers.", onRetry: noop, previous: null },
  done: { kind: "done", view: view() },
};

const frameProps = (state: FinderState) => ({ state, teamName: "Moonbeam Mudcats", controls: null, records: [], leagueKey: "espn:0000abcd", onFeedback: saved });
const renderFrame = (state: FinderState) => renderToStaticMarkup(createElement(FinderFrame, frameProps(state)));

/** The status line's classes and text (the one with tabindex: the cards' feedback lines have none). */
function statusOf(html: string): { cls: string; text: string } | null {
  const m = /<p role="status" tabindex="-1" class="([^"]*)">(.*?)<\/p>/.exec(html);
  return m ? { cls: m[1] ?? "", text: textOf(m[2] ?? "") } : null;
}

/** Every button and link that isn't an inline text link, with its classes. */
function targets(html: string): { tag: string; text: string; cls: string }[] {
  return [...html.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)].map(([, tag = "", attrs = "", inner = ""]) => ({ tag, text: textOf(inner), cls: /class="([^"]*)"/.exec(attrs)?.[1] ?? "" }));
}

describe("FinderFrame: one status line through every state", () => {
  it("keeps the status line at the same slot of the frame in every state, so React keeps the element and announces each change", () => {
    const slots = Object.values(STATES).map((state) => {
      const frame = FinderFrame(frameProps(state)) as ReactElement<{ children: ReactNode[] }>;
      return frame.props.children.findIndex((c) => isValidElement(c) && (c.props as { role?: string }).role === "status");
    });
    expect(new Set(slots)).toEqual(new Set([2]));
  });

  it("says what's happening in each state: loading (visible, with a spinner), the search's stage, stopped, what was found", () => {
    const text = Object.fromEntries(Object.entries(STATES).map(([k, s]) => [k, statusOf(renderFrame(s))?.text]));
    expect(text).toEqual({
      fetching: "Loading projections…",
      fetchError: "",
      noTeam: "",
      settings: "Loading your settings…",
      searching: "Searching for trade ideas: screening trade ideas…",
      stopped: "Search stopped.",
      error: "",
      done: "Found 2 trade ideas.",
    });
    expect(statusOf(renderFrame(STATES.fetching as FinderState))?.cls).toContain("flex");
    expect(statusOf(renderFrame(STATES.done as FinderState))?.cls).toContain("sr-only");
    expect(finderStatus({ kind: "done", view: view([]) })).toBe("No trade ideas found.");
  });

  it("has one page heading, names the user's team, and links to the Analyzer", () => {
    const html = renderFrame(STATES.done as FinderState);
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toContain('Trades for <span class="font-bold break-words text-foreground">Moonbeam Mudcats</span>, ranked by how much they help you and how likely the other');
    expect(html).toMatch(/<a class="[^"]*min-h-11[^"]*" href="\/analyzer">Build your own trade in the Trade Analyzer<\/a>/);
    expect(textOf(html)).toContain("How to read a trade idea");
  });

  it("says when to look and how fresh the data is under the intro, before the Analyzer link, in every state (planner reply to Checkpoint 7a, 5.3)", () => {
    const now = new Date("2026-11-26T22:00:00.000Z");
    const ago = (hours: number) => new Date(now.getTime() - hours * 3600_000).toISOString();
    const reviewed = { ...snapshot, settings: { ...snapshot.settings, tradeReview: "league_vote" as const, tradeReviewHours: 24 } };
    const inputs = { market: { ...TRADE_MARKET, fetchedAt: ago(3) }, sources: [{ source: PROJECTIONS_SOURCE, fetchedAt: ago(5) }], lastWeek: 17 };
    const timing = finderTimingLines({ snapshot: reviewed, inputs, now });
    expect(timing).toEqual({
      bestTime:
        "Best time to look: Tuesday or Wednesday, after Monday night's game. Trade values and projections have caught up with the weekend, and a trade still has time to clear your league's 1-day review before Thursday.",
      freshness: "Trade values updated 3 hours ago · Projections updated 5 hours ago.",
    });
    for (const state of Object.values(STATES)) {
      const html = renderToStaticMarkup(createElement(FinderFrame, { ...frameProps(state), timing }));
      const intro = html.indexOf("The search runs in your browser.");
      const best = html.indexOf(`<p class="mt-2 max-w-2xl text-sm text-muted">${timing.bestTime?.replace(/'/g, "&#x27;")}</p>`);
      const fresh = html.indexOf(`<p class="mt-1 text-xs text-muted">${timing.freshness}</p>`);
      expect(intro, state.kind).toBeGreaterThan(-1);
      expect(best, state.kind).toBeGreaterThan(intro);
      expect(fresh, state.kind).toBeGreaterThan(best);
      expect(html.indexOf("Build your own trade in the Trade Analyzer"), state.kind).toBeGreaterThan(fresh);
    }
    // Out of season, the freshness line alone; no timing (inputs not loaded yet): neither.
    const fresh = renderToStaticMarkup(createElement(FinderFrame, { ...frameProps(STATES.done as FinderState), timing: { bestTime: null, freshness: timing.freshness } }));
    expect(textOf(fresh)).not.toContain("Best time to look");
    expect(textOf(fresh)).toContain("Trade values updated 3 hours ago · Projections updated 5 hours ago.");
    const none = textOf(renderFrame(STATES.fetching as FinderState));
    expect(none).not.toContain("Best time to look");
    expect(none).not.toContain("updated");
  });

  it("shows a progress bar while searching: the stage and its count in words, its value for screen readers, and Stop", () => {
    const html = renderFrame(STATES.searching as FinderState);
    expect(html).toMatch(/role="progressbar" aria-label="Trade search progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="15" aria-valuetext="Screening trade ideas: 120 of 480"/);
    expect(html).toContain('style="width:15%"');
    expect(textOf(html)).toContain("Screening trade ideas · 120 of 480");
    expect(html).toMatch(/<button type="button" class="[^"]*min-h-11[^"]*">Stop<\/button>/);
    expect(html).not.toContain("aria-busy");
  });

  it("keeps the last ideas found on screen, dimmed, while a new search runs", () => {
    const html = renderFrame({ ...(STATES.searching as Extract<FinderState, { kind: "searching" }>), previous: view() });
    expect(html).toMatch(/<div class="opacity-60 transition-opacity"><section aria-labelledby="results-title"/);
    expect(textOf(html)).toContain("The last trade ideas found");
  });

  it("keeps the last ideas found, dimmed, under the stopped card and after a failure (review: Stop made them vanish)", () => {
    const stopped = renderFrame({ kind: "stopped", onAgain: noop, previous: view() });
    expect(textOf(stopped)).toContain("You stopped the search. The last trade ideas found are still below. Search again whenever you're ready. Search again The last trade ideas found");
    expect(stopped).toMatch(/<div class="opacity-60 transition-opacity"><section aria-labelledby="results-title"/);
    expect(textOf(renderFrame(STATES.stopped as FinderState))).toContain("You stopped the search. Search again whenever you're ready.");
    expect(renderFrame({ kind: "error", message: "x", onRetry: noop, previous: view() })).toMatch(/<div class="opacity-60 transition-opacity"><section aria-labelledby="results-title"/);
  });

  it("says how Helps you weighs later seasons in dynasty and keeper leagues (the Win now ↔ Future setting)", () => {
    const how = (leagueType?: "redraft" | "keeper" | "dynasty") => {
      const text = textOf(renderToStaticMarkup(createElement(FinderFrame, { ...frameProps(STATES.done as FinderState), leagueType })));
      return text.slice(text.indexOf("How to read a trade idea"));
    };
    expect(how()).not.toContain("Win now");
    expect(how("redraft")).not.toContain("long-term value");
    expect(how("dynasty")).toContain("In a dynasty league it also counts the change in your roster's long-term value, weighed by your Win now ↔ Future setting in Settings.");
    expect(how("dynasty")).not.toContain("keep a player");
    expect(how("keeper")).toContain("In a keeper league it also counts the change in your roster's long-term value, weighed by your Win now ↔ Future setting in Settings. What it costs to keep a player next season isn't counted yet.");
  });

  it("tells How to read what the league's data allows, and a card shown whose long-term values are missing (review of track UIC, findings 2 and 3)", () => {
    const ON = { valuesOn: true, longTermOn: true, blendOn: true };
    const how = (state: FinderState, leagueType: "redraft" | "dynasty", facts?: typeof ON) => {
      const text = textOf(renderToStaticMarkup(createElement(FinderFrame, { ...frameProps(state), leagueType, facts })));
      return text.slice(text.indexOf("How to read a trade idea"));
    };
    const done = STATES.done as FinderState;
    expect(how(done, "redraft", { ...ON, valuesOn: false })).toContain("While FantasyCalc's trade values aren't available, it leaves trade value out.");
    expect(how(done, "redraft", { ...ON, blendOn: false })).not.toContain("blended");
    expect(how(done, "dynasty", ON)).toContain("In a dynasty league it also counts the change in your roster's long-term value");
    expect(how(done, "dynasty", { ...ON, longTermOn: false })).toContain("so it counts this season only.");
    // The engine's own word: a card shown (dimmed ones too) whose long-term values are missing.
    const missing = view([evaluation({ key: "a", dynMissing: true, lambda: 0.5 })]);
    expect(how({ kind: "done", view: missing }, "dynasty", ON)).toContain("so it counts this season only.");
    expect(how({ kind: "stopped", onAgain: noop, previous: missing }, "dynasty", ON)).toContain("so it counts this season only.");
    // Before the league's data loads (no facts): the usual words.
    expect(how(STATES.fetching as FinderState, "redraft")).toContain("It also counts trade value");
    expect(how(STATES.fetching as FinderState, "redraft")).toContain("blended with the trade market");
  });

  it("offers Search again once stopped, Try again after a failure (an alert), and a link to pick a team without one", () => {
    expect(renderFrame(STATES.stopped as FinderState)).toMatch(/<button type="button" class="[^"]*">Search again<\/button>/);
    const failed = renderFrame(STATES.error as FinderState);
    expect(failed).toMatch(/role="alert"[^>]*>.*The trade search didn&#x27;t finish.*Something went wrong while crunching the numbers\./);
    expect(failed).toMatch(/<button type="button" class="[^"]*">Try again<\/button>/);
    const noTeam = renderFrame(STATES.noTeam as FinderState);
    expect(textOf(noTeam)).toContain("Which team is yours? Pick your team on the Import Report to see trade ideas.");
    expect(noTeam).toContain('href="/import#your-team"');
    const fetchError = renderFrame(STATES.fetchError as FinderState);
    expect(textOf(fetchError)).toContain("We couldn't load your league's projections ESPN isn't responding right now.");
    expect(fetchError).toContain('href="/import"');
  });

  it("lists the ideas in order with my odds before any trade and what they count, what was left out and what was looked at", () => {
    const html = renderFrame({ kind: "done", view: view(undefined, { hidden: { byBenefit: 3, byMarket: 0 } }) });
    const text = textOf(html);
    expect(text).toContain(
      "Trade ideas Your odds before any trade: 62% to make the playoffs, 9.0% to win the title. As on the League page, they count the free-agent pickups that would help each team, and every trade idea's odds start from them. Helps you (0–100) sums up how much your title and playoff odds rise, minus a cost for giving away trade value or plus a credit for gaining it. 63 ≈ as good as adding 3 points a week to your lineup for the rest of the season. 2 trade ideas, sorted by Overall.",
    );
    expect(html).toContain('<p class="mt-0.5 text-xs text-muted">As on the League page');
    expect([...html.matchAll(/Trade idea (\d+)<\/p>/g)].map((m) => m[1])).toEqual(["1", "2"]);
    // Each idea's item carries its key, so a return from the Analyzer can bring it back into view (review of Phase 4).
    expect([...html.matchAll(/<li data-trade-key="([^"]+)"><article aria-labelledby=/g)].map((m) => m[1])).toEqual(["b", "a"]);
    expect(html).toMatch(/<ol class="space-y-4"><li data-trade-key="[^"]+"><article aria-labelledby=/);
    expect(text).toContain("Left out on purpose: 3 trade ideas that wouldn't help you.");
    expect(text).toContain("Looked at 1,234 trade ideas");
    // The results' heading can take focus (after Search again).
    expect(renderToStaticMarkup(createElement(FinderFrame, { ...frameProps({ kind: "done", view: view() }), resultsRef: { current: null } }))).toMatch(/<h2 id="results-title" tabindex="-1"/);
  });

  it("says why there's nothing when there isn't, with ways forward", () => {
    const html = renderFrame({ kind: "done", view: view([], { notes: ["Your season's over — no trade helps this year."], counts: { screened: 0, exact: 0, simScreen: 0, simFinal: 0 } }) });
    const text = textOf(html);
    expect(text).toContain("No trade ideas right now Your season's over — no trade helps this year.");
    expect(html).toContain('href="/settings"');
    expect(html).not.toContain("<article");
  });

  it("renders the server's first paint as a loading status (the tab's storage isn't read there)", () => {
    expect(renderToStaticMarkup(createElement(TradeFinderPage))).toMatch(/<p role="status"[^>]*><span aria-hidden="true"[^>]*><\/span> Loading your league…<\/p>/);
    expect(renderToStaticMarkup(createElement(AnalyzerPage))).toMatch(/<p role="status"[^>]*><span aria-hidden="true"[^>]*><\/span> Loading your league…<\/p>/);
  });
});

describe("the minimum chance and the pattern note on the Trade Finder (planner reply to Checkpoint 4b, changes 6 and 10)", () => {
  const key = (settings: ReturnType<typeof defaultTradeSettings>) => searchKeyFor({ snapshot, builtAt: "2026-10-01T12:00:00.000Z", myTeamId: "1", settings, partnerId: null });

  it("re-filters, never searches, when only the minimum changes: the search key leaves it out; a goal change (it changes B) searches", () => {
    const d = defaultTradeSettings();
    expect(key({ ...d, minChance: 0.5 })).toBe(key(d));
    expect(key({ ...d, minChance: 0 })).toBe(key(d));
    expect(key({ ...d, goal: "prizes" })).not.toBe(key(d));
    expect(key({ ...d, prizes: { ...d.prizes, first: 50 } })).not.toBe(key(d));
    expect(key({ ...d, maxPerSide: 3 })).not.toBe(key(d));
    // Neither does "Drop from the same position", Waiver upgrades' alone (the final review of Checkpoint 7e, RT-2: switching
    // it on the League page searched again for the same ideas); the untouchables and return weeks do (they reach the trades).
    expect(key({ ...d, waiverSamePosition: false })).toBe(key(d));
    expect(key({ ...d, untouchables: ["101"] })).not.toBe(key(d));
    expect(key({ ...d, returnWeeks: { "101": 9 }, returnWeeksSeason: 2026 })).not.toBe(key(d));
    // Ideas ranked at another minimum need ranking again; a search that stopped before ranking holds for any.
    const ranked = { filter: { minChance: 0.1, qualifying: 12, few: false } };
    expect([needsRefilter(ranked, 0.1), needsRefilter(ranked, 0.3), needsRefilter(ranked, 0), needsRefilter({}, 0.3)]).toEqual([false, true, true, false]);
  });

  it("says a re-filter is under way in the status line, its bar the ranking's alone", () => {
    const state: FinderState = { kind: "searching", progress: progressView({ stage: "rank", done: 2, total: 8 }, "refilter"), onStop: noop, previous: view(), refilter: true };
    expect(finderStatus(state)).toBe("Showing the trade ideas at your minimum chance…");
    const html = renderFrame(state);
    expect(html).toMatch(/aria-valuenow="25" aria-valuetext="Ranking the trade ideas: 2 of 8"/);
    // The ideas being re-ranked stay on screen, dimmed.
    expect(html).toMatch(/<div class="opacity-60 transition-opacity"><section aria-labelledby="results-title"/);
  });

  it("shows a re-filter the worker answers with a new search (a kickoff since) as a search, for good once any other stage shows", () => {
    const step = refilterProgress();
    const start = step(null);
    expect([start.searching, start.view.label, start.view.percent]).toEqual([false, "Ranking the trade ideas", 0]);
    // The ranking alone fills the whole bar.
    expect(step({ stage: "rank", done: 4, total: 8 })).toMatchObject({ searching: false, view: { percent: 50 } });
    // The worker searches afresh: a search's bar from then on, its own ranking near the end (not back to half).
    expect(step({ stage: "screening", done: 0, total: 100 })).toMatchObject({ searching: true, view: progressView({ stage: "screening", done: 0, total: 100 }) });
    expect(step({ stage: "rank", done: 4, total: 8 })).toMatchObject({ searching: true, view: progressView({ stage: "rank", done: 4, total: 8 }) });
    expect(progressView({ stage: "rank", done: 4, total: 8 }).percent).toBeGreaterThan(90);

    // The status line: a re-filter's until the worker searches, then a search's; another run's progress isn't shown.
    const tag = "key|0|min:0.3";
    const refiltering = runShown({ tag, view: progressView({ stage: "rank", done: 1, total: 4 }, "refilter") }, tag, true);
    expect(refiltering.refilter).toBe(true);
    const searching = runShown({ tag, view: progressView({ stage: "exact", done: 3, total: 9 }), searching: true }, tag, true);
    expect(searching.refilter).toBe(false);
    expect(finderStatus({ kind: "searching", progress: searching.view, onStop: noop, previous: null, refilter: searching.refilter })).toBe("Searching for trade ideas: checking the best ideas closely…");
    expect(runShown({ tag: "key|0", view: progressView({ stage: "screening", done: 9, total: 10 }) }, tag, true)).toEqual({ view: progressView(null, "refilter"), refilter: true });
    expect(runShown(null, "key|0", false)).toEqual({ view: progressView(null), refilter: false });
  });

  it("puts the pattern note and the few-ideas line above the list, after what Helps you sums up", () => {
    const pattern = { playerId: "106", count: 7, of: 10, drivers: ["byeCover" as const], text: "Most of your best ideas trade Wiggleton Spoons: his bye is in week 13, your riskiest week." };
    const html = renderFrame({ kind: "done", view: view(undefined, { pattern, filter: { minChance: 0.5, qualifying: 9, few: true } }) });
    const text = textOf(html);
    expect(text).toContain(`2 trade ideas, sorted by Overall. ${pattern.text} Only 2 trade ideas to show at “at least 50%”. Try a lower setting to see more. Trade idea 1`);
    expect(html.indexOf(pattern.text)).toBeLessThan(html.indexOf("<ol"));
    expect(html.indexOf("Helps you (0–100) sums up")).toBeLessThan(html.indexOf(pattern.text));
    // Neither without the search saying so.
    const plain = textOf(renderFrame({ kind: "done", view: view() }));
    expect(plain).not.toContain("Most of your best ideas");
    expect(plain).not.toContain("Try a lower setting");
  });
});

describe("the “Helps both” sort on the Trade Finder (planner reply to Checkpoint 7b, §7)", () => {
  /** Two trades with team 2 that help both teams and one with team 3 that helps only me; the engine's list holds the two. */
  const helpsBothView = (list: TradeEvaluation[], over: Partial<NonNullable<Parameters<typeof searchResult>[1]>> = {}, both = { byChance: 0, lowerWouldAdd: false }) => {
    const mine = withThem(evaluation({ key: "mine", b: 8, pComplete: 0.3, partnerId: "3", get: ["303"] }), 0);
    const trades = [mine, ...list];
    const helpsBoth = { trades: list, qualifying: list.length, byChance: both.byChance, lowerWouldAdd: both.lowerWouldAdd, dropped: { partnerCap: 0, core: 0, filler: 0, givenPlayer: 0 } };
    return buildFinderView({ result: searchResult(trades, { helpsBoth, ...over }), sort: "helpsBoth", snapshot, partnerId: null, fantasyCalc: FC });
  };
  const two = [withThem(evaluation({ key: "x", b: 6 }), 30), withThem(evaluation({ key: "y", b: 3, give: ["105"] }), 12)];

  it("lists the engine's “Helps both” list by Helps you, each card tagged, with the planner's few line, and no pattern note", () => {
    const pattern = { playerId: "106", count: 7, of: 10, drivers: ["byeCover" as const], text: "Most of your best ideas trade Wiggleton Spoons: his bye is in week 13, your riskiest week." };
    const view = helpsBothView(two, { pattern });
    const html = renderFrame({ kind: "done", view });
    const text = textOf(html);
    expect(text).toContain("2 trade ideas that help both teams, sorted by Helps you. Only 2 trades help both teams right now. Trade idea 1");
    expect([...html.matchAll(/<li data-trade-key="([^"]+)">/g)].map((m) => m[1])).toEqual(["x", "y"]);
    expect(html.match(/>Helps both<\/span>/g)).toHaveLength(2);
    expect(text).not.toContain(pattern.text);
    expect(finderStatus({ kind: "done", view })).toBe("Found 2 trade ideas that help both teams.");
    // One: singular; a lower minimum would add more: its suggestion.
    const one = helpsBothView(two.slice(0, 1), {}, { byChance: 2, lowerWouldAdd: true });
    expect(one.few).toBe("Only 1 trade helps both teams right now. Try a lower minimum chance to see more.");
    expect(one.countText).toBe("1 trade idea that helps both teams, sorted by Helps you.");
    expect(one.hidden).toBe("Left out on purpose: 2 trade ideas below your minimum chance.");
  });

  it("says when no trade helps both teams, with the ways forward, as the status line's words", () => {
    const view = helpsBothView([], { filter: { minChance: 0.3, qualifying: 1, few: false } }, { byChance: 1, lowerWouldAdd: true });
    expect(view.empty).toEqual({
      title: "No trades help both teams right now",
      text: ["Try a lower minimum chance to see more.", "Sort by Overall to see the trade ideas that help you.", "Left out on purpose: 1 trade idea below your minimum chance."],
    });
    expect(finderStatus({ kind: "done", view })).toBe("No trades help both teams right now.");
    const html = renderFrame({ kind: "done", view });
    expect(textOf(html)).toContain("No trades help both teams right now Try a lower minimum chance to see more. Sort by Overall to see the trade ideas that help you.");
    expect(html).not.toContain("<article");
  });
});

describe("FinderControls", () => {
  it("labels the partner filter (All teams, then the others) and the sort (Overall first), and says what the settings allow", () => {
    const props = { snapshot, myTeamId: "1", partnerId: "3", onPartner: noop, sort: "helps" as const, onSort: noop, minChance: 0.3, onMinChance: noop, summary: settingsSummary(defaultTradeSettings(), "espn") };
    const html = renderToStaticMarkup(createElement(FinderControls, props));
    expect(html).toContain('<label for="finder-partner" class="text-sm font-bold">Trade partner</label>');
    expect([...html.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => `${m[1]}:${m[2]}`)).toEqual([
      ":All teams",
      "2:Gravel Gophers",
      "3:Quasar Quokkas",
      "4:Tundra Tortoises",
      "overall:Overall",
      "helps:Helps you",
      "accept:Chance they accept",
      // Checkpoint 7c (planner reply to Checkpoint 7b, §7): the fourth sort, last.
      "helpsBoth:Helps both",
      "0:Any",
      "0.1:10%",
      "0.2:20%",
      "0.3:30%",
      "0.4:40%",
      "0.5:50%",
    ]);
    expect(html).toMatch(/<option value="3" selected="">/);
    expect(html).toMatch(/<option value="helps" selected="">/);
    expect(textOf(html)).toContain("Up to 2 players a side. Change in Settings");
    // "Chance they accept: at least" (planner reply to Checkpoint 4b, change 10): a labeled native select, its choice shown.
    expect(html).toContain('<label for="finder-min-chance" class="text-sm font-bold">Chance they accept: at least</label>');
    expect(html).toMatch(/<option value="0.3" selected="">30%<\/option>/);
    expect(html).not.toContain("aria-describedby");
    // In a league that reviews trades, the note that the minimum reads the chance it goes through; a refused save, an alert; both describe the select.
    const noted = renderToStaticMarkup(createElement(FinderControls, { ...props, minChanceNote: minChanceNote("league_vote"), minChanceError: "Your browser wouldn't let Offer Sheet save your settings." }));
    expect(textOf(noted)).toContain("Chance they accept: at least Any 10% 20% 30% 40% 50% Judged on the chance the trade goes through, which a league veto vote can cut.");
    expect(noted).toMatch(/<select id="finder-min-chance" aria-describedby="[^" ]+ [^"]+"/);
    expect(noted).toMatch(/<p id="[^"]+" role="alert" class="[^"]*">Your browser wouldn&#x27;t let Offer Sheet save your settings\.<\/p>/);
  });

  it("says under the sort what “Helps both” shows, the planner's helper line read with the sort, only while it's chosen (planner reply to Checkpoint 7b, §7)", () => {
    const props = { snapshot, myTeamId: "1", partnerId: null, onPartner: noop, onSort: noop, minChance: 0.1, onMinChance: noop, summary: settingsSummary(defaultTradeSettings(), "espn") };
    const html = renderToStaticMarkup(createElement(FinderControls, { ...props, sort: "helpsBoth" }));
    expect(html).toMatch(/<option value="helpsBoth" selected="">Helps both<\/option>/);
    const id = /<select id="finder-sort" aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`<p id="${id}" class="mt-1 text-xs text-muted">Trades that help them too, sorted by how much they help you.</p>`);
    // Right under the sort's select, before the minimum chance.
    expect(html.indexOf("Trades that help them too")).toBeLessThan(html.indexOf("finder-min-chance"));
    // Not under the other sorts.
    for (const sort of ["overall", "helps", "accept"] as const) {
      const other = renderToStaticMarkup(createElement(FinderControls, { ...props, sort }));
      expect(other, sort).not.toContain("Trades that help them too");
      expect(other, sort).not.toMatch(/<select id="finder-sort" aria-describedby=/);
    }
  });

  it("names the league's review under the minimum chance as the cards' veto line does (review of track UIC, finding 5)", () => {
    // An ESPN league with a review period and no veto votes reads as commissioner review: the cards say "Counting the
    // commissioner's review, about 20% it goes through.", so the control names the same review.
    expect(minChanceNote("league_vote")).toBe("Judged on the chance the trade goes through, which a league veto vote can cut.");
    expect(minChanceNote("commissioner")).toBe("Judged on the chance the trade goes through, which the commissioner's review can cut.");
    expect(minChanceNote("none")).toBeNull();
    const vetoed = evaluation({ pAccept: 0.4, pComplete: 0.2, detail: { vetoRisk: true } });
    for (const review of ["league_vote", "commissioner"] as const) {
      const words = minChanceNote(review)?.replace(/^Judged on the chance the trade goes through, which (.*) can cut\.$/, "$1") ?? "";
      expect(buildTradeCard(vetoed, { snapshot: tradeSnapshot({ tradeReview: review }) }).numbers.acceptNote?.toLowerCase()).toContain(`counting ${words},`);
    }
  });
});

describe("TradeCard (§13: each trade card shows)", () => {
  const render = (e = evaluation(), feedback: CardFeedback = NONE, opts: { rank?: number; analyzer?: boolean } = {}) =>
    renderToStaticMarkup(createElement(TradeCard, { card: buildTradeCard(e, { snapshot, fantasyCalc: FC }), rank: opts.rank ?? 1, feedback, onFeedback: saved, showAnalyzerLink: opts.analyzer ?? true }));

  it("shows give and get, the three numbers with Est. and the label, ROS points, the numbers behind them, and the FantasyCalc link after a sentence, never a trade value (planner reply to Checkpoint 7a, 5.4)", () => {
    const html = render(evaluation({ pComplete: 0.4, ros: { received: 142, given: 118 } }));
    const text = textOf(html);
    expect(text).toContain("Trade idea 1 Trade with Gravel Gophers You give Wiggleton Spoons WR · ATL You get Cornelius Snoot RB · HOU");
    expect(html).toMatch(/<dl class="mt-4 grid grid-cols-3 gap-2">/);
    // Each number's label (dt) comes first for screen readers; the number shows above it (flex-col-reverse).
    expect(text).toContain("Helps you 39 Chance they accept 40% Est. · Decent Overall 18");
    expect(html).toContain('<div class="flex min-w-0 flex-col-reverse justify-end rounded-xl bg-surface-muted px-1.5 py-2 text-center"><dt');
    // Helps you's tile alone has a tooltip with its scale (planner reply to Checkpoint 4c, A2).
    const tiles = [...html.matchAll(/<div( title="[^"]*")? class="flex min-w-0 flex-col-reverse[^"]*"><dt[^>]*>([^<]+)<\/dt>/g)].map((m) => [m[2], m[1] ?? null]);
    expect(tiles).toEqual([
      ["Helps you", ' title="63 ≈ as good as adding 3 points a week to your lineup for the rest of the season."'],
      ["Chance they accept", null],
      ["Overall", null],
    ]);
    expect(text).toContain("You get 142 ROS pts, give 118");
    // Phase 4c: my odds right under the three numbers (change 9; the separator is read as a comma). No trade value: the
    // FantasyCalc credit follows a sentence after the facts (planner reply to Checkpoint 7a, 5.4).
    expect(text).toContain("Helps you 39 Chance they accept 40% Est. · Decent Overall 18 Title odds +1 percentage point · , Playoff odds +3 percentage points");
    expect(text).toContain("Their lineup 0 pts a week These numbers weigh each player's trade value. Values: FantasyCalc (opens in a new tab)");
    expect(text).not.toMatch(/Trade value|5,000|5,400/);
    // The arrow is read as "from … to"; each odds kept on one line.
    const withOdds = renderToStaticMarkup(createElement(TradeCard, { card: buildTradeCard(evaluation({ dCH: 0.013, dPO: 0.04 }), { snapshot, baseline: { pPlayoffs: 0.65, pTitle: 0.121 } }), rank: 1, feedback: NONE, onFeedback: saved }));
    expect(withOdds).toContain(
      '<p><span class="whitespace-nowrap"><span class="font-semibold">Title odds</span> <span aria-hidden="true" class="tabular-nums">12.1% → 13.4%</span><span class="sr-only">from 12.1% to 13.4%</span></span><span aria-hidden="true">' + NBSP + '· </span><span class="sr-only">, </span><span class="whitespace-nowrap"><span class="font-semibold">Playoff odds</span> <span aria-hidden="true" class="tabular-nums">65% → 69%</span><span class="sr-only">from 65% to 69%</span></span></p>',
    );
    expect(html).toMatch(/<a href="https:\/\/fantasycalc\.com" target="_blank" rel="noopener" referrerPolicy="origin" class="[^"]*">Values: FantasyCalc/);
  });

  it("lays out “Top 3 odds” between my title and playoff odds under “Several prizes” paying 3rd place, each kept on one line, the arrow read as “from … to” (planner reply to Checkpoint 7b, §6)", () => {
    const e = { ...evaluation({ dCH: 0.007, dPO: 0.03 }), dPrizes: { first: 0.007, second: 0.006, third: 0.007, weeklyHigh: null, pointsLeader: 0 } };
    const baseline = { pPlayoffs: 0.6, pTitle: 0.105, prizes: { first: 0.105, second: 0.09, third: 0.105, weeklyHigh: 0, pointsLeader: 0.1 } };
    const reward = { goal: "prizes" as const, shares: { first: 4 / 9, second: 16 / 45, third: 1 / 5, weeklyHigh: 0, pointsLeader: 0 } };
    const html = renderToStaticMarkup(createElement(TradeCard, { card: buildTradeCard(e, { snapshot, baseline, reward }), rank: 1, feedback: NONE, onFeedback: saved }));
    const item = (label: string, value: string, sr: string) =>
      `<span class="whitespace-nowrap"><span class="font-semibold">${label}</span> <span aria-hidden="true" class="tabular-nums">${value}</span><span class="sr-only">${sr}</span></span>`;
    const dot = `<span aria-hidden="true">${NBSP}· </span><span class="sr-only">, </span>`;
    expect(html).toContain(`<p>${item("Title odds", "10.5% → 11.2%", "from 10.5% to 11.2%")}${dot}${item("Top 3 odds", "30% → 32%", "from 30% to 32%")}${dot}${item("Playoff odds", "60% → 63%", "from 60% to 63%")}</p>`);
    // The lead's line, as the card reads.
    expect(textOf(html)).toContain("Title odds 10.5% → 11.2% from 10.5% to 11.2% · , Top 3 odds 30% → 32% from 30% to 32% · , Playoff odds 60% → 63% from 60% to 63%");
    // "Only the champion": the two lines as before.
    expect(textOf(renderToStaticMarkup(createElement(TradeCard, { card: buildTradeCard(e, { snapshot, baseline }), rank: 1, feedback: NONE, onFeedback: saved })))).not.toContain("Top 3 odds");
  });

  it("tags a card that helps both teams “Helps both” right after its heading, in words, outside it, and shows the partner's line after mine (planner reply to Checkpoint 7b, §7)", () => {
    const baseline = { pPlayoffs: 0.65, pTitle: 0.121 };
    const e = withThem(evaluation({ dCH: 0.013, dPO: 0.04, detail: { winChance: [{ week: 9, before: 0.68, after: 0.64 }] } }), 24);
    const html = renderToStaticMarkup(createElement(TradeCard, { card: buildTradeCard(e, { snapshot, baseline }), rank: 1, feedback: NONE, onFeedback: saved }));
    // The tag: a pill in words after the heading, with why on hover; the heading alone still names the card.
    expect(html).toMatch(
      /<div class="flex flex-wrap items-center gap-x-2 gap-y-1"><h3 id="[^"]+" class="[^"]*">Trade with Gravel Gophers<\/h3><span title="Helps both: this trade helps you, and it helps them too \(Helps them 24\)\." class="shrink-0"><span class="[^"]*bg-brand-soft[^"]*">Helps both<\/span><\/span><\/div>/,
    );
    expect(html).toMatch(/<article aria-labelledby="([^"]+)"[\s\S]*<h3 id="\1"/);
    // The partner's line: after my odds and my weekly line, in the format of mine, the planner's tooltip on "Helps them".
    const them = `<p><span class="whitespace-nowrap" title="${HELPS_THEM_TITLE.replace(/'/g, "&#x27;")}"><span class="font-semibold">Helps them</span> <span class="tabular-nums">24</span></span><span aria-hidden="true">${NBSP}· </span><span class="sr-only">, </span><span class="whitespace-nowrap"><span class="font-semibold">Their title odds</span> <span aria-hidden="true" class="tabular-nums">6.0% → 6.9%</span><span class="sr-only">from 6.0% to 6.9%</span></span><span aria-hidden="true">${NBSP}· </span><span class="sr-only">, </span><span class="whitespace-nowrap"><span class="font-semibold">Their playoff odds</span> <span aria-hidden="true" class="tabular-nums">41% → 45%</span><span class="sr-only">from 41% to 45%</span></span></p>`;
    expect(html).toContain(them);
    expect(html.indexOf("Win chance by week")).toBeLessThan(html.indexOf(them));
    expect(html.indexOf("Playoff odds</span>")).toBeLessThan(html.indexOf("Win chance by week"));
    expect(textOf(html)).toContain("Win chance by week: Week 9: 68% → 64% week 9 from 68% to 64% Helps them 24 · , Their title odds 6.0% → 6.9% from 6.0% to 6.9% · , Their playoff odds 41% → 45% from 41% to 45%");
    // No weekly line for them.
    expect(textOf(html).match(/Win chance by week/g)).toHaveLength(1);
  });

  it("keeps the tag to the cards that help both, says “Helps them 0” when the trade costs them, and shows no line without the partner's numbers", () => {
    const render = (e: ReturnType<typeof evaluation>) => renderToStaticMarkup(createElement(TradeCard, { card: buildTradeCard(e, { snapshot }), rank: 1, feedback: NONE, onFeedback: saved }));
    // Helps them under 10, or 0, or a trade that doesn't help me: their line, no tag.
    for (const [e, helps] of [
      [withThem(evaluation(), config.benefit.helpsThemMin - 1), String(config.benefit.helpsThemMin - 1)],
      [withThem(evaluation(), 0), "0"],
      [withThem(evaluation({ b: -1 }), 30), "30"],
    ] as const) {
      const html = render(e);
      expect(html).not.toContain(">Helps both<");
      expect(textOf(html)).toContain(`Helps them ${helps} · ,`);
      expect(html).toMatch(/<h3 id="[^"]+" class="[^"]*">Trade with Gravel Gophers<\/h3><div class="mt-3 grid/);
    }
    // The veto note stays right under the three numbers (`npm run check:browser` reads it as the <dl>'s next element).
    const vetoed = withThem(evaluation({ pAccept: 0.4, pComplete: 0.2, detail: { vetoRisk: true } }), 24);
    const card = buildTradeCard(vetoed, { snapshot: tradeSnapshot({ tradeReview: "league_vote" }) });
    expect(renderToStaticMarkup(createElement(TradeCard, { card, rank: 1, feedback: NONE, onFeedback: saved }))).toMatch(
      /<\/dl><p class="mt-2 text-sm text-muted">Counting a league veto vote, about 20% it goes through\.<\/p><div class="mt-2 space-y-0\.5 text-sm">/,
    );
    // At exactly 10 the tag shows.
    expect(render(withThem(evaluation(), config.benefit.helpsThemMin))).toContain(">Helps both<");
    // Without the partner's numbers, or without a Helps them: neither.
    for (const e of [evaluation(), withThem(evaluation(), null)]) {
      const html = render(e);
      expect(html).not.toContain("Helps them");
      expect(html).not.toContain(">Helps both<");
    }
    // A Plan B box shows neither, whatever its card.
    const planB = { proposal: { partnerId: "2", give: [{ kind: "player" as const, id: "105" }], get: [{ kind: "player" as const, id: "203" }] }, key: "2|give:105|get:203", b: 2, tradeScore: 28, pAccept: 0.4, pComplete: 0.4, acceptLabel: "Decent", overall: 13, kind: "otherTarget" as const, dPO: 0.02, dCH: 0.01 };
    const boxed = render(withThem(evaluation({ planB }), 24));
    const box = boxed.slice(boxed.indexOf(PLAN_B_HTML));
    expect(box).toContain("Title odds");
    expect(box).not.toContain("Helps them");
    expect(box).not.toContain("Helps both");
  });

  it("keeps the chance it goes through right under the three numbers, before the odds (`npm run check:browser` reads it as the numbers' next element)", () => {
    const vetoed = evaluation({ pAccept: 0.4, pComplete: 0.2, detail: { vetoRisk: true } });
    const card = buildTradeCard(vetoed, { snapshot: tradeSnapshot({ tradeReview: "league_vote" }), fantasyCalc: FC });
    const html = renderToStaticMarkup(createElement(TradeCard, { card, rank: 1, feedback: NONE, onFeedback: saved }));
    expect(html).toMatch(/<\/dl><p class="mt-2 text-sm text-muted">Counting a league veto vote, about 20% it goes through\.<\/p><div class="mt-2 space-y-0\.5 text-sm"><p>[^]*Title odds/);
    // Under 5%, it says so in words ("<5%" is the big number's short form).
    const under = buildTradeCard(evaluation({ pAccept: 0.08, pComplete: 0.04, detail: { vetoRisk: true } }), { snapshot: tradeSnapshot({ tradeReview: "league_vote" }), fantasyCalc: FC });
    expect(under.numbers.acceptNote).toBe("Counting a league veto vote, under 5% it goes through.");
  });

  it("lists the risk flags apart from the numbers, in words with a symbol (not color alone)", () => {
    const html = render(evaluation({ gMine: -0.2, flags: { marketCheck: true, hiddenByMarket: false, hiddenByBenefit: false, injured: ["107"] } }));
    expect(html).toMatch(
      /<ul aria-label="Risks"[^>]*><li[^>]*><span aria-hidden="true"[^>]*>⚠<\/span><span[^>]*>Depends on an injured player: Humbert Fiddlesticks \(injured reserve\)\. His projection assumes he returns at full strength, blended with the trade market\.<\/span><\/li><li[^>]*>.*Market check: counting roster spots, you&#x27;d give up more trade value than you get\./,
    );
    expect(render()).not.toContain('aria-label="Risks"');
  });

  it("says a hurt player I'd get twice, not four times: his tag, and the flag with what his projection assumes (review of Phase 4b)", () => {
    // I get the IR WR (107), whom the flag names, and the Doubtful RB (206), whom no flag names; explain.ts's caveat
    // repeating the flag isn't shown.
    const caveat = "Depends on injured players: Humbert Fiddlesticks (on injured reserve), and the numbers assume they return as expected.";
    const html = render(
      evaluation({
        give: ["105"],
        get: ["107", "206"],
        flags: { marketCheck: false, hiddenByMarket: false, hiddenByBenefit: false, injured: ["107"] },
        reasons: ["Your WR2 spot goes from 9.1 to 14.3 projected points per week.", caveat],
      }),
    );
    const text = textOf(html);
    expect(text).toContain("Depends on an injured player: Humbert Fiddlesticks (injured reserve). His projection assumes he returns at full strength, blended with the trade market.");
    expect(text).toContain("Rupert Wimbleton: his projection assumes he returns at full strength, blended with the trade market.");
    expect(text).not.toContain("Humbert Fiddlesticks: his projection");
    // (Not the caveat's words; Checkpoint 7e's heading over the roster moves, "Roster moves these numbers assume", is another.)
    expect(text).not.toContain("the numbers assume they return");
    expect(text.match(/Humbert Fiddlesticks/g)).toHaveLength(2);
    expect(text).toContain("Why Your WR2 spot goes from 9.1 to 14.3 projected points per week.");
  });

  it("says the roster moves the numbers assume, the reasons, and the pitch behind a 44 px summary with a 44 px Copy button", () => {
    const html = render(evaluation({ required: { me: { drops: ["108"], adds: [] }, partner: { drops: [], adds: [] } } }));
    const text = textOf(html);
    // An evaluation without myMoves (made before Checkpoint 7e): today's words under the new heading.
    expect(text).toContain("Roster moves these numbers assume You'd drop Tobias Thimble (TE, JAX) to stay within your roster limits.");
    // Checkpoint 7e (planner reply to Checkpoint 7d, item 2.2): every move in order with its reason, and the moves made either way.
    const listed = textOf(render({ ...evaluation(), myMoves: { moves: [{ kind: "makeRoom", week: 6, drop: ["108"], for: ["204"] }], assumed: [{ add: "901", drop: "105" }] } }));
    expect(listed).toContain("Roster moves these numbers assume Make room for Cornelius Snoot: drop Tobias Thimble (TE). Assumed with or without this trade: add Floopy Freeman, drop Glimmer Oddfellow.");
    expect(text).toContain("Why Your RB2 spot goes from 9.1 to 14.3 projected points per week.");
    expect(html).toMatch(/<details class="[^"]*"><summary class="flex min-h-11[^"]*"><span>Message to send them<span class="sr-only"> \(trade idea 1, Trade with Gravel Gophers\)<\/span><\/span><span aria-hidden="true" class="text-muted">▾<\/span><\/summary>/);
    expect(html).toContain("Hey! Want Wiggleton Spoons for Cornelius Snoot?");
    expect(html).toMatch(/<div class="mt-2 \[&amp;&gt;button\]:min-h-11"><button type="button" class="[^"]*" aria-live="polite">Copy message<\/button><\/div>/);
  });

  it("links to the Analyzer with the trade (not from the Analyzer itself)", () => {
    expect(render()).toMatch(/<a class="[^"]*min-h-11[^"]*" href="\/analyzer\?partner=2&amp;give=106&amp;get=204">Open in Analyzer<span class="sr-only"> \(trade idea 1, Trade with Gravel Gophers\)<\/span><\/a>/);
    expect(render(evaluation(), NONE, { analyzer: false })).not.toContain("Open in Analyzer");
  });

  it("has the outcome buttons (toggles) and Report; the pressed one is marked by a ring and a check, not color alone", () => {
    const html = render(evaluation(), { ...NONE, outcome: "accepted" });
    const buttons = [...html.matchAll(/<button type="button" aria-pressed="(true|false)" class="([^"]*)">(.*?)<\/button>/g)].map(([, pressed, cls = "", inner = ""]) => ({ pressed, ring: cls.includes("ring-2"), text: textOf(inner) }));
    expect(buttons).toEqual([
      { pressed: "false", ring: false, text: "Sent (trade idea 1, Trade with Gravel Gophers)" },
      { pressed: "true", ring: true, text: "✓ Accepted (trade idea 1, Trade with Gravel Gophers)" },
      { pressed: "false", ring: false, text: "Rejected (trade idea 1, Trade with Gravel Gophers)" },
      { pressed: "false", ring: false, text: "Countered (trade idea 1, Trade with Gravel Gophers)" },
    ]);
    expect(html).toMatch(/<div role="group" aria-labelledby="[^"]+" class="[^"]*">/);
    expect(html).toMatch(/<button type="button" aria-expanded="false" class="[^"]*min-h-11[^"]*">Report a problem<span class="sr-only"> with trade idea 1, Trade with Gravel Gophers<\/span><\/button>/);
  });

  it("reads a saved report back with Undo instead of Report", () => {
    const html = render(evaluation(), { ...NONE, report: { reason: "never-accept", note: "too lopsided" } });
    expect(textOf(html)).toContain("Reported: They'd never accept · “too lopsided” Undo the report on trade idea 1, Trade with Gravel Gophers");
    expect(html).not.toContain("Report a problem");
  });

  it("gives every button and non-text link a 44 px target", () => {
    const planB = { proposal: { partnerId: "2", give: [{ kind: "player" as const, id: "105" }], get: [{ kind: "player" as const, id: "203" }] }, key: "2|give:105|get:203", b: 2, tradeScore: 28, pAccept: 0.4, pComplete: 0.4, acceptLabel: "Decent", overall: 13, kind: "otherTarget" as const };
    const html = render(evaluation({ planB, required: { me: { drops: ["108"], adds: [] }, partner: { drops: [], adds: [] } } }), { ...NONE, outcome: "sent" });
    // Both messages (the card's and its Plan B's) and both Open in Analyzer links are counted.
    expect(targets(html).filter((t) => t.text.startsWith("Open in Analyzer"))).toHaveLength(2);
    expect(html.match(/<summary class="flex min-h-11/g)).toHaveLength(2);
    const small = targets(html).filter((t) => !t.cls.includes("min-h-11") && !t.text.startsWith("Values: FantasyCalc") && t.tag !== "button");
    expect(small).toEqual([]);
    for (const t of targets(html).filter((x) => x.tag === "button" && x.text !== "Copy message")) expect(t.cls, t.text).toContain("min-h-11");
  });

  it("uses no jargon on the card", () => {
    const text = textOf(render(evaluation({ gMine: -0.2, dDyn: 300 })));
    for (const jargon of [" EV ", "σ", "V*", "g_mkt", "NaN", "undefined"]) expect(text).not.toContain(jargon);
  });

  it("marks a player I'd get 'Harder to get' with a gold pill in words, why on hover and for screen readers (planner addendum to Checkpoint 3, §2)", () => {
    const html = render(evaluation({ get: ["202", "204"], detail: { premium: [GLOOP_PREMIUM, SNOOT_PREMIUM] } }));
    const why = "Harder to get: their most valuable player and one of the top 12 players by trade value, so expect them to want a little extra for him.";
    // Review of the addendum: the why lived only in a title, which touch screens can't hover and screen readers don't
    // reliably read. Screen readers now hear it in full in place of the pill's two words (not both: it isn't said twice).
    expect(html).toContain(
      `<li class="min-w-0"><span class="font-extrabold break-words">Mortimer Gloop</span> <span title="${why}"><span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap bg-accent text-navy align-middle"><span aria-hidden="true">Harder to get</span></span><span class="sr-only">${why}</span></span><span class="block text-xs text-muted">RB · DET</span></li>`,
    );
    expect(html.match(/>Harder to get<\/span>/g)).toHaveLength(1);
    expect(textOf(html)).toContain(`You get Mortimer Gloop Harder to get ${why} RB · DET Cornelius Snoot RB · HOU`);
    // A tagged player who is hurt: the pill by his name, his injury tag in words under his position (Phase 4b).
    const hurt = render(evaluation({ get: ["206"], detail: { premium: [{ playerId: "206", e: 0.2, rank: 1, elite: true, harderToGet: true }] } }));
    expect(hurt).toMatch(
      /<span class="font-extrabold break-words">Rupert Wimbleton<\/span> <span title="Harder to get: [^"]*"><span class="[^"]*bg-accent[^"]*"><span aria-hidden="true">Harder to get<\/span><\/span><span class="sr-only">Harder to get: [^<]*<\/span><\/span><span class="block text-xs text-muted">RB · PIT<\/span><span class="[^"]*bg-warn-bg text-warn-fg">Doubtful<\/span>/,
    );
  });

  it("tags every hurt player on either side in words under his name (a tint that wraps, never color alone), and says once why a hurt player I'd get still counts (planner reply to Checkpoint 4, change 6)", () => {
    // I give the Questionable RB (103) and get the IR WR (107).
    const html = render(evaluation({ give: ["103"], get: ["107"] }));
    expect(html).toContain('<span class="mt-0.5 inline-block rounded-md px-1.5 py-0.5 text-xs font-bold break-words bg-warn-bg text-warn-fg">Questionable</span>');
    expect(html).toContain('<span class="mt-0.5 inline-block rounded-md px-1.5 py-0.5 text-xs font-bold break-words bg-danger-bg text-danger-fg">On IR</span>');
    // The sentence sits under the two lists, before the three numbers.
    const note = "Humbert Fiddlesticks: his projection assumes he returns at full strength, blended with the trade market.";
    expect(html).toContain(`<p class="mt-2 text-xs leading-relaxed break-words text-muted">${note}</p>`);
    expect(html.indexOf(note)).toBeLessThan(html.indexOf(">Helps you</dt>"));
    // A healthy card has neither.
    expect(render()).not.toContain("inline-block rounded-md");
    expect(render()).not.toContain("full strength");
  });

  it("shows 'If they won't move: try …' after the card's own content: the other trade, its kind, its numbers, its own message and its own 44 px Open in Analyzer (planner reply to Checkpoint 4, change 6; its heading since Checkpoint 7e)", () => {
    const planB = { proposal: { partnerId: "2", give: [{ kind: "player" as const, id: "105" }], get: [{ kind: "player" as const, id: "203" }] }, key: "2|give:105|get:203", b: 2, tradeScore: 28, pAccept: 0.4, pComplete: 0.4, acceptLabel: "Decent", overall: 13, kind: "otherTarget" as const };
    const html = render(evaluation({ planB, flags: { marketCheck: false, hiddenByMarket: false, hiddenByBenefit: false, injured: ["204"] } }));
    const text = textOf(html);
    const which = "(if they won't move: Glimmer Oddfellow for Ignatius Fumblewick; trade idea 1, Trade with Gravel Gophers)";
    expect(text).toContain(
      `If they won't move: try … A different set of their players You give: Glimmer Oddfellow You get: Ignatius Fumblewick Helps you 28 · Chance they accept 40% (Est. · Decent) · Overall 13 Message to send them ${which} ▾ Thanks for considering it! Would you trade Ignatius Fumblewick for Glimmer Oddfellow instead? Let me know what you think! Copy message Open in Analyzer ${which}`,
    );
    // Review of Phase 4b: after the card's flags, facts, reasons, message and Open in Analyzer (a flag about the card's
    // player sat right under a Plan B that didn't include him), and before the feedback buttons.
    const at = html.indexOf(PLAN_B_HTML);
    for (const before of ['aria-label="Risks"', "You get 120 ROS pts", ">Why<", "Hey! Want Wiggleton Spoons for Cornelius Snoot?", 'href="/analyzer?partner=2&amp;give=106&amp;get=204"']) expect(html.indexOf(before), before).toBeLessThan(at);
    expect(at).toBeLessThan(html.indexOf("What happened with it?"));
    // Each number on one line; the estimate's label can wrap apart from its number (a 320 px phone).
    expect(html).toContain(
      '<p class="mt-1 font-semibold"><span class="whitespace-nowrap">Helps you 28</span>' + NBSP + '· <span class="whitespace-nowrap">Chance they accept 40%</span> <span class="whitespace-nowrap">(Est. · Decent)</span>' + NBSP + '· <span class="whitespace-nowrap">Overall 13</span></p>',
    );
    // Its link says it comes from Plan B (the Analyzer then shows it as one offer).
    expect(html).toMatch(/<a class="[^"]*min-h-11[^"]*" href="\/analyzer\?partner=2&amp;give=105&amp;get=203&amp;from=planB">Open in Analyzer<span class="sr-only">/);
    // Its message's summary and Copy are 44 px targets.
    expect(html).toMatch(/<summary class="flex min-h-11[^"]*"><span>Message to send them<span class="sr-only"> \(if they won&#x27;t move:/);
    // Not on a card without one, and the Analyzer's card shows no link.
    expect(render()).not.toContain(PLAN_B_HTML);
    expect(html).not.toContain("If they say no");
    expect(render(evaluation({ planB }), NONE, { analyzer: false })).not.toContain("Open in Analyzer");
    // Review of track F: its injured players carry their tags in words, and a Plan B that is a card of its own says so.
    const hurt = render(evaluation({ planB: { ...planB, proposal: { ...planB.proposal, get: [{ kind: "player", id: "206" }] }, key: "2|give:105|get:206" } }));
    expect(textOf(hurt)).toContain("You get: Rupert Wimbleton (Doubtful)");
    const list = buildFinderView({ result: searchResult([evaluation({ planB: { ...planB, key: "2|give:105|get:204" } }), evaluation({ key: "2|give:105|get:204", give: ["105"], b: 1, pComplete: 0.5 })]), sort: "overall", snapshot, partnerId: null });
    const withAlso = renderToStaticMarkup(createElement(TradeCard, { card: list.cards[0] as TradeCardView, rank: 1, feedback: NONE, onFeedback: saved }));
    expect(withAlso).toContain('<p class="text-muted">Also shown as trade idea 2.</p>');
    // Phase 4c (change 9): a Plan B with its own odds shows them as the card shows its own, after its numbers and the veto
    // note, before "Also shown as" and its message; the arrow is read as "from … to"; a Plan B without odds shows none.
    const odds = { ...planB, dPO: 0.04, dCH: 0.013, winChance: [{ week: 9, before: 0.68, after: 0.64 }, { week: 13, before: 0.42, after: 0.55 }] };
    const boxed = renderToStaticMarkup(
      createElement(TradeCard, { card: buildTradeCard(evaluation({ planB: odds }), { snapshot, baseline: { pPlayoffs: 0.65, pTitle: 0.121 } }), rank: 1, feedback: NONE, onFeedback: saved }),
    );
    const box = boxed.slice(boxed.indexOf(PLAN_B_HTML));
    expect(textOf(box)).toContain(
      "Helps you 28 · Chance they accept 40% (Est. · Decent) · Overall 13 Title odds 12.1% → 13.4% from 12.1% to 13.4% · , Playoff odds 65% → 69% from 65% to 69% Win chance by week: Week 9: 68% → 64% week 9 from 68% to 64% · , Week 13: 42% → 55% week 13 from 42% to 55% Message to send them",
    );
    expect(box).toContain('<span class="font-semibold">Title odds</span> <span aria-hidden="true" class="tabular-nums">12.1% → 13.4%</span><span class="sr-only">from 12.1% to 13.4%</span>');
    expect(textOf(html.slice(html.indexOf(PLAN_B_HTML)))).not.toContain("Title odds");
    // Final review of Phase 4c, finding PAGES-7: every separator keeps its dot with the item before it (a no-break space
    // before the dot), so a wrapped line never starts with "· Week 13"; the weekly line's included.
    expect(box).toContain(`<span aria-hidden="true" class="whitespace-nowrap tabular-nums">Week 9: 68% → 64%</span><span class="sr-only">week 9 from 68% to 64%</span><span aria-hidden="true">${NBSP}· </span>`);
    expect(boxed).not.toMatch(/> · </);
    // Checkpoint 7e (planner reply to Checkpoint 7d, item 2.2: "a Plan B box when it has moves"): the roster moves its numbers
    // assume, under its odds and before its message.
    const moved = renderToStaticMarkup(
      createElement(TradeCard, {
        card: buildTradeCard(evaluation({ planB: { ...odds, myMoves: { moves: [{ kind: "makeRoom", week: 6, drop: ["108"], for: ["203"] }], assumed: [] } } }), { snapshot, baseline: { pPlayoffs: 0.65, pTitle: 0.121 } }),
        rank: 1,
        feedback: NONE,
        onFeedback: saved,
      }),
    );
    expect(textOf(moved.slice(moved.indexOf(PLAN_B_HTML)))).toContain("week 13 from 42% to 55% Roster moves these numbers assume Make room for Ignatius Fumblewick: drop Tobias Thimble (TE). Message to send them");
    // Review of wave B (findings B-4, either-way-before-unexplained): odds that start from the trade's own "before" (its
    // either-way moves) say so right under them, on the card and on a Plan B box.
    const before = { pPlayoffs: 0.66, pTitle: 0.125, prizes: { first: 0.125, second: null, third: null, weeklyHigh: 0, pointsLeader: 0 } };
    const own = renderToStaticMarkup(
      createElement(TradeCard, {
        card: buildTradeCard({ ...evaluation({ dPO: 0.04, dCH: 0.013, planB: { ...odds, before } }), before }, { snapshot, baseline: { pPlayoffs: 0.65, pTitle: 0.121 } }),
        rank: 1,
        feedback: NONE,
        onFeedback: saved,
      }),
    );
    const ownText = textOf(own);
    expect(ownText).toContain("from 66% to 70% This idea's odds start from your odds with the moves it assumes with or without this trade.");
    expect(textOf(own.slice(own.indexOf(PLAN_B_HTML)))).toContain("week 13 from 42% to 55% This idea's odds start from your odds with the moves it assumes with or without this trade. Message to send them");
    expect(textOf(boxed)).not.toContain("This idea's odds start from");
  });

  it("Checkpoint 7e (planner reply to Checkpoint 7d, item 4.1): “How to offer it”, a closed 44 px disclosure right under the odds, on a card that helps me when the page can work its offers out", () => {
    const offered = (e = evaluation(), onOffers: (() => Promise<LadderView>) | undefined = () => new Promise<LadderView>(() => {})) =>
      renderToStaticMarkup(createElement(TradeCard, { card: buildTradeCard(e, { snapshot, fantasyCalc: FC }), rank: 1, feedback: NONE, onFeedback: saved, onOffers }));
    const html = offered();
    expect(html).toMatch(
      /<details class="mt-3 rounded-xl border border-line"><summary class="flex min-h-11 items-center justify-between gap-2 px-3 text-sm font-bold"><span>How to offer it<span class="sr-only"> \(trade idea 1, Trade with Gravel Gophers\)<\/span><\/span><span aria-hidden="true" class="text-muted">▾<\/span><\/summary>/,
    );
    expect(html).not.toMatch(/<details[^>]* open/);
    // Under the numbers and the odds, before the risk flags and the reasons (where Phase 4's steps were).
    expect(html.indexOf("How to offer it")).toBeGreaterThan(html.indexOf(">Overall</dt>"));
    expect(html.indexOf("How to offer it")).toBeLessThan(html.indexOf("You get 120 ROS pts"));
    // Closed and never opened: nothing asked yet, so nothing but its status line inside.
    expect(textOf(html.slice(html.indexOf("How to offer it"), html.indexOf("You get 120 ROS pts")))).toBe("How to offer it (trade idea 1, Trade with Gravel Gophers) ▾");
    // Without the page's engine (a test, a page that gives none), on a trade that doesn't help me, or the old steps: none.
    expect(render()).not.toContain("How to offer it");
    expect(offered(evaluation({ b: -0.5 }))).not.toContain("How to offer it");
    expect(offered(steppedFull())).not.toContain("Offer first:");
  });

  it("Checkpoint 7e: the opened “How to offer it” in each state: working them out, the offers in order with their own messages, the trade alone, a failure with Try again", () => {
    const base = evaluation({ b: 3, pAccept: 0.3, pComplete: 0.3 });
    const open = evaluation({ get: ["202", "204"], b: 4.2, pAccept: 0.15, pComplete: 0.15 });
    const last = evaluation({ give: ["106", "108"], b: 2.7, pAccept: 0.4, pComplete: 0.4, required: { me: { drops: [], adds: [] }, partner: { drops: ["205"], adds: [] } } });
    const c = buildTradeCard(base, { snapshot });
    const ladder = buildLadderView(
      {
        cardKey: base.key,
        steps: [
          { kind: "open", evaluation: open, message: "Hey! Would you trade Mortimer Gloop and Cornelius Snoot for Wiggleton Spoons?" },
          { kind: "suggested", evaluation: base, message: "Thanks for considering it! Would you trade Cornelius Snoot for Wiggleton Spoons instead? Let me know what you think!" },
          { kind: "last", evaluation: last, message: "Thanks for considering it! Would you trade Cornelius Snoot for Wiggleton Spoons and Tobias Thimble instead? Let me know what you think!" },
        ],
      },
      c,
      { snapshot },
    );
    const panel = (state: OffersState) => renderToStaticMarkup(createElement(OffersPanel, { state, name: "trade idea 1, Trade with Gravel Gophers", onRetry: noop }));
    // One status line, always there, so each change is announced: empty until asked, then working them out with a spinner.
    expect(panel({ kind: "idle" })).toBe('<p role="status" tabindex="-1" class="sr-only scroll-my-4"></p>');
    expect(panel({ kind: "loading" })).toBe(`<p role="status" tabindex="-1" class="flex items-center gap-2 font-semibold text-muted scroll-my-4"><span aria-hidden="true" class="inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent"></span> ${OFFERS_LOADING_TEXT}</p>`);
    expect(OFFERS_LOADING_TEXT).toBe("Working out the offers…");
    // The offers, in order: label and players, Helps you and the chance with its label (each kept on one line), the roster
    // moves that aren't the card's, and each offer's own message behind its own 44 px summary with a 44 px Copy.
    const done = panel({ kind: "done", ladder });
    const text = textOf(done);
    expect(text).toContain(
      "Offer them in order: if they say no, try the next. Open with: Wiggleton Spoons for Mortimer Gloop and Cornelius Snoot Helps you 50 · Chance they accept 15% (Est. · Possible) Message to send them (Open with: Wiggleton Spoons for Mortimer Gloop and Cornelius Snoot; trade idea 1, Trade with Gravel Gophers) ▾ Hey! Would you trade Mortimer Gloop and Cornelius Snoot for Wiggleton Spoons? Copy message",
    );
    expect(text).toContain("Last offer: Wiggleton Spoons and Tobias Thimble for Cornelius Snoot Helps you 36 · Chance they accept 40% (Est. · Decent) Roster moves these numbers assume Gravel Gophers would drop Percival Plunk (WR, LAR) to stay within their roster limits. Message to send them");
    expect(done).toMatch(/^<p role="status" tabindex="-1" class="font-semibold scroll-my-4">Offer them in order: if they say no, try the next\.<\/p><ol class="mt-2 list-decimal space-y-3 pl-5"><li class="break-words" data-offer-key="[^"]+">/);
    expect(done.match(/<li class="break-words" data-offer-key="[^"]+"><p><span class="font-semibold">/g)).toHaveLength(3);
    expect(done).toContain('<p class="font-semibold"><span class="whitespace-nowrap">Helps you 50</span>' + NBSP + '· <span class="whitespace-nowrap">Chance they accept 15%</span> <span class="whitespace-nowrap">(Est. · Possible)</span></p>');
    expect(done.match(/<summary class="flex min-h-11[^"]*"><span>Message to send them/g)).toHaveLength(3);
    expect(done.match(/>Copy message<\/button>/g)).toHaveLength(3);
    // The suggested trade alone: the status line says to offer it as it is, and no list.
    const alone = buildLadderView({ cardKey: base.key, steps: [{ kind: "suggested", evaluation: base, message: "x" }] }, c, { snapshot });
    expect(panel({ kind: "done", ladder: alone })).toBe('<p role="status" tabindex="-1" class="font-semibold scroll-my-4">Offer this trade as it is: no version of it with Gravel Gophers makes a better first offer.</p>');
    // No offer at all (the review of wave D, UI-D-8): the trade can't be worked out, no list, no Try again (asking again gives the same).
    const none = buildLadderView({ cardKey: base.key, steps: [] }, c, { snapshot });
    expect(panel({ kind: "done", ladder: none })).toBe(`<p role="status" tabindex="-1" class="font-semibold scroll-my-4">${OFFERS_NONE_TEXT.replace(/'/g, "&#x27;")}</p>`);
    // A failure: an alert, and a 44 px Try again named for screen readers.
    const failed = panel({ kind: "failed" });
    expect(failed).toContain(`<div role="alert" class="rounded-xl border px-4 py-3 text-sm leading-relaxed border-danger-line bg-danger-bg text-danger-fg"><div>${OFFERS_FAILED_TEXT.replace(/'/g, "&#x27;")}</div></div>`);
    expect(failed).toMatch(/<button type="button" class="[^"]*min-h-11[^"]*">Try again<span class="sr-only"> \(how to offer trade idea 1, Trade with Gravel Gophers\)<\/span><\/button>/);
    // Every button and link in it is a 44 px target.
    for (const t of targets(done)) expect(t.cls, t.text).toContain("min-h-11");
    // Once the offers are in, they're the versions the feedback asks about, with Plan B's after them.
    expect(cardVersions(c, ladder).map((v) => v.version)).toEqual(["open", "suggested", "last"]);
  });
});

describe("HowToRead (planner addendum to Checkpoint 3)", () => {
  const how = (leagueType?: "redraft" | "keeper" | "dynasty", page?: "finder" | "analyzer") => textOf(renderToStaticMarkup(createElement(HowToRead, { leagueType, page })));
  const HARDER = "Harder to get marks a player you'd get who is one of their two most valuable players and one of the top 12 players by trade value: managers want a little extra for players like that, and the chance they accept counts it.";

  it("says Helps you weighs title and playoff odds by what the league rewards, and that the card shows them with the weeks that move (planner reply to Checkpoint 4b, changes 8 and 9; 7a, 5.2)", () => {
    for (const page of ["finder", "analyzer"] as const) {
      expect(how(undefined, page)).toContain(
        "Helps you (0–100) is how much the trade raises your chances this season: Offer Sheet plays out the rest of your season thousands of times with and without it, and weighs your title and playoff odds by your “What does your league reward?” setting in Settings (“Only the champion” unless you change it). Each card shows those odds before and after the trade, and the weeks whose chance to win your game moves by 3 percentage points or more (up to 4 weeks, the drops first, then the biggest gains).",
      );
      expect(how(undefined, page)).not.toContain("What matters most");
    }
    expect(weeklyLineWords()).toBe(`by ${Math.round(config.explain.weeklyLineMin * 100)} percentage points or more (up to ${config.explain.weeklyLineMax} weeks, the drops first, then the biggest gains)`);
    expect(weeklyLineWords(0.01, 1)).toBe("by 1 percentage point or more (up to 1 week, the drops first, then the biggest gains)");
  });

  it("names the league's prizes under “Several prizes” paying more than 1st place, by the reward or else the scale the page passes, never the word “goal” (planner reply to Checkpoint 7b, §6; ⚠️ ours)", () => {
    const prizes =
      "Helps you (0–100) is how much the trade raises your chances this season: Offer Sheet plays out the rest of your season thousands of times with and without it, and weighs your chances at your league's prizes and your playoff odds by your “What does your league reward?” setting in Settings (“Only the champion” unless you change it).";
    const reward = { goal: "prizes" as const, shares: { first: 4 / 9, second: 16 / 45, third: 1 / 5, weeklyHigh: 0, pointsLeader: 0 } };
    const read = (props: Record<string, unknown>) => textOf(renderToStaticMarkup(createElement(HowToRead, props)));
    for (const page of ["finder", "analyzer"] as const) {
      expect(read({ page, reward })).toContain(prizes);
      expect(read({ page, reward })).not.toMatch(/goals?/i);
    }
    // The pages pass the scale: "Several prizes" paying more than 1st place names its odds "prizes" (benefit.ts helpsScale).
    const scale = { b3: 4.65, raw: 4.65, floored: false, odds: 5, oddsNamed: "prizes" as const, lambda: null, f10: null, gainReads: 63, futureReads: null, reason: null };
    expect(read({ helpsScale: scale })).toContain(prizes);
    // "Only the champion" (or 1st place alone under "Several prizes"): the title's words, as before.
    expect(read({ reward: { goal: "title", shares: { first: 1, second: 0, third: 0, weeklyHigh: 0, pointsLeader: 0 } } })).toContain("and weighs your title and playoff odds by your “What does your league reward?” setting");
    expect(read({ reward: { ...reward, shares: { first: 1, second: 0, third: 0, weeklyHigh: 0, pointsLeader: 0 } }, helpsScale: scale })).toContain("and weighs your title and playoff odds by");
  });

  it("names the odds each card shows after the league's prizes, never “those odds”: a weekly high score or the points title has no odds line (review of the prizes UI, prizes-ui-6)", () => {
    const read = (props: Record<string, unknown>) => textOf(renderToStaticMarkup(createElement(HowToRead, props)));
    const shows = (odds: string) => `Each card shows ${odds} before and after the trade, and the weeks whose chance to win your game moves`;
    const shares = (o: Partial<Record<"first" | "second" | "third" | "weeklyHigh" | "pointsLeader", number>>) => ({ first: 0, second: 0, third: 0, weeklyHigh: 0, pointsLeader: 0, ...o });
    // By the reward: the card's own lines (tradeView.ts oddsViews).
    expect(read({ reward: { goal: "prizes", shares: shares({ first: 4 / 9, second: 16 / 45, third: 1 / 5 }) } })).toContain(shows("your title, top-3 and playoff odds"));
    expect(read({ reward: { goal: "prizes", shares: shares({ first: 0.6, second: 0.4 }) } })).toContain(shows("your title, top-2 and playoff odds"));
    for (const paid of [{ first: 0.8, weeklyHigh: 0.2 }, { first: 0.9, pointsLeader: 0.1 }]) expect(read({ reward: { goal: "prizes", shares: shares(paid) } })).toContain(shows("your title and playoff odds"));
    // The scale alone (what the pages pass): the top-N line's rule in words.
    const scale = { b3: 4.65, raw: 4.65, floored: false, odds: 5, oddsNamed: "prizes" as const, lambda: null, f10: null, gainReads: 63, futureReads: null, reason: null };
    expect(read({ helpsScale: scale })).toContain(shows("your title and playoff odds (and your top-3 odds when your league pays 3rd place, or your top-2 odds when it pays 2nd)"));
    // The title's words: "those odds", as before.
    expect(read({})).toContain(shows("those odds"));
    expect(read({ reward: { goal: "title", shares: shares({ first: 1 }) } })).toContain(shows("those odds"));
  });

  it("says Helps you's scale whatever the league rewards, the mix with long-term value in dynasty and keeper leagues, and that a note says so only when the floor note shows (planner reply to Checkpoint 4c, A2; 7a, §2 question 6 and 5.2)", () => {
    const words = "Whatever your league rewards, 63 is about as good as adding 3 points a week to your lineup for the rest of the season (28 for 1 point a week, 86 for 6).";
    const note = " When that doesn't hold for your team right now, a note on the page says so.";
    expect(helpsScaleWords()).toBe(words);
    for (const page of ["finder", "analyzer"] as const) expect(how("redraft", page)).toContain(words);
    // Dynasty and keeper leagues with long-term values: the mix, by the Win now ↔ Future setting.
    for (const leagueType of ["keeper", "dynasty"] as const) {
      const mix = `In a ${leagueType} league, 63 is about as good as adding 3 points a week to your lineup this season together with 10% more long-term value for your roster, weighed by your Win now ↔ Future setting.`;
      expect(helpsScaleWords({ leagueType })).toBe(mix);
      for (const page of ["finder", "analyzer"] as const) expect(how(leagueType, page)).toContain(mix);
      // Without long-term values: this season only, as in a redraft league.
      expect(helpsScaleWords({ leagueType, longTermOn: false })).toBe(words);
    }
    // With the search's or the evaluation's scale: what each part alone reads, and its ends.
    const scale = (lambda: number | null, o: { gainReads?: number; futureReads?: number | null; reason?: "odds" | null } = {}) => ({
      b3: 4.65,
      raw: 4.65,
      floored: o.reason === "odds",
      odds: 5,
      oddsNamed: "title" as const,
      lambda,
      f10: lambda === null ? null : 4,
      gainReads: o.gainReads ?? 63,
      futureReads: lambda === null ? null : (o.futureReads ?? 0),
      reason: o.reason ?? null,
    });
    expect(helpsScaleWords({ leagueType: "dynasty", scale: scale(0.35, { gainReads: 50, futureReads: 26 }) })).toBe(
      "In a dynasty league, 63 is about as good as adding 3 points a week to your lineup this season together with 10% more long-term value for your roster, weighed by your Win now ↔ Future setting: 3 points a week alone reads 50, and 10% more long-term value alone reads 26.",
    );
    expect(helpsScaleWords({ leagueType: "dynasty", scale: scale(1, { gainReads: 0, futureReads: 63 }) })).toBe(
      "In a dynasty league with your Win now ↔ Future setting at Future, 63 is about as good as adding 10% more long-term value to your roster.",
    );
    expect(helpsScaleWords({ leagueType: "dynasty", scale: scale(0, { futureReads: 0 }) })).toBe(words);
    expect(helpsScaleWords({ leagueType: "dynasty", scale: scale(null) })).toBe(words);
    // "A note on the page says so" only when the note shows (the floor).
    expect(helpsScaleWords({ scale: scale(null, { reason: "odds" }) })).toBe(`${words}${note}`);
    expect(how("redraft")).not.toContain("a note on the page says so");
    expect(textOf(renderToStaticMarkup(createElement(HowToRead, { helpsScale: scale(null, { reason: "odds" }) })))).toContain(`${words}${note}`);
    // Not "in every league" (a dynasty league's scale is the mix), nor "under every setting".
    expect(how("dynasty")).not.toMatch(/in every league|under every setting/i);
    // The setting is "What does your league reward?" (planner reply to Checkpoint 7a, 5.2): no "goal" left in the words.
    for (const t of ["redraft", "dynasty", "keeper"] as const) expect(how(t)).not.toMatch(/goals?/i);
    // From config.benefit.helpsGain.
    expect(helpsScaleWords({ gain: 6 })).toBe("Whatever your league rewards, 63 is about as good as adding 6 points a week to your lineup for the rest of the season (28 for 2 points a week, 86 for 12).");
  });

  it("says Helps you counts trade value by the Protect my trade value setting in redraft leagues only", () => {
    expect(how()).toContain("It also counts trade value, so you keep some for later deals: giving up more than you get lowers it, getting more raises it. How much depends on your “Protect my trade value” setting in Settings.");
    expect(how("dynasty")).not.toContain("Protect my trade value");
    expect(how("keeper")).not.toContain("Protect my trade value");
  });

  it("follows the league's data: no trade-value part without FantasyCalc's values, this season only without long-term values, no blend while it's off (review of track UIC, findings 2 and 3)", () => {
    const read = (props: { leagueType?: "redraft" | "keeper" | "dynasty"; valuesOn?: boolean; longTermOn?: boolean; blendOn?: boolean }) => textOf(renderToStaticMarkup(createElement(HowToRead, props)));
    // Redraft without FantasyCalc's values (the curve fallback: B has no market term; none at all: nothing moves it).
    const noValues = read({ valuesOn: false });
    expect(noValues).toContain("(up to 4 weeks, the drops first, then the biggest gains). While FantasyCalc's trade values aren't available, it leaves trade value out.");
    expect(noValues).not.toContain("Protect my trade value");
    expect(noValues).toContain("The chance they accept and the Market check count roster spots too:");
    // Dynasty or keeper without long-term values (TradeEvaluation.dynMissing: B is the odds alone).
    for (const leagueType of ["dynasty", "keeper"] as const) {
      const text = read({ leagueType, longTermOn: false });
      expect(text).toContain(
        `In a ${leagueType} league it would also count the change in your roster's long-term value, but long-term trade values aren't available right now, so it counts this season only.`,
      );
      expect(text).not.toContain("weighed by your Win now");
      expect(text).not.toContain("keep a player");
      expect(text).toContain("The chance they accept and the Market check count roster spots too:");
    }
    // Each league type reads its own flag.
    expect(read({ longTermOn: false })).toBe(read({}));
    expect(read({ leagueType: "dynasty", valuesOn: false })).toBe(read({ leagueType: "dynasty" }));
    // The blend off: a hurt player's projection isn't said to be blended.
    const noBlend = read({ blendOn: false });
    expect(noBlend).toContain("A player you'd get who is hurt is projected to return at full strength. ROS points");
    expect(noBlend).not.toContain("blended");
    // The defaults: as before.
    expect(read({})).toContain("A player you'd get who is hurt is projected to return at full strength, blended with the trade market, which prices his injury in.");
    expect(read({})).toContain("The chance they accept, Helps you and the Market check count roster spots too:");
    expect(read({ leagueType: "keeper" })).toContain("The chance they accept, Helps you and the Market check count roster spots too:");
  });

  it("names what moves the chance they accept, the trade's effect on their starting lineup included, its cap from config, and '<5%' (review of Phase 4b; planner reply to Checkpoint 4b, answer 5)", () => {
    for (const page of ["finder", "analyzer"] as const) {
      expect(how(undefined, page)).toContain(
        "Chance they accept is an estimate (Est.), rounded to 5% (“<5%” when it's lower) and never above 85%: it looks at the trade from the other manager's side (trade value, what it adds to or costs their starting lineup, the holes it fills, how active a trader they are).",
      );
    }
    // The Finder's minimum chance, its default from config, judged on the chance the trade goes through (change 10).
    expect(how()).toContain("“Chance they accept: at least” hides ideas below the chance you pick (10% unless you change it), judged on the chance the trade goes through after a possible veto.");
    expect(how(undefined, "analyzer")).not.toContain("Chance they accept: at least");
    expect(acceptCapWords()).toBe(`${Math.round(config.acceptance.pAcceptClamp[1] * 100)}%`);
    expect(acceptCapWords(0.9)).toBe("90%");
  });

  it("explains Helps them and the “Helps both” sort in plain words on both pages, after Overall: the planner's tooltip, for a phone (planner reply to Checkpoint 7b, §7)", () => {
    const tooltip = "uses the same scale as Helps you, from their side. Both teams can gain when each fills the other's weak spot. Helps you already counts the cost of making them stronger.";
    expect(HELPS_THEM_TITLE).toBe(`Helps them ${tooltip}`);
    // Checkpoint 7d (planner reply to Checkpoint 7c, answers 3 and 5): a trade idea shows it only when it helps both teams, the
    // Analyzer's card always ("then it reads 0"); the tag needs the bar on both scores.
    expect(how()).toContain(
      `Helps them (0–100) ${tooltip} A trade idea shows it, with their odds before and after the trade, only when it helps both teams: when it scores at least 10 on both Helps you and Helps them. Helps them doesn't count trade value: the chance they accept does. Such an idea is tagged “Helps both”, and the “Helps both” sort shows only those, sorted by how much they help you.`,
    );
    expect(how(undefined, "analyzer")).toContain(
      `Helps them (0–100) ${tooltip} The card shows it with their odds before and after the trade, even when the trade costs them (then it reads 0); the Trade Finder shows it only on trade ideas that help both teams. Helps them doesn't count trade value: the chance they accept does. A trade that scores at least 10 on both Helps you and Helps them is tagged “Helps both”, and the Trade Finder's “Helps both” sort shows such trades, sorted by how much they help you.`,
    );
    // After Overall, before Harder to get; in every league type; its bar from config.
    for (const leagueType of ["redraft", "keeper", "dynasty"] as const) {
      const text = how(leagueType);
      expect(text.indexOf("Helps them (0–100)"), leagueType).toBeGreaterThan(text.indexOf("Overall combines the two"));
      expect(text.indexOf("Helps them (0–100)"), leagueType).toBeLessThan(text.indexOf("Harder to get marks"));
    }
    for (const page of ["finder", "analyzer"] as const) {
      expect(helpsThemWords(page, { min: 15 })).toContain("scores at least 15 on both Helps you and Helps them");
      expect(helpsThemWords(page)).toContain(`scores at least ${config.benefit.helpsThemMin} on both Helps you and Helps them`);
    }
  });

  it("says what Helps them counts in each league type: no trade value in redraft, their long-term value by their own odds in dynasty and keeper, never my Win now ↔ Future setting (review of the “Helps both” UI, helps-both-ui-1)", () => {
    const read = (props: { leagueType?: "redraft" | "keeper" | "dynasty"; page?: "finder" | "analyzer"; longTermOn?: boolean; valuesOn?: boolean }) => textOf(renderToStaticMarkup(createElement(HowToRead, props)));
    const paragraph = (text: string) => text.slice(text.indexOf("Helps them (0–100)"), text.indexOf("Harder to get marks"));
    // Where the card shows it, and the tag, on each page (Checkpoint 7d: a trade idea only when it helps both teams).
    const shows = { finder: "only when it helps both teams: when it scores at least 10 on both Helps you and Helps them.", analyzer: "the Trade Finder shows it only on trade ideas that help both teams." };
    const tagged = { finder: "Such an idea is tagged", analyzer: "A trade that scores at least 10 on both Helps you and Helps them is tagged" };
    // The sentence sits between where the card shows it and the tag, on both pages.
    const counts = (props: Parameters<typeof read>[0], sentence: string) => {
      for (const page of ["finder", "analyzer"] as const) expect(paragraph(read({ ...props, page })), `${JSON.stringify(props)} ${page}`).toContain(`${shows[page]} ${sentence} ${tagged[page]}`);
    };
    // Redraft: B_P has no trade-value term (benefit.ts partnerBenefit), whether or not FantasyCalc's values loaded. Each
    // sentence names Helps them (review of Checkpoint 7d, cards-export-4): since 7d the sentence before it ends on "both Helps
    // you and Helps them" (or on the Trade Finder), so a bare "It" read as the trade idea or as Helps you, which does count
    // trade value in a redraft league.
    const redraft = "Helps them doesn't count trade value: the chance they accept does.";
    for (const valuesOn of [true, false]) counts({ valuesOn }, redraft);
    counts({ leagueType: "redraft", longTermOn: false }, redraft);
    // Dynasty and keeper with long-term values: B_future,P by λ_P, their own odds (keeper: config.benefit.lambda.keeper).
    counts({ leagueType: "dynasty" }, "In a dynasty league Helps them also counts the change in their roster's long-term value, weighed more the less likely they are to make the playoffs, not by your Win now ↔ Future setting.");
    counts({ leagueType: "keeper" }, `In a keeper league Helps them also counts the change in their roster's long-term value, weighed at a fixed ${Math.round(config.benefit.lambda.keeper * 100)}%, not by your Win now ↔ Future setting.`);
    expect(config.benefit.lambda.keeper).toBe(0.2);
    // Without long-term values: this season only, as Helps you.
    for (const leagueType of ["dynasty", "keeper"] as const) counts({ leagueType, longTermOn: false }, "Like Helps you, Helps them counts this season only while long-term trade values aren't available.");
    for (const leagueType of ["redraft", "keeper", "dynasty"] as const) {
      for (const longTermOn of [true, false]) expect(helpsThemValueWords(leagueType, longTermOn), `${leagueType} ${String(longTermOn)}`).toMatch(/^(?:Helps them |In a \w+ league Helps them |Like Helps you, Helps them )/);
    }
    // Each league type says its own sentence alone (redraft's never in dynasty and keeper, no long-term value in redraft's); no "goal" anywhere.
    for (const leagueType of ["dynasty", "keeper"] as const) expect(paragraph(read({ leagueType }))).not.toContain(redraft);
    expect(paragraph(read({}))).not.toContain("long-term");
    for (const leagueType of ["redraft", "keeper", "dynasty"] as const) {
      for (const longTermOn of [true, false]) {
        const text = paragraph(read({ leagueType, longTermOn }));
        expect(text).not.toMatch(/goals?/i);
        for (const jargon of ["λ", "lambda", "B_P", "B₃", "NaN", "undefined"]) expect(text, `${leagueType} ${String(longTermOn)}`).not.toContain(jargon);
      }
    }
    expect(helpsThemValueWords()).toBe(redraft);
  });

  it("explains Harder to get and How to offer it: its offers in order, by their rules from config (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.1), merged ideas (Checkpoint 7f; planner reply to Checkpoint 7e, decision 3), and since Checkpoint 7g the Last offer's smaller ask, the ladder's preference for an idea of the list and the versions of a trade one of which shows alone (planner reply to Checkpoint 7f, answer 3; the final review's W1)", () => {
    expect(how()).toContain(HARDER);
    expect(how()).toContain(
      "How to offer it works out, when you open it on an idea that helps you, up to 4 offers to the same team, in order: “Open with” the version that helps you most while it still has at least a 15% chance they accept (or your minimum chance, when that's higher); “Then”, versions that help you a little less, each at least 5 percentage points likelier than the one before; “The suggested trade”, the idea itself; and “Last offer”, the suggested trade plus a player you can spare (losing him costs your lineup little) or asking for fewer of their players, whichever has the higher Overall, when it's at least 5 percentage points likelier; with a player added it still does at least 80% as much for you, and asking for fewer it keeps at least 80% of the idea's Overall. Each offer shows Helps you, the chance they accept, the roster moves its numbers assume when they aren't the idea's, and its own message to send them. When an idea's offers include another idea below it on Overall, the list shows only the higher one, and the other is among its offers. When another idea below this one on Overall fits one of these offers, it can be offered there even if another version helps you more or, for the “Last offer”, has a higher Overall, so it shows among this idea's offers rather than as an idea of its own. When two ideas are versions of the same trade and one is at least as good on both Helps you and the chance, only that one shows. An offer can still be an idea above it on Overall whose own offers don't include this one; it then says so, with that idea's place (“Also shown as trade idea 2.”). The idea's own “If they won't move: try …” trade is never one of its offers. When no other version makes a better first offer, it says to offer the trade as it is.",
    );
    // The final review of Checkpoint 7g (the lead's ruling W1; merge-b-howtoread-rules-false, merge-ui-howtoread-preference,
    // merge-a-howtoread-higher-overall-vs-preference): the ladder's preference for an idea of the list below this one, which
    // can make the Open or a Then help less than the version their rules pick and the Last offer the lower Overall, said
    // right after the merge sentence it serves. ⚠️ "can", never "is offered there": the preference reads only ideas holding no
    // merged trade, is fixed per idea and kept only when it holds more of them (the design's §4.1); and "more", never "a little
    // more": nothing bounds the gap (5 points of Helps you on the 12-team smallLeague 1 at the review).
    expect(offersWords("finder")).toContain(
      "When an idea's offers include another idea below it on Overall, the list shows only the higher one, and the other is among its offers. When another idea below this one on Overall fits one of these offers, it can be offered there",
    );
    expect(PREFER_LISTED_WORDS).toContain("it can be offered there even if another version helps you more or, for the “Last offer”, has a higher Overall");
    expect(PREFER_LISTED_WORDS).not.toMatch(/is offered there|a little more|first\b/);
    // The Analyzer's card is no idea of a list: nothing on merging there, and no preference.
    expect(offersWords("analyzer")).not.toContain("on Overall");
    expect(offersWords("analyzer")).not.toContain(PREFER_LISTED_WORDS);
    expect(offersWords("analyzer")).not.toContain("an idea of its own");
    expect(how(undefined, "analyzer")).not.toContain("rather than as an idea of its own");
    // ⚠️ The review of the merge, MERGE-1: never that the higher idea "can't offer" this one back (it can, when this one is its
    // lean version: it passed it over); only what holds, that its own offers don't include it.
    expect(offersWords("finder")).not.toMatch(/can't (?:offer|ask)/);
    expect(offersWords("finder")).toContain(`up to ${config.offers.maxSteps} offers`);
    expect(offersWords("finder")).toContain(`at least a ${Math.round(config.offers.openMinChance * 100)}% chance`);
    // Checkpoint 7g: every number from config (the throw-in's B share, the smaller ask's Overall share), on both pages; the
    // versions' sentence on the Trade Finder only (the Analyzer shows one card).
    for (const page of ["finder", "analyzer"] as const) {
      expect(offersWords(page)).toContain(`with a player added it still does at least ${Math.round(config.search.steps.minBShare * 100)}% as much for you`);
      expect(offersWords(page)).toContain(`asking for fewer it keeps at least ${Math.round(config.offers.lastMinOverallShare * 100)}% of`);
    }
    expect(offersWords("analyzer")).toContain("keeps at least 80% of the Overall of the trade you built.");
    expect(offersWords("analyzer")).not.toContain("versions of the same trade");
    expect(how()).not.toContain("Offer first");
  });

  it("explains the roster moves box on both pages (Checkpoint 7e; planner reply to Checkpoint 7d, item 2.2), and since Checkpoint 7f why a release can name the less valuable of two nearly even players, and the releases made either way (planner reply to Checkpoint 7e, answer 4)", () => {
    // The review of Checkpoint 7f: the rule's words as it decides (PIERCE-2: "the one with less trade value goes" wasn't always
    // so), and a release made either way named with the moves made either way, its reason on the League page (INTEGRATION-4).
    const box =
      "Roster moves these numbers assume lists, in order, each move to your roster that the card's numbers count on, with its reason and its week: a player you'd drop to stay within your league's limits or to make room, a free agent for a roster spot the trade opens, a waiver move the trade makes worthwhile, and who you'd release when a player comes back from IR (when the player your lineup would miss least has more trade value than another player nearly as cheap to lose from then on, that other player goes instead, and the line says why). Moves you'd make with or without the trade, like the pickups the League page suggests, are named at the end and aren't counted for the trade;";
    const releases = "A release you'd make with or without the trade is named with those moves, and your roster card on the League page says why. The other team's moves follow yours.";
    expect(how()).toContain(`${box} when one isn't on the League page's list, the idea's odds start from your odds with it, and the card says so. ${releases}`);
    expect(how(undefined, "analyzer")).toContain(`${box} when one isn't on the League page's list, your odds before this trade count it too. ${releases}`);
    expect(rosterMovesWords("finder")).not.toMatch(/either-way|V\*|baseline|two of your players/);
  });

  it("explains “Now or after this week” on both pages, its numbers from config (the review of wave D, UI-D-9; planner reply to Checkpoint 7d, item 4.2)", () => {
    const line =
      "Now or after this week shows on a card when making the same trade after this week's games would change Helps you by more than 3 (“Helps you 37 now · 41 if done after this week's games.”), while at least 2 weeks remain before your trade deadline. It assumes the same deal is still there next week: injuries, big games or another trade can change that, and their answer may change too.";
    expect(how()).toContain(line);
    expect(how(undefined, "analyzer")).toContain(line);
    expect(nowOrLaterWords()).toContain(`by more than ${config.explain.nowOrLaterMin} `);
    expect(nowOrLaterWords()).toContain(`at least ${config.explain.nowOrLaterWeeks} weeks remain`);
    // The planner's tooltip, word for word but for its first letter.
    expect(nowOrLaterWords()).toContain("assumes the same deal is still there next week: injuries, big games or another trade can change that, and their answer may change too.");
  });

  it("keeps the Trade Finder's words: ideas sorted by Overall, and what's left out", () => {
    const text = how();
    expect(text.startsWith("How to read a trade idea Helps you (0–100)")).toBe(true);
    expect(text).toContain("Overall combines the two: how much it helps, discounted by the chance it happens. Ideas are sorted by it unless you choose otherwise.");
    // Trade values are FantasyCalc's and never shown (planner reply to Checkpoint 7a, 5.4); the model's count of roster spots,
    // neutral throw-ins included (change 2), drives the estimate, Helps you and the Market check.
    expect(text).toContain(
      "ROS points are each player's projected points for the rest of the season. Trade values come from FantasyCalc: Offer Sheet uses them in its own numbers but doesn't show them. The chance they accept, Helps you and the Market check count roster spots too: every player counts at least what the best free agent no team is expected to pick up is worth, an extra player in an uneven trade adds nothing when he's worth no more than that (the team getting him would cut someone like him), and the side getting fewer players is credited the roster spot it opens (an IR slot isn't one). Your side also counts the free-agent moves a card says the trade counts on: a player you'd cut for them counts as if you traded him. Trades that wouldn't help you, or where, counting roster spots, you'd give up much more trade value than you get, are left out.",
    );
    expect(text).not.toContain("trade you built");
  });

  it("explains Plan B on the Trade Finder only, and the injury tags on both pages (planner reply to Checkpoint 4, change 6)", () => {
    // Review of track F: a Plan B is a trade they're likelier to accept (it read "a good fallback", for trades that were
    // often harder to land than their card).
    // Checkpoint 7e: its heading is the planner's, "If they won't move: try …", below an idea (the offers above it).
    // The final review of Checkpoint 7g (the lead's ruling W2; merge-ui-howtoread-planb): true with Plan B's narrow rule (the
    // lead's D5: never the idea's own trade asking for fewer of their players that its Last offer could take, so an idea can
    // show none) and the smaller asks (a box can ask for fewer of their players). Until then it read "It's the best such trade
    // for a different set of their players (other versions of the idea's own trade are in How to offer it), with …", which the
    // (c) sentence's "versions of the same trade" contradicted for a box asking for fewer.
    const planB =
      "If they won't move: try … shows below an idea when the same team has a trade they're likelier to accept: at least 5 percentage points likelier to go through, while still helping you at least half as much. It's the best such trade for a different set of their players, which can be fewer of them, but never the idea's own trade asking for fewer of their players when that could be its “Last offer”, so an idea can show none. It has its own three numbers and odds, its own message to send them, and a link to open it in the Trade Analyzer, where it's shown as one offer.";
    expect(how()).toContain(planB);
    expect(how()).not.toContain("other versions of the idea's own trade");
    // Its numbers are config's (the bar and the share), and the offer it can't be is named as How to offer it names it.
    expect(planBWords()).toContain(`at least ${planBGainWords()} likelier to go through, while still helping you at least ${planBShareWords()}.`);
    expect(offersWords("finder")).toContain("and “Last offer”, the suggested trade plus a player you can spare");
    expect(planBWords()).toContain("never the idea's own trade asking for fewer of their players when that could be its “Last offer”, so an idea can show none.");
    expect(offersWords("finder")).toContain("or asking for fewer of their players, whichever has the higher Overall");
    expect(how()).not.toContain("good fallback");
    expect(how()).not.toContain("If they say no");
    // The Analyzer shows no Plan B; it only says how a trade opened from one is shown (review of Phase 4b).
    expect(how(undefined, "analyzer")).not.toContain("If they won't move: try … shows");
    expect(how(undefined, "analyzer")).toContain("A trade opened from a trade idea's “If they won't move: try …” is shown as one offer instead");
    const tags =
      "Injury tags show under any player in the trade who isn't healthy, on either side: for example “Questionable” or “Out — expected back week 8”. The week shows when his projection counts on it, so a questionable player whose league site doesn't expect him back for weeks shows that week too. A player you'd get who is hurt is projected to return at full strength, blended with the trade market, which prices his injury in.";
    expect(how()).toContain(tags);
    expect(how(undefined, "analyzer")).toContain(tags);
    // The share and the acceptance bar are config's.
    expect(planBShareWords(0.5)).toBe("half as much");
    expect(planBShareWords(0.6)).toBe("60% as much");
    expect(planBGainWords()).toBe(`${Math.round(config.search.steps.minAcceptGain * 100)} percentage points`);
    expect([planBGainWords(0.05), planBGainWords(0.01)]).toEqual(["5 percentage points", "1 percentage point"]);
  });

  it("has the Trade Analyzer's own version: nothing ranked or left out there, and its offers built around the trade built (Checkpoint 7e)", () => {
    const text = how(undefined, "analyzer");
    expect(text.startsWith("How to read the evaluation Helps you (0–100)")).toBe(true);
    expect(text).toContain("It also counts trade value, so you keep some for later deals");
    expect(text).toContain(
      "Chance they accept is an estimate (Est.), rounded to 5% (“<5%” when it's lower) and never above 85%: it looks at the trade from the other manager's side (trade value, what it adds to or costs their starting lineup, the holes it fills, how active a trader they are). It's a guess, not a promise.",
    );
    expect(text).toContain("Overall combines the two: how much it helps, discounted by the chance it happens. The Trade Finder ranks its trade ideas by it.");
    expect(text).toContain(HARDER);
    expect(text).toContain(
      "How to offer it works out, when you open it, up to 4 offers of this trade to the same team, in order: “Open with” the version that helps you most while it still has at least a 15% chance they accept (or the minimum chance you set on the Trade Finder, when that's higher); “Then”, versions that help you a little less, each at least 5 percentage points likelier than the one before; “The trade you built”; and “Last offer”, the trade you built plus a player you can spare (losing him costs your lineup little) or asking for fewer of their players, whichever has the higher Overall, when it's at least 5 percentage points likelier; with a player added it still does at least 80% as much for you, and asking for fewer it keeps at least 80% of the Overall of the trade you built. Each offer shows Helps you, the chance they accept, the roster moves its numbers assume when they aren't this card's, and its own message to send them. When no other version makes a better first offer, it says to offer the trade as it is. A trade opened from a trade idea's “If they won't move: try …” is shown as one offer instead: they've just turned down a trade with the same team.",
    );
    expect(text).toContain(
      "“Details” shows what Helps you is worth in points a week. The Trade Finder leaves out trades that wouldn't help you, or where, counting roster spots, you'd give up much more trade value than you get; here they still show, with a warning.",
    );
    expect(text).not.toContain("Ideas are sorted by it");
    expect(text).not.toContain("are left out.");
    expect(how("keeper", "analyzer")).toContain("In a keeper league it also counts the change in your roster's long-term value");
  });

  it("opens from a 44 px summary, closed at first", () => {
    for (const page of ["finder", "analyzer"] as const) {
      const html = renderToStaticMarkup(createElement(HowToRead, { page }));
      expect(html).toMatch(/^<details class="[^"]*"><summary class="flex min-h-11 [^"]*">How to read (a trade idea|the evaluation)<\/summary>/);
      expect(html).not.toMatch(/<details[^>]* open/);
    }
  });
});

describe("FeedbackControls", () => {
  it("names its group and keeps one status line mounted for what each press did", () => {
    const html = renderToStaticMarkup(createElement(FeedbackControls, { feedback: NONE, onChange: saved, tradeName: "Trade with Gravel Gophers" }));
    expect(textOf(html)).toContain("What happened with it?");
    expect(html).toMatch(/<p role="status" class="sr-only"><\/p>/);
  });

  describe("which version was sent (planner reply to Checkpoint 4, change 6), with its model inputs (planner reply to Checkpoint 4b, change 7); since Checkpoint 7e the offers of “How to offer it” (planner reply to Checkpoint 7d, item 4.1)", () => {
    const plain = buildTradeCard(evaluation(), { snapshot, goal: "title" }).versions;
    // A card with a Plan B (Oddfellow for Fumblewick) whose "How to offer it" has loaded: open with Spoons for Gloop and Snoot,
    // then the card, then the card with Thimble added.
    const planB = { proposal: { partnerId: "2", give: [{ kind: "player" as const, id: "105" }], get: [{ kind: "player" as const, id: "203" }] }, key: "2|give:105|get:203", b: 2, tradeScore: 28, pAccept: 0.5, pComplete: 0.5, acceptLabel: "Decent", overall: 14, kind: "otherTarget" as const };
    const base = evaluation({ planB });
    const card = buildTradeCard(base, { snapshot, goal: "title" });
    const opening = evaluation({ get: ["202", "204"], b: 4.2, pAccept: 0.15, pComplete: 0.15 });
    const ladder = buildLadderView(
      {
        cardKey: base.key,
        steps: [
          { kind: "open", evaluation: opening, message: "x" },
          { kind: "suggested", evaluation: base, message: "y" },
          { kind: "last", evaluation: evaluation({ give: ["106", "108"], b: 2.7, pAccept: 0.55, pComplete: 0.55 }), message: "z" },
        ],
      },
      card,
      { snapshot, goal: "title" },
    );
    const offered = cardVersions(card, ladder);

    it("a plain card saves its one version, the suggested trade, with the outcome, without asking, its model inputs and the goal included", () => {
      const e = evaluation();
      // Phase 7a: with the card's B₃ and its scale's reason (none here: the fixture's notes are empty).
      const inputs = { features: { ...e.features }, gPartner: e.gPartner, b: e.b, goal: "title", b3: e.b3, helpsReason: null };
      expect(outcomeAction(NONE, plain, "sent")).toEqual({ action: "save", change: { outcome: "sent", sent: { version: "suggested", key: plain[0]?.key, pAccept: 0.4, pComplete: 0.4, inputs } } });
    });

    it("a card with two or more versions asks on the first outcome; a version recorded stays; pressing the outcome on clears it", () => {
      for (const versions of [card.versions, offered]) {
        expect(outcomeAction(NONE, versions, "sent")).toEqual({ action: "ask" });
        expect(outcomeAction(NONE, versions, "accepted")).toEqual({ action: "ask" });
      }
      expect(outcomeAction({ outcome: "sent", version: "open" }, offered, "accepted")).toEqual({ action: "save", change: { outcome: "accepted" } });
      expect(outcomeAction({ outcome: "sent", version: "open" }, offered, "sent")).toEqual({ action: "clear", change: { outcome: null } });
      // An older card's kind recorded stays too.
      expect(outcomeAction({ outcome: "sent", version: "offerFirst" }, offered, "rejected")).toEqual({ action: "save", change: { outcome: "rejected" } });
      // No versions (absent): the outcome alone.
      expect(outcomeAction(NONE, [], "rejected")).toEqual({ action: "save", change: { outcome: "rejected" } });
      expect(chosenVersionChange("sent", offered[0] as (typeof offered)[number])).toEqual({ outcome: "sent", sent: { version: "open", key: opening.key, pAccept: 0.15, pComplete: 0.15, inputs: offered[0]?.inputs } });
      expect(offered[0]?.inputs).toMatchObject({ b: 4.2, goal: "title" });
    });

    it("asks in words, worded for the outcome, one 44 px button per version and Cancel: the offers in order once opened, then Plan B", () => {
      const ask = (versions: typeof offered) => renderToStaticMarkup(createElement(VersionChooser, { kind: "sent", versions, tradeName: "Trade with Gravel Gophers", onChoose: noop, onCancel: noop }));
      const html = ask(offered);
      expect(html).toMatch(/^<fieldset[^>]*><legend tabindex="-1" class="[^"]*">Which version did you send\?<span class="sr-only"> \(Trade with Gravel Gophers\)<\/span><\/legend>/);
      const buttons = targets(html).filter((t) => t.tag === "button");
      expect(buttons.map((b) => b.text)).toEqual([
        "Open with: Wiggleton Spoons for Mortimer Gloop and Cornelius Snoot",
        "The suggested trade",
        "Last offer: Wiggleton Spoons and Tobias Thimble for Cornelius Snoot",
        "If they won't move: Glimmer Oddfellow for Ignatius Fumblewick",
        "Cancel",
      ]);
      for (const b of buttons) expect(b.cls, b.text).toContain("min-h-11");
      // Before "How to offer it" is opened: the card's own trade and its Plan B.
      expect(targets(ask(card.versions)).map((b) => b.text)).toEqual(["The suggested trade", "If they won't move: Glimmer Oddfellow for Ignatius Fumblewick", "Cancel"]);
      // Two offers at the same place ("Then") are two buttons (each keyed by its trade).
      const thens = [
        { ...(offered[0] as (typeof offered)[number]), version: "then" as const, key: "2|give:106|get:202", label: "Then: Wiggleton Spoons for Mortimer Gloop" },
        { ...(offered[0] as (typeof offered)[number]), version: "then" as const, key: "2|give:106|get:203", label: "Then: Wiggleton Spoons for Ignatius Fumblewick" },
      ];
      expect(targets(ask(thens)).map((b) => b.text)).toEqual(["Then: Wiggleton Spoons for Mortimer Gloop", "Then: Wiggleton Spoons for Ignatius Fumblewick", "Cancel"]);
      expect(VERSION_QUESTION).toEqual({ sent: "Which version did you send?", accepted: "Which version did they accept?", rejected: "Which version did they turn down?", countered: "Which version did they counter?" });
    });

    it("says which version was recorded under the buttons: by its label, an offer by its place and players even with “How to offer it” closed", () => {
      const sentLast = { ...NONE, outcome: "sent" as const, version: "last" as const, versionKey: offered[2]?.key ?? null, versionWords: "Wiggleton Spoons and Tobias Thimble for Cornelius Snoot" };
      const line = (feedback: CardFeedback, versions: typeof offered) => textOf(renderToStaticMarkup(createElement(FeedbackControls, { feedback, onChange: saved, tradeName: "x", versions })));
      expect(line(sentLast, offered)).toContain("Version: Last offer: Wiggleton Spoons and Tobias Thimble for Cornelius Snoot");
      // After a reload "How to offer it" is closed: the same words, never "an earlier one".
      expect(line(sentLast, card.versions)).toContain("Version: Last offer: Wiggleton Spoons and Tobias Thimble for Cornelius Snoot");
      // A record made before keys were saved: by its kind.
      expect(line({ ...NONE, outcome: "sent", version: "planB", versionKey: null, versionWords: null }, offered)).toContain("Version: If they won't move: Glimmer Oddfellow for Ignatius Fumblewick");
      // A plain card's one version goes without saying.
      expect(line({ ...sentLast, version: "suggested", versionKey: plain[0]?.key ?? null }, plain)).not.toContain("Version:");
    });

    it("says 'an earlier one', with its players, when the recorded Plan B isn't the one the card shows (review of Phase 4b)", () => {
      // Sent the Plan B, then a refresh changed the card's Plan B: the line names the one sent, not the box shown now.
      const earlier = { ...NONE, outcome: "sent" as const, version: "planB" as const, versionKey: "2|give:105|get:205", versionWords: "Glimmer Oddfellow for Percival Plunk" };
      const html = renderToStaticMarkup(createElement(FeedbackControls, { feedback: earlier, onChange: saved, tradeName: "x", versions: offered }));
      expect(textOf(html)).toContain("Version: an earlier one (Glimmer Oddfellow for Percival Plunk)");
      expect(textOf(html)).not.toContain("Ignatius Fumblewick");
      // The Analyzer's card for the same trade (one version) says it too, rather than nothing.
      expect(textOf(renderToStaticMarkup(createElement(FeedbackControls, { feedback: earlier, onChange: saved, tradeName: "x", versions: plain })))).toContain("Version: an earlier one (Glimmer Oddfellow for Percival Plunk)");
      // Without the league's names, still never the version shown now.
      expect(textOf(renderToStaticMarkup(createElement(FeedbackControls, { feedback: { ...earlier, versionWords: null }, onChange: saved, tradeName: "x", versions: offered })))).toContain("Version: an earlier one");
      // A later outcome keeps the recorded version without asking.
      expect(outcomeAction(earlier, offered, "rejected")).toEqual({ action: "save", change: { outcome: "rejected" } });
    });
  });
});

describe("the Trade Analyzer", () => {
  const form = (draft: Parameters<typeof analyzerChoices>[2], busy = false) =>
    renderToStaticMarkup(createElement(AnalyzerForm, { choices: analyzerChoices(snapshot, "1", draft), draft, summary: null, busy, onChange: noop, onEvaluate: noop }));

  it("labels the partner, groups each side's players in a fieldset of 44 px checkbox rows, and can't evaluate an empty trade", () => {
    const html = form({ partnerId: null, give: [], get: [] });
    expect(html).toMatch(/<label for="[^"]+" class="text-sm font-bold">Trade with<\/label><select id="[^"]+"/);
    expect(html).toContain('<option value="" selected="">Choose a team…</option>');
    expect(html).toMatch(/<fieldset class="min-w-0"><legend class="[^"]*">You give<\/legend>/);
    expect(textOf(html)).toContain("You get Choose a team first to see its players.");
    // My 8 active-roster players and my IR player (Phase 4b: IR players are tradable).
    expect((html.match(/<label class="flex min-h-11/g) ?? []).length).toBe(9);
    expect(html).toMatch(/<button type="button" aria-disabled="true" class="[^"]*">Evaluate trade<\/button>/);
    expect(textOf(html)).toContain("Choose a team and at least one player to evaluate a trade.");
  });

  it("checks the drafted players, disables the rest of a full side and says why, and evaluates a complete trade", () => {
    const html = form({ partnerId: "2", give: ["101", "102", "104", "105"], get: ["203"] });
    expect((html.match(/checked=""/g) ?? []).length).toBe(5);
    // My side is full: my other 4 active-roster players and my IR player are disabled.
    expect((html.match(/disabled=""/g) ?? []).length).toBe(5);
    expect(textOf(html)).toContain("That's 4 players, the most a side can have here. Uncheck one to pick another.");
    expect(html).toMatch(/<legend class="[^"]*">You get from Gravel Gophers<\/legend>/);
    expect(html).toMatch(/<button type="button" class="[^"]*">Evaluate trade<\/button>/);
    expect(html).toMatch(/<button type="button" class="[^"]*">Clear players<\/button>/);
    expect(form({ partnerId: "2", give: ["101"], get: [] }, true)).toMatch(/<button type="button" aria-disabled="true" class="[^"]*">Evaluating…<\/button>/);
  });

  it("says my odds before this trade above the card, with what they count and what Helps you sums up, and the card's odds before and after (review of Phase 4; Phase 4c)", () => {
    const props = { stale: false, records: [], leagueKey: "espn:0000abcd", onFeedback: saved };
    const result = buildAnalysisView({ evaluation: evaluation({ dPO: 0.091, dCH: 0.039 }), illegal: null, notes: [], baseline: { pPlayoffs: 0.63, pTitle: 0.12 } }, snapshot, undefined, { fantasyCalc: FC });
    const html = renderToStaticMarkup(createElement(AnalysisResult, { view: result, ...props }));
    const text = textOf(html);
    expect(text).toContain(
      "The trade, evaluated Your odds before this trade: 63% to make the playoffs, 12.0% to win the title. As on the League page, they count the free-agent pickups that would help each team, and the trade's odds start from them. Helps you (0–100) sums up how much your title and playoff odds rise, minus a cost for giving away trade value or plus a credit for gaining it. 63 ≈ as good as adding 3 points a week to your lineup for the rest of the season. Trade with Gravel Gophers",
    );
    expect(text).toContain("Title odds 12.0% → 15.9% from 12.0% to 15.9% · , Playoff odds 63% → 72% from 63% to 72%");
    // The Analyzer's card has "Details" (what Helps you is worth in points a week), behind a closed 44 px summary named for screen readers.
    expect(html).toMatch(/<details class="mt-3 rounded-xl border border-line"><summary class="flex min-h-11[^"]*"><span>Details<span class="sr-only"> \(Trade with Gravel Gophers\)<\/span><\/span>/);
    expect(text).toContain("How Helps you adds up for this trade.");
    expect(text).not.toMatch(/counting roster spots: you'd get|Trade value You give/);
    // Planner reply to Checkpoint 4c, A2: Details ends with what Helps you is worth in lineup points (B 3 on the fixtures' B₃ 6).
    expect(text).toContain("Helps you 39 ≈ +1.5 pts/week: as good as adding that to your lineup every week for the rest of the season.");
    // Dimmed with the card when it's stale (the odds are the evaluation's).
    expect(renderToStaticMarkup(createElement(AnalysisResult, { view: result, ...props, stale: true }))).toMatch(/<div class="space-y-4 transition-opacity opacity-60"><div><p class="text-sm font-semibold">Your odds before this trade/);
    // Without them (no odds), no line.
    const plain = renderToStaticMarkup(createElement(AnalysisResult, { view: buildAnalysisView({ evaluation: evaluation(), illegal: null, notes: [] }, snapshot), ...props }));
    expect(plain).not.toContain("Your odds before");
  });

  it("says a trade opened from 'If they won't move: try …' is shown as one offer, first among the notes under its card, without “How to offer it” (review of Phase 4b; Checkpoint 7e)", () => {
    const props = { stale: false, records: [], leagueKey: "espn:0000abcd", onFeedback: saved, onOffers: () => new Promise<LadderView>(() => {}) };
    const view = buildAnalysisView({ evaluation: evaluation(), illegal: null, notes: ["Long-term values didn't load."] }, snapshot, undefined, { from: "planB" });
    expect(view.notes).toEqual([FROM_PLAN_B_NOTE, "Long-term values didn't load."]);
    const html = renderToStaticMarkup(createElement(AnalysisResult, { view, ...props }));
    expect(textOf(html)).toContain(
      "You opened this from “If they won't move: try …” on a trade idea, so it's shown as one offer, without offers to try before it: they've just turned down a trade with the same team. Long-term values didn't load.",
    );
    expect(html).not.toMatch(OFFERS_SUMMARY);
    expect(html.indexOf("You opened this from")).toBeGreaterThan(html.indexOf("What happened with it?"));
    // Not otherwise, and not without a card.
    expect(buildAnalysisView({ evaluation: evaluation(), illegal: null, notes: [] }, snapshot).notes).toEqual([]);
    expect(buildAnalysisView({ evaluation: null, illegal: "You can't trade a player twice.", notes: [] }, snapshot, undefined, { from: "planB" }).notes).toEqual([]);
  });

  it("shows the same tag and partner's line as the Trade Finder's card, and announces the partner's score (planner reply to Checkpoint 7b, §7: “The Analyzer shows the same”)", () => {
    const props = { stale: false, records: [], leagueKey: "espn:0000abcd", onFeedback: saved };
    const e = withThem(evaluation({ dCH: 0.013, dPO: 0.04 }), 24);
    const baseline = { pPlayoffs: 0.65, pTitle: 0.121 };
    const view = buildAnalysisView({ evaluation: e, illegal: null, notes: [], baseline }, snapshot);
    const finder = buildFinderView({ result: searchResult([e], { baseline: { ...baseline, expWins: 8 } }), sort: "overall", snapshot, partnerId: null });
    expect(view.card?.them).toEqual(finder.cards[0]?.them);
    expect(view.card?.helpsBothTag).toEqual(finder.cards[0]?.helpsBothTag);
    const html = renderToStaticMarkup(createElement(AnalysisResult, { view, ...props }));
    expect(html).toMatch(/<h3 id="[^"]+" class="[^"]*">Trade with Gravel Gophers<\/h3><span title="Helps both: [^"]*" class="shrink-0"><span class="[^"]*">Helps both<\/span><\/span>/);
    expect(textOf(html)).toContain("Helps them 24 · , Their title odds 6.0% → 6.9% from 6.0% to 6.9% · , Their playoff odds 41% → 45% from 41% to 45%");
    expect(textOf(html)).toContain("is tagged “Helps both”, and the Trade Finder's “Helps both” sort shows such trades");
    // The status line: the three numbers, then the partner's score, and that it helps both teams.
    expect(analysisStatus(view)).toBe("Evaluated: Helps you 39, chance they accept 40%, Overall 18, Helps them 24. It helps both teams.");
    expect(analysisStatus(buildAnalysisView({ evaluation: withThem(evaluation(), 4), illegal: null, notes: [] }, snapshot))).toBe("Evaluated: Helps you 39, chance they accept 40%, Overall 18, Helps them 4.");
    expect(analysisStatus(buildAnalysisView({ evaluation: evaluation(), illegal: null, notes: [] }, snapshot))).toBe("Evaluated: Helps you 39, chance they accept 40%, Overall 18.");
    expect(analysisStatus(buildAnalysisView({ evaluation: null, illegal: "You can't trade a player twice.", notes: [] }, snapshot))).toBe("This trade can't be made: You can't trade a player twice.");
  });

  it("Checkpoint 7d (planner reply to Checkpoint 7c, answer 3): the Trade Finder shows the partner's line only on a card that helps both, the Analyzer whatever it is", () => {
    const props = { stale: false, records: [], leagueKey: "espn:0000abcd", onFeedback: saved };
    for (const helps of [4, 0]) {
      const e = withThem(evaluation({ dCH: 0.013, dPO: 0.04 }), helps);
      const finder = buildFinderView({ result: searchResult([e]), sort: "overall", snapshot, partnerId: null });
      // The card itself (How to read, after the list, explains Helps them on every page).
      const article = (html: string) => html.slice(html.indexOf("<article"), html.indexOf("</article>"));
      const finderCard = article(renderToStaticMarkup(createElement(FinderFrame, { ...frameProps({ kind: "done", view: finder }) })));
      expect(finderCard, String(helps)).toContain("Trade with Gravel Gophers");
      expect(finderCard, String(helps)).not.toContain("Helps them");
      expect(finderCard, String(helps)).not.toContain(">Helps both<");
      const analyzerCard = article(renderToStaticMarkup(createElement(AnalysisResult, { view: buildAnalysisView({ evaluation: e, illegal: null, notes: [] }, snapshot), ...props })));
      expect(textOf(analyzerCard), String(helps)).toContain(`Helps them ${helps} · , Their title odds`);
      expect(analyzerCard, String(helps)).not.toContain(">Helps both<");
    }
  });

  it("shows “How to offer it” on the analyzed trade's card too (useful for counteroffers; Checkpoint 7e), its offers built around the trade built", () => {
    const html = renderToStaticMarkup(
      createElement(AnalysisResult, {
        view: buildAnalysisView({ evaluation: evaluation(), illegal: null, notes: [] }, snapshot),
        stale: false,
        records: [],
        leagueKey: "espn:0000abcd",
        onFeedback: saved,
        onOffers: () => new Promise<LadderView>(() => {}),
      }),
    );
    expect(html).toMatch(/<summary class="flex min-h-11[^"]*"><span>How to offer it<span class="sr-only"> \(Trade with Gravel Gophers\)<\/span><\/span>/);
    // Without the page's engine: none.
    expect(renderToStaticMarkup(createElement(AnalysisResult, { view: buildAnalysisView({ evaluation: evaluation(), illegal: null, notes: [] }, snapshot), stale: false, records: [], leagueKey: "espn:0000abcd", onFeedback: saved }))).not.toMatch(
      OFFERS_SUMMARY,
    );
  });

  it("explains the card under it, as the Trade Finder does: Harder to get, How to offer it with the trade built among its offers, and the roster moves (review of the addendum; Checkpoint 7e)", () => {
    const built = evaluation({ give: ["106", "108"] });
    const result = (stale: boolean, leagueType?: "redraft" | "keeper" | "dynasty") =>
      renderToStaticMarkup(createElement(AnalysisResult, { view: buildAnalysisView({ evaluation: built, illegal: null, notes: [] }, snapshot), stale, records: [], leagueKey: "espn:0000abcd", leagueType, onFeedback: saved }));
    const html = result(false);
    const text = textOf(html);
    expect(text).toContain("How to read the evaluation");
    expect(text).toContain("Harder to get marks a player you'd get who is one of their two most valuable players and one of the top 12 players by trade value");
    expect(text).toContain("“The trade you built”; and “Last offer”, the trade you built plus a player you can spare");
    expect(text).toContain("Roster moves these numbers assume lists, in order, each move to your roster");
    // Under the card, inside the result's section, closed at first.
    expect(html.indexOf("How to read the evaluation")).toBeGreaterThan(html.indexOf("What happened with it?"));
    expect(html).toMatch(/<\/div><details class="[^"]*"><summary class="flex min-h-11[^"]*">How to read the evaluation<\/summary>[\s\S]*<\/details><\/section>$/);
    // A stale result is dimmed; the explanation isn't (its words don't go stale).
    expect(result(true)).toMatch(/<div class="space-y-4 transition-opacity opacity-60">[\s\S]*<\/div><details /);
    // It says how Helps you weighs later seasons in the league's type.
    expect(textOf(result(false, "dynasty"))).toContain("In a dynasty league it also counts the change in your roster's long-term value");
    expect(text).not.toContain("In a dynasty league");
    // Nothing to read without a card: a trade that can't be made.
    const illegal = renderToStaticMarkup(createElement(AnalysisResult, { view: buildAnalysisView({ evaluation: null, illegal: "You can't trade a player twice.", notes: [] }, snapshot), stale: false, records: [], leagueKey: "espn:0000abcd", onFeedback: saved }));
    expect(illegal).not.toContain("How to read");
  });

  it("says under the card what its league's data allows: long-term values missing on the card, the page's values and blend (review of track UIC, findings 2 and 3)", () => {
    const render = (e: ReturnType<typeof evaluation>, leagueType: "redraft" | "keeper", facts?: { valuesOn: boolean; longTermOn: boolean; blendOn: boolean }) =>
      textOf(renderToStaticMarkup(createElement(AnalysisResult, { view: buildAnalysisView({ evaluation: e, illegal: null, notes: [] }, snapshot), stale: false, records: [], leagueKey: "espn:0000abcd", leagueType, facts, onFeedback: saved })));
    // The card's own word (TradeEvaluation.dynMissing), even when the page's reading says they loaded.
    const missing = render(evaluation({ dynMissing: true, lambda: 0.2 }), "keeper", { valuesOn: true, longTermOn: true, blendOn: true });
    expect(missing).toContain("In a keeper league it would also count the change in your roster's long-term value, but long-term trade values aren't available right now, so it counts this season only.");
    expect(render(evaluation({ lambda: 0.2 }), "keeper")).toContain("In a keeper league it also counts the change in your roster's long-term value");
    // The page's facts reach it.
    const off = render(evaluation(), "redraft", { valuesOn: false, longTermOn: true, blendOn: false });
    expect(off).toContain("While FantasyCalc's trade values aren't available, it leaves trade value out.");
    expect(off).not.toContain("blended");
  });

  it("shows the evaluation on the same card (no Analyzer link), an illegal trade's reason, notes, and a stale result dimmed", () => {
    const props = { records: [], leagueKey: "espn:0000abcd", onFeedback: saved };
    const legal = renderToStaticMarkup(createElement(AnalysisResult, { view: buildAnalysisView({ evaluation: evaluation(), illegal: null, notes: ["Long-term values didn't load."] }, snapshot), stale: false, ...props }));
    expect(legal).toMatch(/<h2 id="analysis-title" class="[^"]*">The trade, evaluated<\/h2>/);
    expect(legal).toMatch(/<h3 id="[^"]+" class="[^"]*">Trade with Gravel Gophers<\/h3>/);
    expect(legal).not.toContain("Open in Analyzer");
    expect(textOf(legal)).toContain("Long-term values didn't load.");
    const illegal = renderToStaticMarkup(createElement(AnalysisResult, { view: buildAnalysisView({ evaluation: null, illegal: "You can't trade a player twice.", notes: [] }, snapshot), stale: true, ...props }));
    expect(textOf(illegal)).toContain("This trade can't be made You can't trade a player twice.");
    expect(textOf(illegal)).toContain("You've changed the trade, your settings or the league data since. Evaluate it again to see the new numbers.");
    expect(illegal).toContain("opacity-60");
  });
});
