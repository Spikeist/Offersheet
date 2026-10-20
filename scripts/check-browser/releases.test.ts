/**
 * check:browser's release contract (Checkpoint 7f; planner reply to Checkpoint 7e, answer 4: "keep the rule, but the card must
 * say why"; contracts.ts releaseLineProblems): every line about a release at an IR return, a card's, a Plan B box's, an offer's
 * or the League page's "Returns from IR", reads as the app words it: the near-tie rule's reason in the planner's shape, never
 * after "instead of dropping someone else", its lock where it is (the League page's own card; on a trade page, "on the League
 * page": the review of Checkpoint 7f, INTEGRATION-5), and a release made with or without the trade named in the line of moves
 * made either way, names only (INTEGRATION-4). The app's own lines pass (tradeView.ts myMovesLines and releaseLine on a made-up
 * league, with NFL names for the planner's sentence).
 *
 * The reader (inPage.ts READ_RELEASE_LINES) runs here on the pages' own markup, rendered as they render it, through a tiny DOM
 * (React's static markup parsed; the reader's selector matched; textContent): the Trade Finder's list, `<main><ol><li
 * data-trade-key><TradeCard/></li></ol></main>`, a card with its "How to offer it" open and a Plan B box, and the League page.
 * The review of Checkpoint 7f, PIERCE-1: it read every `main li`, so each Trade Finder card, whose <li> holds the whole card,
 * came back as one more "line" and the contract failed the app's right words; it now reads the lists of roster moves alone
 * (`data-roster-moves`), and gets exactly their lines.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LeagueView } from "@/components/league/LeagueView";
import { NOW, leagueFixture } from "@/components/league/testFixtures";
import { OffersPanel, TradeCard } from "@/components/trades/TradeCard";
import { evaluation, tradeSnapshot } from "@/components/trades/testFixtures";
import type { PlayerInfo } from "@/engine/model";
import { planBFixture } from "@/engine/tradeTestFixtures";
import type { OfferLadder, RosterMoves } from "@/engine/tradeModel";
import { buildLeagueView } from "@/lib/leagueView";
import { buildLadderView, buildTradeCard, myMovesLines, releaseLine, type CardFeedback, type TradeCardView } from "@/lib/tradeView";
import { RELEASE_EITHER_WAY, RELEASE_REASON, releaseLineProblems } from "./contracts";
import { CARD_HELPERS, PAGE_HELPERS, READ_RELEASE_LINES, ROSTER_MOVE_LINES, cleanCall } from "./inPage";
import { nameRules } from "./report";

const base = tradeSnapshot();
const snapshot = { ...base, players: { ...base.players, "107": { ...(base.players["107"] as PlayerInfo), name: "Alec Pierce" }, "105": { ...(base.players["105"] as PlayerInfo), name: "Marvin Harrison Jr." }, "108": { ...(base.players["108"] as PlayerInfo), name: "Kyle Pitts Sr." }, "206": { ...(base.players["206"] as PlayerInfo), name: "Jordan Mason" } } };
const harrison = { keptInstead: "105", lockable: true };
// The planner's sentence since Checkpoint 7g (planner reply to Checkpoint 7f, answer 5), and a trade page's, whose lock is on the League page.
const PLANNER = "Week 7, when Alec Pierce returns from IR: release him. From week 7 on, he and Marvin Harrison Jr. add about the same to your starting lineup, and Harrison Jr. has more trade value. Lock Pierce to keep him instead.";
const ON_TRADES = "Week 7, when Alec Pierce returns from IR: release him. From week 7 on, he and Marvin Harrison Jr. add about the same to your starting lineup, and Harrison Jr. has more trade value. Lock Pierce on the League page to keep him instead.";

// ---------------------------------------------------------------------------------------------
// A tiny DOM of React's static markup: elements with their attributes and children, text decoded.

interface El {
  tag: string;
  attrs: Map<string, string>;
  kids: (El | string)[];
  parent: El | null;
}
const VOID = new Set(["area", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function parse(html: string): El {
  const root: El = { tag: "#document", attrs: new Map(), kids: [], parent: null };
  let top = root;
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[5] !== undefined) top.kids.push(decode(m[5]));
    else if (m[1] !== undefined) top = top.parent ?? top;
    else if (m[2] !== undefined) {
      const el: El = { tag: m[2].toLowerCase(), attrs: new Map(), kids: [], parent: top };
      for (const a of (m[3] ?? "").matchAll(/([^\s"'>/=]+)(?:="([^"]*)")?/g)) el.attrs.set((a[1] as string).toLowerCase(), decode(a[2] ?? ""));
      top.kids.push(el);
      if (m[4] !== "/" && !VOID.has(el.tag)) top = el;
    }
  }
  return root;
}

const textOf = (e: El): string => e.kids.map((k) => (typeof k === "string" ? k : textOf(k))).join("");

/** One compound selector: a tag (or any) and attribute filters ([name], [name=value], [name="value"]). */
interface Compound {
  tag: string | null;
  attrs: { name: string; value: string | null }[];
}
/** A selector of compounds joined by descendant (" ") and child (">") combinators: all the reader's selector needs. */
function compile(selector: string): { parts: Compound[]; joins: string[] } {
  const tokens = selector.trim().replace(/\s*>\s*/g, " > ").split(/\s+/);
  const parts: Compound[] = [];
  const joins: string[] = [];
  let join = " ";
  for (const t of tokens) {
    if (t === ">") {
      join = ">";
      continue;
    }
    const m = /^([a-zA-Z][\w-]*)?((?:\[[^\]]+\])*)$/.exec(t);
    if (!m) throw new Error(`the tiny DOM can't read the selector part “${t}”`);
    const attrs = [...(m[2] ?? "").matchAll(/\[([^\]=]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g)].map((a) => ({ name: (a[1] as string).toLowerCase(), value: a[2] ?? a[3] ?? a[4] ?? null }));
    if (parts.length) joins.push(join);
    parts.push({ tag: m[1] ? m[1].toLowerCase() : null, attrs });
    join = " ";
  }
  return { parts, joins };
}
function matchesAt(el: El, sel: ReturnType<typeof compile>, i: number): boolean {
  const c = sel.parts[i] as Compound;
  if ((c.tag && el.tag !== c.tag) || !c.attrs.every((a) => el.attrs.has(a.name) && (a.value === null || el.attrs.get(a.name) === a.value))) return false;
  if (i === 0) return true;
  if (sel.joins[i - 1] === ">") return !!el.parent && el.parent.tag !== "#document" && matchesAt(el.parent, sel, i - 1);
  for (let p = el.parent; p && p.tag !== "#document"; p = p.parent) if (matchesAt(p, sel, i - 1)) return true;
  return false;
}
/** The page's `document` for an in-page reader: querySelectorAll in document order, each match with its textContent. */
function documentOf(html: string) {
  const root = parse(html);
  const all: El[] = [];
  const walk = (e: El) => {
    for (const k of e.kids) {
      if (typeof k === "string") continue;
      all.push(k);
      walk(k);
    }
  };
  walk(root);
  return {
    querySelectorAll(selector: string) {
      const sel = compile(selector);
      return all.filter((e) => matchesAt(e, sel, sel.parts.length - 1)).map((e) => ({ textContent: textOf(e), getAttribute: (n: string) => e.attrs.get(n) ?? null }));
    },
  };
}
/** READ_RELEASE_LINES run on the markup (with the page helpers it needs; names left as they are). */
const readReleaseLines = (html: string): string[] => new Function("document", `${PAGE_HELPERS}\nconst clean = (t) => t || "";\n${READ_RELEASE_LINES}`)(documentOf(html)) as string[];

