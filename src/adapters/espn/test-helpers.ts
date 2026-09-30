/**
 * Test-only helpers for the ESPN adapter tests (committed fixtures; no network).
 * Parker's league: fixtures/sanitized/espn/ (placeholders only). The public test league (a
 * stranger's): minimized copies in fixtures/sanitized/min/espn/public-league/.
 */
import type { PlayerIdResolver, SleeperPlayerLite } from "@/data/types";
import { readMinFixture, readSanitizedFixture } from "@/test-utils/fixtures";
import type { EspnRawBundle } from "./normalize";

export const PARKER = {
  leagueId: "1000000001",
  /** Placeholder SWID of Parker's member record in the sanitized fixtures (manifest). */
  swid: "{00000000-0000-4000-8000-000000000001}",
  myTeamId: "3",
  season: 2026,
  currentWeek: 4,
} as const;

export const NOW = new Date("2026-09-29T20:00:00.000Z");
const L = (s: string) => `league/{leagueId}/${s}`;
export const LABELS = {
  league: L("view=mSettings+mTeam+mRoster+mMatchup+mStatus"),
  tx: (week: number) => L(`view=mTransactions2&scoringPeriodId=${week} (filter: FA, waiver and trade types)`),
  fa: (pos: string) => L(`view=kona_player_info&scoringPeriodId={current} (free agents ${pos}, limit 500; 50 most-owned + top 50 by projection)`),
  /** Player cards of every rostered player, 40 per batch (Phase 0 probe; espn-api get_player_card filter). */
  cards: (batch: number) => L(`view=kona_playercard (rostered players batch ${batch})`),
  roster: (week: number) => L(`view=mRoster&scoringPeriodId=${week}`),
  wrongSeason: L("seasons={season+1}/view=mSettings (error body)"),
  proSchedule: "seasons/{season}/view=proTeamSchedules_wl",
  playersWl: "seasons/{season}/players?view=players_wl (active; QB/RB/WR/TE/K/D/ST plus up to 5 per other position)",
  manifest: "manifest",
} as const;
export const FA_POSITIONS = ["QB", "RB", "WR", "TE", "K", "D/ST"] as const;
export const CARD_BATCHES = [1, 2, 3, 4, 5] as const;

export const PUBLIC = {
  group: "public-league",
  league: "league: settings, scoring, roster subset",
  /** The public test league's top-250 pool: that week's actual lines (weeks 2 and 3). */
  pool: (week: number) => `player pool: week ${week} actual lines`,
  weeks: [2, 3],
} as const;
export const CROSS = { group: "cross-source", label: "sleeper stats weeks 2-3 (Parker's rostered players)" } as const;

export const readEspn = <T = unknown>(label: string) => readSanitizedFixture<T>("espn", label);

/** Every rostered player's card (the five committed batches), as one kona_playercard body. */
export function parkerCards(): { players: Array<{ id: number; player: { id: number; injuryStatus?: string; injuryDetails?: { expectedReturnDate?: number[]; outForSeason?: boolean } } }> } {
  return { players: CARD_BATCHES.flatMap((b) => readEspn<{ players: Array<{ id: number; player: { id: number } }> }>(LABELS.cards(b)).players) };
}

/** Parker's league as fetch.ts would collect it (transactions for periods 1–4, six free-agent lists, player cards). */
export function parkerBundle(): EspnRawBundle {
  return {
    league: readEspn(LABELS.league),
    transactions: [1, 2, 3, 4].map((w) => readEspn(LABELS.tx(w))),
    freeAgents: FA_POSITIONS.map((p) => readEspn(LABELS.fa(p))),
    playerCards: [parkerCards()],
    proTeamSchedules: readEspn(LABELS.proSchedule),
  };
}

/**
 * Parker's fixtures are refreshed whenever the ESPN probe re-runs, so tests take live-data facts
 * (transaction counts, records) from the fixtures themselves. This restates the transaction rule
 * independently: unique ids, EXECUTED only; FREEAGENT → add (drop when it has no ADD), WAIVER →
 * waiver, TRADE_ACCEPT / TRADE_UPHOLD → trade (the fixtures have no executed trade to dedupe).
 */
export function expectedTransactionTypes(): Record<string, number> {
  const seen = new Set<string>();
  const out: Record<string, number> = {};
  for (const w of [1, 2, 3, 4])
    for (const t of readEspn<{ transactions?: Array<{ id: string; type: string; status?: string; items?: Array<{ type?: string }> }> }>(LABELS.tx(w)).transactions ?? []) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      if (t.status !== "EXECUTED") continue;
      const type = t.type === "WAIVER" ? "waiver" : t.type === "FREEAGENT" ? ((t.items ?? []).some((i) => i.type === "ADD") ? "add" : "drop") : t.type === "TRADE_ACCEPT" || t.type === "TRADE_UPHOLD" ? "trade" : undefined;
      if (type) out[type] = (out[type] ?? 0) + 1;
    }
  return out;
}

export interface CrossRow {
  week: number;
  espnId: number;
  sleeperId: string;
  stats: Record<string, number>;
}
export interface CrossFixture {
  keys: string[];
  playerWeeks: number;
  unmatched: { noSleeperId: number; noSleeperRow: number };
  rows: CrossRow[];
}
export const readCross = () => readMinFixture<CrossFixture>("espn", CROSS.group, CROSS.label);

/**
 * A resolver like src/data's, built from real crosswalk rows (ESPN id → Sleeper id, from the
 * committed cross-source fixture) so canonical ids in tests are realistic. D/ST → Sleeper team code.
 */
export function fakeResolver(extra: { ages?: Record<string, number> } = {}): PlayerIdResolver {
  const bySpn = new Map<string, string>();
  for (const r of readCross().rows) if (r.espnId > 0) bySpn.set(String(r.espnId), r.sleeperId);
  return {
    canonical: (source, id) => (source === "espn" ? bySpn.get(id) : undefined),
    sleeperPlayer: (id) => {
      const age = extra.ages?.[id];
      return age === undefined ? undefined : ({ id, name: "Zorblax Quintavious", position: "WR", fantasyPositions: ["WR"], team: null, injuryStatus: null, status: null, age, active: true, yearsExp: 3 } satisfies SleeperPlayerLite);
    },
    defenseId: (code) => ({ WSH: "WAS" })[code] ?? code,
    sources: () => [],
  };
}
