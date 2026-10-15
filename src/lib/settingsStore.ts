/**
 * The user's trade settings, per league, in this browser (CLAUDE.md §12 "User settings", §14 item 6
 * "Settings"; Phase 4 lead decision L12). One localStorage entry, SETTINGS_STORAGE_KEY, holds
 * { [leagueKey]: TradeSettings } for every league whose settings the user changed. Settings outlast the tab
 * (before Phase 4c the import and the League page's model inputs didn't: they lived in sessionStorage, this tab
 * only): they're preferences, and the same league imported tomorrow keeps them. They hold no credentials and no
 * names: positions, numbers, on/off flags and canonical player ids.
 *
 * leagueKey(league) = "<platform>:<8 hex digits>": a short hash (FNV-1a with MurmurHash3's finalizer,
 * src/engine/rng.ts) of the platform and the league id, so the raw league id never sits in storage that
 * outlasts the tab (feedbackStore.ts files feedback under the same key). It is not anonymous: an ESPN league
 * id is a small number, and hashing every possible id finds it in seconds. So nothing that leaves the
 * browser carries it: the feedback export numbers leagues instead (feedbackStore.ts feedbackExport), and
 * Phase 7's server-side feedback store must drop it too.
 * There is no season in the key, so an ESPN league renewed for next season keeps its settings (Sleeper
 * gives a renewed league a new id).
 *
 * Reading never throws and never trusts the stored value: a value that isn't ours (bad JSON, another
 * shape) counts as no settings, an entry under anything but a league key is ignored, and every league's
 * entry goes through normalizeTradeSettings (src/engine/settings.ts), so one saved by an older version
 * gets today's defaults for whatever it lacks or holds out of range. Writing reports failure in plain
 * English (storage blocked, or full) instead of throwing. "Reset to defaults" removes the league's entry,
 * so later changes to the defaults reach it. Pure functions over an injected storage, like importStore.ts;
 * the pages' hooks are in src/components/settings.
 *
 * Phase 4c (planner reply to Checkpoint 4b, change 11): settings move to the league store's IndexedDB
 * (src/lib/leagueStore.ts), one row per league under the same leagueKey (so a renewed ESPN league still keeps
 * them), normalized the same way. Its migration copies every league's entry from SETTINGS_STORAGE_KEY once per
 * browser, leagues without a saved import included (they attach when that league is imported), and removing a
 * league deletes its old entry too. The pages no longer read or write localStorage: ⚠️ loadLeagueSettings,
 * saveLeagueSettings and resetLeagueSettings (the pre-4c writers and their reader) are kept with their tests, unused
 * since 4c.
 */
import type { LeagueSnapshot } from "@/engine/model";
import { fmix32, hash32 } from "@/engine/rng";
import { defaultTradeSettings, normalizeTradeSettings, type TradeSettings } from "@/engine/settings";
import type { SaveResult, StorageLike } from "./importStore";

export const SETTINGS_STORAGE_KEY = "offersheet:settings:v1";

/** What a failed write says (the Settings page shows it; nothing was saved). */
export const SETTINGS_SAVE_FAILED =
  "Your browser wouldn't let Offer Sheet save your settings (its storage is full or blocked for this site), so this change wasn't kept. Allow site data for Offer Sheet and try again.";

type LeagueRef = Pick<LeagueSnapshot, "platform" | "leagueId">;

/** A league's key in this browser's stored settings and feedback: "espn:1a2b3c4d" (see the header). */
export function leagueKey(league: LeagueRef): string {
  const h = fmix32(hash32(`${league.platform}:${league.leagueId}`));
  return `${league.platform}:${h.toString(16).padStart(8, "0")}`;
}

/** The keys leagueKey makes (anything else under SETTINGS_STORAGE_KEY is ignored; "__proto__" never matches). */
const LEAGUE_KEY = /^[a-z]+:[0-9a-f]{8}$/;

/** Whether a key is one leagueKey makes ("espn:1a2b3c4d"). */
export function isLeagueKey(key: unknown): key is string {
  return typeof key === "string" && LEAGUE_KEY.test(key);
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

/** Every league's stored settings, normalized; {} when nothing is stored or the value isn't ours. Never throws. */
export function parseStoredSettings(raw: string | null | undefined): Record<string, TradeSettings> {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isRecord(data)) return {};
  const out: Record<string, TradeSettings> = {};
  for (const [key, value] of Object.entries(data)) if (isLeagueKey(key) && isRecord(value)) out[key] = normalizeTradeSettings(value);
  return out;
}

/** One league's settings as the pages use them: its stored entry (normalized), else the defaults; `stored` says which. */
export interface LeagueSettingsRead {
  settings: TradeSettings;
  stored: boolean;
}

/** This league's settings from the stored value (the localStorage text, or null when nothing is stored). */
export function readLeagueSettings(raw: string | null | undefined, key: string): LeagueSettingsRead {
  const own = parseStoredSettings(raw)[key];
  return own ? { settings: own, stored: true } : { settings: defaultTradeSettings(), stored: false };
}

