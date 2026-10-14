/**
 * The per-league settings store (CLAUDE.md §12 "User settings", §14 item 6; Phase 4 lead decision L12): keys
 * that never hold the raw league id, round trips through a storage, tolerance of whatever the storage holds
 * (bad JSON, another shape, an older version's entry, junk keys) and of a browser that blocks storage or is
 * full, "Reset to defaults", and the fingerprint the League page recomputes on, over the settings the League
 * model reads (checked against a real build of a small synthetic league). A Map stands in for localStorage
 * (Vitest runs in Node).
 */
import { describe, expect, it } from "vitest";
import { config } from "@/engine/config";
import { buildLeagueModel } from "@/engine/league";
import type { Matchup } from "@/engine/model";
import { PRIZE_MAX, defaultTradeSettings, normalizeTradeSettings, type TradeSettings } from "@/engine/settings";
import { TEST_NOW, randomLeague } from "@/engine/testLeague";
import type { StorageLike } from "./importStore";
import {
  LEAGUE_MODEL_SETTINGS,
  SETTINGS_SAVE_FAILED,
  SETTINGS_STORAGE_KEY,
  isLeagueKey,
  leagueKey,
  loadLeagueSettings,
  parseStoredSettings,
  readLeagueSettings,
  resetLeagueSettings,
  saveLeagueSettings,
  settingsFingerprint,
} from "./settingsStore";

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

/** A browser that blocks site data: every access throws, as Chrome's localStorage does then. */
class BlockedStorage implements StorageLike {
  getItem(): string | null {
    throw new DOMException("The operation is insecure.", "SecurityError");
  }
  setItem(): void {
    throw new DOMException("The operation is insecure.", "SecurityError");
  }
  removeItem(): void {
    throw new DOMException("The operation is insecure.", "SecurityError");
  }
}

/** A full storage: reads work, writes throw QuotaExceededError. */
class FullStorage extends MemoryStorage {
  override setItem(): void {
    throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
  }
}

const ESPN = { platform: "espn" as const, leagueId: "4242" };
const SLEEPER = { platform: "sleeper" as const, leagueId: "1048576000123456789" };
const mine: TradeSettings = { ...defaultTradeSettings(), streamPositions: ["K", "DEF", "TE"], goal: "prizes", prizes: { first: 2000, second: 1600, third: 900, weeklyHigh: null, pointsLeader: null }, untouchables: ["4046"], maxPerSide: 3 };

describe("leagueKey", () => {
  it("is the platform and 8 hex digits, the same every time, and never the raw league id", () => {
    const key = leagueKey(ESPN);
    expect(key).toMatch(/^espn:[0-9a-f]{8}$/);
    expect(leagueKey({ ...ESPN })).toBe(key);
    expect(key).not.toContain(ESPN.leagueId);
    expect(leagueKey(SLEEPER)).toMatch(/^sleeper:[0-9a-f]{8}$/);
    expect(leagueKey(SLEEPER)).not.toContain(SLEEPER.leagueId);
  });

  it("recognizes its own keys (the league store checks every settings and feedback row's key)", () => {
    expect(isLeagueKey(leagueKey(ESPN))).toBe(true);
    expect(isLeagueKey(leagueKey(SLEEPER))).toBe(true);
    for (const bad of ["espn:4242", "espn:1A2B3C4D", "espn:1a2b3c4d:2026", ":1a2b3c4d", "__proto__", 42, null, undefined]) expect(isLeagueKey(bad), String(bad)).toBe(false);
  });

  it("tells leagues and platforms apart", () => {
    const keys = new Set([leagueKey(ESPN), leagueKey({ platform: "espn", leagueId: "4243" }), leagueKey({ platform: "sleeper", leagueId: "4242" }), leagueKey(SLEEPER)]);
    expect(keys.size).toBe(4);
    // A few thousand league ids, no two keys alike (a 32-bit hash: a clash among one person's leagues is negligible).
    const many = new Set(Array.from({ length: 5000 }, (_, i) => leagueKey({ platform: "espn", leagueId: String(100000 + i) })));
    expect(many.size).toBe(5000);
  });
});

