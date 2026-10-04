/**
 * Minimized fixtures for the ESPN trade refill (Phase 4, approved at Checkpoint 1; CLAUDE.md §2.2
 * "Transactions"): ESPN lists other teams' completed trades without their players, so the adapter
 * rebuilds them from the roster entries whose acquisitionType is "TRADE" (src/adapters/espn/trades.ts).
 * This script commits the live evidence the adapter tests read. It never makes a request.
 *
 *   fixtures/sanitized/min/espn/trade-refill/
 *     "parker: completed trade without players"  Parker's league as the app imported it after a trade
 *        between two other teams went through (a public import: the app's server cache under
 *        .cache/app/, read OFFLINE by the app's own cache keys): ESPN's trade rows (TRADE_ACCEPT /
 *        TRADE_UPHOLD of every period, any status; memberId dropped), each traded player's new roster
 *        entry fields (team, lineup slot, acquisitionType, acquisitionDate) with the team he was on in
 *        the committed pre-trade fixture (fixtures/sanitized/espn/, captured 2026-09-30), the players the
 *        trade's rows drop who are gone from that roster, ESPN's per-team trade counters and the review
 *        period. Team ids only (the tests read names from the committed league fixture); player ids are
 *        ESPN's public NFL player ids; Parker's own league, so times aren't shifted (like its other
 *        committed fixtures).
 *   fixtures/sanitized/min/espn/public-league/
 *     "trade acquisitions"  the public test league (a stranger's; CLAUDE.md §0.6): its players acquired
 *        by trade (a minimal player object and the entry's acquisition fields), ESPN's per-team trade
 *        counters, the trade review settings and the league's activation date. Timestamps shifted by the
 *        secret whole-week offset (scripts/lib/minimize.ts), like its other minimized fixtures. Read
 *        from the full sanitized copy in git-ignored data-local/.
 *
 * The app's cached copies are deleted 10 minutes after they're stored (§2.10), so run it right after
 * importing the league (npm run dev, Connect, Import); it says so when they're gone.
 *
 *   npx tsx scripts/minimize/espn-trade-refill.ts
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { sha256 } from "../lib/cache";
import { ROOT, env } from "../lib/env";
import { readLocalFixture, saveMinimizedFixture, shiftTimestamps, timestampShiftMs } from "../lib/minimize";
import { installConsoleScrubber } from "../lib/redact";
import { isMainModule } from "../lib/runMode";

export const REFILL_GROUP = "trade-refill";
export const REFILL_PARKER = "parker: completed trade without players";
export const PUBLIC_GROUP = "public-league";
export const PUBLIC_TRADES = "trade acquisitions";
const PUBLIC_LEAGUE_LABEL = "public-league/{publicLeagueId}/view=mSettings+mTeam+mRoster+mStatus";
/** Parker's committed pre-trade league (fixtures/sanitized/espn/), for the team each traded player came from. */
const PRE_TRADE_LABEL = "league/{leagueId}/view=mSettings+mTeam+mRoster+mMatchup+mStatus";
const APP_CACHE_DIR = path.join(ROOT, ".cache", "app");
const TRADE_ROW_TYPES = new Set(["TRADE_ACCEPT", "TRADE_UPHOLD"]);

type Json = Record<string, unknown>;
interface Entry {
  playerId: number;
  lineupSlotId: number;
  acquisitionType?: string | null;
  acquisitionDate?: number | null;
  playerPoolEntry: { id: number; player: { id: number; fullName: string; defaultPositionId: number; eligibleSlots: number[]; proTeamId: number; injuryStatus?: string | null } };
}
interface Team {
  id: number;
  roster?: { entries?: Entry[] };
  transactionCounter?: { trades?: number | null } | null;
}
interface League {
  status: { latestScoringPeriod: number; activatedDate?: number | null };
  settings: { tradeSettings: { revisionHours?: number | null; vetoVotesRequired?: number | null } };
  teams: Team[];
}
interface Row {
  id: string;
  type: string;
  status?: string | null;
  relatedTransactionId?: string | null;
  scoringPeriodId: number;
  teamId: number;
  proposedDate?: number | null;
  processDate?: number | null;
  items?: Array<{ playerId: number; type?: string | null; fromTeamId?: number | null; toTeamId?: number | null; fromLineupSlotId?: number | null; toLineupSlotId?: number | null }> | null;
  teamActions?: Record<string, string> | null;
}

/**
 * One body from the app's file cache (src/server/cache.ts FileCache: sha256(key).json holding
 * { storedAt, expiresAt, value: { status, text, … } }), read directly so an entry past its retention
 * is read, never deleted. undefined when it isn't there.
 */
function appCached<T>(key: string): { body: T; storedAt: number } | undefined {
  const file = path.join(APP_CACHE_DIR, `${sha256(key)}.json`);
  if (!existsSync(file)) return undefined;
  const envelope = JSON.parse(readFileSync(file, "utf8")) as { storedAt: number; value: { status?: number; text?: string } };
  if (envelope.value.status !== 200 || typeof envelope.value.text !== "string") return undefined;
  return { body: JSON.parse(envelope.value.text) as T, storedAt: envelope.storedAt };
}

const counters = (teams: readonly Team[]) => Object.fromEntries(teams.map((t) => [String(t.id), t.transactionCounter?.trades ?? null]));

