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
import { defaultTradeSettings } from "@/engine/settings";
import type { CardFeedback, FinderView } from "@/lib/tradeView";
import { analyzerChoices, buildAnalysisView, buildFinderView, buildTradeCard, progressView, settingsSummary } from "@/lib/tradeView";
import { AnalysisResult, AnalyzerForm, AnalyzerPage } from "./AnalyzerPage";
import { FeedbackControls } from "./FeedbackControls";
import { HowToRead } from "./HowToRead";
import { TradeCard } from "./TradeCard";
import { FinderControls, FinderFrame, TradeFinderPage, finderStatus, type FinderState } from "./TradeFinderPage";
import { GLOOP_PREMIUM, SNOOT_PREMIUM, evaluation, searchResult, step, steppedFull, steppedOffer, tradeSnapshot } from "./testFixtures";

const snapshot = tradeSnapshot();
const noop = () => {};
const saved = () => ({ ok: true as const });
const NONE: CardFeedback = { outcome: null, report: null };

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
  buildFinderView({ result: searchResult(trades, over), sort: "overall", snapshot, partnerId: null });

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

  it("shows a progress bar while searching: the stage and its count in words, its value for screen readers, and Stop", () => {
    const html = renderFrame(STATES.searching as FinderState);
    expect(html).toMatch(/role="progressbar" aria-label="Trade search progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="17" aria-valuetext="Screening trade ideas: 120 of 480"/);
    expect(html).toContain('style="width:17%"');
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
      "Trade ideas Your odds before any trade: 62% to make the playoffs, 9% to win the title. Like every trade idea's numbers, they count the free-agent pickups that would help each team, so they can differ from the League page's odds, which take rosters as they stand. 2 trade ideas, sorted by Overall.",
    );
    expect(html).toContain('<p class="mt-0.5 text-xs text-muted">Like every trade idea&#x27;s numbers');
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

describe("FinderControls", () => {
  it("labels the partner filter (All teams, then the others) and the sort (Overall first), and says what the settings allow", () => {
    const html = renderToStaticMarkup(createElement(FinderControls, { snapshot, myTeamId: "1", partnerId: "3", onPartner: noop, sort: "helps", onSort: noop, summary: settingsSummary(defaultTradeSettings(), "espn") }));
    expect(html).toContain('<label for="finder-partner" class="text-sm font-bold">Trade partner</label>');
    expect([...html.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => `${m[1]}:${m[2]}`)).toEqual([
      ":All teams",
      "2:Gravel Gophers",
      "3:Quasar Quokkas",
      "4:Tundra Tortoises",
      "overall:Overall",
      "helps:Helps you",
      "accept:Chance they accept",
    ]);
    expect(html).toMatch(/<option value="3" selected="">/);
    expect(html).toMatch(/<option value="helps" selected="">/);
    expect(textOf(html)).toContain("Up to 2 players a side. Change in Settings");
  });
});

describe("TradeCard (§13: each trade card shows)", () => {
  const render = (e = evaluation(), feedback: CardFeedback = NONE, opts: { rank?: number; analyzer?: boolean } = {}) =>
    renderToStaticMarkup(createElement(TradeCard, { card: buildTradeCard(e, { snapshot }), rank: opts.rank ?? 1, feedback, onFeedback: saved, showAnalyzerLink: opts.analyzer ?? true }));

  it("shows give and get, the three numbers with Est. and the label, ROS points, the numbers behind them and the FantasyCalc link beside the values", () => {
    const html = render(evaluation({ pComplete: 0.4, ros: { received: 142, given: 118 } }));
    const text = textOf(html);
    expect(text).toContain("Trade idea 1 Trade with Gravel Gophers You give Wiggleton Spoons WR · ATL You get Cornelius Snoot RB · HOU");
    expect(html).toMatch(/<dl class="mt-4 grid grid-cols-3 gap-2">/);
    // Each number's label (dt) comes first for screen readers; the number shows above it (flex-col-reverse).
    expect(text).toContain("Helps you 39 Chance they accept 40% Est. · Decent Overall 18");
    expect(html).toContain('<div class="flex min-w-0 flex-col-reverse justify-end rounded-xl bg-surface-muted px-1.5 py-2 text-center"><dt');
    expect(text).toContain("You get 142 ROS pts, give 118");
    expect(text).toContain("Playoff odds +3 percentage points Title odds +1 percentage point Trade value You give 5,000, you get 5,000 · Values: FantasyCalc (opens in a new tab)");
    expect(html).toMatch(/<a href="https:\/\/fantasycalc\.com" target="_blank" rel="noopener noreferrer" class="[^"]*">Values: FantasyCalc/);
  });

  it("lists the risk flags apart from the numbers, in words with a symbol (not color alone)", () => {
    const html = render(evaluation({ gMine: -0.2, flags: { marketCheck: true, hiddenByMarket: false, hiddenByBenefit: false, injured: ["107"] } }));
    expect(html).toMatch(/<ul aria-label="Risks"[^>]*><li[^>]*><span aria-hidden="true"[^>]*>⚠<\/span><span[^>]*>Depends on an injured player: Humbert Fiddlesticks \(injured reserve\)<\/span><\/li><li[^>]*>.*Market check: you&#x27;d get 20% less trade value than you give\./);
    expect(render()).not.toContain('aria-label="Risks"');
  });

  it("says the forced roster moves, the reasons, and the pitch behind a 44 px summary with a 44 px Copy button", () => {
    const html = render(evaluation({ required: { me: { drops: ["108"], adds: [] }, partner: { drops: [], adds: [] } } }));
    const text = textOf(html);
    expect(text).toContain("Roster moves this trade forces You'd drop Tobias Thimble (TE, JAX) to stay within your roster limits.");
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
    const html = render(evaluation(), { outcome: "accepted", report: null });
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
    const html = render(evaluation(), { outcome: null, report: { reason: "never-accept", note: "too lopsided" } });
    expect(textOf(html)).toContain("Reported: They'd never accept · “too lopsided” Undo the report on trade idea 1, Trade with Gravel Gophers");
    expect(html).not.toContain("Report a problem");
  });

  it("gives every button and non-text link a 44 px target", () => {
    const html = render(evaluation({ required: { me: { drops: ["108"], adds: [] }, partner: { drops: [], adds: [] } } }), { outcome: "sent", report: null });
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
    // After an injury badge, a small gap separates the two pills.
    const hurt = render(evaluation({ get: ["206"], detail: { premium: [{ playerId: "206", e: 0.2, rank: 1, elite: true, harderToGet: true }] } }));
    expect(hurt).toMatch(
      /<span class="sr-only">Doubtful<\/span><\/span><span title="Harder to get: [^"]*" class="ml-1"><span class="[^"]*bg-accent[^"]*"><span aria-hidden="true">Harder to get<\/span><\/span><span class="sr-only">Harder to get: [^<]*<\/span><\/span>/,
    );
  });

  it("shows 'How to offer it' right under the three numbers: an ordered list, each estimate said in full to screen readers (§4)", () => {
    const html = render(steppedFull());
    expect(html).toContain(
      '<div class="mt-3 rounded-xl border border-line px-3 py-2"><p class="text-sm font-bold">How to offer it</p><ol class="mt-1 list-decimal space-y-1 pl-5 text-sm leading-relaxed"><li class="break-words"><span class="font-semibold">Offer first:</span> Wiggleton Spoons for Cornelius Snoot<span aria-hidden="true"> · </span><span class="sr-only">, </span><span aria-hidden="true" class="font-semibold"><span class="whitespace-nowrap tabular-nums">Est. 35%</span></span><span class="sr-only">an estimated 35% chance they accept</span></li><li class="break-words"><span class="font-semibold">If they say no, add</span> Tobias Thimble<span aria-hidden="true"> · </span><span class="sr-only">, </span><span aria-hidden="true" class="font-semibold"><span class="whitespace-nowrap tabular-nums">Est. 55%</span></span><span class="sr-only">an estimated 55% chance they accept</span></li></ol></div>',
    );
    // Under the numbers, before the risk flags and the reasons.
    expect(html.indexOf("How to offer it")).toBeGreaterThan(html.indexOf(">Overall</dt>"));
    expect(html.indexOf("How to offer it")).toBeLessThan(html.indexOf("You get 120 ROS pts"));
    expect(render()).not.toContain("How to offer it");
    // A version a veto vote could stop: only "Est. 40%" stays on one line; the rest wraps (no overflow on a 320 px phone).
    const e = steppedOffer();
    const vetoed = { ...e, steps: e.steps && { ...e.steps, offerFirst: step({ give: ["106"], get: ["204"], pAccept: 0.4, pComplete: 0.2, vetoRisk: true }) } };
    expect(render(vetoed)).toContain(
      '<span aria-hidden="true" class="font-semibold"><span class="whitespace-nowrap tabular-nums">Est. 40%</span>, about 20% it goes through</span><span class="sr-only">an estimated 40% chance they accept, about 20% that it goes through</span>',
    );
  });
});

describe("HowToRead (planner addendum to Checkpoint 3)", () => {
  const how = (leagueType?: "redraft" | "keeper" | "dynasty", page?: "finder" | "analyzer") => textOf(renderToStaticMarkup(createElement(HowToRead, { leagueType, page })));
  const HARDER = "Harder to get marks a player you'd get who is one of their two most valuable players and one of the top 12 players by trade value: managers want a little extra for players like that, and the chance they accept counts it.";

  it("says Helps you counts trade value by the Protect my trade value setting in redraft leagues only", () => {
    expect(how()).toContain("It also counts trade value, so you keep some for later deals: giving up more than you get lowers it, getting more raises it. How much depends on your “Protect my trade value” setting in Settings.");
    expect(how("dynasty")).not.toContain("Protect my trade value");
    expect(how("keeper")).not.toContain("Protect my trade value");
  });

  it("explains Harder to get and How to offer it", () => {
    expect(how()).toContain(HARDER);
    expect(how()).toContain("How to offer it shows on some ideas: offer the first version, and if they say no, add the player named, one you can spare (losing him costs your lineup little), which raises the chance they accept. The message to send them proposes the first version.");
  });

  it("keeps the Trade Finder's words: ideas sorted by Overall, and what's left out", () => {
    const text = how();
    expect(text.startsWith("How to read a trade idea Helps you (0–100)")).toBe(true);
    expect(text).toContain("Overall combines the two: how much it helps, discounted by the chance it happens. Ideas are sorted by it unless you choose otherwise.");
    expect(text).toContain(
      "ROS points are each player's projected points for the rest of the season. Trade values are FantasyCalc's. Trades that wouldn't help you, or where you'd give up much more trade value than you get, are left out.",
    );
    expect(text).not.toContain("trade you built");
  });

  it("has the Trade Analyzer's own version: nothing ranked or left out there, and why the first offer can leave out a player of the trade built (review of the addendum)", () => {
    const text = how(undefined, "analyzer");
    expect(text.startsWith("How to read the evaluation Helps you (0–100)")).toBe(true);
    expect(text).toContain("It also counts trade value, so you keep some for later deals");
    expect(text).toContain("Chance they accept is an estimate (Est.), rounded to 5%");
    expect(text).toContain("Overall combines the two: how much it helps, discounted by the chance it happens. The Trade Finder ranks its trade ideas by it.");
    expect(text).toContain(HARDER);
    expect(text).toContain(
      "How to offer it shows when the trade is worth offering in two steps: offer the first version, and if they say no, add the player named, one you can spare (losing him costs your lineup little), which raises the chance they accept. If the trade you built gives a player you can spare along with someone else, the first version leaves him out, and adding him back gives the trade you built. The message to send them proposes the first version; the three numbers are for the trade you built.",
    );
    expect(text).toContain(
      "The Trade Finder leaves out trades that wouldn't help you, or where you'd give up much more trade value than you get; here they still show, with a warning.",
    );
    expect(text).not.toContain("Ideas are sorted by it");
    expect(text).not.toContain("are left out.");
    expect(how("keeper", "analyzer")).toContain("In a keeper league it also counts the change in your roster's long-term value");
  });

  it("opens from a 44 px summary, closed at first", () => {
    for (const page of ["finder", "analyzer"] as const) {
      const html = renderToStaticMarkup(createElement(HowToRead, { page }));
      expect(html).toMatch(/^<details class="[^"]*"><summary class="flex min-h-11 [^"]*">How to read (a trade idea|the evaluation)<\/summary>/);
      expect(html).not.toContain(" open");
    }
  });
});

describe("FeedbackControls", () => {
  it("names its group and keeps one status line mounted for what each press did", () => {
    const html = renderToStaticMarkup(createElement(FeedbackControls, { feedback: NONE, onChange: saved, tradeName: "Trade with Gravel Gophers" }));
    expect(textOf(html)).toContain("What happened with it?");
    expect(html).toMatch(/<p role="status" class="sr-only"><\/p>/);
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
    expect((html.match(/<label class="flex min-h-11/g) ?? []).length).toBe(8);
    expect(html).toMatch(/<button type="button" aria-disabled="true" class="[^"]*">Evaluate trade<\/button>/);
    expect(textOf(html)).toContain("Choose a team and at least one player to evaluate a trade.");
  });

  it("checks the drafted players, disables the rest of a full side and says why, and evaluates a complete trade", () => {
    const html = form({ partnerId: "2", give: ["101", "102", "104", "105"], get: ["203"] });
    expect((html.match(/checked=""/g) ?? []).length).toBe(5);
    expect((html.match(/disabled=""/g) ?? []).length).toBe(4);
    expect(textOf(html)).toContain("That's 4 players, the most a side can have here. Uncheck one to pick another.");
    expect(html).toMatch(/<legend class="[^"]*">You get from Gravel Gophers<\/legend>/);
    expect(html).toMatch(/<button type="button" class="[^"]*">Evaluate trade<\/button>/);
    expect(html).toMatch(/<button type="button" class="[^"]*">Clear players<\/button>/);
    expect(form({ partnerId: "2", give: ["101"], get: [] }, true)).toMatch(/<button type="button" aria-disabled="true" class="[^"]*">Evaluating…<\/button>/);
  });

  it("says my odds before this trade above the card, with what they count, and the card's odds with their end percents (review of Phase 4)", () => {
    const props = { stale: false, records: [], leagueKey: "espn:0000abcd", onFeedback: saved };
    const result = buildAnalysisView({ evaluation: evaluation({ dPO: 0.091, dCH: 0.039 }), illegal: null, notes: [], baseline: { pPlayoffs: 0.63, pTitle: 0.12 } }, snapshot);
    const html = renderToStaticMarkup(createElement(AnalysisResult, { view: result, ...props }));
    const text = textOf(html);
    expect(text).toContain(
      "The trade, evaluated Your odds before this trade: 63% to make the playoffs, 12% to win the title. Like the trade's numbers, they count the free-agent pickups that would help each team, so they can differ from the League page's odds, which take rosters as they stand. Trade with Gravel Gophers",
    );
    expect(text).toContain("Playoff odds +9.1 percentage points (63% to 72%) Title odds +3.9 percentage points (12% to 16%)");
    // Dimmed with the card when it's stale (the odds are the evaluation's).
    expect(renderToStaticMarkup(createElement(AnalysisResult, { view: result, ...props, stale: true }))).toMatch(/<div class="space-y-4 transition-opacity opacity-60"><div><p class="text-sm font-semibold">Your odds before this trade/);
    // Without them (no odds), no line.
    const plain = renderToStaticMarkup(createElement(AnalysisResult, { view: buildAnalysisView({ evaluation: evaluation(), illegal: null, notes: [] }, snapshot), ...props }));
    expect(plain).not.toContain("Your odds before");
  });

  it("shows the analyzed trade's steps on its card too (useful for counteroffers)", () => {
    const html = renderToStaticMarkup(createElement(AnalysisResult, { view: buildAnalysisView({ evaluation: steppedOffer(), illegal: null, notes: [] }, snapshot), stale: false, records: [], leagueKey: "espn:0000abcd", onFeedback: saved }));
    expect(textOf(html)).toContain("How to offer it Offer first: Wiggleton Spoons for Cornelius Snoot · , Est. 35% an estimated 35% chance they accept If they say no, add Tobias Thimble · , Est. 55%");
  });

  it("explains the card under it, as the Trade Finder does: Harder to get, How to offer it, and why the message proposes less than the trade built (review of the addendum)", () => {
    // The trade built: Spoons and Thimble for Snoot; the first offer leaves Thimble out (TradeSteps.ranked "full").
    const built = steppedFull();
    const result = (stale: boolean, leagueType?: "redraft" | "keeper" | "dynasty") =>
      renderToStaticMarkup(createElement(AnalysisResult, { view: buildAnalysisView({ evaluation: built, illegal: null, notes: [] }, snapshot), stale, records: [], leagueKey: "espn:0000abcd", leagueType, onFeedback: saved }));
    const html = result(false);
    const text = textOf(html);
    expect(text).toContain("How to read the evaluation");
    expect(text).toContain("Harder to get marks a player you'd get who is one of their two most valuable players and one of the top 12 players by trade value");
    expect(text).toContain("If the trade you built gives a player you can spare along with someone else, the first version leaves him out, and adding him back gives the trade you built. The message to send them proposes the first version; the three numbers are for the trade you built.");
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
