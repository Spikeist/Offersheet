/**
 * The FantasyCalc formats in use, for the daily snapshot cron (planner reply to Checkpoint 7a, §6.3: "the day's FantasyCalc
 * lists for the formats in use"; src/server/snapshots.ts): every League page build records the formats of the lists it
 * read, one line in each model handler (src/app/api/model/espn/handler.ts and sleeper/handler.ts: recordFormatsInUse).
 *
 * - What: format keys only (src/server/fantasyCalcArchive.ts fantasyCalcFormatKey: "redraft-1qb-10team-ppr0.5" …, the
 *   request's parameters): the league's own list and a keeper league's redraft list (src/server/modelInputs.ts
 *   marketFormats), and a dynasty league's redraft list in its format when the build read one (the market blend's, while
 *   weeks are left to project). Nothing about the league, the person or the request: each key names one of the 144
 *   formats, shared by every league of that format. ⚠️ A rare format can still point to one league, so the privacy page
 *   says the archive shows which formats were in use each day, kept up to 2 seasons (src/server/snapshots.ts dayRetainMs;
 *   review of Phase 7b).
 * - Where: on Vercel with the shared store only (src/server/snapshots.ts formatsInUseStore), into that UTC day's set
 *   (noteFormatsInUse: one SADD and PEXPIRE transaction, and only for keys this instance hasn't recorded that day, so most
 *   builds cost no Upstash command at all), after the answer (next/server's after(): never a delay to the League page).
 *   Locally nothing is written: the local FantasyCalc archive is the record there (every local build files the lists it read).
 * Never throws: a League page build is never refused or slowed by this.
 */
import { after } from "next/server";
import type { FantasyCalcFormat, ModelInputs } from "@/engine/inputs";
import type { LeagueSettings } from "@/engine/model";
import { fantasyCalcFormatKey } from "@/server/fantasyCalcArchive";
import { marketFormats } from "@/server/modelInputs";
import { formatsInUseStore, noteFormatsInUse, unnotedFormats, utcDay } from "@/server/snapshots";

type Env = Readonly<Record<string, string | undefined>>;

/** The format keys of the lists a build read (see the header), sorted. */
export function formatKeysInUse(settings: LeagueSettings, model: Pick<ModelInputs, "market">): string[] {
  const asked = marketFormats(settings);
  const formats: FantasyCalcFormat[] = [asked.values, ...(asked.redraft ? [asked.redraft] : [])];
  if (asked.season && model.market?.seasonValues) formats.push(asked.season);
  const keys = formats.map((f) => fantasyCalcFormatKey(f)).filter((k): k is string => k !== null);
  return [...new Set(keys)].sort();
}

export interface RecordOptions {
  /** Test hooks: the environment, the store (default formatsInUseStore), the clock and next/server's after(). */
  env?: Env;
  store?: Parameters<typeof noteFormatsInUse>[0] | null;
  now?: number;
  schedule?: (task: () => Promise<void>) => void;
}

/**
 * Records the formats a League page build read (see the header) and hands back its model untouched, so each handler's build
 * stays one line: `return recordFormatsInUse(snapshot.settings, await d.buildInputs(…))`.
 */
export function recordFormatsInUse<T extends Pick<ModelInputs, "market">>(settings: LeagueSettings, model: T, opts: RecordOptions = {}): T {
  try {
    const env = opts.env ?? process.env;
    const store = opts.store === undefined ? formatsInUseStore(env) : opts.store;
    if (!store) return model;
    const day = utcDay(opts.now ?? Date.now());
    const keys = unnotedFormats(formatKeysInUse(settings, model), day);
    if (!keys.length) return model;
    const task = () => noteFormatsInUse(store, keys, day, { env });
    try {
      (opts.schedule ?? after)(task);
    } catch {
      // Outside a Next request (a test calling the handler directly): written now, without holding the answer.
      void task();
    }
  } catch {
    // Never a reason to fail a build.
  }
  return model;
}
