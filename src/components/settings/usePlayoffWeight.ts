"use client";
/**
 * The automatic playoff-week weight for the Settings page (planner reply to Checkpoint 7a, §6.1: "Settings shows it
 * read-only"): the League model's own (LeagueModel.playoffWeight and playoffWeightAuto, src/engine/league.ts step 5c),
 * built in an engine worker of this page's own (src/lib/engineClient.ts, as the League page builds it) from the league's
 * saved model inputs while they're fresh (the copy the League page reuses: modelStore.ts modelForSnapshot) and the league's
 * settings (the goal the weight weighs my odds by). Nothing is fetched: without fresh saved inputs the weight isn't known
 * here, and the page says it's set automatically when the League page loads. It's worked out again when what the League
 * model reads changes (the settings in LEAGUE_MODEL_SETTINGS, the goal among them; my team; the inputs), and the worker
 * goes with the page. A failed build leaves it unknown (the same words). React state is set only in async callbacks.
 */
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { ModelInputs } from "@/engine/inputs";
import type { LeagueSnapshot } from "@/engine/model";
import type { TradeSettings } from "@/engine/settings";
import { createEngineClient, type EngineClient } from "@/lib/engineClient";
import { LEAGUE_MODEL_SETTINGS, settingsFingerprint } from "@/lib/settingsStore";
import { leagueTag } from "../league/useLeagueInputs";
import type { PlayoffWeightRead } from "./settingsView";

/** What a weight is worked out for: the league data, the inputs' build, my team and the settings the League model reads; null when it can't be. */
export function playoffWeightTag(args: { snapshot: LeagueSnapshot; inputs: ModelInputs | null | undefined; myTeamId: string | null; settings: TradeSettings | undefined }): string | null {
  if (!args.inputs || !args.settings) return null;
  return `${leagueTag(args.snapshot)}|${args.inputs.builtAt}|${args.myTeamId ?? "-"}|${settingsFingerprint(args.settings, LEAGUE_MODEL_SETTINGS)}`;
}

/** The two reads without a weight, kept the same objects from render to render (the page memoizes its view on them). */
const UNKNOWN: PlayoffWeightRead = { kind: "unknown" };
const WORKING: PlayoffWeightRead = { kind: "working" };

/** The weight as the page knows it (the file header): unknown without fresh inputs, "working" while the worker builds, else known. */
export function usePlayoffWeight(args: { snapshot: LeagueSnapshot; inputs: ModelInputs | null | undefined; myTeamId: string | null; settings: TradeSettings | undefined }): PlayoffWeightRead {
  const tag = playoffWeightTag(args);
  const [done, setDone] = useState<{ tag: string; read: PlayoffWeightRead } | null>(null);
  const engineRef = useRef<EngineClient | null>(null);

  useEffect(
    () => () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    },
    [],
  );

  const start = useEffectEvent((forTag: string) => {
    const { snapshot, inputs, myTeamId, settings } = args;
    if (!inputs || !settings) return undefined;
    let live = true;
    // A tick later, so React StrictMode's first run (development) is cancelled before it starts.
    const timer = setTimeout(() => {
      const engine = engineRef.current ?? createEngineClient();
      engineRef.current = engine;
      engine.buildLeague({ snapshot, model: inputs, myTeamId, nowIso: new Date().toISOString(), settings }).then(
        (model) => {
          if (live) setDone({ tag: forTag, read: { kind: "known", omega: model.playoffWeight, auto: model.playoffWeightAuto ?? null } });
        },
        () => {
          if (live) setDone({ tag: forTag, read: UNKNOWN });
        },
      );
    }, 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  });
  useEffect(() => {
    if (!tag) return;
    return start(tag);
  }, [tag]);

  if (!tag) return UNKNOWN;
  return done && done.tag === tag ? done.read : WORKING;
}
