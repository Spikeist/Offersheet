/**
 * When numbers computed for one moment still hold at another (Phase 4 wave 2 decision M12; client-safe: no engine
 * beyond acceptance.ts's deadline readings, which the pages already load). The engine's worker keeps its evaluation
 * context while this holds (src/workers/engine.worker.ts), and the Trade Finder shows the ideas it last found again
 * while it holds (src/components/trades/finderMemory.ts; review of Phase 4: every return from the Analyzer searched
 * again): the trade engine is deterministic, so the same league data, inputs, team and settings give the same numbers
 * until something it reads by the clock changes.
 *
 * That is: no NFL kickoff (ModelInputs.nfl.kickoffs) between the two moments (a game kicks off at its time: kickoff ≤
 * now means started, as the engine reads it; an unreadable time never starts), since a game that kicks off no longer
 * counts (§6 step 7); and ⚠️ ours, on top of M12: the trade deadline's two readings (acceptance.ts urgencyTerm and
 * tradeDeadlinePassed) are the same at both times, since crossing either changes the numbers (deadline urgency; "Your
 * league's trade deadline has passed").
 */
import { tradeDeadlinePassed, transactionWeek, urgencyTerm } from "@/engine/acceptance";
import type { ModelInputs } from "@/engine/inputs";
import type { LeagueSnapshot } from "@/engine/model";

/** Whether numbers computed for `builtForMs` still hold at `nowMs` (epoch ms; see the header). */
export function contextStillValid(
  builtForMs: number,
  nowMs: number,
  model: Pick<ModelInputs, "nfl">,
  snapshot: Pick<LeagueSnapshot, "settings" | "currentWeek" | "leagueWeek">,
): boolean {
  if (!Number.isFinite(builtForMs) || !Number.isFinite(nowMs)) return false;
  if (builtForMs === nowMs) return true;
  const lo = Math.min(builtForMs, nowMs);
  const hi = Math.max(builtForMs, nowMs);
  for (const week of Object.values(model.nfl?.kickoffs ?? {})) {
    for (const iso of Object.values(week ?? {})) {
      const t = Date.parse(iso);
      if (Number.isFinite(t) && t > lo && t <= hi) return false;
    }
  }
  const deadline = snapshot.settings?.tradeDeadline ?? null;
  const week = transactionWeek(snapshot);
  const then = new Date(builtForMs);
  const now = new Date(nowMs);
  return urgencyTerm(deadline, then, week) === urgencyTerm(deadline, now, week) && tradeDeadlinePassed(deadline, then, week) === tradeDeadlinePassed(deadline, now, week);
}
