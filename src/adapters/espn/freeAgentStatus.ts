/**
 * ESPN free agents' waiver status (planner reply to Checkpoint 7a, §6.2: the League page's "Waiver upgrades" shows "On
 * waivers until Wed" or "Free agent now" when the platform reports it; LeagueSnapshot.freeAgentStatus). PURE: no I/O, no
 * clock.
 *
 * The import's free-agent requests (leagueData.ts: view=kona_player_info, filterStatus FREEAGENT and WAIVERS) answer each
 * player with ESPN's `status` (✅ seen in every capture: FREEAGENT or WAIVERS for an unrostered player, ONTEAM for a rostered
 * one) and, for WAIVERS, `waiverProcessDate` (epoch ms: when ESPN runs the claims; ✅ on every WAIVERS row of the Phase 0
 * captures, e.g. a Wednesday 07:00 UTC in Parker's league on the Tuesday it was read). FREEAGENT → "freeAgent"; WAIVERS →
 * "waivers", with `until` (ISO) when the date reads as a time; anything else (ONTEAM, a missing or unknown status) → no
 * entry, so no status is shown. Only the free agents the snapshot keeps get one (the rest of ESPN's pool isn't shown), each
 * from his first row (a player eligible at two positions comes back in two position lists, with the same status).
 *
 * The schema keeps both fields (schema.ts PoolPlayerSchema), so a league the browser read and uploaded (src/adapters/upload.ts
 * keeps each body in its schema-kept form) gets the same statuses as the server's own read.
 */
import type { FreeAgentStatus } from "@/engine/model";
import type { EspnPoolPlayer } from "./schema";

/** ESPN's status values (kona_player_info players[].status) this reads. */
export const ESPN_STATUS = { freeAgent: "FREEAGENT", waivers: "WAIVERS" } as const;

/**
 * The waiver status of each kept free agent (`kept`: canonical ids, LeagueSnapshot.freeAgents), from the free-agent pool's
 * rows; `idOf` maps a row to its canonical id (normalize.ts's player mapper; undefined when he isn't mapped). Undefined when
 * no kept free agent has one (the snapshot then has no field).
 */
export function espnFreeAgentStatus(pool: readonly EspnPoolPlayer[], kept: readonly string[], idOf: (row: EspnPoolPlayer) => string | undefined): Record<string, FreeAgentStatus> | undefined {
  const wanted = new Set(kept);
  const out: Record<string, FreeAgentStatus> = {};
  let any = false;
  for (const row of pool) {
    const id = idOf(row);
    if (id === undefined || !wanted.has(id) || Object.prototype.hasOwnProperty.call(out, id)) continue;
    const status = statusOf(row);
    if (!status) continue;
    out[id] = status;
    any = true;
  }
  return any ? out : undefined;
}

/** One row's status (the file header), or null when it reports none we read. */
export function statusOf(row: Pick<EspnPoolPlayer, "status" | "waiverProcessDate">): FreeAgentStatus | null {
  if (row.status === ESPN_STATUS.freeAgent) return { kind: "freeAgent" };
  if (row.status !== ESPN_STATUS.waivers) return null;
  const ms = row.waiverProcessDate;
  // A real moment: a finite number after the epoch that a Date can hold.
  const until = typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
  return until && !Number.isNaN(until.getTime()) ? { kind: "waivers", until: until.toISOString() } : { kind: "waivers" };
}
