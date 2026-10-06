/**
 * The league store's hooks (planner reply to Checkpoint 4b, change 11; useLeagueInputs.ts, useLeagueSettings.ts,
 * useFeedback.ts), rendered statically: on the server and while the page hydrates they say "loading" (undefined), never
 * "no league imported", since the store hasn't been read; on a ready state they read the league this tab shows, the
 * switcher's list, the storage status, the league's settings and feedback, and its stored model inputs (a fresh copy
 * gives the page its league data and "my team" without a request). Pages' tests mock useLeagueStoreState the same way,
 * with leagueStoreStateOf. A made-up league.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { defaultTradeSettings } from "@/engine/settings";
import type { ImportResponse } from "@/lib/api";
import { applyFeedback, type FeedbackRecord } from "@/lib/feedbackStore";
import { IMPORT_FORMAT_VERSION, type StoredImport } from "@/lib/importStore";
import { leagueStoreStateOf, savedLeagueId, type LeagueStoreState } from "@/lib/leagueStore";
import { modelKey } from "@/lib/modelStore";
import { leagueKey } from "@/lib/settingsStore";
import { useSavedFeedback } from "../settings/useFeedback";
import { useSavedLeagueSettings } from "../settings/useLeagueSettings";
import { leagueFixture } from "./testFixtures";
import { INPUTS_UNREACHABLE, inputsFailure, leagueTag, settledInputs, useCurrentLeague, useLeagueStorage, useSavedLeagueInputs, useSavedLeagues, useSavedModel, type InputsOutcome } from "./useLeagueInputs";

/** The store's state the hooks see: null = the real hook (the server's: loading). */
const env = vi.hoisted(() => ({ state: null as LeagueStoreState | null }));
vi.mock("@/lib/leagueStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/leagueStore")>();
  return { ...actual, useLeagueStoreState: () => env.state ?? actual.useLeagueStoreState() };
});

const f = leagueFixture({ myTeamId: null });
const stored: StoredImport = { version: IMPORT_FORMAT_VERSION, savedAt: "2026-11-26T20:00:00.000Z", request: { platform: "espn", season: f.snapshot.season, leagueId: f.snapshot.leagueId }, response: { snapshot: f.snapshot, notes: [] } };
const id = savedLeagueId(f.snapshot);
const key = leagueKey(f.snapshot);

function Probe() {
  const current = useCurrentLeague();
  const leagues = useSavedLeagues();
  const storage = useLeagueStorage();
  const settings = useSavedLeagueSettings(key);
  const feedback = useSavedFeedback();
  const model = useSavedModel(id);
  const parts = [
    `current=${current?.kind ?? "loading"}`,
    `leagues=${leagues ? leagues.leagues.length : "loading"}`,
    `storage=${storage?.kind ?? "loading"}`,
    `settings=${settings.settings ? (settings.stored ? "saved" : "defaults") : "loading"}`,
    `feedback=${feedback ? feedback.length : "loading"}`,
    `model=${model === undefined ? "loading" : model ? "stored" : "none"}`,
  ];
  return createElement("p", null, parts.join(" "));
}

function Inputs() {
  const current = useCurrentLeague();
  return current?.kind === "ok" ? createElement(LoadedInputs, { current }) : createElement("p", null, "waiting");
}

function LoadedInputs({ current }: { current: Extract<ReturnType<typeof useCurrentLeague>, { kind: "ok" }> }) {
  const { pair, myTeam, error } = useSavedLeagueInputs(current);
  return createElement("p", null, `pair=${pair ? pair.snapshot.leagueId === f.snapshot.leagueId : "none"} myTeam=${myTeam ? `${myTeam.myTeamId}/${myTeam.source}` : "none"} error=${error ?? "none"}`);
}

const render = (state: LeagueStoreState | null, component: () => ReturnType<typeof createElement> = Probe) => {
  env.state = state;
  try {
    return renderToStaticMarkup(createElement(component));
  } finally {
    env.state = null;
  }
};