const minRow = (r: Row): Json => ({
  id: r.id,
  type: r.type,
  ...(r.status ? { status: r.status } : {}),
  ...(r.relatedTransactionId ? { relatedTransactionId: r.relatedTransactionId } : {}),
  scoringPeriodId: r.scoringPeriodId,
  teamId: r.teamId,
  ...(typeof r.proposedDate === "number" ? { proposedDate: r.proposedDate } : {}),
  ...(typeof r.processDate === "number" ? { processDate: r.processDate } : {}),
  ...(r.items ? { items: r.items.map((i) => ({ playerId: i.playerId, type: i.type ?? null, fromTeamId: i.fromTeamId ?? null, toTeamId: i.toTeamId ?? null, fromLineupSlotId: i.fromLineupSlotId ?? null, toLineupSlotId: i.toLineupSlotId ?? null })) } : {}),
  ...(r.teamActions ? { teamActions: r.teamActions } : {}),
});

async function parkerFixture(): Promise<void> {
  const leagueId = env("ESPN_LEAGUE_ID");
  const season = Number(env("ESPN_SEASON") ?? "2026");
  if (!leagueId) throw new Error("ESPN_LEAGUE_ID is blank in .env.local");
  // The app's own keys for a public import (src/adapters/espn/fetch.ts: espn:<scope>:<season>:<leagueId>:…).
  const base = `espn:public:${season}:${leagueId}`;
  const league = appCached<League>(`${base}:league`);
  if (!league) throw new Error("the app's cached copy of the league is gone (it's kept 10 minutes): import the league again (npm run dev), then rerun this script");
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (let sp = 1; sp <= league.body.status.latestScoringPeriod; sp++) {
    const tx = appCached<{ transactions?: Row[] }>(`${base}:tx:${sp}`);
    if (!tx) throw new Error(`the app's cached transactions of period ${sp} are gone: import the league again, then rerun this script`);
    for (const r of tx.body.transactions ?? []) {
      if (!TRADE_ROW_TYPES.has(r.type) || seen.has(r.id)) continue;
      seen.add(r.id);
      rows.push(r);
    }
  }
  const before = new Map<number, number>();
  const pre = JSON.parse(readFileSync(path.join(ROOT, "fixtures", "sanitized", "espn", `${sha256(PRE_TRADE_LABEL)}.json`), "utf8")) as League;
  for (const t of pre.teams) for (const e of t.roster?.entries ?? []) before.set(e.playerId, t.id);
  const onTeam = new Map<number, number>();
  for (const t of league.body.teams) for (const e of t.roster?.entries ?? []) onTeam.set(e.playerId, t.id);

  const moved = league.body.teams.flatMap((t) =>
    (t.roster?.entries ?? [])
      .filter((e) => e.acquisitionType === "TRADE")
      .map((e) => ({ playerId: e.playerId, from: before.get(e.playerId) ?? null, to: t.id, lineupSlotId: e.lineupSlotId, acquisitionType: e.acquisitionType, acquisitionDate: e.acquisitionDate ?? null })),
  );
  const dropped = rows.flatMap((r) => (r.items ?? []).filter((i) => i.type === "DROP" && typeof i.fromTeamId === "number" && onTeam.get(i.playerId) !== i.fromTeamId).map((i) => ({ playerId: i.playerId, teamId: i.fromTeamId as number })));
  const body = {
    captured: new Date(league.storedAt).toISOString(),
    revisionHours: league.body.settings.tradeSettings.revisionHours ?? null,
    vetoVotesRequired: league.body.settings.tradeSettings.vetoVotesRequired ?? null,
    activatedDate: league.body.status.activatedDate ?? null,
    counters: counters(league.body.teams),
    rows: rows.map(minRow),
    moved,
    dropped,
  };
  const file = await saveMinimizedFixture("espn", REFILL_GROUP, REFILL_PARKER, body, {
    note: `${rows.length} trade row(s), ${moved.length} player(s) acquired by trade, ${dropped.length} dropped by the trade; from the app's cached import of ${body.captured.slice(0, 10)}`,
  });
  console.log(`saved ${file} (${rows.length} trade rows, ${moved.length} traded players, ${dropped.length} dropped)`);
}

async function publicFixture(): Promise<void> {
  const league = readLocalFixture<League>("espn", PUBLIC_LEAGUE_LABEL);
  const teams = league.teams
    .map((t) => ({
      id: t.id,
      entries: (t.roster?.entries ?? [])
        .filter((e) => e.acquisitionType === "TRADE")
        .map((e) => {
          const p = e.playerPoolEntry.player;
          return {
            playerId: e.playerId,
            lineupSlotId: e.lineupSlotId,
            acquisitionType: e.acquisitionType,
            acquisitionDate: e.acquisitionDate ?? null,
            playerPoolEntry: { id: e.playerPoolEntry.id, player: { id: p.id, fullName: p.fullName, defaultPositionId: p.defaultPositionId, eligibleSlots: p.eligibleSlots, proTeamId: p.proTeamId, ...(p.injuryStatus ? { injuryStatus: p.injuryStatus } : {}), stats: [] } },
          };
        }),
    }))
    .filter((t) => t.entries.length);
  const body = {
    revisionHours: league.settings.tradeSettings.revisionHours ?? null,
    vetoVotesRequired: league.settings.tradeSettings.vetoVotesRequired ?? null,
    activatedDate: league.status.activatedDate ?? null,
    counters: counters(league.teams),
    teams,
  };
  const n = teams.reduce((s, t) => s + t.entries.length, 0);
  const file = await saveMinimizedFixture("espn", PUBLIC_GROUP, PUBLIC_TRADES, shiftTimestamps(body, timestampShiftMs("espn")), { note: `${n} roster entries acquired by trade, ESPN's per-team trade counters, review settings and activation date; timestamps shifted` });
  console.log(`saved ${file} (${n} players acquired by trade)`);
}

async function main(): Promise<void> {
  installConsoleScrubber();
  await publicFixture();
  await parkerFixture();
}

// Run only as a script (an exact path: ../lib/runMode.ts isMainModule; a scratch file that imports it starts nothing).
if (isMainModule(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
