/**
 * check:browser on a promoted idea's "Open with" (Checkpoint 7h; planner reply to Checkpoint 7g, answer 3: "that version becomes
 * the idea; the original becomes its "Open with" step, the bigger ask"; the first review's item 5): the engine places the idea a
 * card was promoted from as its "Open with" whatever the Open's rule would pick, so it can print under
 * config.offers.openMinChance, never under the minimum chance (offers.ts forcedOpenOk). The view carries the mark
 * (OfferStepView.original), the card puts it on the offer's item (data-offer-original), the card step's reader reads it
 * (inPage.ts offersData) and the offers contract holds that Open to the minimum chance alone (contracts.ts offersProblems):
 * here end to end on a real promoting search (smallLeague 19, 6 teams, 8 scenarios, at least 10%: its Overall idea 4 is a
 * promoted smaller ask whose original prints 10%; the first review's driver found it), the panel rendered as the card renders
 * it and read by the reader itself through a tiny DOM (React's static markup parsed; the element methods the reader calls).
 * Synthetic league (trade.testing.ts smallLeague: made-up players, placeholder teams).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OffersPanel } from "@/components/trades/TradeCard";
import { config } from "@/engine/config";
import { buildTradeContext } from "@/engine/evaluate";
import { offerLadderOfSearch } from "@/engine/offers";
import { runTradeSearch } from "@/engine/search";
import { defaultTradeSettings } from "@/engine/settings";
import { TEST_NOW } from "@/engine/testLeague";
import { smallLeague } from "@/engine/trade.testing";
import { ANALYZER_SUGGESTED_LABEL, OFFER_STEP_LABEL, buildFinderView, buildLadderView } from "@/lib/tradeView";
import { offersProblems, type OffersRead } from "./contracts";
import { CARD_HELPERS, PAGE_HELPERS } from "./inPage";

// ---------------------------------------------------------------------------------------------
// A tiny DOM: elements with attributes, children and text; selectors of one compound (a tag, classes and [attr] filters).

interface Node_ {
  tagName: string;
  attrs: Map<string, string>;
  childNodes: (Node_ | string)[];
  parentElement: Node_ | null;
}
const VOID = new Set(["area", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function parse(html: string): Node_ {
  const root: Node_ = { tagName: "#DOCUMENT", attrs: new Map(), childNodes: [], parentElement: null };
  let top = root;
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[5] !== undefined) top.childNodes.push(decode(m[5]));
    else if (m[1] !== undefined) top = top.parentElement ?? top;
    else if (m[2] !== undefined) {
      const el: Node_ = { tagName: m[2].toUpperCase(), attrs: new Map(), childNodes: [], parentElement: top };
      for (const a of (m[3] ?? "").matchAll(/([^\s"'>/=]+)(?:="([^"]*)")?/g)) el.attrs.set((a[1] as string).toLowerCase(), decode(a[2] ?? ""));
      top.childNodes.push(el);
      if (m[4] !== "/" && !VOID.has(el.tagName.toLowerCase())) top = el;
    }
  }
  return root;
}

function matches(el: Node_, selector: string): boolean {
  const m = /^([a-zA-Z][\w-]*)?((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/.exec(selector.trim());
  if (!m) throw new Error(`the tiny DOM can't read the selector “${selector}”`);
  if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
  const classes = (el.attrs.get("class") ?? "").split(/\s+/);
  if (!(m[2] ?? "").split(".").filter(Boolean).every((c) => classes.includes(c))) return false;
  return [...(m[3] ?? "").matchAll(/\[([^\]=]+)(?:="?([^"\]]*)"?)?\]/g)].every((a) => el.attrs.has((a[1] as string).toLowerCase()) && (a[2] === undefined || el.attrs.get((a[1] as string).toLowerCase()) === a[2]));
}

/** The document and element API the reader calls, over a parsed tree (one wrapper per node, so identities hold). */
function documentOf(html: string): Record<string, unknown> {
  const made = new Map<Node_, Record<string, unknown>>();
  const elements = (n: Node_) => n.childNodes.filter((k): k is Node_ => typeof k !== "string");
  const text = (n: Node_): string => n.childNodes.map((k) => (typeof k === "string" ? k : text(k))).join("");
  const descendants = (n: Node_): Node_[] => elements(n).flatMap((k) => [k, ...descendants(k)]);
  const copy = (n: Node_, parent: Node_ | null): Node_ => {
    const c: Node_ = { tagName: n.tagName, attrs: new Map(n.attrs), childNodes: [], parentElement: parent };
    c.childNodes = n.childNodes.map((k) => (typeof k === "string" ? k : copy(k, c)));
    return c;
  };
  const wrap = (n: Node_ | null): Record<string, unknown> | null => {
    if (!n || n.tagName === "#DOCUMENT") return null;
    let w = made.get(n);
    if (w) return w;
    w = {
      tagName: n.tagName,
      getAttribute: (name: string) => n.attrs.get(name) ?? null,
      get textContent() {
        return text(n);
      },
      get children() {
        return elements(n).map(wrap);
      },
      matches: (s: string) => matches(n, s),
      contains: (other: unknown) => [n, ...descendants(n)].some((d) => made.get(d) === other),
      querySelector: (s: string) => wrap(descendants(n).find((d) => matches(d, s)) ?? null),
      querySelectorAll: (s: string) => descendants(n).filter((d) => matches(d, s)).map(wrap),
      cloneNode: () => wrap(copy(n, null)),
      remove: () => {
        const p = n.parentElement;
        if (p) p.childNodes = p.childNodes.filter((k) => k !== n);
        n.parentElement = null;
      },
    };
    made.set(n, w);
    return w;
  };
  const root = parse(html);
  return {
    querySelector: (s: string) => wrap(descendants(root).find((d) => matches(d, s)) ?? null),
    getElementById: (id: string) => wrap(descendants(root).find((d) => d.attrs.get("id") === id) ?? null),
  };
}

