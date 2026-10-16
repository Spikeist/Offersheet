/**
 * check:browser's Checkpoint 7g contracts (planner reply to Checkpoint 7f, answer 3; contracts.ts lastOfferShapeProblems and
 * dominatedIdeasProblems): the Last offer is the idea plus one player of mine or the idea asking for fewer of their players,
 * and no idea of the list is a version of another's trade at least as good on both Helps you and the chance as printed; and
 * the reader the card step runs for the second (inPage.ts listIdeas) on the Trade Finder's own markup, rendered as the page
 * renders it (FinderFrame's list of cards, one with a league veto's "goes through" note, one under 5%), through a tiny DOM
 * (React's static markup parsed; the few element methods the reader calls). A made-up league.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FinderFrame } from "@/components/trades/TradeFinderPage";
import { evaluation, searchResult, tradeSnapshot } from "@/components/trades/testFixtures";
import { buildFinderView } from "@/lib/tradeView";
import { dominatedIdeasProblems, lastOfferShapeProblems, tradeKeyParts, type IdeaRead, type OfferRead } from "./contracts";
import { CARD_HELPERS, PAGE_HELPERS } from "./inPage";

// ---------------------------------------------------------------------------------------------
// A tiny DOM: elements with attributes, children and text; the selectors the reader uses (a tag and [attr] filters).

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

/** One compound selector (a tag or any, and [name] or [name=value] filters): all the reader's selectors are one. */
function matches(el: Node_, selector: string): boolean {
  const m = /^([a-zA-Z][\w-]*)?((?:\[[^\]]+\])*)$/.exec(selector.trim());
  if (!m) throw new Error(`the tiny DOM can't read the selector “${selector}”`);
  if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
  return [...(m[2] ?? "").matchAll(/\[([^\]=]+)(?:="?([^"\]]*)"?)?\]/g)].every((a) => el.attrs.has((a[1] as string).toLowerCase()) && (a[2] === undefined || el.attrs.get((a[1] as string).toLowerCase()) === a[2]));
}

/** The element API the reader calls, over a parsed node (made once per node, so identities hold). */
function domOf(html: string): { querySelector(s: string): unknown } {
  const made = new Map<Node_, Record<string, unknown>>();
  const elements = (n: Node_) => n.childNodes.filter((k): k is Node_ => typeof k !== "string");
  const text = (n: Node_): string => n.childNodes.map((k) => (typeof k === "string" ? k : text(k))).join("");
  const descendants = (n: Node_): Node_[] => elements(n).flatMap((k) => [k, ...descendants(k)]);
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
      get parentElement() {
        return wrap(n.parentElement);
      },
      get children() {
        return elements(n).map(wrap);
      },
      get nextElementSibling() {
        const sibs = n.parentElement ? elements(n.parentElement) : [];
        return wrap(sibs[sibs.indexOf(n) + 1] ?? null);
      },
      get dataset() {
        const out: Record<string, string> = {};
        for (const [k, v] of n.attrs) if (k.startsWith("data-")) out[k.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
        return out;
      },
      matches: (s: string) => matches(n, s),
      closest: (s: string) => {
        for (let p: Node_ | null = n; p && p.tagName !== "#DOCUMENT"; p = p.parentElement) if (matches(p, s)) return wrap(p);
        return null;
      },
      querySelector: (s: string) => wrap(descendants(n).find((d) => matches(d, s)) ?? null),
      querySelectorAll: (s: string) => descendants(n).filter((d) => matches(d, s)).map(wrap),
    };
    made.set(n, w);
    return w;
  };
  const root = parse(html);
  return { querySelector: (s: string) => wrap(descendants(root).find((d) => matches(d, s)) ?? null) };
}

/** inPage.ts listIdeas run on the markup's first card (with the helpers it needs). */
const listIdeasOf = (html: string): IdeaRead[] => new Function("document", `${PAGE_HELPERS}\n${CARD_HELPERS}\nreturn listIdeas(document.querySelector("article"));`)(domOf(html)) as IdeaRead[];