describe("the league store's hooks", () => {
  it("say 'loading' on the server and while the page hydrates (never 'no league')", () => {
    expect(render(null)).toBe("<p>current=loading leagues=loading storage=loading settings=loading feedback=loading model=loading</p>");
    expect(render(null, Inputs)).toBe("<p>waiting</p>");
  });

  it("read the league, the list, the storage, its settings, feedback and model inputs from a ready state", () => {
    const record = applyFeedback([], {
      leagueKey: key,
      evaluation: { key: "t1", proposal: { partnerId: "2", give: [], get: [] }, features: { g: 0, n: 0, h: 0, c: 0, a: 0, hist: null, ctx: 0, hot: 0, urg: 0, z: 0 }, b: 1, tradeScore: 15, pAccept: 0.3, pComplete: 0.3, overall: 5, dPO: 0, dCH: 0, dPPW: 0, gMine: 0, gPartner: 0 },
      change: { outcome: "sent" },
      at: "2026-11-26T21:00:00.000Z",
    })[0] as FeedbackRecord;
    const state = leagueStoreStateOf({ imports: [stored], settings: { [key]: { ...defaultTradeSettings(), maxPerSide: 3 } }, feedback: [record] });
    expect(render(state)).toBe("<p>current=ok leagues=1 storage=indexeddb settings=saved feedback=1 model=none</p>");
    expect(render(leagueStoreStateOf({}))).toBe("<p>current=none leagues=0 storage=indexeddb settings=defaults feedback=0 model=loading</p>");
    expect(render(leagueStoreStateOf({ outdatedTabImport: { request: null }, storage: { kind: "memory", message: "…" } }))).toContain("current=outdated leagues=0 storage=memory");
  });

  it("give the page its league data and 'my team' from fresh stored model inputs, without a request", () => {
    const builtAt = new Date().toISOString();
    const model = { version: 1 as const, savedAt: builtAt, key: modelKey(f.snapshot), snapshotFetchedAt: f.snapshot.fetchedAt, model: { ...f.inputs, builtAt } };
    const state = leagueStoreStateOf({ imports: [stored], models: { [id]: model }, picks: { [id]: { teamId: "2", source: "you" } } });
    expect(render(state, Inputs)).toBe("<p>pair=true myTeam=2/you error=none</p>");
    // No stored inputs (or stale ones): no pair yet (the page fetches them once mounted).
    expect(render(leagueStoreStateOf({ imports: [stored] }), Inputs)).toBe("<p>pair=none myTeam=none error=none</p>");
    const stale = { ...model, model: { ...f.inputs, builtAt: "2026-01-01T00:00:00.000Z" } };
    expect(render(leagueStoreStateOf({ imports: [stored], models: { [id]: stale } }), Inputs)).toBe("<p>pair=none myTeam=none error=none</p>");
  });
});

describe("inputsFailure: a page load's failed model request (review of Phase 7b)", () => {
  const tag = `${leagueTag(f.snapshot)}|0`;
  const message = "Offer Sheet is busy right now. Try again in a minute.";

  it("without an import read again: the error under this fetch's tag, nothing to keep", () => {
    expect(inputsFailure({ tag, attempt: 0, message, imported: undefined, stored })).toEqual({ error: { tags: [tag], message }, kept: null });
  });

  it("with one (the league read again, then BUSY): it's kept, and the error is filed under its tag too, so the page waits for Try again", () => {
    const fresh: ImportResponse = { snapshot: { ...f.snapshot, fetchedAt: "2026-11-26T20:30:00.000Z" }, notes: [], signed: { issuedAt: 1, token: "made-up" } };
    const out = inputsFailure({ tag, attempt: 2, message, imported: fresh, stored });
    expect(out.kept).toEqual(fresh);
    // Once the store shows the kept import, the page asks under its tag with the same attempt: the error answers it.
    expect(out.error).toEqual({ tags: [tag, `${leagueTag(fresh.snapshot)}|2`], message });
    // The stored import's team carries over to a read that didn't find it (and the signature, which covered the snapshot
    // as it was, goes), as an answer's does (modelStore.ts withImportedTeam).
    const withTeam: StoredImport = { ...stored, response: { ...stored.response, snapshot: { ...f.snapshot, myTeamId: "1" } } };
    const kept = inputsFailure({ tag, attempt: 0, message, imported: fresh, stored: withTeam }).kept;
    expect(kept?.snapshot.myTeamId).toBe("1");
    expect(kept).not.toHaveProperty("signed");
  });
});

describe("settledInputs: a model request never rejects to the page (review E2E-1)", () => {
  it("passes an outcome through, and reads a request that threw as 'couldn't reach Offer Sheet', so Refresh always ends", async () => {
    const answered: InputsOutcome = { ok: false, message: "ESPN isn't answering right now. Try again in a few minutes." };
    expect(await settledInputs(Promise.resolve(answered))).toBe(answered);
    // A browser without CompressionStream threw here before (src/lib/leagueFetch.ts), and the League page's Refresh stayed
    // "Refreshing…" for good.
    expect(await settledInputs(Promise.reject(new ReferenceError("CompressionStream is not defined")))).toEqual({ ok: false, message: INPUTS_UNREACHABLE });
    expect(INPUTS_UNREACHABLE).toBe("We couldn't reach Offer Sheet. Check your connection and try again.");
  });
});
