/**
 * Future draft picks from FetchTeamPicks (one call per team). Observed 2026-09-29: a traded pick is
 * listed under BOTH teams — the new owner's copy, and the original owner's copy flagged
 * `lost: true` (traded: true, ownedBy = the new owner). Summing the per-team lists therefore counts
 * every traded pick twice. Dedup rule for the adapter: key (season, slot.round, originalOwner ??
 * ownedBy); the owner is `ownedBy` of the copy that is not `lost`. Pure functions: no I/O.
 */
import type { FfDraftPick } from "./api";

export interface DistinctPick {
  season: number;
  round: number;
  originalTeam: number;
  owner: number;
  /** Owned by a team other than the original one. */
  traded: boolean;
  /** Copies seen across the team lists (2 for a traded pick). */
  copies: number;
  lostCopies: number;
}

export interface PickDedup {
  entries: number;
  distinct: DistinctPick[];
  lostCopies: number;
  /** Picks whose only copies are `lost` (no current owner lists them): would mean a forfeited pick. */
  onlyLost: number;
  /** Picks whose non-lost copies disagree on the owner. */
  conflicts: number;
}

export function dedupePicks(lists: ReadonlyArray<{ teamId: number; picks: readonly FfDraftPick[] }>): PickDedup {
  const byKey = new Map<string, { season: number; round: number; originalTeam: number; copies: Array<{ owner: number | undefined; lost: boolean }> }>();
  let entries = 0;
  for (const { teamId, picks } of lists) {
    for (const p of picks) {
      entries++;
      const season = p.season ?? 0;
      const round = p.slot?.round ?? 0;
      const originalTeam = p.originalOwner?.id ?? p.ownedBy?.id ?? teamId;
      const key = `${season}|${round}|${originalTeam}`;
      const g = byKey.get(key) ?? { season, round, originalTeam, copies: [] };
      g.copies.push({ owner: p.ownedBy?.id ?? teamId, lost: p.lost === true });
      byKey.set(key, g);
    }
  }
  const distinct: DistinctPick[] = [];
  let lostCopies = 0;
  let onlyLost = 0;
  let conflicts = 0;
  for (const g of byKey.values()) {
    const kept = g.copies.filter((c) => !c.lost);
    const lost = g.copies.length - kept.length;
    lostCopies += lost;
    if (!kept.length) onlyLost++;
    const owners = new Set(kept.map((c) => c.owner));
    if (owners.size > 1) conflicts++;
    const owner = kept[0]?.owner ?? g.copies[0]?.owner ?? g.originalTeam;
    distinct.push({ season: g.season, round: g.round, originalTeam: g.originalTeam, owner, traded: owner !== g.originalTeam, copies: g.copies.length, lostCopies: lost });
  }
  distinct.sort((a, b) => a.season - b.season || a.round - b.round || a.originalTeam - b.originalTeam);
  return { entries, distinct, lostCopies, onlyLost, conflicts };
}

/**
 * Cross-check traded picks against completed trades: a traded pick should appear in some trade's
 * picksObtained for the side that now owns it (same season, round and original team).
 */
export function matchTradedPicks(
  picks: readonly DistinctPick[],
  trades: ReadonlyArray<{ teams?: Array<{ team?: { id: number }; picksObtained?: FfDraftPick[] }> }>,
): { traded: number; matched: number } {
  const obtained = new Set<string>();
  for (const t of trades)
    for (const side of t.teams ?? [])
      for (const p of side.picksObtained ?? []) obtained.add(`${p.season}|${p.slot?.round}|${p.originalOwner?.id}|${side.team?.id}`);
  const traded = picks.filter((p) => p.traded);
  return { traded: traded.length, matched: traded.filter((p) => obtained.has(`${p.season}|${p.round}|${p.originalTeam}|${p.owner}`)).length };
}
