/**
 * A trade card's "How to offer it" and its feedback (the review of wave D; Checkpoint 7e, planner reply to Checkpoint 7d, item
 * 4.1: "Feedback records which step was sent"): until the card's offers have loaded, its feedback buttons get a loader
 * (TradeCard's `loadVersions`, through the page's `onOffers`), so the first outcome pressed asks for the offers and then which
 * one was sent instead of saving "the suggested trade" without a word (UI-D-1; FeedbackControls.tsx pressedOutcome); the
 * offers' state is asked for only while the disclosure is open, or by the feedback (UI-D-10: offersStateFor); and once the
 * offers open with another trade, a line over the card's own message says so (UI-D-6: ownMessageNote); an offer that is another
 * card the Trade Finder shows says so with that card's place (the lead's call, wave D: OffersPanel's `places`, "Also shown as
 * trade idea 2."). FeedbackControls is stood in for, to hold the props the card gives it. A made-up league.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OfferLadder } from "@/engine/tradeModel";
import type { FeedbackChange } from "@/lib/feedbackStore";
import { OWN_MESSAGE_NOTE, buildLadderView, buildTradeCard, cardVersions, ownMessageNote, type CardFeedback, type LadderView, type TradeCardView, type VersionChoice } from "@/lib/tradeView";

/** The props the card gave its feedback buttons, at the last render. */
const given: { versions: readonly VersionChoice[] | null; loadVersions: (() => Promise<readonly VersionChoice[]>) | undefined } = { versions: null, loadVersions: undefined };

vi.mock("./FeedbackControls", () => ({
  FeedbackControls: (props: { versions?: readonly VersionChoice[]; loadVersions?: () => Promise<readonly VersionChoice[]> }) => {
    given.versions = props.versions ?? null;
    given.loadVersions = props.loadVersions;
    return null;
  },
}));

const { OffersPanel, TradeCard, offersStateFor } = await import("./TradeCard");
const { pressedOutcome, outcomeAction } = await vi.importActual<typeof import("./FeedbackControls")>("./FeedbackControls");
const { evaluation, tradeSnapshot } = await import("./testFixtures");
const { planBFixture } = await import("@/engine/tradeTestFixtures");

const NONE: CardFeedback = { outcome: null, report: null, version: null, versionKey: null, versionWords: null };
const snapshot = tradeSnapshot();
const base = evaluation({ b: 3, pAccept: 0.3, pComplete: 0.3 });
const open = evaluation({ get: ["202", "204"], b: 4.2, pAccept: 0.15, pComplete: 0.15 });
const ladderOf = (card: TradeCardView): OfferLadder => ({
  cardKey: card.key,
  steps: [
    { kind: "open", evaluation: open, message: "Hey! Would you trade Mortimer Gloop and Cornelius Snoot for Wiggleton Spoons?" },
    { kind: "suggested", evaluation: base, message: "Thanks for considering it!" },
  ],
});

/** What the card gave its feedback buttons, read after a render (a function, so TypeScript doesn't narrow what the render set). */
const gave = (): { versions: readonly VersionChoice[] | null; loadVersions: (() => Promise<readonly VersionChoice[]>) | undefined } => ({ versions: given.versions, loadVersions: given.loadVersions });

/** Renders the card once (statically) and gives back what its feedback buttons got. */
function render(card: TradeCardView, onOffers?: (card: TradeCardView) => Promise<LadderView>) {
  given.versions = null;
  given.loadVersions = undefined;
  const onFeedback = (change: FeedbackChange) => (void change, { ok: true as const });
  renderToStaticMarkup(createElement(TradeCard, { card, rank: 1, feedback: NONE, onFeedback, onOffers }));
  return gave();
}