describe("saving and reading a league's settings", () => {
  it("round-trips one league's settings and keeps every other league's", () => {
    const storage = new MemoryStorage();
    const other = { ...defaultTradeSettings(), includeKDefIdp: true };
    expect(saveLeagueSettings(storage, leagueKey(SLEEPER), other)).toEqual({ ok: true });
    expect(saveLeagueSettings(storage, leagueKey(ESPN), mine)).toEqual({ ok: true });
    expect(loadLeagueSettings(storage, leagueKey(ESPN))).toEqual({ settings: mine, stored: true });
    expect(loadLeagueSettings(storage, leagueKey(SLEEPER))).toEqual({ settings: other, stored: true });
    // One localStorage value, keyed by league key: the raw league ids appear nowhere in it.
    const raw = storage.getItem(SETTINGS_STORAGE_KEY) ?? "";
    expect(Object.keys(JSON.parse(raw) as object).sort()).toEqual([leagueKey(ESPN), leagueKey(SLEEPER)].sort());
    expect(raw).not.toContain(ESPN.leagueId);
    expect(raw).not.toContain(SLEEPER.leagueId);
  });

  it("gives a league without saved settings the defaults, and says so", () => {
    const storage = new MemoryStorage();
    saveLeagueSettings(storage, leagueKey(SLEEPER), mine);
    expect(loadLeagueSettings(storage, leagueKey(ESPN))).toEqual({ settings: defaultTradeSettings(), stored: false });
    expect(readLeagueSettings(null, leagueKey(ESPN))).toEqual({ settings: defaultTradeSettings(), stored: false });
    expect(defaultTradeSettings().streamPositions).toEqual([...config.streaming.defaultPositions]);
  });

  it("saves settings normalized: out-of-range values fall back to the defaults", () => {
    const storage = new MemoryStorage();
    saveLeagueSettings(storage, leagueKey(ESPN), { ...mine, maxPerSide: 9, streamPositions: ["K", "RB", "K"] as TradeSettings["streamPositions"] });
    expect(loadLeagueSettings(storage, leagueKey(ESPN)).settings).toEqual({ ...mine, maxPerSide: config.search.maxPerSide, streamPositions: ["K"] });
  });

  it("'Reset to defaults' removes the league's entry, and the whole value with the last one", () => {
    const storage = new MemoryStorage();
    saveLeagueSettings(storage, leagueKey(ESPN), mine);
    saveLeagueSettings(storage, leagueKey(SLEEPER), mine);
    expect(resetLeagueSettings(storage, leagueKey(ESPN))).toEqual({ ok: true });
    expect(loadLeagueSettings(storage, leagueKey(ESPN))).toEqual({ settings: defaultTradeSettings(), stored: false });
    expect(loadLeagueSettings(storage, leagueKey(SLEEPER)).stored).toBe(true);
    expect(resetLeagueSettings(storage, leagueKey(SLEEPER))).toEqual({ ok: true });
    expect(storage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
    // Resetting a league with nothing saved is fine too.
    expect(resetLeagueSettings(storage, leagueKey(ESPN))).toEqual({ ok: true });
  });
});

describe("tolerance: whatever the browser holds or does", () => {
  it("reads bad JSON, another shape or nothing as no settings, never a throw", () => {
    for (const raw of [undefined, null, "", "{", "null", "[]", '"settings"', "42", "[{}]"]) {
      expect(parseStoredSettings(raw), String(raw)).toEqual({});
      expect(readLeagueSettings(raw, leagueKey(ESPN))).toEqual({ settings: defaultTradeSettings(), stored: false });
    }
  });

  it("ignores entries that aren't under a league key or aren't settings, and normalizes an older version's entry", () => {
    const key = leagueKey(ESPN);
    const entries = JSON.stringify({
      // An older version's entry: no streamPositions or includePicks, and the playoff weight the Settings page set before the
      // planner's reply to Checkpoint 7a, §6.1 (dropped: the League model sets it now).
      [key]: { version: 0, playoffWeight: 1.5, untouchables: ["4046", 17, "4046"], targetPositions: ["RB", "XX"] },
      "espn:4242": { ...mine },
      [leagueKey(SLEEPER)]: "K,DEF",
    });
    // JSON.parse makes "__proto__" an own key; it must never become the result's prototype.
    const raw = `{"__proto__":{"includePicks":true},${entries.slice(1)}`;
    expect(Object.keys(JSON.parse(raw) as object)).toContain("__proto__");
    const all = parseStoredSettings(raw);
    expect(Object.keys(all)).toEqual([key]);
    expect(all[key]).toEqual({ ...defaultTradeSettings(), untouchables: ["4046"], targetPositions: ["RB"] });
    expect(all[key]).not.toHaveProperty("playoffWeight");
    expect(Object.getPrototypeOf(all)).toBe(Object.prototype);
    expect((all as Record<string, unknown>).includePicks).toBeUndefined();
  });

  it("replaces a stored value that isn't ours when saving, rather than failing", () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_STORAGE_KEY, "{not json");
    expect(saveLeagueSettings(storage, leagueKey(ESPN), mine)).toEqual({ ok: true });
    expect(loadLeagueSettings(storage, leagueKey(ESPN)).settings).toEqual(mine);
  });

  it("reads a blocked storage (site data blocked) as the defaults, and says a save failed in plain words", () => {
    const blocked = new BlockedStorage();
    expect(loadLeagueSettings(blocked, leagueKey(ESPN))).toEqual({ settings: defaultTradeSettings(), stored: false });
    expect(loadLeagueSettings(undefined, leagueKey(ESPN))).toEqual({ settings: defaultTradeSettings(), stored: false });
    expect(saveLeagueSettings(blocked, leagueKey(ESPN), mine)).toEqual({ ok: false, message: SETTINGS_SAVE_FAILED });
    expect(resetLeagueSettings(blocked, leagueKey(ESPN))).toEqual({ ok: false, message: SETTINGS_SAVE_FAILED });
    expect(SETTINGS_SAVE_FAILED).toMatch(/wasn't kept/);
  });

  it("says a save failed when the storage is full, and keeps what was there", () => {
    const full = new FullStorage();
    full.values.set(SETTINGS_STORAGE_KEY, JSON.stringify({ [leagueKey(ESPN)]: mine }));
    expect(saveLeagueSettings(full, leagueKey(ESPN), defaultTradeSettings())).toEqual({ ok: false, message: SETTINGS_SAVE_FAILED });
    expect(loadLeagueSettings(full, leagueKey(ESPN))).toEqual({ settings: mine, stored: true });
  });
});

