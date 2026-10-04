import { describe, expect, it } from "vitest";
import { normalizeEspnLeague } from "./normalize";
import { LABELS, NOW, PARKER, fakeResolver, parkerBundle, readEspn } from "./test-helpers";
import { ESPN_WAIVER_CODES, anyGamePlayed, espnWaiverOrder, resetOrder, type EspnWaiverSettings, type EspnWaiverTeam } from "./waivers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A made-up team: its live waiver rank, playoff seed and record. */
const team = (id: string, waiverRank: number | null, playoffSeed: number | null, w: number, l: number, pointsFor: number, t = 0): EspnWaiverTeam => ({ id, waiverRank, playoffSeed, record: { w, l, t }, pointsFor });

/** Four made-up teams after week 3: the standings 2 (3-0) > 4 (2-1) > 1 (1-2) > 3 (0-3); live ranks mid-week, after claims. */
const four = (): EspnWaiverTeam[] => [team("1", 1, 3, 1, 2, 300), team("2", 2, 1, 3, 0, 350), team("3", 3, 4, 0, 3, 280), team("4", 4, 2, 2, 1, 320)];

const WEEKLY: EspnWaiverSettings = { faab: false, acquisitionType: "WAIVERS_TRADITIONAL", waiverOrderReset: true, orderEdited: false, divisions: false };

const ranksOf = (r: ReturnType<typeof espnWaiverOrder>) => Object.fromEntries([...r.ranks].map(([id, x]) => [id, x.waiverRank]));
const liveOf = (r: ReturnType<typeof espnWaiverOrder>) => Object.fromEntries([...r.ranks].map(([id, x]) => [id, x.liveWaiverRank]));
const codes = (r: ReturnType<typeof espnWaiverOrder>) => r.warnings.map((w) => w.code);

