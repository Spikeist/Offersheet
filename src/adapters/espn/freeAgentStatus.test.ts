/**
 * ESPN free agents' waiver status (./freeAgentStatus.ts; planner reply to Checkpoint 7a, §6.2): FREEAGENT and WAIVERS with
 * the claims' date, only for the free agents the snapshot keeps, through the normalizer (the committed fixture of Parker's
 * league, read on a Tuesday: every kept free agent on waivers until Wednesday), and the same through a browser's upload
 * (the schema keeps waiverProcessDate).
 */
import { describe, expect, it } from "vitest";
import { trimEspnBody } from "../upload";
import { ESPN_STATUS, espnFreeAgentStatus, statusOf } from "./freeAgentStatus";
import { normalizeEspnLeague } from "./normalize";
import { PoolPlayerSchema, type EspnPoolPlayer } from "./schema";
import { NOW, PARKER, fakeResolver, parkerBundle } from "./test-helpers";

const WED_3AM_ET = Date.UTC(2026, 8, 30, 7, 0, 0);
const row = (id: number, status: string | null, waiverProcessDate?: number): EspnPoolPlayer =>
  PoolPlayerSchema.parse({ id, onTeamId: 0, status, ...(waiverProcessDate !== undefined ? { waiverProcessDate } : {}), player: { id, fullName: `Player ${id}`, defaultPositionId: 2, proTeamId: 1, eligibleSlots: [2] } });

describe("statusOf: one row", () => {
  it("FREEAGENT is a free agent now; WAIVERS is on waivers until the claims' date (ISO), when it reads as a moment", () => {
    expect(statusOf(row(1, ESPN_STATUS.freeAgent))).toEqual({ kind: "freeAgent" });
    expect(statusOf(row(2, ESPN_STATUS.waivers, WED_3AM_ET))).toEqual({ kind: "waivers", until: "2026-09-30T07:00:00.000Z" });
    for (const bad of [undefined, 0, -5, Number.MAX_VALUE]) expect(statusOf({ status: ESPN_STATUS.waivers, waiverProcessDate: bad }), String(bad)).toEqual({ kind: "waivers" });
  });

  it("anything else reports no status (ONTEAM, missing, unknown)", () => {
    for (const s of ["ONTEAM", null, "SOMETHING_NEW"]) expect(statusOf(row(3, s)), String(s)).toBeNull();
  });
});

describe("espnFreeAgentStatus: the kept free agents' statuses", () => {
  const idOf = (r: EspnPoolPlayer) => (r.player.id === 99 ? undefined : `espn:${r.player.id}`);

  it("only the kept free agents, each from his first row; undefined when none has one", () => {
    const pool = [row(1, "FREEAGENT"), row(2, "WAIVERS", WED_3AM_ET), row(2, "FREEAGENT"), row(3, "WAIVERS", WED_3AM_ET), row(99, "FREEAGENT"), row(4, "ONTEAM")];
    expect(espnFreeAgentStatus(pool, ["espn:1", "espn:2", "espn:4", "espn:99"], idOf)).toEqual({
      "espn:1": { kind: "freeAgent" },
      "espn:2": { kind: "waivers", until: "2026-09-30T07:00:00.000Z" },
    });
    expect(espnFreeAgentStatus(pool, ["espn:4"], idOf)).toBeUndefined();
    expect(espnFreeAgentStatus([], ["espn:1"], idOf)).toBeUndefined();
  });
});

describe("through the normalizer (the committed fixture: Parker's league read on Tuesday, Sep 29)", () => {
  const { snapshot } = normalizeEspnLeague(parkerBundle(), { leagueId: PARKER.leagueId, resolver: fakeResolver(), now: NOW, swid: PARKER.swid });

  it("every kept free agent has ESPN's status (all on waivers then), and nobody else does", () => {
    const status = snapshot.freeAgentStatus ?? {};
    expect(Object.keys(status).sort()).toEqual([...snapshot.freeAgents].sort());
    const until = Object.values(status).map((s) => (s.kind === "waivers" ? s.until : s.kind));
    // Wednesday 3 AM Eastern (07:00 UTC), and two players dropped later on until Thursday.
    expect(until.filter((u) => u === "2026-09-30T07:00:00.000Z").length).toBeGreaterThan(200);
    expect(until.every((u) => u === "2026-09-30T07:00:00.000Z" || u === "2026-10-01T07:00:00.000Z")).toBe(true);
  });

  it("a browser's upload keeps the claims' date (the schema-kept form holds waiverProcessDate), so its import gets the same", () => {
    const fa = parkerBundle().freeAgents?.[0] as { players: unknown[] };
    const url = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/1000000001?view=kona_player_info&scoringPeriodId=4";
    const kept = trimEspnBody(url, fa) as { players: Array<{ status?: string; waiverProcessDate?: number }> };
    const waived = kept.players.filter((x) => x.status === "WAIVERS");
    expect(waived.length).toBeGreaterThan(0);
    for (const x of waived) expect(typeof x.waiverProcessDate).toBe("number");
  });
});