describe("settingsFingerprint", () => {
  it("is the same for the same settings in any order, and differs when any setting does", () => {
    expect(settingsFingerprint(defaultTradeSettings(), undefined)).toBe(settingsFingerprint(defaultTradeSettings()));
    const a = settingsFingerprint({ ...mine, streamPositions: ["TE", "K", "DEF"], untouchables: ["2", "1"], mustInclude: ["9", "8"], targetPositions: ["WR", "RB"] });
    const b = settingsFingerprint({ ...mine, streamPositions: ["DEF", "TE", "K"], untouchables: ["1", "2"], mustInclude: ["8", "9"], targetPositions: ["RB", "WR"] });
    expect(a).toBe(b);
    const base = settingsFingerprint(defaultTradeSettings());
    const changes: Partial<TradeSettings>[] = [
      { streamPositions: ["K"] },
      { goal: "playoffs" },
      { goal: "prizes" },
      { prizes: { first: 50, second: 30, third: 10, weeklyHigh: null, pointsLeader: null } },
      { lambda: 0.4 },
      { maxPerSide: 3 },
      { untouchables: ["1"] },
      { mustInclude: ["1"] },
      { targetPositions: ["RB"] },
      { avoidPositions: ["TE"] },
      { includeKDefIdp: true },
      { includePicks: true },
    ];
    for (const change of changes) expect(settingsFingerprint({ ...defaultTradeSettings(), ...change }), JSON.stringify(change)).not.toBe(base);
  });

  it("normalizes first: a value the engine would read as the default fingerprints as the default", () => {
    // An older version's playoff weight (gone since the planner's reply to Checkpoint 7a, §6.1) counts for nothing.
    expect(settingsFingerprint({ ...defaultTradeSettings(), playoffWeight: 1.5 } as unknown as TradeSettings)).toBe(settingsFingerprint(defaultTradeSettings()));
    expect(settingsFingerprint({ ...defaultTradeSettings(), goal: "x" as TradeSettings["goal"] }, LEAGUE_MODEL_SETTINGS)).toBe(settingsFingerprint(defaultTradeSettings(), LEAGUE_MODEL_SETTINGS));
  });

  it("reads a league saved with “Top finishers too” as “Several prizes” on the prefilled split, fingerprinted as its re-saved copy (planner reply to Checkpoint 7b, §6, “Migration”)", () => {
    const stored = { ...defaultTradeSettings(), goal: "balanced", prizes: { first: 1, second: 2, third: 3, weeklyHigh: 4, pointsLeader: 5 } } as unknown as TradeSettings;
    const read = normalizeTradeSettings(stored);
    expect(read).toEqual({ ...defaultTradeSettings(), goal: "prizes", prizes: { first: 60, second: 30, third: 10, weeklyHigh: null, pointsLeader: null } });
    for (const fields of [undefined, LEAGUE_MODEL_SETTINGS]) expect(settingsFingerprint(stored, fields)).toBe(settingsFingerprint(read, fields));
    // Stored, read back: the same, and saved again normalized.
    const storage = new MemoryStorage();
    storage.values.set(SETTINGS_STORAGE_KEY, JSON.stringify({ [leagueKey(ESPN)]: stored }));
    expect(loadLeagueSettings(storage, leagueKey(ESPN))).toEqual({ settings: read, stored: true });
    // The prizes' keys in one order, whatever order they were stored in (the fingerprint is JSON).
    const shuffled = normalizeTradeSettings({ ...defaultTradeSettings(), goal: "prizes", prizes: { pointsLeader: 5, third: 10, first: 60, weeklyHigh: null, second: 30 } });
    expect(Object.keys(shuffled.prizes)).toEqual(["first", "second", "third", "weeklyHigh", "pointsLeader"]);
    expect(settingsFingerprint(shuffled)).toBe(settingsFingerprint({ ...defaultTradeSettings(), goal: "prizes", prizes: { first: 60, second: 30, third: 10, weeklyHigh: null, pointsLeader: 5 } }));
  });

  it("keeps a prize amount only as a finite number from 0 to PRIZE_MAX, else blank (not paid), key by key (the review of the reward engine, RW-5)", () => {
    const read = (prizes: unknown) => normalizeTradeSettings({ ...defaultTradeSettings(), goal: "prizes", prizes }).prizes;
    expect(read({ first: -5, second: 30, third: 0, weeklyHigh: 2.5, pointsLeader: -0 })).toEqual({ first: null, second: 30, third: 0, weeklyHigh: 2.5, pointsLeader: 0 });
    expect(Object.is(read({ first: 1, second: null, third: null, weeklyHigh: null, pointsLeader: -0 }).pointsLeader, 0)).toBe(true);
    expect(read({ first: Number.NaN, second: Number.POSITIVE_INFINITY, third: "900", weeklyHigh: PRIZE_MAX + 1, pointsLeader: PRIZE_MAX })).toEqual({ first: null, second: null, third: null, weeklyHigh: null, pointsLeader: PRIZE_MAX });
    // Not an object: the prefilled split.
    for (const junk of [null, 7, "60/30/10", [60, 30, 10]]) expect(read(junk)).toEqual(defaultTradeSettings().prizes);
  });

  it("with fields, counts only those settings, in any order (the League page's tag passes LEAGUE_MODEL_SETTINGS)", () => {
    const base = settingsFingerprint(defaultTradeSettings(), LEAGUE_MODEL_SETTINGS);
    expect(settingsFingerprint({ ...defaultTradeSettings(), streamPositions: ["K"] }, LEAGUE_MODEL_SETTINGS)).not.toBe(base);
    expect(settingsFingerprint({ ...defaultTradeSettings(), goal: "playoffs" }, LEAGUE_MODEL_SETTINGS)).not.toBe(base);
    // "Several prizes"' amounts (Checkpoint 7c): the split moves ω.
    expect(settingsFingerprint({ ...defaultTradeSettings(), prizes: { first: 2000, second: 1600, third: 900, weeklyHigh: null, pointsLeader: null } }, LEAGUE_MODEL_SETTINGS)).not.toBe(base);
    // Checkpoint 7e (planner reply to Checkpoint 7d, items 3.2, 3.3 and 3.5): the untouchables, "Drop from the same position"
    // and the user's return weeks are read by the League model too.
    expect(settingsFingerprint({ ...defaultTradeSettings(), untouchables: ["1"] }, LEAGUE_MODEL_SETTINGS)).not.toBe(base);
    expect(settingsFingerprint({ ...defaultTradeSettings(), waiverSamePosition: false }, LEAGUE_MODEL_SETTINGS)).not.toBe(base);
    expect(settingsFingerprint({ ...defaultTradeSettings(), returnWeeks: { "1": 8 } }, LEAGUE_MODEL_SETTINGS)).not.toBe(base);
    // The manual playoff weight is gone (planner reply to Checkpoint 7a, §6.1: ω is set automatically).
    const other = { ...defaultTradeSettings(), lambda: 0.4, maxPerSide: 3, mustInclude: ["2"], targetPositions: ["RB"], avoidPositions: ["TE"], includeKDefIdp: true, includePicks: true } satisfies TradeSettings;
    expect(settingsFingerprint(other, LEAGUE_MODEL_SETTINGS)).toBe(base);
    // The fields' order and repeats don't matter; the lists' order doesn't either.
    expect(settingsFingerprint(mine, ["returnWeeks", "goal", "untouchables", "prizes", "waiverSamePosition", "streamPositions", "goal"])).toBe(settingsFingerprint({ ...mine, streamPositions: ["TE", "DEF", "K"] }, LEAGUE_MODEL_SETTINGS));
  });
});