/** inPage.ts offersData run on the markup's first article (with the helpers it needs), as the card step runs it. */
const offersDataOf = (html: string): OffersRead => new Function("document", `${PAGE_HELPERS}\n${CARD_HELPERS}\nreturn offersData(document.querySelector("article"));`)(documentOf(html)) as OffersRead;

describe("check:browser on a promoted idea's “Open with” (Checkpoint 7h; the first review's item 5)", () => {
  it("marks it in the markup, reads the mark, and holds it to the minimum chance alone, on a real promoting search", { timeout: 120_000 }, () => {
    const league = smallLeague(19, {}, 6);
    const minChance = 0.1;
    const ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
    const result = runTradeSearch(ctx, { settings: { ...defaultTradeSettings(), minChance } });
    // Overall idea 4: a promoted smaller ask, opening with the idea it was promoted from.
    const promoted = (result.merged?.promoted ?? []).find((p) => p.list === "overall");
    if (!promoted) throw new Error("smallLeague 19 promotes no idea on its Overall list");
    expect(result.trades.findIndex((t) => t.key === promoted.key)).toBe(3);
    const ladder = offerLadderOfSearch(result, promoted.key);
    if (!ladder) throw new Error("no ladder for the promoted idea");
    expect(ladder.steps.map((s) => [s.kind, s.original === true, s.evaluation.key === promoted.from])).toEqual([
      ["open", true, true],
      ["then", false, false],
      ["suggested", false, false],
    ]);
    // The view carries the mark on that offer only, and the card's panel puts it on that offer's item only.
    const view = buildFinderView({ result, sort: "overall", snapshot: league.snapshot, partnerId: null });
    const card = view.cards.find((c) => c.key === promoted.key);
    if (!card) throw new Error("the promoted idea isn't on the view");
    const words = buildLadderView(ladder, card, { snapshot: league.snapshot, goal: "title" });
    expect(words.steps.map((s) => s.original ?? false)).toEqual([true, false, false]);
    const panel = renderToStaticMarkup(createElement(OffersPanel, { state: { kind: "done", ladder: words }, name: "trade idea 4", places: new Map(view.cards.map((c, i) => [c.key, i + 1] as const)) }));
    expect([...panel.matchAll(/<li class="break-words" data-offer-key="([^"]+)"( data-offer-original="true")?>/g)].map((m) => [m[1], !!m[2]])).toEqual([
      [promoted.from, true],
      [ladder.steps[1]?.evaluation.key, false],
      [promoted.key, false],
    ]);
    // The card step's reader on the card: the "How to offer it" control names the panel, as TradeCard's does.
    const html = `<article><button type="button" aria-expanded="true" aria-controls="offers-4"><span class="min-w-0">How to offer it</span></button><div id="offers-4">${panel}</div></article>`;
    const read = offersDataOf(html);
    expect(read.offers.map((o) => [o.label, o.chance, o.original])).toEqual([
      ["Open with", "10%", true],
      ["Then", "20%", false],
      ["The suggested trade", "55%", false],
    ]);
    // The contract with the card step's numbers: the Open's own floor is 15%, the minimum chance 10%.
    const want = {
      openMin: Math.round(Math.max(config.offers.openMinChance, minChance) * 100),
      minChance: Math.round(minChance * 100),
      gain: Math.round(config.search.steps.minAcceptGain * 100),
      suggested: [OFFER_STEP_LABEL.suggested, ANALYZER_SUGGESTED_LABEL],
    };
    expect([want.openMin, want.minChance]).toEqual([15, 10]);
    expect(offersProblems(read, want)).toEqual([]);
    // Read without its mark (before the fix: no marker in the markup) the same Open broke the Open's 15%, though the engine
    // places it there on purpose.
    const unmarked = { ...read, offers: read.offers.map((o) => ({ ...o, original: false })) };
    expect(offersProblems(unmarked, want)).toEqual(["offer 1 (“Open with”) prints 10%, under 15%"]);
    // Under a higher minimum chance it would break that one (the engine never places it there: forcedOpenOk).
    expect(offersProblems(read, { ...want, minChance: 15 })).toEqual(["offer 1 (“Open with”), the idea this one was promoted from, prints 10%, under the minimum chance of 15%"]);
  });
});