/** This league's settings straight from a storage (the defaults when it's blocked or holds nothing). Never throws. */
export function loadLeagueSettings(storage: StorageLike | undefined, key: string): LeagueSettingsRead {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(SETTINGS_STORAGE_KEY) ?? null;
  } catch {
    // storage blocked: the defaults
  }
  return readLeagueSettings(raw, key);
}

/**
 * Saves one league's settings (normalized), keeping every other league's. A stored value that isn't ours
 * is replaced rather than merged into.
 */
export function saveLeagueSettings(storage: StorageLike, key: string, settings: TradeSettings): SaveResult {
  try {
    const all = parseStoredSettings(storage.getItem(SETTINGS_STORAGE_KEY));
    all[key] = normalizeTradeSettings(settings);
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(all));
    return { ok: true };
  } catch {
    return { ok: false, message: SETTINGS_SAVE_FAILED };
  }
}

/** "Reset to defaults": removes the league's entry (and the whole stored value when it was the last one). */
export function resetLeagueSettings(storage: StorageLike, key: string): SaveResult {
  try {
    const all = parseStoredSettings(storage.getItem(SETTINGS_STORAGE_KEY));
    delete all[key];
    if (Object.keys(all).length) storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(all));
    else storage.removeItem(SETTINGS_STORAGE_KEY);
    return { ok: true };
  } catch {
    return { ok: false, message: SETTINGS_SAVE_FAILED };
  }
}

/**
 * The settings the League model reads (src/engine/league.ts buildLeagueModel, through modelSettings): the
 * positions my team streams and, since the planner's reply to Checkpoint 7a (§6.1), the goal ("What does your league
 * reward?") and since Checkpoint 7c its prizes (planner reply to Checkpoint 7b, §6: the reward, src/engine/reward.ts, which
 * the automatic playoff-week weight weighs my odds by, league.ts step 5c, and whose weekly prize decides whether the weekly
 * high scores are simulated; a split with nothing entered or a goal that ignores the prizes builds the same model, which
 * only costs a rebuild). Since Checkpoint 7e (planner reply to Checkpoint 7d, items 3.2, 3.3 and 3.5) also the untouchables
 * (never dropped: my pickups, IR returns, Waiver upgrades), "Drop from the same position" (Waiver upgrades) and the return
 * weeks the user sets (his injured players' availability), with the season they were set for (they count in that season
 * only: review of wave C, UI-C-3). The manual playoff weight left the list
 * then, and the settings with it (src/engine/settings.ts: a copy stored before still loads, without it). The others (Win
 * now ↔ Future, players per side, must-include
 * players, positions to target or avoid, what else trade ideas include) are the trade search's alone, so changing one of
 * them doesn't compute the League page's model again (it would come out the same, after a dimmed "Updating the
 * numbers…"); the engine worker keys its cached trade context by these too (engine.worker.ts contextKey), so a new goal or
 * a new split builds a new one. Keep it in step with league.ts: settingsStore.test.ts builds a League model with every other setting
 * changed and checks that nothing in it moves.
 */
export const LEAGUE_MODEL_SETTINGS = ["streamPositions", "goal", "prizes", "untouchables", "waiverSamePosition", "returnWeeks", "returnWeeksSeason"] as const satisfies readonly (keyof TradeSettings)[];

/**
 * The settings Waiver upgrades' "Rest of season" rating reads besides those (Checkpoint 7e, item 3.4; league.ts
 * rateWaiverUpgrades, which the League page's engine worker runs on its own request), as a trade's Helps you does: in a
 * redraft league "Protect my trade value" (the market term), in a dynasty or keeper league Win now ↔ Future (the mix and its
 * scale). Nothing else of the League model reads them, so the trade context isn't keyed by them; the League page's compute
 * tag is, by its league's type (LeaguePage.tsx computeTagFor: review of wave C, RC-ENG-4: a change saved in another tab left
 * its Helps you as it was; a redraft league's page still ignores the Win now ↔ Future slider, which it doesn't read).
 */
export function waiverRatingSettings(leagueType: LeagueSnapshot["settings"]["leagueType"]): readonly (keyof TradeSettings)[] {
  return leagueType === "redraft" ? ["protectValue"] : ["lambda"];
}

/**
 * The settings as one stable string: equal settings give equal text whatever the order of their lists
 * (positions and player ids are sets to the engine). With `fields`, only those settings count (the League
 * page's compute tag passes LEAGUE_MODEL_SETTINGS, so a changed setting the model reads computes it again and
 * any other change doesn't); without, every setting does.
 */
export function settingsFingerprint(settings: TradeSettings, fields?: readonly (keyof TradeSettings)[]): string {
  const s = normalizeTradeSettings(settings);
  const sorted = <T extends string>(xs: readonly T[]): T[] => [...xs].sort();
  const all: TradeSettings = {
    ...s,
    streamPositions: sorted(s.streamPositions),
    untouchables: sorted(s.untouchables),
    mustInclude: sorted(s.mustInclude),
    targetPositions: sorted(s.targetPositions),
    avoidPositions: sorted(s.avoidPositions),
  };
  if (!fields) return JSON.stringify(all);
  const picked: Partial<Record<keyof TradeSettings, unknown>> = {};
  for (const field of [...new Set(fields)].sort()) picked[field] = all[field];
  return JSON.stringify(picked);
}
