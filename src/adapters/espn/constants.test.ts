import { describe, expect, it } from "vitest";
import type { Pos } from "@/engine/model";
import { ESPN_API_SOURCE, ESPN_DEFAULT_POSITIONS, ESPN_LINEUP_SLOTS, ESPN_LINEUP_SLOT_IDS, ESPN_PRO_TEAMS, ESPN_SCORING_FORMAT, ESPN_TRANSACTION_TYPES } from "./constants";
import { POSITION_ID, SLOT, eligiblePositions, mapInjury, positionOf, slotInfo } from "./positions";
import { LABELS, PUBLIC, readEspn } from "./test-helpers";
import { readMinFixture } from "@/test-utils/fixtures";

interface WlPlayer {
  id: number;
  fullName: string;
  defaultPositionId: number;
  eligibleSlots: number[];
  proTeamId: number;
}
const players = readEspn<WlPlayer[]>(LABELS.playersWl);

/** espn-api football/player.py: the first eligible slot that isn't 25 and isn't a combo slot (unless the name has "/"). */
function espnApiPosition(p: WlPlayer): string | undefined {
  for (const slot of p.eligibleSlots) {
    const label = ESPN_LINEUP_SLOTS[slot];
    if (label === undefined) continue;
    if ((slot !== 25 && !label.includes("/")) || p.fullName.includes("/")) return label;
  }
  return undefined;
}

describe("generated espn-api tables (cwendt94/espn-api@663d726, MIT)", () => {
  it("records the pinned source and carries the tables the adapter reads", () => {
    expect(ESPN_API_SOURCE.commit).toBe("663d726c82acdcd1e1f42ecaef35b993ce9ce455");
    expect(ESPN_API_SOURCE.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(ESPN_LINEUP_SLOTS)).toHaveLength(26);
    expect(ESPN_LINEUP_SLOTS[20]).toBe("BE");
    expect(ESPN_LINEUP_SLOTS[21]).toBe("IR");
    expect(ESPN_LINEUP_SLOT_IDS.FLEX).toBe(23);
    expect(ESPN_PRO_TEAMS[0]).toBe("None");
    expect(Object.keys(ESPN_PRO_TEAMS)).toHaveLength(33);
    expect(Object.keys(ESPN_SCORING_FORMAT)).toHaveLength(235);
    expect(ESPN_SCORING_FORMAT[53]).toEqual({ abbr: "REC", label: "Each reception" });
    expect(ESPN_TRANSACTION_TYPES).toContain("TRADE_ACCEPT");
  });

  it("looks slot and position ids up by label (none hand-typed)", () => {
    expect(SLOT).toEqual({ QB: 0, TQB: 1, OP: 7, BENCH: 20, IR: 21, HC: 19 });
    expect(POSITION_ID).toEqual({ QB: 1, TQB: 15, HC: 14, DST: 16 });
  });
});

describe("empirical defaultPositionId table (Phase 0 E.defaultPosition)", () => {
  it("matches espn-api's eligibleSlots rule for every active player in the committed players_wl fixture", () => {
    expect(players.length).toBeGreaterThan(1000);
    const seen = new Set<number>();
    for (const p of players) {
      seen.add(p.defaultPositionId);
      expect({ id: p.id, pos: ESPN_DEFAULT_POSITIONS[p.defaultPositionId] }).toEqual({ id: p.id, pos: espnApiPosition(p) });
    }
    expect([...seen].sort((a, b) => a - b)).toEqual(Object.keys(ESPN_DEFAULT_POSITIONS).map(Number));
  });

  it("team D/ST units have id −(16000 + proTeamId); TQB units −(15000 + proTeamId)", () => {
    const dst = players.filter((p) => p.defaultPositionId === POSITION_ID.DST);
    expect(dst.length).toBe(32);
    for (const p of dst) expect(p.id).toBe(-(16000 + p.proTeamId));
    const league = readMinFixture<{ teams: Array<{ roster: { entries: Array<{ playerPoolEntry: { player: WlPlayer } }> } }> }>("espn", PUBLIC.group, PUBLIC.league);
    const tqb = league.teams.flatMap((t) => t.roster.entries.map((e) => e.playerPoolEntry.player)).filter((p) => p.defaultPositionId === POSITION_ID.TQB);
    expect(tqb.length).toBeGreaterThan(0);
    for (const p of tqb) expect(p.id).toBe(-(15000 + p.proTeamId));
  });
});

