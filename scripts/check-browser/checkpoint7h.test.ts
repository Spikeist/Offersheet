/**
 * check:browser's Checkpoint 7h checks without a browser (planner reply to Checkpoint 7g; steps7h.ts, contracts7h.ts,
 * inPage7h.ts): the contracts on what the app itself prints (the what-if's words from the real engine on a hand league:
 * src/lib/whatIfView.ts on evaluate.ts analyzeWhatIf, as whatIfView.test.ts builds them; the waiver rows' odds lines from
 * waiversView.ts waiverOddsLines; the Thorough search's help from TradeFinderPage.tsx thoroughHelp and engine thorough.ts) and
 * on reads that break each rule, and a syntax check of the in-page JavaScript, which TypeScript never sees. The steps themselves
 * need the production build and Chrome: the live script is their test (and the track's offline harness ran them on the real
 * components: S\7h\build-browser.md). Every name here is fictional.
 */
import { describe, expect, it } from "vitest";
import { THOROUGH_LABEL as APP_THOROUGH_LABEL, thoroughHelp } from "@/components/trades/TradeFinderPage";
import { analyzeWhatIf, buildTradeContext } from "@/engine/evaluate";
import { defaultTradeSettings, type TradeSettings } from "@/engine/settings";
import { TEST_NOW } from "@/engine/testLeague";
import { thoroughSeconds } from "@/engine/thorough";
import { handLeague } from "@/engine/trade.testing";
import { ANALYZER_MODES, WHAT_IF_ODDS_ONLY, WHAT_IF_OTHER_TEAMS, buildWhatIfView, whatIfStatus, type WhatIfView } from "@/lib/whatIfView";
import { ODDS_FRAME, waiverOddsLines } from "@/lib/waiversView";
import { contextBaseline } from "@/workers/engine.worker";
import { releaseLineProblems } from "./contracts";
import {
  THOROUGH_HELP,
  TITLE_ODDS_VALUE,
  WHAT_IF_CARD_HEADING,
  WHAT_IF_SECTION_HEADING,
  WHOLE_ODDS_VALUE,
  asTradeWords,
  newIdeas,
  oddsOrderProblems,
  oddsValueProblems,
  oversizedIdeas,
  sameIdeasProblems,
  thoroughEstimate,
  thoroughSummaryProblems,
  thoroughSwitchProblems,
  waiverDetailsProblems,
  waiverOddsCoverageProblems,
  weeklyItemProblems,
  whatIfProblems,
  whatIfSwitchProblems,
  type IdeaSummary,
  type ThoroughSwitchRead,
  type WaiverRowRead,
  type WhatIfRead,
} from "./contracts7h";
import { CARD_HELPERS, PAGE_HELPERS, cleanCall } from "./inPage";
import { READ_FINDER_SUMMARY, READ_WAIVER_ODDS, READ_WHAT_IF, READ_WHAT_IF_CHOICES, READ_WHAT_IF_MOVES, READ_WHAT_IF_SWITCH, WHAT_IF_HELPERS, readThorough, readWaiverRow, thoroughSwitch, waiverDetailsButton, whatIfRow } from "./inPage7h";
import { nameRules } from "./report";
import { THOROUGH_LABEL, thoroughEstimates, withWhatIf } from "./steps7h";

// ---------------------------------------------------------------------------------------------
// The in-page JavaScript