describe("espnWaiverOrder: the weekly reset order (Phase 4c; planner reply to Checkpoint 4b, answer 2)", () => {
  it("a league whose order resets weekly: numTeams + 1 − playoffSeed, and ESPN's live rank kept apart", () => {
    const r = espnWaiverOrder(four(), WEEKLY);
    expect(r.used).toBe("weeklyReset");
    // Reverse standings: the 0-3 team claims first, the 3-0 team last.
    expect(ranksOf(r)).toEqual({ "1": 2, "2": 4, "3": 1, "4": 3 });
    expect(liveOf(r)).toEqual({ "1": 1, "2": 2, "3": 3, "4": 4 });
    expect(r.warnings).toEqual([]);
    expect(r.notes.join(" ")).toMatch(/resets this league's waiver order every week to reverse standings.*ESPN's order right now is different/);
  });

  it("doesn't depend on the day of the import: any live order (claims move teams back) gives the same reset order", () => {
    const base = ranksOf(espnWaiverOrder(four(), WEEKLY));
    for (const live of [
      [4, 3, 2, 1],
      [2, 1, 4, 3],
      [3, 4, 1, 2],
      [null, null, null, null],
    ]) {
      const teams = four().map((t, i) => ({ ...t, waiverRank: live[i] }));
      expect(ranksOf(espnWaiverOrder(teams, WEEKLY)), String(live)).toEqual(base);
    }
  });

  it("at the reset itself (ESPN's live rank equals the reset order) there's nothing to explain: no note", () => {
    const teams = four().map((t) => ({ ...t, waiverRank: 5 - (t.playoffSeed as number) }));
    const r = espnWaiverOrder(teams, WEEKLY);
    expect(r.used).toBe("weeklyReset");
    expect(ranksOf(r)).toEqual(liveOf(r));
    expect(r.notes).toEqual([]);
  });

  it("a live rank ESPN didn't send (or can't be read) is left out of liveWaiverRank; the reset order still ranks every team", () => {
    const teams = four();
    teams[0] = { ...teams[0], waiverRank: 0 } as EspnWaiverTeam;
    teams[1] = { ...teams[1], waiverRank: 2.5 } as EspnWaiverTeam;
    const r = espnWaiverOrder(teams, WEEKLY);
    expect(r.used).toBe("weeklyReset");
    expect(ranksOf(r)).toEqual({ "1": 2, "2": 4, "3": 1, "4": 3 });
    expect(liveOf(r)).toEqual({ "1": undefined, "2": undefined, "3": 3, "4": 4 });
  });

  it("with divisions (playoffSeed puts the division winners first): ⚠️ the reverse of the overall standings, with a note", () => {
    // Team 1 (1-2) won its division, so ESPN seeds it 2nd; the overall standings still rank it 3rd.
    const teams = [team("1", 1, 2, 1, 2, 300), team("2", 2, 1, 3, 0, 350), team("3", 3, 4, 0, 3, 280), team("4", 4, 3, 2, 1, 320)];
    const r = espnWaiverOrder(teams, { ...WEEKLY, divisions: true });
    expect(r.used).toBe("weeklyReset");
    expect(ranksOf(r)).toEqual({ "1": 2, "2": 4, "3": 1, "4": 3 });
    expect(r.notes.join(" ")).toMatch(/With divisions, ESPN's playoff seeds put the division winners first.*worst win percentage first, then fewer points for \(our reading\)/);
    // The seeds alone would have put the division winner after the 2-1 team.
    expect(ranksOf(espnWaiverOrder(teams, WEEKLY))).toEqual({ "1": 3, "2": 4, "3": 1, "4": 2 });
  });

  it("the standings order breaks ties by fewer points for, then the worse playoff seed, then team id (never the live rank)", () => {
    const teams = [team("1", 4, 1, 2, 1, 300), team("2", 3, 3, 2, 1, 290), team("3", 2, 2, 2, 1, 300), team("4", 1, 4, 2, 1, 300), team("5", 5, null, 2, 1, 300)];
    // 2 has the fewest points; 1, 3, 4 and 5 tie on 300: worse seed first (4 before 3 before 1), the unseeded 5 last, then id.
    expect(Object.fromEntries(resetOrder(teams, true).ranks)).toEqual({ "2": 1, "4": 2, "3": 3, "1": 4, "5": 5 });
    // Ties (½ a win each) and a 0-game team: win percentage counts a tie as half a win.
    const ties = [team("1", 1, null, 1, 1, 100, 1), team("2", 2, null, 2, 1, 100), team("3", 3, null, 0, 0, 0)];
    expect(Object.fromEntries(resetOrder(ties, true).ranks)).toEqual({ "3": 1, "1": 2, "2": 3 });
  });

  it("⚠️ a commissioner-edited order (status.isWaiverOrderEdited): still the reset order, warned that the edit lasts until the reset", () => {
    const r = espnWaiverOrder(four(), { ...WEEKLY, orderEdited: true });
    expect(r.used).toBe("weeklyReset");
    expect(ranksOf(r)).toEqual(ranksOf(espnWaiverOrder(four(), WEEKLY)));
    expect(liveOf(r)).toEqual({ "1": 1, "2": 2, "3": 3, "4": 4 });
    expect(r.warnings).toEqual([expect.objectContaining({ code: ESPN_WAIVER_CODES.edited, platformPath: "status.isWaiverOrderEdited" })]);
    expect(r.warnings[0]?.message).toMatch(/commissioner has edited this league's waiver order\. The next weekly reset replaces an edited order \(our reading\), so free agents are handed out in the weekly reset order/);
    // The order doesn't depend on the day of the import here either, whatever ESPN's live order says.
    for (const live of [
      [4, 3, 2, 1],
      [null, null, null, null],
    ]) {
      const teams = four().map((t, i) => ({ ...t, waiverRank: live[i] }));
      expect(ranksOf(espnWaiverOrder(teams, { ...WEEKLY, orderEdited: true })), String(live)).toEqual(ranksOf(r));
    }
  });

  it("a FAAB league whose order resets weekly: the reset order breaks ties between equal budgets (Phase 4c review of track AD)", () => {
    // The public test league's settings: continuous waivers with a FAAB budget, the order reset every week.
    const faab: EspnWaiverSettings = { ...WEEKLY, faab: true, acquisitionType: "WAIVERS_CONTINUOUS" };
    const r = espnWaiverOrder(four(), faab);
    expect(r.used).toBe("faab");
    expect(ranksOf(r)).toEqual({ "1": 2, "2": 4, "3": 1, "4": 3 });
    expect(liveOf(r)).toEqual({ "1": 1, "2": 2, "3": 3, "4": 4 });
    expect(r.warnings).toEqual([]);
    // Only a tie is made independent of the day: the budgets are read as they stand (review of track EF, finding 5).
    expect(r.notes.join(" ")).toMatch(/breaks ties between equal FAAB bids\. Ties between equal budgets go by the reset order, so a tie doesn't depend on the day you import; ESPN's order right now is different/);
    expect(r.notes.join(" ")).not.toMatch(/pickups don't depend/);
    // Any live order gives the same tiebreak, so the day of the import doesn't matter.
    for (const live of [
      [4, 3, 2, 1],
      [2, 1, 4, 3],
    ]) {
      const teams = four().map((t, i) => ({ ...t, waiverRank: live[i] }));
      expect(ranksOf(espnWaiverOrder(teams, faab)), String(live)).toEqual(ranksOf(r));
    }
    // A commissioner's edit: the reset order still breaks the ties, warned in the tiebreak's words.
    const edited = espnWaiverOrder(four(), { ...faab, orderEdited: true });
    expect(ranksOf(edited)).toEqual(ranksOf(r));
    expect(edited.warnings[0]?.message).toMatch(/so ties between equal FAAB budgets go by the weekly reset order/);
  });

  it("without divisions, seeds that aren't 1..n once each fall back to the standings, with a note", () => {
    for (const seeds of [
      [3, 1, null, 2],
      [3, 1, 4, 4],
      [3, 1, 5, 2],
    ]) {
      const teams = four().map((t, i) => ({ ...t, playoffSeed: seeds[i] as number | null }));
      const r = espnWaiverOrder(teams, WEEKLY);
      expect(r.used, String(seeds)).toBe("weeklyReset");
      expect(ranksOf(r), String(seeds)).toEqual({ "1": 2, "2": 4, "3": 1, "4": 3 });
      expect(r.notes.join(" "), String(seeds)).toMatch(/playoff seeds don't cover every team, so the reset order is read from the standings/);
    }
  });
});

describe("espnWaiverOrder: when ESPN's live rank is the order used", () => {
  it("a FAAB league whose order doesn't reset weekly (or doesn't say): the live rank breaks ties between equal budgets (as in Phase 4b)", () => {
    for (const waiverOrderReset of [false, undefined, null]) {
      const r = espnWaiverOrder(four(), { ...WEEKLY, faab: true, acquisitionType: "WAIVERS_CONTINUOUS", waiverOrderReset });
      expect(r.used, String(waiverOrderReset)).toBe("faab");
      expect(ranksOf(r)).toEqual({ "1": 1, "2": 2, "3": 3, "4": 4 });
      expect(liveOf(r)).toEqual({ "1": undefined, "2": undefined, "3": undefined, "4": undefined });
      expect([...r.notes, ...codes(r)]).toEqual([]);
    }
  });

  it("a FAAB league that resets weekly, before any game (no standings to reset to): the live rank breaks ties, warned", () => {
    const fresh = four().map((t) => ({ ...t, record: { w: 0, l: 0, t: 0 }, pointsFor: 0 }));
    const r = espnWaiverOrder(fresh, { ...WEEKLY, faab: true, acquisitionType: "WAIVERS_CONTINUOUS" });
    expect(r.used).toBe("faab");
    expect(ranksOf(r)).toEqual({ "1": 1, "2": 2, "3": 3, "4": 4 });
    expect(liveOf(r)).toEqual({ "1": undefined, "2": undefined, "3": undefined, "4": undefined });
    expect(codes(r)).toEqual([ESPN_WAIVER_CODES.beforeGames]);
    expect(r.warnings[0]?.message).toMatch(/ties between equal FAAB budgets go by ESPN's waiver order as it stands today/);
    // Worded for the tie, not the pickups: the budgets are read as they stand whatever the order (review of track EF, finding 5).
    expect(r.warnings[0]?.message).toMatch(/until the first games are played a tie between equal budgets may depend on the day you import\.$/);
  });

  it("rolling waivers (waiverOrderReset false): the live rank, no note or warning", () => {
    const r = espnWaiverOrder(four(), { ...WEEKLY, waiverOrderReset: false });
    expect(r.used).toBe("live");
    expect(ranksOf(r)).toEqual({ "1": 1, "2": 2, "3": 3, "4": 4 });
    expect(liveOf(r)).toEqual({ "1": undefined, "2": undefined, "3": undefined, "4": undefined });
    expect([...r.notes, ...codes(r)]).toEqual([]);
  });

  it("a reset rule ESPN doesn't report: the live rank, with a warning that it can change during the week", () => {
    for (const waiverOrderReset of [undefined, null]) {
      const r = espnWaiverOrder(four(), { ...WEEKLY, waiverOrderReset });
      expect(r.used).toBe("live");
      expect(ranksOf(r)).toEqual({ "1": 1, "2": 2, "3": 3, "4": 4 });
      expect(r.warnings).toEqual([expect.objectContaining({ code: ESPN_WAIVER_CODES.resetUnknown, platformPath: "settings.acquisitionSettings.waiverOrderReset" })]);
    }
  });

  it("before any game is played (no standings to reset to): the live rank, with a warning the Import Report's row reads", () => {
    const fresh = four().map((t) => ({ ...t, record: { w: 0, l: 0, t: 0 }, pointsFor: 0 }));
    expect(anyGamePlayed(fresh)).toBe(false);
    const r = espnWaiverOrder(fresh, WEEKLY);
    expect(r.used).toBe("live");
    expect(ranksOf(r)).toEqual({ "1": 1, "2": 2, "3": 3, "4": 4 });
    expect(liveOf(r)).toEqual({ "1": undefined, "2": undefined, "3": undefined, "4": undefined });
    expect(r.warnings).toEqual([expect.objectContaining({ code: ESPN_WAIVER_CODES.beforeGames, platformPath: "teams[].record.overall" })]);
    expect(r.warnings[0]?.message).toMatch(/No games have been played yet.*until the first games are played the pickups may depend on the day you import/);
    expect(r.notes).toEqual([]);
    // A points-only league's records can stay 0-0 while points for count.
    expect(anyGamePlayed(fresh.map((t, i) => (i === 2 ? { ...t, pointsFor: 88.5 } : t)))).toBe(true);
    expect(anyGamePlayed(fresh.map((t, i) => (i === 0 ? { ...t, record: { w: 0, l: 0, t: 1 } } : t)))).toBe(true);
  });

  it("before any game, only a league that resets weekly is marked: rolling waivers are the live order whenever you import", () => {
    const fresh = four().map((t) => ({ ...t, record: { w: 0, l: 0, t: 0 }, pointsFor: 0 }));
    const rolling = espnWaiverOrder(fresh, { ...WEEKLY, waiverOrderReset: false });
    expect(rolling.used).toBe("live");
    expect([...rolling.notes, ...codes(rolling)]).toEqual([]);
    // Each other caveat keeps its own code (the rule that applies first); before any game a commissioner's edit is the
    // live order itself, so only the before-games warning says anything.
    expect(codes(espnWaiverOrder(fresh, { ...WEEKLY, waiverOrderReset: undefined }))).toEqual([ESPN_WAIVER_CODES.resetUnknown]);
    const editedFresh = espnWaiverOrder(fresh, { ...WEEKLY, orderEdited: true });
    expect(editedFresh.used).toBe("live");
    expect(codes(editedFresh)).toEqual([ESPN_WAIVER_CODES.beforeGames]);
    // Without a rank for every team no order is used, so nothing is warned.
    const partial = fresh.map((t, i) => ({ ...t, waiverRank: i === 3 ? null : t.waiverRank }));
    const r = espnWaiverOrder(partial, WEEKLY);
    expect(r.used).toBeUndefined();
    expect(codes(r)).toEqual([]);
  });

  it("a live order counts only when ESPN ranks every team (the engine's rule); otherwise no order is used and nothing is warned", () => {
    const teams = four().map((t, i) => ({ ...t, waiverRank: i === 1 ? null : t.waiverRank }));
    for (const s of [{ ...WEEKLY, waiverOrderReset: false }, { ...WEEKLY, waiverOrderReset: undefined }]) {
      const r = espnWaiverOrder(teams, s);
      expect(r.used).toBeUndefined();
      expect(ranksOf(r)).toEqual({ "1": 1, "2": undefined, "3": 3, "4": 4 });
      expect(r.warnings).toEqual([]);
    }
    expect(espnWaiverOrder([], { ...WEEKLY, waiverOrderReset: false }).used).toBeUndefined();
    // The reset order ranks every team whatever ESPN sent, a commissioner's edit included.
    const edited = espnWaiverOrder(teams, { ...WEEKLY, orderEdited: true });
    expect(edited.used).toBe("weeklyReset");
    expect(ranksOf(edited)).toEqual({ "1": 2, "2": 4, "3": 1, "4": 3 });
    expect(codes(edited)).toEqual([ESPN_WAIVER_CODES.edited]);
  });

  it("⚠️ FREEAGENCY (read as no waivers): no waiver order at all, with a warning", () => {
    const r = espnWaiverOrder(four(), { ...WEEKLY, acquisitionType: "FREEAGENCY" });
    expect(r.used).toBeUndefined();
    expect([...r.ranks.values()].every((x) => x.waiverRank === undefined && x.liveWaiverRank === undefined)).toBe(true);
    expect(r.ranks.size).toBe(4);
    expect(r.warnings).toEqual([expect.objectContaining({ code: ESPN_WAIVER_CODES.noWaivers, platformPath: "settings.acquisitionSettings.acquisitionType" })]);
    // A FAAB league is a FAAB league whatever its acquisition type says.
    expect(espnWaiverOrder(four(), { ...WEEKLY, faab: true, acquisitionType: "FREEAGENCY" }).used).toBe("faab");
  });
});

describe("Parker's league (sanitized fixtures, captured 2026-09-30 at the weekly reset)", () => {
  const raw = readEspn<Json>(LABELS.league);

  it("reports what the rules read: a weekly reset (waiverOrderReset), traditional waivers, no FAAB, no commissioner edit, one division", () => {
    expect(raw.settings.acquisitionSettings).toMatchObject({ acquisitionType: "WAIVERS_TRADITIONAL", isUsingAcquisitionBudget: false, waiverOrderReset: true });
    expect(raw.status.isWaiverOrderEdited).toBe(false);
    expect(raw.settings.scheduleSettings.divisions).toHaveLength(1);
  });

  it("✅ at the reset ESPN's own waiverRank is numTeams + 1 − playoffSeed for every team", () => {
    const teams = raw.teams as Json[];
    expect(teams).toHaveLength(10);
    for (const t of teams) expect(t.waiverRank, `team ${t.id}`).toBe(teams.length + 1 - t.playoffSeed);
  });

  it("the snapshot: the weekly reset order in waiverRank, ESPN's live rank in liveWaiverRank, waiverOrderUsed weeklyReset", () => {
    const { snapshot, notes } = normalizeEspnLeague(parkerBundle(), { leagueId: PARKER.leagueId, resolver: fakeResolver(), now: NOW, swid: PARKER.swid });
    expect(snapshot.settings.waiverOrderUsed).toBe("weeklyReset");
    const reset = { "1": 8, "2": 1, "3": 4, "4": 2, "5": 5, "6": 10, "7": 9, "8": 7, "9": 6, "10": 3 };
    expect(Object.fromEntries(snapshot.teams.map((t) => [t.id, t.waiverRank]))).toEqual(reset);
    expect(Object.fromEntries(snapshot.teams.map((t) => [t.id, t.liveWaiverRank]))).toEqual(reset);
    // Captured at the reset: ESPN's order is the reset order, so there's nothing to explain.
    expect(notes.filter((n) => n.startsWith("Waiver order"))).toEqual([]);
    expect(snapshot.warnings.filter((w) => /WAIVER/.test(w.code))).toEqual([]);
  });

  it("mid-week (Oct 4, after three waiver runs moved the claimants back): the same reset order; ESPN's live order kept apart, with a note", () => {
    const bundle = parkerBundle();
    // ESPN's live order on 2026-10-04 (CLAUDE.md §7): Team 5 > 8 > 6 > 4 > 9 > 7 > 2 > 1 > 10 > 3. The records hadn't changed.
    const live: Record<string, number> = { "5": 1, "8": 2, "6": 3, "4": 4, "9": 5, "7": 6, "2": 7, "1": 8, "10": 9, "3": 10 };
    for (const t of (bundle.league as Json).teams as Json[]) t.waiverRank = live[String(t.id)];
    const { snapshot, notes } = normalizeEspnLeague(bundle, { leagueId: PARKER.leagueId, resolver: fakeResolver(), now: NOW, swid: PARKER.swid });
    const order = (key: "waiverRank" | "liveWaiverRank") => [...snapshot.teams].sort((a, b) => (a[key] as number) - (b[key] as number)).map((t) => t.id);
    expect(order("waiverRank")).toEqual(["2", "4", "10", "3", "5", "9", "8", "1", "7", "6"]);
    expect(order("liveWaiverRank")).toEqual(["5", "8", "6", "4", "9", "7", "2", "1", "10", "3"]);
    // Parker's Team 3 claims 4th, not 10th.
    expect(snapshot.teams.find((t) => t.id === PARKER.myTeamId)).toMatchObject({ waiverRank: 4, liveWaiverRank: 10 });
    expect(notes.filter((n) => n.startsWith("Waiver order"))).toEqual([expect.stringMatching(/ESPN's order right now is different/)]);
  });

  it("⚠️ a commissioner edit keeps the reset order in the snapshot, warned; an unreported reset rule keeps ESPN's live order, warned", () => {
    const edited = parkerBundle();
    (edited.league as Json).status.isWaiverOrderEdited = true;
    const live: Record<string, number> = { "5": 1, "8": 2, "6": 3, "4": 4, "9": 5, "7": 6, "2": 7, "1": 8, "10": 9, "3": 10 };
    for (const t of (edited.league as Json).teams as Json[]) t.waiverRank = live[String(t.id)];
    const e = normalizeEspnLeague(edited, { leagueId: PARKER.leagueId, resolver: fakeResolver(), now: NOW }).snapshot;
    expect(e.settings.waiverOrderUsed).toBe("weeklyReset");
    expect(e.teams.find((t) => t.id === PARKER.myTeamId)).toMatchObject({ waiverRank: 4, liveWaiverRank: 10 });
    expect(e.warnings.map((w) => w.code)).toContain(ESPN_WAIVER_CODES.edited);

    const unknown = parkerBundle();
    delete (unknown.league as Json).settings.acquisitionSettings.waiverOrderReset;
    const u = normalizeEspnLeague(unknown, { leagueId: PARKER.leagueId, resolver: fakeResolver(), now: NOW }).snapshot;
    expect(u.settings.waiverOrderUsed).toBe("live");
    expect(u.teams.every((t) => t.liveWaiverRank === undefined && typeof t.waiverRank === "number")).toBe(true);
    expect(u.warnings.map((w) => w.code)).toContain(ESPN_WAIVER_CODES.resetUnknown);
  });

  it("a FAAB league is \"faab\"; its order resets weekly, so the reset order breaks ties (ESPN's live rank kept apart), whether or not it reports its budget", () => {
    const live: Record<string, number> = { "5": 1, "8": 2, "6": 3, "4": 4, "9": 5, "7": 6, "2": 7, "1": 8, "10": 9, "3": 10 };
    const reset = { "1": 8, "2": 1, "3": 4, "4": 2, "5": 5, "6": 10, "7": 9, "8": 7, "9": 6, "10": 3 };
    for (const budget of [100, undefined]) {
      const bundle = parkerBundle();
      const league = bundle.league as Json;
      for (const t of league.teams as Json[]) t.waiverRank = live[String(t.id)];
      league.settings.acquisitionSettings.isUsingAcquisitionBudget = true;
      if (budget === undefined) delete league.settings.acquisitionSettings.acquisitionBudget;
      const { snapshot, notes } = normalizeEspnLeague(bundle, { leagueId: PARKER.leagueId, resolver: fakeResolver(), now: NOW });
      expect(snapshot.settings.waiverOrderUsed, String(budget)).toBe("faab");
      expect(snapshot.settings.faabBudget, String(budget)).toBe(budget);
      expect(Object.fromEntries(snapshot.teams.map((t) => [t.id, t.waiverRank])), String(budget)).toEqual(reset);
      expect(Object.fromEntries(snapshot.teams.map((t) => [t.id, t.liveWaiverRank])), String(budget)).toEqual(live);
      expect(notes.filter((n) => n.startsWith("Waiver order")), String(budget)).toEqual([expect.stringMatching(/Ties between equal budgets go by the reset order/)]);
    }
    // A FAAB league that doesn't reset weekly keeps ESPN's live rank as the tiebreak.
    const rolling = parkerBundle();
    const league = rolling.league as Json;
    for (const t of league.teams as Json[]) t.waiverRank = live[String(t.id)];
    Object.assign(league.settings.acquisitionSettings, { isUsingAcquisitionBudget: true, waiverOrderReset: false });
    const r = normalizeEspnLeague(rolling, { leagueId: PARKER.leagueId, resolver: fakeResolver(), now: NOW }).snapshot;
    expect(Object.fromEntries(r.teams.map((t) => [t.id, t.waiverRank]))).toEqual(live);
    expect(r.teams.every((t) => t.liveWaiverRank === undefined)).toBe(true);
  });

  it("before any game (every record 0-0 with no points, as before week 1): ESPN's live order, warned; no liveWaiverRank", () => {
    const fresh = parkerBundle();
    for (const t of (fresh.league as Json).teams as Json[]) t.record.overall = { ...t.record.overall, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };
    const { snapshot, notes } = normalizeEspnLeague(fresh, { leagueId: PARKER.leagueId, resolver: fakeResolver(), now: NOW });
    expect(snapshot.settings.waiverOrderUsed).toBe("live");
    const raw = Object.fromEntries(((fresh.league as Json).teams as Json[]).map((t) => [String(t.id), t.waiverRank]));
    expect(Object.fromEntries(snapshot.teams.map((t) => [t.id, t.waiverRank]))).toEqual(raw);
    expect(snapshot.teams.every((t) => t.liveWaiverRank === undefined)).toBe(true);
    expect(snapshot.warnings.filter((w) => /WAIVER/.test(w.code)).map((w) => w.code)).toEqual([ESPN_WAIVER_CODES.beforeGames]);
    expect(notes.filter((n) => n.startsWith("Waiver order"))).toEqual([]);
  });
});
