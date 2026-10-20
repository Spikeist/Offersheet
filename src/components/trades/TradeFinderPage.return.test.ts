/**
 * The Trade Finder's trip to the Analyzer and back, its retries and its progress card (Checkpoint 7h, the review of its page;
 * TradeFinderPage.tsx's header):
 * - "Search again" and "Try again" search afresh for the search they were pressed on only (thoroughui#1: the attempt was
 *   page-wide, so after one press no switch flip or partner showed its kept ideas: each searched again, a Thorough search
 *   included).
 * - The Thorough search switch comes back from the Analyzer as it was left (the first review's (4): as page state it came back
 *   off, the normal search's ideas showed, and the idea to come back to, filed under the Thorough search's key, was lost).
 * - Coming back opens the panel holding the "Open in Analyzer" link used (the first review's (2): a card opens closed since
 *   Checkpoint 7h, its own link in Details and its Plan B's in "How to offer it", so the link took no scroll and no focus, and
 *   the results' heading didn't get it either).
 * - The progress card's time line says a Thorough search's own estimate (thoroughui#2: "It usually takes a few seconds" next to
 *   the switch's "Takes about 55 seconds"), and the estimate reads the normal search's time this tab kept, also when the page
 *   opens afresh (the estimate by scope, thoroughui#3: TradeFinderPage.thorough.test.ts).
 * Static renders (first render only) with the league store's state and Next's hooks faked, and a tiny DOM of the rendered
 * markup for revealIdea; a made-up league.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ state: null as LeagueStoreState | null }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(""), usePathname: () => "/trades" }));
vi.mock("next/link", () => ({
  default: ({ href, prefetch: _prefetch, children, ...rest }: { href: string; prefetch?: unknown; children?: ReactNode; className?: string; onClick?: () => void }) => {
    void _prefetch;
    return createElement("a", { ...rest, href }, children);
  },
}));
vi.mock("@/lib/leagueStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/leagueStore")>();
  return { ...actual, useLeagueStoreState: () => env.state ?? actual.useLeagueStoreState() };
});

import { defaultTradeSettings } from "@/engine/settings";
import { planBFixture } from "@/engine/tradeTestFixtures";
import { thoroughSeconds } from "@/engine/thorough";
import { IMPORT_FORMAT_VERSION, type StoredImport } from "@/lib/importStore";
import { leagueStoreStateOf, savedLeagueId, type LeagueStoreState } from "@/lib/leagueStore";
import { modelKey } from "@/lib/modelStore";
import { DETAILS_HEADING, OFFERS_HEADING, buildFinderView, progressView, type LadderView } from "@/lib/tradeView";
import { leagueFixture } from "../league/testFixtures";
import { rememberOpened, rememberSearchTime, rememberThorough, rememberedThorough, resetFinderMemory, takeReturnTarget } from "./finderMemory";
import { SearchProgress, searchTimeNote } from "./SearchProgress";
import { FinderFrame, THOROUGH_LABEL, TradeFinderPage, attemptFor, retryHeld, retryPressed, returnPanelOf, revealIdea, searchKeyFor, type Retry, type RevealTarget } from "./TradeFinderPage";
import { evaluation, searchResult, tradeSnapshot } from "./testFixtures";

const f = leagueFixture();
/** The saved league's id: the trade pages' memory is per league (finderMemory.ts). */
const LEAGUE = savedLeagueId(f.snapshot);
/** When the saved model inputs were built (the page's search keys name it). */
let builtAt = "";