describe("Checkpoint 7h's in-page JavaScript", () => {
  const clean = cleanCall(nameRules({ leagueName: "Fictional League", teams: [{ id: "3", name: "Gravel Gophers", ownerName: 'quote " and \\ slash' }], players: [] }, [["12345", "<league id>"]]));
  const body = (reader: string) => `return (async () => {\n${PAGE_HELPERS}\n${CARD_HELPERS}\n${clean}\n${reader}\n})`;

  it("compiles: the what-if helpers and readers, the waiver rows' readers, the Thorough search's", () => {
    for (const reader of [
      WHAT_IF_HELPERS + READ_WHAT_IF_SWITCH,
      WHAT_IF_HELPERS + READ_WHAT_IF_CHOICES,
      WHAT_IF_HELPERS + READ_WHAT_IF,
      WHAT_IF_HELPERS + READ_WHAT_IF_MOVES,
      readWaiverRow('a "quoted" \\ id'),
      READ_WAIVER_ODDS,
      readThorough(THOROUGH_LABEL),
      READ_FINDER_SUMMARY,
    ]) {
      expect(() => new Function(body(reader)), reader.slice(0, 60)).not.toThrow();
    }
  });

  it("compiles the expressions the steps wait on or tap", () => {
    for (const expression of [
      withWhatIf(`whatIfModeButton("What if")`),
      withWhatIf(whatIfRow("take", 0)),
      withWhatIf(whatIfRow("put", 3)),
      withWhatIf("whatIfEvaluate()"),
      withWhatIf(`(() => { const s = whatIfStatus() || ""; return /^Evaluated/.test(s); })()`),
      waiverDetailsButton('x"y'),
      thoroughSwitch(THOROUGH_LABEL),
    ]) {
      expect(() => new Function(body(`return (${expression});`)), expression.slice(0, 60)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The odds lines' forms

describe("the odds lines' forms (the cards': tradeView.ts oddsViews)", () => {
  it("reads the title's one decimal and the others' whole percents, before → after, the edges included", () => {
    for (const v of ["8.9% → 9.2%", "<0.1% → 0.3%", "99.8% → >99.9%", "100.0% → 100.0%"]) expect(v).toMatch(TITLE_ODDS_VALUE);
    for (const v of ["61% → 62%", "<1% → 2%", "98% → >99%", "100% → 100%"]) expect(v).toMatch(WHOLE_ODDS_VALUE);
    for (const v of ["61% → 62%", "8.9%", "+4.1 percentage points", "8.9% -> 9.2%"]) expect(v).not.toMatch(TITLE_ODDS_VALUE);
    for (const v of ["8.9% → 9.2%", "61%", "+4 percentage points"]) expect(v).not.toMatch(WHOLE_ODDS_VALUE);
  });

  it("fails a line that shows a change only, or a title in whole percents; passes “unknown”", () => {
    expect(oddsValueProblems([{ label: "Title odds", value: "unknown" }, { label: "Playoff odds", value: "61% → 62%" }], "x")).toEqual([]);
    expect(oddsValueProblems([{ label: "Title odds", value: "9% → 9%" }], "x")).toHaveLength(1);
    expect(oddsValueProblems([{ label: "Top 3 odds", value: "+2 percentage points" }], "x")).toHaveLength(1);
  });

  it("orders them: title, the top-N line exactly when called for, playoffs", () => {
    expect(oddsOrderProblems(["Title odds", "Playoff odds"], null, "x")).toEqual([]);
    expect(oddsOrderProblems(["Title odds", "Top 3 odds", "Playoff odds"], 3, "x")).toEqual([]);
    expect(oddsOrderProblems(["Title odds", "Playoff odds"], 3, "x")).toHaveLength(1);
    expect(oddsOrderProblems(["Title odds", "Top 2 odds", "Playoff odds"], null, "x")).toHaveLength(1);
    expect(oddsOrderProblems(["Playoff odds", "Title odds"], null, "x")).toHaveLength(1);
  });

  it("reads the weekly line week by week", () => {
    expect(weeklyItemProblems(null, "x")).toEqual([]);
    expect(weeklyItemProblems({ label: "Win chance by week", items: ["Week 6: 62% → 66%", "Week 13: <1% → 3%"] }, "x")).toEqual([]);
    expect(weeklyItemProblems({ label: "Win chance", items: ["Week 6: 62% → 66%"] }, "x")).toHaveLength(1);
    expect(weeklyItemProblems({ label: "Win chance by week", items: ["Week 6: 62 → 66"] }, "x")).toHaveLength(1);
    expect(weeklyItemProblems({ label: "Win chance by week", items: [] }, "x")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Section 4: "What if"

/** A hand league (4 teams of 10, team "1" mine), as whatIfView.test.ts builds it, and the worker's answer. */
function whatIfView(proposal: { remove: string[]; add: string[] }, settings: TradeSettings = defaultTradeSettings()): WhatIfView {
  const built = handLeague();
  const ctx = buildTradeContext(built.snapshot, built.inputs, { now: TEST_NOW, scenarios: 0 });
  return buildWhatIfView({ ...analyzeWhatIf(ctx, proposal, { settings }), baseline: contextBaseline(ctx) }, built.snapshot);
}

/** What the page shows of a view, as READ_WHAT_IF reads it (the panel's markup: WhatIfPanel.tsx WhatIfResultView, WhatIfCard). */
function readOf(view: WhatIfView, address: WhatIfRead["address"]): WhatIfRead {
  const c = view.card;
  return {
    panel: true,
    status: whatIfStatus(view),
    section: true,
    heading: WHAT_IF_SECTION_HEADING,
    illegal: view.illegal,
    lines: [view.baseline, view.baselineNote, view.helpsInfo, view.otherTeams].filter((l): l is string => !!l),
    card: c
      ? {
          heading: WHAT_IF_CARD_HEADING,
          helps: c.helps.value,
          lines: [c.helpsNote, c.odds.map((o) => `${o.label} ${o.value}`).join(" · "), c.ros, ...(c.rosNote ? [c.rosNote] : [])],
          odds: c.odds.map((o) => ({ label: o.label, value: o.value })),
          weekly: c.weekly ? { label: c.weekly.label, items: c.weekly.weeks.map((w) => w.text) } : null,
          removed: c.remove.length,
          added: c.add.length,
        }
      : null,
    labels: ["Helps you", "Your lineup"],
    buttons: [],
    text: JSON.stringify(view),
    address,
  };
}

describe("“What if” (section 4)", () => {
  const address = { mode: "whatif", remove: ["q1"], add: ["ra2"], others: [] };
  const expect1 = { oddsOnly: WHAT_IF_ODDS_ONLY, otherTeams: WHAT_IF_OTHER_TEAMS, removed: 1, added: 1, places: null };

  it("the app's own result passes: a starter off and another team's player on", () => {
    const view = whatIfView({ remove: ["q1"], add: ["ra2"] });
    expect(view.card).not.toBeNull();
    expect(whatIfProblems(readOf(view, address), expect1)).toEqual([]);
  });

  it("under “Several prizes” paying 3rd place, the top-3 line is called for and there", () => {
    const view = whatIfView({ remove: ["q1"], add: ["ra2"] }, { ...defaultTradeSettings(), goal: "prizes" });
    expect(whatIfProblems(readOf(view, address), { ...expect1, places: 3 })).toEqual([]);
    expect(whatIfProblems(readOf(view, address), expect1)).toHaveLength(1);
  });

  it("a change that can't be made fails with its words; so does a page with no result", () => {
    const view = whatIfView({ remove: ["ra2"], add: [] });
    expect(whatIfProblems(readOf(view, { ...address, remove: ["ra2"], add: [] }), expect1)).toEqual(["the change can't be made: “Testy McTest ra2 isn't on your active roster or IR.”"]);
    const read = readOf(whatIfView({ remove: ["q1"], add: ["ra2"] }), address);
    expect(whatIfProblems({ ...read, panel: false }, expect1)).toEqual(["the “What if” panel isn't shown"]);
    expect(whatIfProblems({ ...read, section: false }, expect1)).toHaveLength(1);
  });

  it("fails each missing part and each trade-offer part, one problem each", () => {
    const read = readOf(whatIfView({ remove: ["q1"], add: ["ra2"] }), address);
    const card = read.card as NonNullable<WhatIfRead["card"]>;
    const one = (r: WhatIfRead) => whatIfProblems(r, expect1).length;
    expect(one({ ...read, lines: read.lines.filter((l) => l !== WHAT_IF_OTHER_TEAMS) })).toBe(1);
    expect(one({ ...read, card: { ...card, lines: card.lines.filter((l) => l !== WHAT_IF_ODDS_ONLY) } })).toBe(1);
    expect(one({ ...read, card: { ...card, helps: "—" } })).toBe(1);
    expect(one({ ...read, status: "Evaluated: Helps you 99." })).toBe(1);
    expect(one({ ...read, card: { ...card, odds: card.odds.map((o) => ({ ...o, value: "+1 percentage point" })) } })).toBe(card.odds.length);
    expect(one({ ...read, card: { ...card, odds: card.odds.slice(1) } })).toBe(1);
    expect(one({ ...read, card: { ...card, added: 0 } })).toBe(1);
    expect(one({ ...read, labels: [...read.labels, "Chance they accept"] })).toBe(1);
    expect(one({ ...read, labels: [...read.labels, "Overall"] })).toBe(1);
    expect(one({ ...read, buttons: ["Sent", "Report a problem"] })).toBe(2);
    expect(one({ ...read, buttons: ["How to offer it"] })).toBe(1);
    expect(one({ ...read, text: `${read.text} If they won't move: try …` })).toBe(1);
    expect(one({ ...read, address: { ...address, others: ["partner"] } })).toBe(1);
    expect(one({ ...read, address: { ...address, mode: null } })).toBe(1);
    expect(one({ ...read, address: { ...address, add: [] } })).toBe(1);
  });

  it("the mode switch: the app's two buttons, 44 px, the one pressed alone", () => {
    const labels = ANALYZER_MODES.map((m) => m.label);
    expect(labels).toEqual(["Trade with a team", "What if"]);
    const read = (pressed: string, h = 44) => ({ buttons: labels.map((label) => ({ label, pressed: String(label === pressed), height: h, width: 120 })) });
    expect(whatIfSwitchProblems(read("What if"), labels, "What if")).toEqual([]);
    expect(whatIfSwitchProblems(read("Trade with a team"), labels, "What if")).toHaveLength(1);
    expect(whatIfSwitchProblems(read("What if", 32), labels, "What if")).toHaveLength(2);
    expect(whatIfSwitchProblems(null, labels, "What if")).toHaveLength(1);
  });

  it("its releases read as a trade card's once “this change” reads “this trade”", () => {
    const line = "Assumed with or without this change: release Alec Pierce in week 7, when he returns from IR.";
    expect(releaseLineProblems([line], "trade")).toEqual([]);
    expect(asTradeWords(line)).toBe("Assumed with or without this trade: release Alec Pierce in week 7, when he returns from IR.");
    expect(releaseLineProblems([asTradeWords(line)], "trade")).toEqual([]);
    expect(releaseLineProblems([asTradeWords("Assumed with or without this change: release him, with or without this change.")], "trade")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Section 5: the waiver rows' odds lines

/** A row's "Details" as readWaiverRow reads it. */
function row(over: Partial<WaiverRowRead> = {}): WaiverRowRead {
  return { found: true, expanded: "false", controls: true, hidden: true, focused: false, height: 44, width: 80, frame: null, odds: [], text: "", active: "the page", ...over };
}

describe("Waiver upgrades' odds lines (section 5)", () => {
  const odds = { before: { pPlayoffs: 0.61, prizes: { first: 0.089, second: 0.1, third: 0.08, weeklyHigh: 0, pointsLeader: 0 } }, after: { pPlayoffs: 0.62, prizes: { first: 0.092, second: 0.1, third: 0.08, weeklyHigh: 0, pointsLeader: 0 } } };
  const lines = (reward: Parameters<typeof waiverOddsLines>[1]) => (waiverOddsLines(odds, reward) ?? []).map((o) => ({ label: o.label, value: o.value }));
  const frame = `${ODDS_FRAME} (from 20,000 simulated seasons)`;
  const expect1 = { rated: true, frame: ODDS_FRAME, places: null };

  it("the app's own lines pass, a tap opening and another folding the row, focus kept", () => {
    const open = row({ expanded: "true", hidden: false, focused: true, frame, odds: lines(null) });
    expect(waiverDetailsProblems(row(), open, row({ focused: true }), expect1)).toEqual([]);
    const prizes = { goal: "prizes" as const, shares: { first: 0.44, second: 0.36, third: 0.2, weeklyHigh: 0, pointsLeader: 0 } };
    expect(lines(prizes).map((l) => l.label)).toEqual(["Title odds", "Top 3 odds", "Playoff odds"]);
    expect(waiverDetailsProblems(row(), { ...open, odds: lines(prizes) }, row({ focused: true }), { ...expect1, places: 3 })).toEqual([]);
  });

  it("fails a tap that doesn't open it, focus lost, a frame or lines otherwise, or a fold that stays open", () => {
    const open = row({ expanded: "true", hidden: false, focused: true, frame, odds: lines(null) });
    const closed = row({ focused: true });
    expect(waiverDetailsProblems(row(), { ...open, expanded: "false", hidden: true }, closed, expect1).length).toBeGreaterThan(0);
    expect(waiverDetailsProblems(row(), { ...open, focused: false }, closed, expect1)).toHaveLength(1);
    expect(waiverDetailsProblems(row(), { ...open, frame: "without a pickup" }, closed, expect1)).toHaveLength(1);
    expect(waiverDetailsProblems(row(), { ...open, frame: null }, closed, expect1)).toHaveLength(1);
    expect(waiverDetailsProblems(row(), { ...open, odds: lines(null).reverse() }, closed, expect1)).toHaveLength(1);
    expect(waiverDetailsProblems(row(), open, row({ expanded: "true", hidden: false, focused: true }), expect1)).toHaveLength(1);
    expect(waiverDetailsProblems(row(), open, row(), expect1)).toHaveLength(1);
    expect(waiverDetailsProblems(row({ height: 30 }), open, closed, expect1)).toHaveLength(1);
    expect(waiverDetailsProblems(row({ found: false }), open, closed, expect1)).toEqual(["the row has no “Details” button"]);
    // A list in points shows none.
    expect(waiverDetailsProblems(row(), open, closed, { ...expect1, rated: false })).toHaveLength(1);
  });

  it("odds on every move that can be made on a rated list, none on a move that can't, none on a list in points", () => {
    const rows = [
      { blocked: false, odds: true, labels: [] },
      { blocked: true, odds: false, labels: [] },
    ];
    expect(waiverOddsCoverageProblems(rows, true, "Rest of season")).toEqual([]);
    expect(waiverOddsCoverageProblems([{ blocked: false, odds: false, labels: [] }], true, "Rest of season")).toHaveLength(1);
    expect(waiverOddsCoverageProblems([{ blocked: true, odds: true, labels: [] }], true, "Rest of season")).toHaveLength(1);
    expect(waiverOddsCoverageProblems([{ blocked: false, odds: false, labels: [] }], false, "This week")).toEqual([]);
    expect(waiverOddsCoverageProblems([{ blocked: false, odds: true, labels: [] }], false, "This week")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Section 3: the Thorough search

describe("the Thorough search (section 3)", () => {
  const sw = (over: Partial<ThoroughSwitchRead> = {}): ThoroughSwitchRead => ({ found: true, label: THOROUGH_LABEL, role: "switch", checked: false, help: thoroughHelp(45), height: 44, width: 180, ...over });

  it("its words are the page's (TradeFinderPage.tsx): the label, and the help with its estimate", () => {
    expect(THOROUGH_LABEL).toBe(APP_THOROUGH_LABEL);
    for (const n of [5, 45, 120]) expect(thoroughEstimate(thoroughHelp(n))).toBe(n);
    expect(thoroughHelp(45)).toMatch(THOROUGH_HELP);
  });

  it("the estimates a tab can show: the normal searches' totals × the work ratio, or the default rate", () => {
    expect(thoroughEstimates([], 9)).toEqual([thoroughSeconds(null, 9)]);
    expect(thoroughEstimates([9_000, Number.NaN, 0], 9)).toEqual([thoroughSeconds(null, 9), thoroughSeconds(9_000, 9)]);
  });

  it("the switch: there, a 44 px switch, off by default, its help with an estimate this tab can show", () => {
    const allowed = thoroughEstimates([9_000], 9);
    const help = thoroughHelp(allowed[1] as number);
    expect(thoroughSwitchProblems(sw({ help }), { label: THOROUGH_LABEL, checked: false, seconds: allowed })).toEqual([]);
    expect(thoroughSwitchProblems(sw({ help: thoroughHelp(999) }), { label: THOROUGH_LABEL, checked: false, seconds: allowed })).toHaveLength(1);
    expect(thoroughSwitchProblems(sw({ help: thoroughHelp(999) }), { label: THOROUGH_LABEL, checked: false, seconds: [] })).toEqual([]);
    expect(thoroughSwitchProblems(sw({ checked: true }), { label: THOROUGH_LABEL, checked: false, seconds: [] })).toHaveLength(1);
    expect(thoroughSwitchProblems(sw({ role: null }), { label: THOROUGH_LABEL, checked: false, seconds: [] })).toHaveLength(1);
    expect(thoroughSwitchProblems(sw({ height: 20 }), { label: THOROUGH_LABEL, checked: false, seconds: [] })).toHaveLength(1);
    expect(thoroughSwitchProblems(sw({ help: "Takes a while." }), { label: THOROUGH_LABEL, checked: false, seconds: [] })).toHaveLength(1);
    expect(thoroughSwitchProblems(sw({ found: false }), { label: THOROUGH_LABEL, checked: false, seconds: [] })).toHaveLength(1);
  });

  it("the settings line: 3 a side while it's on, as before once it's off", () => {
    const before = "Up to 2 players a side.";
    expect(thoroughSummaryProblems(before, "Up to 3 players a side.", before, 3)).toEqual([]);
    expect(thoroughSummaryProblems(before, before, before, 3)).toHaveLength(1);
    expect(thoroughSummaryProblems(before, "Up to 3 players a side.", "Up to 3 players a side.", 3)).toHaveLength(1);
  });

  it("the ideas: the same list back, how many new, none over 3 a side", () => {
    const idea = (heading: string, give: string[], get: string[], helps = "40"): IdeaSummary => ({ heading, give, get, helps, accept: "35%", overall: "18" });
    const normal = [idea("Trade with Team 2", ["A"], ["B"]), idea("Trade with Team 4", ["C"], ["D", "E"])];
    expect(sameIdeasProblems(normal, normal.map((i) => ({ ...i })))).toEqual([]);
    expect(sameIdeasProblems(normal, normal.slice(0, 1))).toHaveLength(1);
    expect(sameIdeasProblems(normal, [normal[0] as IdeaSummary, { ...(normal[1] as IdeaSummary), helps: "41" }])).toHaveLength(1);
    expect(newIdeas(normal, [idea("Trade with Team 4", ["C"], ["E", "D"]), idea("Trade with Team 5", ["A", "C", "F"], ["G"])])).toBe(1);
    expect(oversizedIdeas([idea("x", ["A", "B", "C"], ["D"]), idea("y", ["A", "B", "C", "D"], ["E"])], 3)).toEqual(["idea 2: 4 for 1"]);
  });
});
