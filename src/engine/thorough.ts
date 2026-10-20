/**
 * The "Thorough search" (Checkpoint 7h; planner reply to Checkpoint 7g, section 3: "For people willing to wait for the most
 * complete search … screens every 1- and 2-player trade with every partner, across whole rosters; adds trades with 3 players
 * on a side, from bigger pools …; sends more trades to the full simulation … before it starts, show roughly how long it will
 * take"): what its switch changes in a search's settings, and roughly how long it takes. The search itself is search.ts's
 * (TradeSearchOptions.mode "thorough": the file header, "Whole rosters"). Client-safe (config only), so the Trade Finder reads
 * the same rules as the engine.
 */
import { config } from "./config";
import type { TradeSettings } from "./settings";

/**
 * A search's settings with the Thorough search on: up to config.search.thorough.maxPerSide players a side (3), ⚠️ whatever the
 * max-per-side setting says (ours: the planner's definition holds trades with 3 players a side; the setting's own max when
 * it's higher). The same object when nothing changes. The engine applies it (search.ts tradeSearch), and so does the page for
 * what it sends and keeps (the worker's "How to offer it" works a card out with the search's settings).
 */
export function thoroughSettings(settings: TradeSettings): TradeSettings {
  const max = Math.max(settings.maxPerSide, Math.floor(config.search.thorough.maxPerSide));
  return max === settings.maxPerSide ? settings : { ...settings, maxPerSide: max };
}

/**
 * Roughly how long a Thorough search takes, in seconds (the Trade Finder says "about N seconds" before it starts;
 * config.search.thorough.estimate): the normal search's time on this device (`normalMs`, its TradeSearchResult.timings.total
 * for the same partner filter) times the work ratio when known, else a default rate for each of the `partners` searched;
 * rounded up to config's step, at least one step.
 */
export function thoroughSeconds(normalMs: number | null | undefined, partners: number): number {
  const e = config.search.thorough.estimate;
  const step = Math.max(1, e.roundTo);
  const raw = typeof normalMs === "number" && Number.isFinite(normalMs) && normalMs > 0 ? (normalMs * e.workRatio) / 1000 : Math.max(1, partners) * e.secondsPerPartner;
  return Math.max(step, Math.ceil(raw / step) * step);
}