// ---------------------------------------------------------------------------------------------
// The pages' markup.

const NONE: CardFeedback = { outcome: null, report: null, version: null, versionKey: null, versionWords: null };
const saved = () => ({ ok: true as const });
const noop = () => {};

/**
 * The Trade Finder's list as the page renders it (TradeFinderPage.tsx: <ol><li data-trade-key><TradeCard/></li></ol> in main),
 * the card's "How to offer it" open with its offers in (the panel the page shows once they're worked out, in place of the
 * closed one: a static render runs no effect), and its Plan B box.
 */
function finderMarkup(card: TradeCardView, ladder: OfferLadder): string {
  const name = `trade idea 1, ${card.heading}`;
  const html = renderToStaticMarkup(
    createElement("main", null, createElement("ol", null, createElement("li", { "data-trade-key": card.key }, createElement(TradeCard, { card, rank: 1, feedback: NONE, onFeedback: saved, onOffers: () => Promise.resolve(buildLadderView(ladder, card, { snapshot })) })))),
  );
  const closed = renderToStaticMarkup(createElement(OffersPanel, { state: { kind: "idle" }, name, onRetry: noop }));
  const open = renderToStaticMarkup(createElement(OffersPanel, { state: { kind: "done", ladder: buildLadderView(ladder, card, { snapshot }) }, name, onRetry: noop }));
  expect(html.split(closed)).toHaveLength(2);
  return html.replace(closed, open);
}