describe("positions and slots → Pos", () => {
  it("maps ESPN positions (TQB → QB, D/ST → DEF, DT/DE → DL, CB/S → DB, HC unmapped)", () => {
    expect(positionOf(15)).toEqual({ name: "TQB", pos: "QB" });
    expect(positionOf(16)).toEqual({ name: "D/ST", pos: "DEF" });
    expect(positionOf(9).pos).toBe("DL");
    expect(positionOf(13).pos).toBe("DB");
    expect(positionOf(7).pos).toBe("P");
    expect(positionOf(14)).toEqual({ name: "HC", pos: null });
    expect(positionOf(99)).toEqual({ name: undefined, pos: null });
  });

  it("slot eligibility agrees with who ESPN actually lets into each slot (players_wl)", () => {
    // At ESPN's own position level: a position is eligible for a slot when ≥ 95% of its players list
    // the slot, and must be ≤ 5% otherwise (single dual-eligible players exist). The slot's Pos list
    // must then be exactly the Pos image of the eligible ESPN positions (TQB → QB, DT/DE → DL …).
    const byName = new Map<string, WlPlayer[]>();
    for (const p of players) {
      const name = ESPN_DEFAULT_POSITIONS[p.defaultPositionId] as string;
      byName.set(name, [...(byName.get(name) ?? []), p]);
    }
    let checked = 0;
    for (const id of Object.keys(ESPN_LINEUP_SLOTS).map(Number)) {
      const s = slotInfo(id);
      if (!s.starting || !s.eligible) continue;
      const eligibleNames: string[] = [];
      for (const [name, list] of byName) {
        const share = list.filter((p) => p.eligibleSlots.includes(id)).length / list.length;
        if (share >= 0.95) eligibleNames.push(name);
        else expect({ slot: s.name, name, share: share <= 0.05 }).toEqual({ slot: s.name, name, share: true });
      }
      const image = new Set(eligibleNames.map((n) => positionOf(Number(Object.entries(ESPN_DEFAULT_POSITIONS).find(([, v]) => v === n)?.[0])).pos as Pos));
      expect({ slot: s.name, eligible: [...s.eligible].sort() }).toEqual({ slot: s.name, eligible: [...image].sort() });
      checked++;
    }
    expect(checked).toBe(20);
  });

  it("names slots as ESPN does, FLEX for 23, and flags slots we can't model", () => {
    expect(slotInfo(23)).toMatchObject({ name: "FLEX", starting: true, eligible: ["RB", "WR", "TE"] });
    expect(slotInfo(7)).toMatchObject({ name: "OP", eligible: ["QB", "RB", "WR", "TE"] });
    expect(slotInfo(15)).toMatchObject({ name: "DP", eligible: ["DL", "LB", "DB"] });
    expect(slotInfo(16)).toMatchObject({ name: "D/ST", eligible: ["DEF"] });
    expect(slotInfo(1)).toMatchObject({ name: "TQB", eligible: ["QB"] });
    expect(slotInfo(19)).toMatchObject({ name: "HC", eligible: null });
    expect(slotInfo(24)).toMatchObject({ name: "ER", eligible: null });
    expect(slotInfo(20).starting).toBe(false);
    expect(slotInfo(25).starting).toBe(false);
  });

  it("derives a player's eligible positions from single-position slots, own position first", () => {
    expect(eligiblePositions("WR", [3, 4, 5, 23, 7, 20, 21, 12, 14, 15])).toEqual(["WR", "DB"]);
    expect(eligiblePositions("RB", [25, 2, 3, 23, 7, 20, 21])).toEqual(["RB"]);
    expect(eligiblePositions("DEF", [16, 20, 21])).toEqual(["DEF"]);
  });

  it("maps injury statuses per the planner (DAY_TO_DAY → QUESTIONABLE; unknown → healthy, flagged)", () => {
    expect(mapInjury("INJURY_RESERVE")).toEqual({ injury: "IR", known: true });
    expect(mapInjury("DAY_TO_DAY")).toEqual({ injury: "QUESTIONABLE", known: true });
    expect(mapInjury("PROBABLE")).toEqual({ injury: "PROBABLE", known: true }); // Checkpoint 1 answer 5
    expect(mapInjury("SUSPENSION")).toEqual({ injury: "SUSPENDED", known: true });
    expect(mapInjury(undefined)).toEqual({ injury: "ACTIVE", known: true });
    // "NA" means "not an active NFL player" in the model; an unknown ESPN status doesn't say that.
    expect(mapInjury("PATERNITY")).toEqual({ injury: "ACTIVE", known: false });
  });
});