beforeEach(() => {
  const savedAt = new Date().toISOString();
  builtAt = savedAt;
  const stored: StoredImport = { version: IMPORT_FORMAT_VERSION, savedAt, request: { platform: "espn", season: 2026, leagueId: f.snapshot.leagueId }, response: { snapshot: f.snapshot, notes: [] } };
  env.state = leagueStoreStateOf({
    imports: [stored],
    models: { [LEAGUE]: { version: 1, savedAt, key: modelKey(f.snapshot), snapshotFetchedAt: f.snapshot.fetchedAt, model: { ...f.inputs, builtAt: savedAt } } },
  });
  vi.stubGlobal("window", { location: { pathname: "/trades", search: "" } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetFinderMemory();
  env.state = null;
});

/** A static render's text as a reader sees it (apostrophes decoded). */
const textOfHtml = (html: string) => html.replace(/&#x27;/g, "'");

describe("Search again and Try again search afresh for their own search only (thoroughui#1)", () => {
  /** The normal search for every team, the Thorough one, and a one-partner search (searchKeyFor's keys). */
  const base = { snapshot: tradeSnapshot(), builtAt: "2026-10-01T12:00:00.000Z", myTeamId: "1", settings: defaultTradeSettings(), partnerId: null };
  const NORMAL = searchKeyFor(base);
  const THOROUGH = searchKeyFor({ ...base, thorough: true });
  const PARTNER = searchKeyFor({ ...base, partnerId: "4" });

  /**
   * The page's renders and presses, as LoadedFinder runs them (retryHeld while rendering, attemptFor for the search's tag,
   * retryPressed on a press): each render's search tag and whether that search may show the ideas this tab kept (attempt 0:
   * the page's recallSearchEntry).
   */
  function run(events: readonly string[]): { tag: string; recall: boolean }[] {
    let retry: Retry | null = null;
    let key: string | null = null;
    const out: { tag: string; recall: boolean }[] = [];
    for (const e of events) {
      if (e === "press") {
        if (key) retry = retryPressed(retry, key);
      } else key = e;
      retry = retryHeld(retry, key);
      const attempt = attemptFor(retry, key);
      out.push({ tag: `${key}|${attempt}`, recall: attempt === 0 });
    }
    return out;
  }

  it("the reviewer's case: Thorough on, Stop, Search again; then the switch off and on again shows each search's kept ideas", () => {
    expect(run([NORMAL, THOROUGH, "press", NORMAL, THOROUGH])).toEqual([
      // The normal search (recalls when it can), then the Thorough one (nothing kept: it searches).
      { tag: `${NORMAL}|0`, recall: true },
      { tag: `${THOROUGH}|0`, recall: true },
      // Search again (after Stop): a fresh Thorough search.
      { tag: `${THOROUGH}|1`, recall: false },
      // The switch off: the normal search's ideas at once; on again: the Thorough search's (its fresh search kept them).
      { tag: `${NORMAL}|0`, recall: true },
      { tag: `${THOROUGH}|0`, recall: true },
    ]);
  });

  it("another partner recalls too, and each press on the same search is a fresh search", () => {
    const steps = run([NORMAL, "press", "press", PARTNER, NORMAL]);
    expect(steps.map((s) => s.recall)).toEqual([true, false, false, true, true]);
    expect(steps.map((s) => s.tag)).toEqual([`${NORMAL}|0`, `${NORMAL}|1`, `${NORMAL}|2`, `${PARTNER}|0`, `${NORMAL}|0`]);
  });

  it("the pure parts: a retry counts for its own key, and the page lets it go once its search is for another one", () => {
    const r = retryPressed(null, NORMAL);
    expect(r).toEqual({ key: NORMAL, n: 1 });
    expect(retryPressed(r, NORMAL)).toEqual({ key: NORMAL, n: 2 });
    expect(retryPressed(r, THOROUGH)).toEqual({ key: THOROUGH, n: 1 });
    expect(attemptFor(r, NORMAL)).toBe(1);
    expect(attemptFor(r, THOROUGH)).toBe(0);
    expect(attemptFor(r, null)).toBe(0);
    expect(attemptFor(null, NORMAL)).toBe(0);
    expect(retryHeld(r, NORMAL)).toBe(r);
    expect(retryHeld(r, THOROUGH)).toBeNull();
    expect(retryHeld(r, null)).toBeNull();
    expect(retryHeld(null, NORMAL)).toBeNull();
  });
});

describe("the Thorough search switch comes back from the Analyzer as it was left (the first review's (4))", () => {
  const page = () => textOfHtml(renderToStaticMarkup(createElement(TradeFinderPage)));
  const switchOn = (html: string) => /<input type="checkbox" role="switch"[^>]*checked=""/.test(html);

  it("the page opens with the switch this tab left on for the league (off by default, another league's never)", () => {
    expect(rememberedThorough(LEAGUE)).toBe(false);
    expect(page()).toContain(THOROUGH_LABEL);
    expect(switchOn(page())).toBe(false);
    rememberThorough("sleeper:12345678:2026", true);
    expect(switchOn(page())).toBe(false);
    rememberThorough(LEAGUE, true);
    expect(switchOn(page())).toBe(true);
    rememberThorough(LEAGUE, false);
    expect(switchOn(page())).toBe(false);
  });

  it("Open in Analyzer files the idea under its search's key and keeps the switch as that search had it, so the return finds both", () => {
    rememberOpened(LEAGUE, { key: "k|thorough", thorough: true }, "card-a", "/analyzer?partner=2&give=106&get=204");
    expect(rememberedThorough(LEAGUE)).toBe(true);
    expect(takeReturnTarget("k|thorough")).toEqual({ cardKey: "card-a", href: "/analyzer?partner=2&give=106&get=204" });
    // An idea shown dimmed from the normal search while a Thorough one ran: the return shows the normal search's ideas.
    rememberOpened(LEAGUE, { key: "k", thorough: false }, "card-b");
    expect(rememberedThorough(LEAGUE)).toBe(false);
    expect(takeReturnTarget("k")).toEqual({ cardKey: "card-b", href: null });
  });

  it("its estimate reads the normal search's time this tab kept for the same filter as the page opens (the trip back builds the page afresh)", () => {
    rememberThorough(LEAGUE, true);
    const partners = f.snapshot.teams.length - 1;
    // The page's normal search for every team, as the store gives the page its settings (the defaults).
    rememberSearchTime(searchKeyFor({ snapshot: f.snapshot, builtAt, myTeamId: "1", settings: defaultTradeSettings(), partnerId: null }), 3000);
    const seconds = thoroughSeconds(3000, partners);
    expect(seconds).not.toBe(thoroughSeconds(null, partners));
    expect(page()).toContain(`Takes about ${seconds} seconds.`);
    expect(page()).toContain(`A Thorough search takes about ${seconds} seconds`);
  });

  it("with the switch left on, the page's first render is the Thorough search's: its progress card says about how long it takes", () => {
    rememberThorough(LEAGUE, true);
    // No normal search ran in this tab: the default rate for every other team.
    const seconds = thoroughSeconds(null, f.snapshot.teams.length - 1);
    expect(page()).toContain(`This runs in your browser. A Thorough search takes about ${seconds} seconds; on a phone it can take longer.`);
    expect(page()).not.toContain("It usually takes a few seconds");
    rememberThorough(LEAGUE, false);
    expect(page()).toContain("This runs in your browser. It usually takes a few seconds; on a phone it can take longer.");
  });
});

describe("the progress card's time line (thoroughui#2)", () => {
  const view = progressView({ stage: "screening", done: 3, total: 11 }, "search", "thorough");

  it("says a Thorough search's estimate while one runs, the usual few seconds otherwise", () => {
    expect(searchTimeNote(55)).toBe("This runs in your browser. A Thorough search takes about 55 seconds; on a phone it can take longer.");
    expect(searchTimeNote(null)).toBe("This runs in your browser. It usually takes a few seconds; on a phone it can take longer.");
    expect(searchTimeNote()).toBe(searchTimeNote(null));
    expect(searchTimeNote(0)).toBe(searchTimeNote(null));
    expect(searchTimeNote(Number.NaN)).toBe(searchTimeNote(null));
    expect(textOfHtml(renderToStaticMarkup(createElement(SearchProgress, { view, onStop: () => undefined, thoroughSeconds: 55 })))).toContain(searchTimeNote(55));
    expect(textOfHtml(renderToStaticMarkup(createElement(SearchProgress, { view, onStop: () => undefined })))).toContain(searchTimeNote(null));
  });

  it("the Trade Finder's searching state carries it to the card", () => {
    const frame = (seconds?: number) =>
      textOfHtml(
        renderToStaticMarkup(
          createElement(FinderFrame, {
            state: { kind: "searching", progress: view, onStop: () => undefined, previous: null, ...(seconds ? { thoroughSeconds: seconds } : {}) },
            teamName: null,
            controls: null,
            records: [],
            leagueKey: "espn:0000abcd",
            onFeedback: () => ({ ok: true as const }),
          }),
        ),
      );
    expect(frame(45)).toContain(searchTimeNote(45));
    expect(frame()).toContain(searchTimeNote(null));
  });
});

// ---------------------------------------------------------------------------------------------
// A tiny DOM of React's static markup, enough for revealIdea and the disclosures: elements with their attributes and text,
// the two selectors revealIdea uses (`tag[attr]` and `tag[attr^="value"]`), whether an element shows (no ancestor hidden),
// and what was scrolled into view and focused.

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

/** Every element inside `e`, in document order. */
const within = (e: El): El[] => e.kids.flatMap((k) => (typeof k === "string" ? [] : [k, ...within(k)]));
const textOf = (e: El): string => e.kids.map((k) => (typeof k === "string" ? k : textOf(k))).join("");

/** The page's `document` for revealIdea, over `html`: what it scrolled into view and focused. */
function documentOf(html: string) {
  const root = parse(html);
  const wrappers = new Map<El, FakeElement>();
  const doc = {
    activeElement: null as FakeElement | null,
    scrolled: [] as FakeElement[],
    querySelectorAll: (selector: string) => select(root, selector),
  };
  class FakeElement {
    constructor(readonly el: El) {}
    get dataset() {
      return { tradeKey: this.el.attrs.get("data-trade-key") };
    }
    getAttribute(name: string) {
      return this.el.attrs.get(name) ?? null;
    }
    querySelectorAll(selector: string) {
      return select(this.el, selector);
    }
    checkVisibility() {
      for (let e: El | null = this.el; e; e = e.parent) if (e.attrs.has("hidden")) return false;
      return true;
    }
    scrollIntoView() {
      doc.scrolled.push(this);
    }
    focus() {
      // A browser focuses nothing that doesn't show.
      if (this.checkVisibility()) doc.activeElement = this;
    }
  }
  const wrap = (e: El) => {
    const known = wrappers.get(e);
    if (known) return known;
    const made = new FakeElement(e);
    wrappers.set(e, made);
    return made;
  };
  function select(from: El, selector: string): FakeElement[] {
    const m = /^([a-z]+)\[([\w-]+)(?:(\^?=)"([^"]*)")?\]$/.exec(selector);
    if (!m) throw new Error(`the tiny DOM can't read the selector “${selector}”`);
    const [, tag, name = "", op, value = ""] = m;
    const fits = (e: El) => e.tag === tag && e.attrs.has(name) && (op === undefined || (op === "=" ? e.attrs.get(name) === value : (e.attrs.get(name) ?? "").startsWith(value)));
    return within(from).filter(fits).map(wrap);
  }
  return doc;
}

describe("coming back from the Analyzer opens the panel holding the link used (the first review's (2))", () => {
  const snapshot = tradeSnapshot();
  const planB = planBFixture({ partnerId: "2", give: ["105"], get: ["203"] });
  // Three ideas: "a" with a Plan B box, "b" and "c" without.
  const trades = [evaluation({ key: "a", b: 6, pComplete: 0.5, planB }), evaluation({ key: "b", b: 3, pComplete: 0.4, give: ["105"] }), evaluation({ key: "c", b: 2, pComplete: 0.3, give: ["108"] })];
  const view = buildFinderView({ result: searchResult(trades), sort: "overall", snapshot, partnerId: null });
  const cardA = view.cards.find((c) => c.key === "a");
  if (!cardA?.planB) throw new Error("the fixture's idea a has no Plan B");
  const OWN = cardA.analyzerHref;
  const PLAN_B = cardA.planB.analyzerHref;
  const render = (reveal?: RevealTarget | null) =>
    renderToStaticMarkup(
      createElement(FinderFrame, {
        state: { kind: "done", view },
        teamName: null,
        controls: null,
        records: [],
        leagueKey: "espn:0000abcd",
        onFeedback: () => ({ ok: true as const }),
        onOpenAnalyzer: () => undefined,
        // Offers that never come: a static render asks for none anyway.
        onOffers: () => new Promise<LadderView>(() => undefined),
        reveal: reveal ?? null,
      }),
    );
  /** Each card's two disclosures (Details, and How to offer it when the card has it) as rendered: open or not, its panel hidden or not. */
  const panels = (html: string) => {
    const items = within(parse(html)).filter((e) => e.tag === "li" && e.attrs.has("data-trade-key"));
    return Object.fromEntries(
      items.map((li) => {
        const inside = within(li);
        const disclosure = (heading: string) => {
          const button = inside.find((e) => e.tag === "button" && e.attrs.has("aria-controls") && textOf(e).trim().startsWith(heading));
          if (!button) return null;
          const panel = inside.find((e) => e.attrs.get("id") === button.attrs.get("aria-controls"));
          return { expanded: button.attrs.get("aria-expanded"), hidden: panel?.attrs.has("hidden") };
        };
        return [li.attrs.get("data-trade-key"), { details: disclosure(DETAILS_HEADING), offers: disclosure(OFFERS_HEADING) }];
      }),
    );
  };
  const closed = { expanded: "false", hidden: true };
  const open = { expanded: "true", hidden: false };

  it("which panel holds the link: How to offer it for a Plan B box's, else Details (the card's own, the idea's first link)", () => {
    expect(returnPanelOf(cardA, PLAN_B)).toBe("offers");
    expect(returnPanelOf(cardA, OWN)).toBe("details");
    expect(returnPanelOf(cardA, null)).toBe("details");
    expect(returnPanelOf(cardA, "/analyzer?partner=9&give=1&get=2")).toBe("details");
    expect(returnPanelOf({ ...cardA, planB: null }, PLAN_B)).toBe("details");
  });

  it("the card a return names opens that panel at mount; every other card opens closed", () => {
    const none = panels(render());
    expect(none.a).toEqual({ details: closed, offers: closed });
    expect(none.b?.details).toEqual(closed);
    expect(none.c?.details).toEqual(closed);
    expect(panels(render({ cardKey: "a", href: OWN })).a).toEqual({ details: open, offers: closed });
    expect(panels(render({ cardKey: "a", href: PLAN_B })).a).toEqual({ details: closed, offers: open });
    const other = panels(render({ cardKey: "b", href: null }));
    expect(other.b?.details).toEqual(open);
    expect(other.a).toEqual({ details: closed, offers: closed });
    // An idea no longer shown opens nothing.
    expect(panels(render({ cardKey: "gone", href: OWN }))).toEqual(none);
  });

  it("revealIdea brings the link back with focus only where it shows: in the panel opened for it, else nothing (the results' heading takes focus)", () => {
    // Before the fix: every card closed, the link found in its hidden panel, and "brought back" though nothing scrolled or took focus.
    const closedDoc = documentOf(render());
    vi.stubGlobal("document", closedDoc);
    expect(revealIdea("a", OWN)).toBeNull();
    expect(revealIdea("a", PLAN_B)).toBeNull();
    expect(closedDoc.activeElement).toBeNull();
    expect(closedDoc.scrolled).toEqual([]);

    for (const href of [OWN, PLAN_B]) {
      const doc = documentOf(render({ cardKey: "a", href }));
      vi.stubGlobal("document", doc);
      const link = revealIdea("a", href);
      expect(link?.getAttribute("href")).toBe(href);
      expect(doc.activeElement).toBe(link);
      expect(doc.scrolled).toEqual([link]);
    }
    // No address remembered: the idea's first link, the card's own, in Details.
    const firstDoc = documentOf(render({ cardKey: "a", href: null }));
    vi.stubGlobal("document", firstDoc);
    expect(revealIdea("a", null)?.getAttribute("href")).toBe(OWN);
    // An idea no longer shown: nothing.
    expect(revealIdea("gone", OWN)).toBeNull();
  });
});