describe("check:browser's release contract (Checkpoint 7f; planner reply to Checkpoint 7e, answer 4)", () => {
  it("passes the app's own lines: every release, with the reason or without, the ones made either way, and the keep lines", () => {
    const lines = myMovesLines(
      {
        moves: [
          { kind: "release", week: 7, player: "107", returner: "107", nearTie: harrison },
          { kind: "release", week: 7, player: "108", returner: "107", instead: "107", kept: true, nearTie: harrison },
          { kind: "release", week: 7, player: "107", returner: "107", instead: "108", kept: false, nearTie: { keptInstead: "105", lockable: false } },
          { kind: "release", week: 8, player: "107", returner: "107" },
          { kind: "keepAtReturn", week: 9, player: "108", returner: "107", returnerStays: true },
        ],
        assumed: [{ add: "901", drop: "106" }],
        assumedLater: [
          { week: 10, player: "107", returner: "107", nearTie: harrison },
          { week: 11, player: "108", returner: "107" },
        ],
      },
      snapshot,
      "Team 2",
    );
    expect(lines[0]).toBe(ON_TRADES);
    expect(lines).toHaveLength(6);
    expect(lines[5]).toBe("Assumed with or without this trade: add Floopy Freeman, drop Wiggleton Spoons; release Alec Pierce in week 10, when he returns from IR; release Kyle Pitts Sr. in week 11, when Alec Pierce returns from IR.");
    expect(releaseLineProblems(lines, "trade")).toEqual([]);
    expect(RELEASE_EITHER_WAY.test(lines[5] as string)).toBe(true);
    expect(RELEASE_EITHER_WAY.test("Assumed with or without this trade: release Alec Pierce in week 7, when he returns from IR.")).toBe(true);
    expect(RELEASE_EITHER_WAY.test("Assumed with or without this trade: add Jake Ferguson, drop Romeo Doubs, release Alec Pierce in week 7, when he returns from IR.")).toBe(true);
    // The League page's own words (the planner's sentence, word for word, its lock on that page).
    expect(releaseLine({ week: 7, player: "107", returner: "107", nearTie: harrison }, snapshot, { page: "league" })).toBe(PLANNER);
    expect(releaseLineProblems([PLANNER], "league")).toEqual([]);
    expect(RELEASE_REASON.test(PLANNER)).toBe(true);
    expect(RELEASE_REASON.test(ON_TRADES)).toBe(true);
  });

  it("names a reason in another shape, a reason after “instead of dropping someone else”, a lock in the wrong place, and a release made either way worded otherwise", () => {
    const page = "trade" as const;
    expect(releaseLineProblems(["Week 7, when Alec Pierce returns from IR: release him. From week 7 on, he and Marvin Harrison Jr. add about the same to your starting lineup, and Harrison Jr. is worth 900."], page)).toHaveLength(1);
    expect(releaseLineProblems(["Week 7, when Alec Pierce returns from IR: release him instead of dropping someone else. From week 7 on, he and Marvin Harrison Jr. add about the same to your starting lineup, and Harrison Jr. has more trade value."], page)).toEqual([
      "a release with a reason still says “instead of dropping someone else”: “Week 7, when Alec Pierce returns from IR: release him instead of dropping someone else. From week 7 on, he and Marvin Harrison Jr. add about the same to your starting lineup, and Harrison Jr. has more trade value.”",
    ]);
    // Checkpoint 7f's words are gone (planner reply to Checkpoint 7f, answer 5).
    const old = "Week 7, when Alec Pierce returns from IR: release him. He and Marvin Harrison Jr. are nearly even for your lineup, and Harrison Jr. has more trade value. Lock Pierce to keep him instead.";
    expect(releaseLineProblems([old], "league")).toEqual([`a release's reason reads “${old}”`]);
    // The reason counts from the line's own return week, and from then on in a line without one.
    const later = PLANNER.replace("From week 7 on", "From week 8 on");
    expect(releaseLineProblems([later], "league")).toEqual([`a release's reason doesn't count from its return week: “${later}”`]);
    const then = PLANNER.replace("From week 7 on", "From then on");
    expect(releaseLineProblems([then], "league")).toEqual([`a release's reason doesn't count from its return week: “${then}”`]);
    const noWeek = then.replace("Week 7, when", "When");
    expect(releaseLineProblems([noWeek], "league")).toEqual([]);
    const noWeekWithOne = PLANNER.replace("Week 7, when", "When");
    expect(releaseLineProblems([noWeekWithOne], "league")).toEqual([`a release's reason doesn't count from its return week: “${noWeekWithOne}”`]);
    // A trade page has no lock: its sentence says the lock is on the League page; the League page's doesn't send you there.
    expect(releaseLineProblems([PLANNER], "trade")).toEqual([`a release's lock doesn't say it's on the League page: “${PLANNER}”`]);
    expect(releaseLineProblems([ON_TRADES], "league")).toEqual([`the League page's lock sends you to the League page: “${ON_TRADES}”`]);
    // A release made either way: in the line of moves made either way, names only, never a line of its own (Checkpoint 7f's
    // first words) nor with its reason.
    const own = "Week 7, when Alec Pierce returns from IR: release him, with or without this trade.";
    expect(releaseLineProblems([own], page)).toEqual([`a release made either way reads “${own}”`]);
    const reasoned = "Assumed with or without this trade: release Alec Pierce in week 7, when he returns from IR. From week 7 on, he and Marvin Harrison Jr. add about the same to your starting lineup, and Harrison Jr. has more trade value.";
    expect(releaseLineProblems([reasoned], page)).toContain(`a release made either way reads “${reasoned}”`);
    expect(releaseLineProblems(["Week 7, when Alec Pierce returns from IR: with or without this trade, release him."], page)).toEqual(["a release made either way reads “Week 7, when Alec Pierce returns from IR: with or without this trade, release him.”"]);
  });

  it("reads the Trade Finder's line above its list in the cards' words for “a trade” (Checkpoint 7h: “Assumed with or without this trade” once, above the list)", () => {
    expect(releaseLineProblems(["Assumed with or without a trade: add Jake Ferguson, drop Romeo Doubs, release Alec Pierce in week 7, when he returns from IR."], "trade")).toEqual([]);
    const bad = "Assumed with or without a trade: Week 7, when Alec Pierce returns from IR, release him.";
    expect(releaseLineProblems([bad], "trade")).toEqual([`a release made either way reads “${bad}”`]);
  });

  it("reads exactly the release lines of the Trade Finder's markup: a card with its offers open and its Plan B box, never a card's or an offer's own list item (review of Checkpoint 7f, PIERCE-1)", () => {
    // My moves on the card: a line that isn't about a release, a release the trade changes (with why), and one made either way.
    const cardMoves: RosterMoves = {
      moves: [
        { kind: "makeRoom", week: 6, drop: ["108"], for: ["204"] },
        { kind: "release", week: 7, player: "104", returner: "107", instead: "107", kept: true, nearTie: harrison },
      ],
      assumed: [{ add: "901", drop: null }],
      assumedLater: [{ week: 9, player: "206", returner: "206", nearTie: harrison }],
    };
    const boxMoves: RosterMoves = { moves: [{ kind: "release", week: 7, player: "107", returner: "107", nearTie: harrison }], assumed: [] };
    const e = { ...evaluation({ detail: { myTeamId: "1" }, b: 3 }), myMoves: cardMoves, planB: { ...planBFixture({ partnerId: "2", give: ["103"], get: ["205"] }), myMoves: boxMoves } };
    const card = buildTradeCard(e, { snapshot, offers: "finder" });
    expect(card.planB).not.toBeNull();
    // Its offers: an Open whose roster moves aren't the card's, then the card.
    const openMoves: RosterMoves = { moves: [{ kind: "release", week: 7, player: "108", returner: "107", nearTie: harrison }], assumed: [], assumedLater: [{ week: 9, player: "206", returner: "206" }] };
    const open = { ...evaluation({ detail: { myTeamId: "1" }, get: ["202", "204"], b: 4.2, pAccept: 0.15, pComplete: 0.15 }), myMoves: openMoves };
    const ladder: OfferLadder = {
      cardKey: card.key,
      steps: [
        { kind: "open", evaluation: open, message: "Hey! Would you trade Wiggleton Spoons for Mortimer Gloop and Cornelius Snoot?" },
        { kind: "suggested", evaluation: e, message: "Thanks for considering it!" },
      ],
    };
    const view = buildLadderView(ladder, card, { snapshot });
    const html = finderMarkup(card, ladder);
    // The lines the app means: the card's (in its Details), then the open offer's, then its box's (since Checkpoint 7h both in
    // "How to offer it", after Details: the page's order), each about a release.
    const about = (lines: readonly string[]) => lines.filter((l) => / returns from IR\b/.test(l));
    const want = [...about(card.required), ...about(view.steps[0]?.moves ?? []), ...about(card.planB?.moves ?? [])];
    expect(want).toEqual([
      "Week 7, when Alec Pierce returns from IR: release Noodle McSprocket (WR) and keep Alec Pierce. From week 7 on, McSprocket and Marvin Harrison Jr. add about the same to your starting lineup, and Harrison Jr. has more trade value. Lock McSprocket on the League page to keep him instead.",
      "Assumed with or without this trade: add Floopy Freeman, release Jordan Mason in week 9, when he returns from IR.",
      "Week 7, when Alec Pierce returns from IR: release Kyle Pitts Sr. (TE). From week 7 on, he and Marvin Harrison Jr. add about the same to your starting lineup, and Harrison Jr. has more trade value. Lock Pitts Sr. on the League page to keep him instead.",
      "Assumed with or without this trade: release Jordan Mason in week 9, when he returns from IR.",
      ON_TRADES,
    ]);
    const read = readReleaseLines(html);
    expect(read).toEqual(want);
    expect(releaseLineProblems(read, "trade")).toEqual([]);
    // Every list item of the roster moves, the line that isn't about a release too, and nothing else.
    expect(documentOf(html).querySelectorAll(ROSTER_MOVE_LINES).map((li) => li.textContent)).toEqual([...card.required, ...(view.steps[0]?.moves ?? []), ...(card.planB?.moves ?? [])]);
    // The old reader (every `main li`) also took the card's and the offer's own list items, whose text holds every line: the
    // contract failed the app's own words.
    const old = documentOf(html)
      .querySelectorAll("main li")
      .map((li) => li.textContent.replace(/\s+/g, " ").trim())
      .filter((t) => / returns from IR: /.test(t));
    expect(old.length).toBeGreaterThan(read.filter((l) => / returns from IR: /.test(l)).length);
    expect(releaseLineProblems(old, "trade").length).toBeGreaterThan(0);
  });

  it("reads exactly the League page's “Returns from IR” (my roster card), whose lock is on that card", () => {
    const f = leagueFixture();
    f.model.teams = f.model.teams.map((t) =>
      t.id === "1"
        ? {
            ...t,
            displacedWithPickups: [
              { id: "108", week: 15, returner: "107", keptInstead: "106" },
              { id: "107", week: 16, returner: "107" },
            ],
          }
        : t,
    );
    const view = buildLeagueView({ ...f, myTeamSource: "platform", timeZone: "America/Chicago", now: NOW });
    const html = renderToStaticMarkup(createElement("main", null, createElement(LeagueView, { view })));
    const read = readReleaseLines(html);
    expect(read).toEqual([
      "Week 15, when Humbert Fiddlesticks returns from IR: release Tobias Thimble (TE). From week 15 on, he and Wiggleton Spoons add about the same to your starting lineup, and Spoons has more trade value. Lock Thimble to keep him instead.",
      "Week 16, when Humbert Fiddlesticks returns from IR: release him instead of dropping someone else.",
    ]);
    expect(read).toEqual(view.rosters.find((r) => r.isMine)?.returns);
    expect(releaseLineProblems(read, "league")).toEqual([]);
  });

  it("its reader compiles with the cleaning prelude (TypeScript never checks it) and reads the lists of roster moves", () => {
    const clean = cleanCall(nameRules({ leagueName: "Fictional League", teams: [{ id: "3", name: "Gravel Gophers", ownerName: "Rowan Vale" }], players: [] }, [["12345", "<league id>"]]));
    expect(() => new Function(`return (async () => {\n${PAGE_HELPERS}\n${CARD_HELPERS}\n${clean}\n${READ_RELEASE_LINES}\n})`)).not.toThrow();
    expect(ROSTER_MOVE_LINES).toBe("main [data-roster-moves] > li");
    expect(READ_RELEASE_LINES).toContain(`querySelectorAll(${JSON.stringify(ROSTER_MOVE_LINES)})`);
    expect(READ_RELEASE_LINES).toContain("clean(txt(li))");
    expect(READ_RELEASE_LINES).not.toContain('"main li"');
  });
});