describe("check:browser's Checkpoint 7g contracts (planner reply to Checkpoint 7f, answer 3)", () => {
  it("reads a trade key's parts (evaluate.ts proposalKey)", () => {
    expect(tradeKeyParts("2|give:105,108|get:205")).toEqual({ partner: "2", give: ["105", "108"], get: ["205"] });
    expect(tradeKeyParts("2|give:|get:205")).toEqual({ partner: "2", give: [], get: ["205"] });
    expect(tradeKeyParts("2|give:105,pick:2027:1:2|get:205")).toEqual({ partner: "2", give: ["105", "pick:2027:1:2"], get: ["205"] });
    for (const x of ["not a key", "", null, undefined, "2|give:105"]) expect(tradeKeyParts(x)).toBeNull();
  });

  it("the Last offer is the idea plus one player of mine, or the idea asking for fewer of their players (lastOfferShapeProblems; answer 3(a))", () => {
    const offer = (label: string, key: string | null): OfferRead => ({ label, helps: "40", chance: "30%", copy: true, key });
    const card = "2|give:105|get:204,205";
    // The throw-in (one more of mine, theirs the same) and the smaller ask (mine the same, fewer of theirs) pass.
    expect(lastOfferShapeProblems({ offers: [offer("The suggested trade", card), offer("Last offer", "2|give:105,108|get:204,205")] }, card)).toEqual([]);
    expect(lastOfferShapeProblems({ offers: [offer("The suggested trade", card), offer("Last offer", "2|give:105|get:205")] }, card)).toEqual([]);
    expect(lastOfferShapeProblems({ offers: [offer("The suggested trade", card), offer("Last offer", "2|give:105|get:204")] }, card)).toEqual([]);
    // No Last offer: nothing to check (an Open of another shape is the ladder's own business).
    expect(lastOfferShapeProblems({ offers: [offer("Open with", "2|give:105|get:206"), offer("The suggested trade", card)] }, card)).toEqual([]);
    // Every other shape fails: two more of mine, theirs swapped, nothing of theirs, another team, mine swapped, no key.
    for (const key of ["2|give:105,106,108|get:204,205", "2|give:105|get:204,206", "2|give:105|get:", "3|give:105|get:205", "2|give:106|get:205", "2|give:105,108|get:205", null]) {
      expect(lastOfferShapeProblems({ offers: [offer("Last offer", key)] }, card), String(key)).toHaveLength(1);
    }
    expect(lastOfferShapeProblems({ offers: [offer("Last offer", "2|give:105,106,108|get:204,205")] }, card)).toEqual(["offer 1 (“Last offer”) is neither the idea plus one player of yours nor the idea asking for fewer of their players"]);
    expect(lastOfferShapeProblems({ offers: [offer("Last offer", null)] }, card)).toEqual(["offer 1 (“Last offer”) or the idea carries no trade key to compare"]);
  });

  it("no idea is a version of another's trade at least as good on both printed numbers (dominatedIdeasProblems; answer 3(c))", () => {
    const idea = (key: string | null, helps: string | null, chance: string | null): IdeaRead => ({ key, helps, chance });
    // A smaller version more helpful but less likely, a bigger one less helpful but likelier: neither beats the other.
    expect(dominatedIdeasProblems([idea("2|give:105|get:204", "40", "30%"), idea("2|give:105,108|get:204", "35", "40%"), idea("2|give:105|get:204,205", "50", "20%")])).toEqual([]);
    // Other teams, or neither a part of the other: no pair to judge.
    expect(dominatedIdeasProblems([idea("2|give:105|get:204", "40", "30%"), idea("3|give:105,108|get:204", "30", "20%"), idea("2|give:106|get:204", "30", "20%")])).toEqual([]);
    // A version at least as good on both shows with the one it beats: said, whichever comes first on the list.
    expect(dominatedIdeasProblems([idea("2|give:105,108|get:204", "35", "25%"), idea("2|give:105|get:204", "40", "30%")])).toEqual([
      "ideas 1 and 2 are versions of the same trade, and idea 2 (Helps you 40, 30%) is at least as good on both as idea 1 (Helps you 35, 25%), which shouldn't show",
    ]);
    // Both the same on both: one of them should have gone.
    expect(dominatedIdeasProblems([idea("2|give:105|get:204", "40", "30%"), idea("2|give:105|get:204,205", "40", "30%")])).toHaveLength(1);
    // "<5%" counts under 5%: an idea at 5% beats its version at "<5%" with the same Helps you, not the other way.
    expect(dominatedIdeasProblems([idea("2|give:105|get:204", "20", "<5%"), idea("2|give:105,108|get:204", "20", "5%")])).toEqual([
      "ideas 1 and 2 are versions of the same trade, and idea 2 (Helps you 20, 5%) is at least as good on both as idea 1 (Helps you 20, <5%), which shouldn't show",
    ]);
    // Numbers or keys it can't read leave the idea out.
    expect(dominatedIdeasProblems([idea("2|give:105|get:204", "—", "30%"), idea("2|give:105,108|get:204", "20", "20%"), idea(null, "50", "50%")])).toEqual([]);
  });

  it("reads the list the card is on as the Trade Finder renders it: each idea's key, Helps you, and the chance the rules read (inPage.ts listIdeas)", () => {
    const snapshot = tradeSnapshot({ tradeReview: "league_vote" });
    // Three ideas: one plain, one whose league veto prints a lower chance it goes through, one under 5%.
    const trades = [
      evaluation({ key: "2|give:106|get:204", b: 3, pComplete: 0.4 }),
      evaluation({ key: "2|give:106,108|get:204", give: ["106", "108"], b: 2.8, pAccept: 0.45, pComplete: 0.2, detail: { vetoRisk: true } }),
      evaluation({ key: "3|give:105|get:302", partnerId: "3", give: ["105"], get: ["302"], b: 6, pComplete: 0.03 }),
    ];
    const view = buildFinderView({ result: searchResult(trades), sort: "overall", snapshot, partnerId: null });
    const html = renderToStaticMarkup(createElement(FinderFrame, { state: { kind: "done", view }, teamName: "Moonbeam Mudcats", controls: null, records: [], leagueKey: "espn:0000abcd", onFeedback: () => ({ ok: true as const }) }));
    const ideas = listIdeasOf(html);
    expect(ideas.map((x) => x.key)).toEqual(view.cards.map((c) => c.key));
    const byKey = new Map(ideas.map((x) => [x.key, x]));
    expect(byKey.get("2|give:106|get:204")).toEqual({ key: "2|give:106|get:204", helps: String(trades[0]?.tradeScore), chance: "40%" });
    // The veto's "about N% it goes through" (P_complete: what the rules read), not the big "Chance they accept" (P_accept).
    expect(byKey.get("2|give:106,108|get:204")).toEqual({ key: "2|give:106,108|get:204", helps: String(trades[1]?.tradeScore), chance: "20%" });
    expect(byKey.get("3|give:105|get:302")?.chance).toBe("<5%");
    // These made-up ideas: the bigger version of idea "2|give:106|get:204" is less helpful and less likely, so it shouldn't show.
    expect(dominatedIdeasProblems(ideas)).toHaveLength(1);
  });
});