describe("the card's feedback waits for its offers (the review of wave D, UI-D-1)", () => {
  it("gives the feedback a loader while the offers haven't loaded: it asks the page once, and gives the offers in order with Plan B after them", async () => {
    const planB = planBFixture({ partnerId: "2", give: ["105"], get: ["203"] });
    const card = buildTradeCard({ ...base, planB }, { snapshot });
    const asked: TradeCardView[] = [];
    const onOffers = (c: TradeCardView) => {
      asked.push(c);
      return Promise.resolve(buildLadderView(ladderOf(c), c, { snapshot }));
    };
    const { versions, loadVersions } = render(card, onOffers);
    // Until then the card's own trade and its Plan B.
    expect(versions?.map((v) => v.version)).toEqual(["suggested", "planB"]);
    expect(loadVersions).toBeTypeOf("function");
    const got = await (loadVersions as () => Promise<readonly VersionChoice[]>)();
    expect(got.map((v) => v.version)).toEqual(["open", "suggested", "planB"]);
    expect(got).toEqual(cardVersions(card, buildLadderView(ladderOf(card), card, { snapshot })));
    // One request: a second ask shares it.
    await (loadVersions as () => Promise<readonly VersionChoice[]>)();
    expect(asked).toHaveLength(1);
  });

  it("no loader without offers (a trade that doesn't help me, or no page loader); offers that fail give the card's own versions", async () => {
    expect(render(buildTradeCard(evaluation({ b: -1 }), { snapshot }), () => Promise.reject(new Error("never asked"))).loadVersions).toBeUndefined();
    expect(render(buildTradeCard(base, { snapshot })).loadVersions).toBeUndefined();
    const card = buildTradeCard(base, { snapshot });
    const { loadVersions } = render(card, () => Promise.reject(new Error("the worker failed")));
    expect(await (loadVersions as () => Promise<readonly VersionChoice[]>)()).toEqual(card.versions);
  });

  it("pressedOutcome: with no version recorded, the press waits for the loader and asks among what it gives; a recorded version, a clear or no loader don't wait", async () => {
    const card = buildTradeCard(base, { snapshot });
    const own = card.versions;
    expect(own).toHaveLength(1);
    const offered = cardVersions(card, buildLadderView(ladderOf(card), card, { snapshot }));
    let loads = 0;
    const load = () => {
      loads++;
      return Promise.resolve(offered);
    };
    // A plain card saved "the suggested trade" without asking; with its offers known, it asks which one was sent.
    expect(outcomeAction(NONE, own, "sent").action).toBe("save");
    const asked = await pressedOutcome(NONE, own, "sent", load);
    expect(asked).toEqual({ versions: offered, next: { action: "ask" } });
    expect(loads).toBe(1);
    // A recorded version stays (no wait), a clear needs none, and without a loader nothing changes.
    expect(await pressedOutcome({ outcome: "sent", version: "open" }, own, "accepted", load)).toEqual({ versions: own, next: { action: "save", change: { outcome: "accepted" } } });
    expect(await pressedOutcome({ outcome: "sent", version: null }, own, "sent", load)).toEqual({ versions: own, next: { action: "clear", change: { outcome: null } } });
    expect(await pressedOutcome(NONE, own, "sent")).toEqual({ versions: own, next: outcomeAction(NONE, own, "sent") });
    expect(loads).toBe(1);
    // A loader that fails: the versions known.
    expect(await pressedOutcome(NONE, own, "sent", () => Promise.reject(new Error("x")))).toEqual({ versions: own, next: outcomeAction(NONE, own, "sent") });
    // Offers that hold the suggested trade alone: one version, saved without asking.
    const alone = cardVersions(card, buildLadderView({ cardKey: card.key, steps: [{ kind: "suggested", evaluation: base, message: "x" }] }, card, { snapshot }));
    expect((await pressedOutcome(NONE, own, "rejected", () => Promise.resolve(alone))).next.action).toBe("save");
  });
});

describe("the offers' state (offersStateFor; the review of wave D, UI-D-10)", () => {
  const ladder = buildLadderView(ladderOf(buildTradeCard(base, { snapshot })), buildTradeCard(base, { snapshot }), { snapshot });
  it("asks only while the disclosure is open; an answer shows open or not; without a loader only offers already in", () => {
    expect(offersStateFor(true, false, null)).toEqual({ kind: "idle" });
    expect(offersStateFor(true, true, null)).toEqual({ kind: "loading" });
    expect(offersStateFor(true, false, { ladder })).toEqual({ kind: "done", ladder });
    expect(offersStateFor(true, true, { ladder: null })).toEqual({ kind: "failed" });
    // The final review of Checkpoint 7e, UI-F-2: the Trade Analyzer gives no loader while its result is stale, and the offers
    // already in still show and still count for the feedback (it asked which one was sent; it saved "the suggested trade").
    expect(offersStateFor(false, true, { ladder })).toEqual({ kind: "done", ladder });
    expect(offersStateFor(false, false, { ladder })).toEqual({ kind: "done", ladder });
    // Nothing to retry without one: no failure, nothing loading.
    expect(offersStateFor(false, true, { ladder: null })).toEqual({ kind: "idle" });
    expect(offersStateFor(false, true, null)).toEqual({ kind: "idle" });
  });
});

