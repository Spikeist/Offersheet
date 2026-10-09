/**
 * A trade card's press end to end (Phase 7a, track FB): saved in the league store first (fake-indexeddb), then, while
 * "Share anonymous feedback" is on, its record's anonymous copy queued with the record's own share id (a fake sender on
 * fake timers); presses on one card that overlap (review FB-R1), and the numbers' basis (review FB-R6). The fictional
 * league of the trade pages' fixtures; no network.
 */
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { tradeSnapshot } from "@/components/trades/testFixtures";
import { FEEDBACK_SHARE_DEBOUNCE_MS, FeedbackSender, feedbackShareContext, type FeedbackEvent } from "@/lib/feedbackShare";
import { FEEDBACK_SAVE_FAILED, type FeedbackEvaluation } from "@/lib/feedbackStore";
import type { StorageLike } from "@/lib/importStore";
import { LeagueStoreClient, savedFeedbackRead } from "@/lib/leagueStore";
import { saveFeedbackPress } from "./useFeedback";

class MemoryStorage implements StorageLike {
  values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const LEAGUE_KEY = "espn:1a2b3c4d";
const share = feedbackShareContext(tradeSnapshot(), "title");
const evaluation: FeedbackEvaluation = {
  key: "2|give:106|get:204",
  proposal: { partnerId: "2", give: [{ kind: "player", id: "106" }], get: [{ kind: "player", id: "204" }] },
  features: { g: 0.02, n: 0.3, h: 0, c: 0, a: 1, hist: null, ctx: 0, hot: 0, urg: 0, z: 0.1 },
  b: 3.2,
  b3: 6,
  tradeScore: 41,
  pAccept: 0.47,
  pComplete: 0.47,
  overall: 22,
  dPO: 0.03,
  dCH: 0.01,
  dPPW: 1.4,
  gMine: 0.01,
  gPartner: 0.02,
};

const clients: LeagueStoreClient[] = [];
afterEach(() => {
  for (const c of clients.splice(0)) c.dispose();
});

/**
 * A started league store on fake-indexeddb (or one not started yet, `started` false), a sender on fake timers, and what it
 * posted; new share ids count up from `idBase` + 1 ("01AAAA…").
 */
async function setup(sharing = true, opts: { factory?: IDBFactory; started?: boolean; idBase?: number } = {}) {
  let clock = Date.parse("2026-10-04T12:00:00.000Z");
  const factory = opts.factory ?? new IDBFactory();
  const client = new LeagueStoreClient({ indexedDB: () => factory, session: () => new MemoryStorage(), local: () => new MemoryStorage(), channel: () => undefined, now: () => new Date((clock += 1000)).toISOString() });
  clients.push(client);
  if (opts.started !== false) await client.start();
  const posted: FeedbackEvent[] = [];
  let now = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let next = 1;
  const sender = new FeedbackSender({
    post: (body) => posted.push(JSON.parse(body) as FeedbackEvent),
    setTimer: (fn, ms) => {
      timers.set(next, { at: now + ms, fn });
      return next++;
    },
    clearTimer: (id) => timers.delete(id as number),
    sharing: () => sharing,
  });
  const advance = (ms: number) => {
    now += ms;
    for (const [id, t] of [...timers]) {
      if (t.at <= now) {
        timers.delete(id);
        t.fn();
      }
    }
  };
  let ids = opts.idBase ?? 0;
  const deps = { client, sender, sharing: () => sharing, newId: () => `${String(++ids).padStart(2, "0")}AAAAAAAAAAAAAAAAAAAA`, now: () => new Date((clock += 1000)).toISOString() };
  const press = (change: Parameters<typeof saveFeedbackPress>[0]["change"], context = share) => saveFeedbackPress({ leagueKey: LEAGUE_KEY, evaluation, change, share: context }, deps);
  const record = () => savedFeedbackRead(client.getState(), LEAGUE_KEY)?.[0];
  return { client, posted, advance, press, record };
}

/** The copies posted, as (share id, what they say). */
const said = (posted: readonly FeedbackEvent[]) => posted.map((e) => [e.rid, e.outcome ?? e.reason ?? "taken back"]);

describe("saveFeedbackPress: saved here first, then its anonymous copy", () => {
  it("a new record gets a share id; its copies carry it, debounced; a later press keeps it", async () => {
    const s = await setup();
    expect(await s.press({ outcome: "sent" })).toEqual({ ok: true, shared: true });
    const rid = s.record()?.rid;
    expect(rid).toBe("01AAAAAAAAAAAAAAAAAAAA");
    s.advance(FEEDBACK_SHARE_DEBOUNCE_MS);
    expect(s.posted.map((e) => [e.rid, e.outcome])).toEqual([[rid, "sent"]]);
    expect(await s.press({ outcome: "accepted" })).toEqual({ ok: true, shared: true });
    expect(await s.press({ report: { reason: "other", note: "Team 3 took a day" } })).toEqual({ ok: true, shared: true });
    s.advance(FEEDBACK_SHARE_DEBOUNCE_MS);
    expect(s.record()?.rid).toBe(rid);
    expect(s.posted.map((e) => [e.rid, e.kind, e.outcome, e.reason])).toEqual([
      [rid, "outcome", "sent", undefined],
      [rid, "report", "accepted", "other"],
    ]);
    // The note stays in this browser.
    expect(s.record()?.report?.note).toBe("Team 3 took a day");
    expect(JSON.stringify(s.posted)).not.toContain("Team 3");
  });

  it("undone before its copy leaves: nothing sent; undone after: the copy that takes it back", async () => {
    const s = await setup();
    await s.press({ outcome: "rejected" });
    expect(await s.press({ outcome: null })).toEqual({ ok: true });
    s.advance(FEEDBACK_SHARE_DEBOUNCE_MS);
    expect(s.posted).toEqual([]);
    expect(s.record()).toBeUndefined();
    await s.press({ outcome: "countered" });
    s.advance(FEEDBACK_SHARE_DEBOUNCE_MS);
    expect(await s.press({ outcome: null })).toEqual({ ok: true, shared: true });
    s.advance(FEEDBACK_SHARE_DEBOUNCE_MS);
    expect(s.posted.map((e) => [e.rid, e.outcome ?? "taken back"])).toEqual([
      ["02AAAAAAAAAAAAAAAAAAAA", "countered"],
      ["02AAAAAAAAAAAAAAAAAAAA", "taken back"],
    ]);
  });

  it("sharing off: saved here (with its share id), nothing sent; without a share context, nothing sent either", async () => {
    const off = await setup(false);
    expect(await off.press({ outcome: "sent" })).toEqual({ ok: true });
    off.advance(FEEDBACK_SHARE_DEBOUNCE_MS);
    expect(off.posted).toEqual([]);
    expect(off.record()?.rid).toBe("01AAAAAAAAAAAAAAAAAAAA");
    const on = await setup();
    expect(await saveFeedbackPress({ leagueKey: LEAGUE_KEY, evaluation, change: { outcome: "sent" } }, { client: on.client, sender: null })).toEqual({ ok: true });
  });

  it("no browser store (the server, or a page that never got one): the save's own failure, nothing sent", async () => {
    expect(await saveFeedbackPress({ leagueKey: LEAGUE_KEY, evaluation, change: { outcome: "sent" }, share }, { client: null })).toEqual({ ok: false, message: FEEDBACK_SAVE_FAILED });
  });

  it("keeps what the card printed with a new record, through the league store and a reload; its copy holds none of it (Checkpoint 7d; planner reply to Checkpoint 7c, answer 1)", async () => {
    const factory = new IDBFactory();
    const s = await setup(true, { factory });
    const shown = { helps: "41", chance: "45%", label: "Decent", overall: "22", odds: ["Title odds 9.0% → 9.4%", "Playoff odds 62% → 64%"], helpsThem: "12", theirOdds: ["Their title odds 6.0% → 6.9%", "Their playoff odds 41% → 45%"] };
    expect(await s.press({ outcome: "sent", shown })).toEqual({ ok: true, shared: true });
    expect(s.record()?.shown).toEqual(shown);
    s.advance(FEEDBACK_SHARE_DEBOUNCE_MS);
    // The copy is built as before: none of the printed texts.
    expect(s.posted).toHaveLength(1);
    expect(s.posted[0]).not.toHaveProperty("shown");
    for (const text of ["45%", "Title odds", "Helps them"]) expect(JSON.stringify(s.posted), text).not.toContain(text);
    // A later press, from a card that prints otherwise now, leaves them as the first press's.
    await s.press({ outcome: "accepted", shown: { ...shown, helps: "60" } });
    expect(s.record()?.shown?.helps).toBe("41");
    s.client.dispose();
    // Another visit reads them back from IndexedDB.
    const again = await setup(true, { factory });
    expect(again.record()?.shown).toEqual(shown);
  });

  it("keeps the week and goal the card's numbers were computed for with a new record; a later press doesn't change them (review FB-R6)", async () => {
    const s = await setup();
    await s.press({ report: { reason: "never-accept" } });
    expect(s.record()?.basis).toEqual({ season: 2026, week: 12, goal: "title" });
    s.advance(FEEDBACK_SHARE_DEBOUNCE_MS);
    // A week later, under another goal: the record's numbers are still week 12's.
    await s.press({ outcome: "sent" }, { ...share, week: 13, goal: "prizes" });
    s.advance(FEEDBACK_SHARE_DEBOUNCE_MS);
    expect(s.record()?.basis).toEqual({ season: 2026, week: 12, goal: "title" });
    expect(s.posted.map((e) => [e.week, e.goal])).toEqual([
      [12, "title"],
      [12, "title"],
    ]);
  });
});

describe("two presses on one card that overlap (a quick double click: review FB-R1)", () => {
  it("Sent, then Sent again to clear it before the first save settled: nothing sent, the note not used up", async () => {
    const s = await setup();
    const results = await Promise.all([s.press({ outcome: "sent" }), s.press({ outcome: null })]);
    expect(results).toEqual([{ ok: true, shared: true }, { ok: true }]);
    expect(s.record()).toBeUndefined();
    s.advance(10 * FEEDBACK_SHARE_DEBOUNCE_MS);
    expect(s.posted).toEqual([]);
  });

  it("a record whose copy left, cleared and pressed again at once: the take-back for it, then the new record's copy", async () => {
    const s = await setup();
    await s.press({ outcome: "sent" });
    s.advance(FEEDBACK_SHARE_DEBOUNCE_MS);
    const results = await Promise.all([s.press({ outcome: null }), s.press({ outcome: "sent" })]);
    expect(results).toEqual([
      { ok: true, shared: true },
      { ok: true, shared: true },
    ]);
    expect(s.record()).toMatchObject({ rid: "02AAAAAAAAAAAAAAAAAAAA", outcome: { kind: "sent" } });
    s.advance(FEEDBACK_SHARE_DEBOUNCE_MS);
    expect(said(s.posted)).toEqual([
      ["01AAAAAAAAAAAAAAAAAAAA", "sent"],
      ["01AAAAAAAAAAAAAAAAAAAA", "taken back"],
      ["02AAAAAAAAAAAAAAAAAAAA", "sent"],
    ]);
  });

  it("Sent then Accepted at once: one copy, Accepted, the record's share id", async () => {
    const s = await setup();
    await Promise.all([s.press({ outcome: "sent" }), s.press({ outcome: "accepted" })]);
    s.advance(FEEDBACK_SHARE_DEBOUNCE_MS);
    expect(said(s.posted)).toEqual([["01AAAAAAAAAAAAAAAAAAAA", "accepted"]]);
  });

  it("a press while the store is still loading reads the record it loads: the record's own share id, never a second record", async () => {
    // A record saved on an earlier visit, its copy sent then.
    const factory = new IDBFactory();
    const earlier = await setup(true, { factory });
    await earlier.press({ outcome: "sent" });
    earlier.client.dispose();
    // This page would make "51AAAA…" for a record it took for new.
    const s = await setup(true, { factory, started: false, idBase: 50 });
    expect(s.client.getState().status).toBe("loading");
    expect(await s.press({ outcome: "accepted" })).toEqual({ ok: true, shared: true });
    s.advance(FEEDBACK_SHARE_DEBOUNCE_MS);
    expect(said(s.posted)).toEqual([["01AAAAAAAAAAAAAAAAAAAA", "accepted"]]);
    // The record keeps its first press's week and goal.
    expect(s.posted[0]).toMatchObject({ week: 12, goal: "title" });
  });

  it("a press made while an earlier one on the card failed to save shares nothing (what it read may hold the failed one)", async () => {
    const s = await setup();
    const failing = {
      getState: s.client.getState,
      start: () => s.client.start(),
      saveFeedback: (args: Parameters<LeagueStoreClient["saveFeedback"]>[0]) => ("outcome" in args.change && args.change.outcome === "sent" ? Promise.resolve({ ok: false as const, message: FEEDBACK_SAVE_FAILED }) : s.client.saveFeedback(args)),
    };
    const sender = new FeedbackSender({ post: () => {}, setTimer: () => 0, clearTimer: () => {}, sharing: () => true });
    const deps = { client: failing, sender, sharing: () => true, newId: () => "09AAAAAAAAAAAAAAAAAAAA" };
    const results = await Promise.all([
      saveFeedbackPress({ leagueKey: LEAGUE_KEY, evaluation, change: { outcome: "sent" }, share }, deps),
      saveFeedbackPress({ leagueKey: LEAGUE_KEY, evaluation, change: { report: { reason: "other" } }, share }, deps),
    ]);
    expect(results).toEqual([{ ok: false, message: FEEDBACK_SAVE_FAILED }, { ok: true }]);
    expect(sender.pending).toBe(0);
    // Once that burst is over, the card's next press shares again.
    expect(await saveFeedbackPress({ leagueKey: LEAGUE_KEY, evaluation, change: { report: { reason: "settings" } }, share }, deps)).toEqual({ ok: true, shared: true });
  });
});
