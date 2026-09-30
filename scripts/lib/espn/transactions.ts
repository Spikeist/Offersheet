/**
 * mTransactions2 helpers (pure). ESPN answers each scoring-period request separately, and some
 * requests repeat rows (scoringPeriodId 0 and future periods return the current period's rows), so
 * anything that counts transactions must dedupe by id.
 */
import type { Transaction } from "./schema";

type Tx = Pick<Transaction, "id" | "teamId" | "items" | "teamActions">;

/** Rows over several period requests, and the unique rows by id (first occurrence wins). */
export function dedupeById<T extends Pick<Transaction, "id">>(perPeriod: ReadonlyArray<readonly T[]>): { rows: number; unique: T[] } {
  const first = new Map<string, T>();
  let rows = 0;
  for (const list of perPeriod)
    for (const t of list) {
      rows++;
      if (!first.has(t.id)) first.set(t.id, t);
    }
  return { rows, unique: [...first.values()] };
}

/** Which ids two responses share, and which rows only one of them has. */
export function idOverlap<T extends Pick<Transaction, "id">>(a: readonly T[], b: readonly T[]): { shared: number; onlyA: T[]; onlyB: T[] } {
  const ia = new Set(a.map((t) => t.id));
  const ib = new Set(b.map((t) => t.id));
  return { shared: a.filter((t) => ib.has(t.id)).length, onlyA: a.filter((t) => !ib.has(t.id)), onlyB: b.filter((t) => !ia.has(t.id)) };
}

/** Does a transaction involve this team (as proposer, one side of a leg, or in teamActions)? */
export function involves(t: Tx, teamId: number | undefined): boolean {
  if (teamId === undefined) return false;
  return t.teamId === teamId || (t.items ?? []).some((i) => i.fromTeamId === teamId || i.toTeamId === teamId) || Object.keys(t.teamActions ?? {}).includes(String(teamId));
}