describe("the Trade Analyzer's card is keyed by its trade (the final review of Checkpoint 7e, UI-F-1)", () => {
  it("so another trade evaluated is another card: no version question, versions or offers carry over from the last one", async () => {
    const { AnalysisResult } = await import("./AnalyzerPage");
    const { buildAnalysisView } = await import("@/lib/tradeView");
    /** The TradeCard elements in a rendered tree (a function component's output, walked without rendering it). */
    const cardsIn = (node: unknown, out: { key: string | null }[] = []): { key: string | null }[] => {
      if (Array.isArray(node)) for (const n of node) cardsIn(n, out);
      else if (node && typeof node === "object" && "props" in node) {
        const el = node as { type: unknown; key: string | null; props: { children?: unknown } };
        if (el.type === TradeCard) out.push({ key: el.key });
        cardsIn(el.props.children, out);
      }
      return out;
    };
    for (const e of [base, open]) {
      const view = buildAnalysisView({ evaluation: e, illegal: null, notes: [] }, snapshot);
      const tree = AnalysisResult({ view, stale: false, records: [], leagueKey: "espn:0000abcd", onFeedback: () => ({ ok: true as const }) });
      expect(cardsIn(tree)).toEqual([{ key: e.key }]);
    }
    expect(base.key).not.toBe(open.key);
  });
});

describe("an offer that is another card the Trade Finder shows says so (the lead's call, wave D: OffersPanel's `places`)", () => {
  const card = buildTradeCard(base, { snapshot });
  const last = evaluation({ give: ["106", "108"], b: 2.6, pAccept: 0.4, pComplete: 0.4 });
  const ladder = buildLadderView(
    {
      cardKey: card.key,
      steps: [
        { kind: "open", evaluation: open, message: "Hey!" },
        { kind: "suggested", evaluation: base, message: "Thanks!" },
        { kind: "last", evaluation: last, message: "One more?" },
      ],
    },
    card,
    { snapshot },
  );
  const html = (places?: ReadonlyMap<string, number>) => renderToStaticMarkup(createElement(OffersPanel, { state: { kind: "done", ladder }, name: "trade idea 1", places }));
  const also = (h: string) => [...h.matchAll(/Also shown as trade idea \d+\./g)].map((m) => m[0]);

  it("“Also shown as trade idea 2.” right under the offer's players when its key is in `places`, with that card's place", () => {
    // The open offer is card 2 of the list; the card itself is card 1 (its own key in the map: the suggested trade says nothing).
    const h = html(new Map([[base.key, 1], [open.key, 2]]));
    expect(also(h)).toEqual(["Also shown as trade idea 2."]);
    expect(h).toMatch(
      new RegExp(`<li class="break-words" data-offer-key="${open.key.replace(/[|]/g, "\\|")}"><p><span class="font-semibold">Open with:</span> [^<]*</p><p class="text-muted">Also shown as trade idea 2\\.</p><p class="font-semibold">`),
    );
    // A re-sort gives other places: the line follows them.
    expect(also(html(new Map([[open.key, 5], [last.key, 3]])))).toEqual(["Also shown as trade idea 5.", "Also shown as trade idea 3."]);
  });

  it("nothing under the suggested trade, an offer the map doesn't have, or without `places` (the Analyzer)", () => {
    expect(also(html(new Map([[base.key, 1]])))).toEqual([]);
    expect(also(html(new Map([["somewhere|give:1|get:2", 4]])))).toEqual([]);
    expect(also(html())).toEqual([]);
    // Every offer carries its key, the cards' items their own attribute (data-trade-key: a return from the Analyzer finds them).
    expect([...html().matchAll(/data-offer-key="([^"]+)"/g)].map((m) => m[1])).toEqual([open.key, base.key, last.key]);
    expect(html()).not.toContain("data-trade-key");
  });
});

describe("the card's own message once the offers open with another trade (the review of wave D, UI-D-6)", () => {
  it("a line says the card's message proposes the trade as it is, only when the first offer isn't the card's", () => {
    const card = buildTradeCard(base, { snapshot });
    const opens = buildLadderView(ladderOf(card), card, { snapshot });
    const alone = buildLadderView({ cardKey: card.key, steps: [{ kind: "suggested", evaluation: base, message: "x" }] }, card, { snapshot });
    expect(opens.opensElsewhere).toBe(true);
    expect(ownMessageNote(opens)).toBe(OWN_MESSAGE_NOTE);
    expect([ownMessageNote(alone), ownMessageNote(null), ownMessageNote(buildLadderView({ cardKey: card.key, steps: [] }, card, { snapshot }))]).toEqual([null, null, null]);
    expect(OWN_MESSAGE_NOTE).toBe("This message proposes the trade as it is. “How to offer it” opens with another offer: send its message first.");
  });
});