/** Round-robin matchups (the circle method), so a test league's season can be simulated. */
function roundRobin(ids: readonly string[], weeks: readonly number[]): Matchup[] {
  const ring = [...ids];
  const out: Matchup[] = [];
  for (const week of weeks) {
    for (let i = 0; i < ring.length / 2; i++) out.push({ week, teamA: ring[i] as string, teamB: ring[ring.length - 1 - i] as string, isPlayoff: false });
    ring.splice(1, 0, ring.pop() as string);
  }
  return out;
}

describe("LEAGUE_MODEL_SETTINGS: every setting the League model reads, and only those (the League page computes again on these alone)", () => {
  // A small seeded league (6 teams; rosters QB, RB, RB, WR, WR, TE, RB, WR, K, DEF, QB, RB) with a schedule, so a
  // build covers projections, lineups, streaming, chips, needs, partners and the season simulation.
  const league = randomLeague({ teams: 6, seed: 11, rosterSize: 12, freeAgentsPerPosition: 6 });
  const snapshot = { ...league.snapshot, schedule: roundRobin(league.snapshot.teams.map((t) => t.id), league.snapshot.settings.regularSeasonWeeks) };
  const build = (change: Partial<TradeSettings>) => buildLeagueModel(snapshot, league.inputs, { now: TEST_NOW, settings: { ...defaultTradeSettings(), ...change }, scenarios: 4, sims: 200 });
  const defaults = build({});
  const roster = (team: number) => snapshot.teams[team]?.roster ?? [];

  /** A change to every setting outside the list (a setting added to TradeSettings fails to typecheck here until it's placed). */
  type TradeOnly = Exclude<keyof TradeSettings, "version" | (typeof LEAGUE_MODEL_SETTINGS)[number]>;
  const tradeOnly: { [K in TradeOnly]: TradeSettings[K] } = {
    lambda: 0.8,
    maxPerSide: 3,
    mustInclude: [roster(0)[1] as string, roster(1)[9] as string], // my RB and their D/ST
    targetPositions: ["RB", "K"],
    avoidPositions: ["TE", "DEF"],
    includeKDefIdp: true,
    includePicks: true,
    protectValue: "high",
    minChance: 0.3,
  };

  it("builds the very same model when any other setting changes, so the League page has no reason to compute it again", () => {
    expect(defaults.odds).not.toBeNull();
    expect(defaults.teams.some((t) => t.chips.length > 0)).toBe(true);
    for (const [field, value] of Object.entries(tradeOnly)) {
      expect(build({ [field]: value }), `${field} changed the League model: add it to LEAGUE_MODEL_SETTINGS`).toEqual(defaults);
    }
    // An older version's stored playoff weight (the manual setting, gone since the planner's reply to Checkpoint 7a, §6.1)
    // changes nothing either.
    expect(build({ playoffWeight: 1.75 } as unknown as Partial<TradeSettings>)).toEqual(defaults);
  });

  it("builds a different model when a setting on the list changes, so the list holds nothing extra", () => {
    // The goal: the automatic playoff weight weighs my odds by it (league.ts step 5c), so its per-point B's (and, unless both
    // sit at an end of the clamp, ω and every ROS(T)) move with it.
    const goal = build({ goal: "playoffs" });
    expect(goal).not.toEqual(defaults);
    expect(goal.playoffWeightAuto?.goal).toBe("playoffs");
    expect(goal.playoffWeightAuto?.playoffPerPoint).not.toBe(defaults.playoffWeightAuto?.playoffPerPoint);
    expect(build({ streamPositions: ["K", "DEF", "QB", "TE"] })).not.toEqual(defaults);
    expect(build({ streamPositions: [] })).not.toEqual(defaults);
    // "Several prizes"' amounts (Checkpoint 7c, planner reply to Checkpoint 7b, §6): under that goal the split weighs my odds.
    const split = build({ goal: "prizes" });
    const parker = build({ goal: "prizes", prizes: { first: 2000, second: 1600, third: 900, weeklyHigh: null, pointsLeader: null } });
    expect(parker).not.toEqual(split);
    expect(parker.reward?.shares).toMatchObject({ first: 4 / 9, second: 16 / 45, third: 1 / 5 });
    expect(parker.playoffWeightAuto?.playoffPerPoint).not.toBe(split.playoffWeightAuto?.playoffPerPoint);
  });
});
