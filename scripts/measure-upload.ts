/**
 * Browser fetching's numbers, offline (planner reply to Checkpoint 4c, Part B, B1: browser fetching; track BF; the
 * Checkpoint 7a report):
 *
 *   npm run measure:upload
 *
 * For each league it can read here, the browser path is run end to end on full-size bodies, as the app runs it:
 * the browser's read (src/lib/leagueRead.ts readInBrowser: the adapter's league-data half through a recording client,
 * each body in its schema-kept form, ESPN's SWIDs pseudonymized), the gzip upload (CompressionStream, as the browser
 * makes it), the import route's reader (src/app/api/_lib/upload.ts: unpack within the caps, pseudonymize again, parse,
 * check) and the replay with the server's own public data (importEspnUpload, importSleeperUpload), against the server's
 * own read of the same bodies (importEspnLeagueForModel, importSleeperLeague). It prints:
 * - sizes: the platform's bodies as decoded and gzipped (what a browser downloads, about), the upload's JSON and its gzip
 *   (what it sends; Vercel takes at most 4.5 MB, uploadLimits.compressedBytes 2 MB since the final review's SEC-1), and the
 *   signed import the League page sends back (the snapshot and its model part, gzipped; signedUploadLimits 1 MB);
 * - the server's CPU for an upload (the reader, then the replay and normalizing) against its own read of the raw bodies,
 *   and the browser's CPU for reading and trimming (Node standing in for a phone), medians of a few runs after a warm-up;
 * - whether the two imports are identical (they must be: src/adapters/upload.test.ts proves it on the committed
 *   fixtures, this on whatever full-size bodies are here).
 *
 * Leagues: Parker's ESPN league from the committed sanitized fixtures (fixtures/sanitized/espn: names replaced, the
 * free-agent lists cut to a sample) and from Phase 0's raw captures (git-ignored fixtures/raw/espn: full-size bodies);
 * ESPN leagues whose bodies .cache/app still holds (Parker's, by the newest dump's league id, and the public
 * test league 899513; league data is kept 10 minutes, so right after an import), read straight from its files, never
 * through FileCache (which deletes what has expired); the Sleeper public test league from data-local/fixtures-sanitized
 * (git-ignored), else the committed minimized one. The resolvers are the tests' (the crosswalk's lookups cost the same).
 *
 * Offline by construction: every client is a fake answering from those files, nothing contacts a platform, Upstash or
 * anything else (no --live), and it writes nothing. It prints sizes, counts and timings only: never an id, a name, a URL
 * or a body.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
import { gzipSync } from "node:zlib";
import { importEspnLeagueForModel, importEspnUpload } from "@/adapters/espn";
import { LABELS, PARKER, fakeResolver as espnResolver, parkerCards, readEspn } from "@/adapters/espn/test-helpers";
import { responseOf } from "@/adapters/httpShared";
import { importSleeperLeague, importSleeperUpload } from "@/adapters/sleeper";
import { sleeperUrls } from "@/adapters/sleeper/leagueData";
import { fakeResolver as sleeperResolver, loadTestLeague } from "@/adapters/sleeper/test-helpers";
import type { HttpClient, HttpResponse, ImportDeps } from "@/adapters/types";
import type { LeagueUpload } from "@/adapters/upload";
import { readLeagueUpload } from "@/app/api/_lib/upload";
import { gzipText } from "@/lib/leagueFetch";
import { readInBrowser } from "@/lib/leagueRead";
import { importSignatureProblem, signImport } from "@/server/importToken";
import { uploadLimits } from "@/server/limits";
import { ROOT } from "./lib/env";
import { isMainModule } from "./lib/runMode";

const KB = 1024;
const RUNS = 5;

/** A platform answering from bodies by address (and ESPN's filter), timed like the fixtures' "now". */
function bodiesPlatform(answer: (url: string, headers: Record<string, string>) => string | undefined, at: number): HttpClient {
  return {
    async get(url, opts = {}): Promise<HttpResponse> {
      const raw = answer(url, opts.headers ?? {});
      if (raw === undefined) return { status: 404, ok: false, isHtml: false, json: { details: [{ type: "GENERAL_NOT_FOUND" }] }, text: "", fromCache: false };
      const text = opts.transformText ? opts.transformText(raw) : raw;
      return responseOf({ status: 200, contentType: "application/json", text }, { fromCache: false, bigInts: opts.bigIntsAsStrings ?? false, fetchedAt: at });
    },
  };
}

interface League {
  label: string;
  platform: "espn" | "sleeper";
  body: Record<string, unknown>;
  /** The platform's answer for a league-data request, as text. */
  league: (url: string, headers: Record<string, string>) => string | undefined;
  /** The server's public data (ESPN's NFL schedule; Sleeper's state and projections). */
  publicData: (url: string) => string | undefined;
  resolver: () => ImportDeps["resolver"];
  now: Date;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = performance.now();
  const value = await fn();
  return { value, ms: performance.now() - t0 };
}

async function measure(l: League): Promise<string[]> {
  const at = l.now.getTime();
  const seen = new Map<string, number>();
  const leagueAnswer = (url: string, headers: Record<string, string>) => {
    const text = l.league(url, headers);
    if (text !== undefined) seen.set(`${url} ${headers["x-fantasy-filter"] ?? ""}`, text.length);
    return text;
  };
  const browserClient = bodiesPlatform(leagueAnswer, at);
  const serverClient = bodiesPlatform((url, headers) => l.publicData(url) ?? l.league(url, headers), at);
  const publicOnly = bodiesPlatform((url) => l.publicData(url), at);
  const deps = (http: HttpClient): ImportDeps => ({ http, resolver: l.resolver(), now: l.now });
  const serverRead = (): Promise<unknown> => (l.platform === "espn" ? importEspnLeagueForModel(l.body as never, deps(serverClient)) : importSleeperLeague(l.body as never, deps(serverClient)));

  const read = await readInBrowser({ platform: l.platform, body: l.body as never, http: browserClient, clock: () => at, espnCookies: "none" });
  if (read.kind !== "upload") return [`${l.label}: the browser path didn't make an upload (${read.kind})`];
  const upload = read.upload;
  const uploadText = JSON.stringify(upload);
  const packed = await gzipText(uploadText);
  const rawBytes = [...seen.values()].reduce((a, b) => a + b, 0);
  const rawGzip = [...seen.keys()].reduce((n, k) => {
    const [url, filter] = [k.slice(0, k.lastIndexOf(" ")), k.slice(k.lastIndexOf(" ") + 1)];
    const text = l.league(url, filter ? { "x-fantasy-filter": filter } : {}) ?? "";
    return n + gzipSync(text, { level: 6 }).length;
  }, 0);
  const request = () => new Request(`http://localhost:3000/api/import/${l.platform}`, { method: "POST", headers: { "content-type": "application/gzip" }, body: packed });
  const replay = async (): Promise<unknown> => {
    const r = await readLeagueUpload(request(), l.platform);
    if (!r.ok) throw new Error(`the route refused the upload (${r.why})`);
    return l.platform === "espn" ? importEspnUpload(r.value, deps(publicOnly)) : importSleeperUpload(r.value as LeagueUpload, deps(publicOnly));
  };

  // A warm-up of each path, then the medians.
  await serverRead();
  await replay();
  const reader: number[] = [];
  const replayMs: number[] = [];
  const serverMs: number[] = [];
  const browserMs: number[] = [];
  let lastReplay: unknown;
  let lastServer: unknown;
  for (let i = 0; i < RUNS; i++) {
    const r1 = await timed(() => readLeagueUpload(request(), l.platform));
    reader.push(r1.ms);
    const r2 = await timed(replay);
    replayMs.push(r2.ms);
    lastReplay = r2.value;
    const r3 = await timed(serverRead);
    serverMs.push(r3.ms);
    lastServer = r3.value;
    const r4 = await timed(() => readInBrowser({ platform: l.platform, body: l.body as never, http: bodiesPlatform(l.league, at), clock: () => at, espnCookies: "none" }));
    browserMs.push(r4.ms);
  }
  const identical = isDeepStrictEqual(lastReplay, lastServer);
  const result = lastReplay as { snapshot?: unknown; result?: { snapshot: unknown }; espn?: unknown };
  const snapshot = result.result?.snapshot ?? result.snapshot;
  const modelPart = l.platform === "espn" ? { espn: result.espn } : {};
  // Signing an import (the import route) and checking it (the model route), on a made-up secret.
  const env = { SESSION_SECRET: "measure-upload: a made-up secret, never a real one" };
  const signature = signImport(l.platform, { snapshot, modelPart }, at, env);
  const signMs: number[] = [];
  const verifyMs: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    signImport(l.platform, { snapshot, modelPart }, at, env);
    signMs.push(performance.now() - t0);
    const back = JSON.parse(JSON.stringify({ snapshot, modelPart })) as { snapshot: unknown; modelPart: unknown };
    const t1 = performance.now();
    if (signature && importSignatureProblem(l.platform, back, signature, at, env) !== null) throw new Error("a signature didn't check out");
    verifyMs.push(performance.now() - t1);
  }
  const signedBody = JSON.stringify({ v: 1, import: { snapshot, modelPart }, signed: signature });
  const kb = (n: number) => `${(n / KB).toFixed(1)} KiB`;
  return [
    `${l.label}:`,
    `  requests read by the browser: ${upload.parts.length} (the platform's bodies ${kb(rawBytes)} decoded, ${kb(rawGzip)} gzipped)`,
    `  upload: ${kb(uploadText.length)} schema-kept JSON (${((uploadText.length / Math.max(1, rawBytes)) * 100).toFixed(0)}% of the bodies), ${kb(packed.byteLength)} gzipped (cap ${kb(uploadLimits.compressedBytes)}; Vercel's 4.5 MB)`,
    `  signed import the League page sends back: ${kb(signedBody.length)} JSON, ${kb(gzipSync(signedBody, { level: 6 }).length)} gzipped; signing it ${median(signMs).toFixed(1)} ms, checking it ${median(verifyMs).toFixed(1)} ms`,
    `  server CPU per upload: reader ${median(reader).toFixed(0)} ms + replay and normalize ${median(replayMs).toFixed(0)} ms (the reader runs again inside), against its own read of the raw bodies ${median(serverMs).toFixed(0)} ms`,
    `  browser CPU (Node standing in): read, trim and pseudonymize ${median(browserMs).toFixed(0)} ms`,
    `  the two imports identical: ${identical ? "yes" : "NO"}`,
  ];
}

// ---------------------------------------------------------------------------------------------
// The leagues

const FA_FILE: Record<number, string> = { 0: "QB", 2: "RB", 4: "WR", 6: "TE", 17: "K", 16: "D/ST" };
const slotOf = (headers: Record<string, string>) => (JSON.parse(headers["x-fantasy-filter"] ?? "{}") as { players?: { filterSlotIds?: { value: number[] } } }).players?.filterSlotIds?.value[0];
const idsOf = (headers: Record<string, string>) => new Set((JSON.parse(headers["x-fantasy-filter"] ?? "{}") as { players?: { filterIds?: { value: number[] } } }).players?.filterIds?.value ?? []);

/** Parker's ESPN league from the committed sanitized fixtures (week 4 of 2026). */
function parkerFixtures(): League {
  const text = (label: string) => JSON.stringify(readEspn(label));
  return {
    label: "ESPN, Parker's league (committed sanitized fixtures, week 4)",
    platform: "espn",
    body: { leagueId: PARKER.leagueId, season: 2026 },
    league(url, headers) {
      const views = new URL(url).searchParams.getAll("view");
      if (views.includes("mSettings")) return text(LABELS.league);
      if (views.includes("mTransactions2")) return text(LABELS.tx(Number(new URL(url).searchParams.get("scoringPeriodId"))));
      if (views.includes("kona_player_info")) {
        const pos = FA_FILE[slotOf(headers) as number];
        return pos ? text(LABELS.fa(pos)) : undefined;
      }
      if (views.includes("kona_playercard")) {
        const ids = idsOf(headers);
        return JSON.stringify({ players: parkerCards().players.filter((p) => ids.has(p.id)) });
      }
      return undefined;
    },
    publicData: (url) => (url.includes("proTeamSchedules_wl") ? text(LABELS.proSchedule) : undefined),
    resolver: () => espnResolver(),
    now: new Date("2026-09-29T20:00:00.000Z"),
  };
}

/**
 * Parker's ESPN league from Phase 0's raw captures (git-ignored fixtures/raw/espn, Sep 29: full-size bodies, the free-agent
 * lists at 500 a position as the app asks for them), when they're here. Read for their sizes only: the browser path
 * pseudonymizes their SWIDs as it would ESPN's own answers, and nothing of them is printed.
 */
function parkerRawCaptures(): League | undefined {
  const dir = path.join(ROOT, "fixtures", "raw", "espn");
  const index = path.join(dir, "index.json");
  if (!existsSync(index)) return undefined;
  const byLabel = new Map<string, string>();
  for (const [file, meta] of Object.entries(JSON.parse(readFileSync(index, "utf8")) as Record<string, { label?: string }>)) {
    // Parker's league only: its labels carry its id redacted (the captures of other ids are error bodies).
    const prefix = "espn:league:[REDACTED:ESPN_LEAGUE_ID]:2026:";
    if (!(meta.label ?? "").startsWith(prefix)) continue;
    const label = (meta.label ?? "").slice(prefix.length);
    if (/^(main|kona_player_info FA .+ limit 500|mTransactions2 sp\d+ filtered|kona_playercard batch \d+)$/.test(label) && existsSync(path.join(dir, file))) byLabel.set(label, readFileSync(path.join(dir, file), "utf8"));
  }
  if (!byLabel.has("main")) return undefined;
  const cards = [...byLabel].filter(([l]) => l.startsWith("kona_playercard")).flatMap(([, text]) => (JSON.parse(text) as { players?: Array<{ id: number }> }).players ?? []);
  const espnPos: Record<number, string> = { 0: "QB", 2: "RB", 4: "WR", 6: "TE", 17: "K", 16: "D/ST" };
  return {
    label: "ESPN, Parker's league (Phase 0's raw captures, Sep 29: full-size bodies)",
    platform: "espn",
    body: { leagueId: PARKER.leagueId, season: 2026 },
    league(url, headers) {
      const u = new URL(url);
      const views = u.searchParams.getAll("view");
      if (views.includes("mSettings")) return byLabel.get("main");
      if (views.includes("mTransactions2")) return byLabel.get(`mTransactions2 sp${u.searchParams.get("scoringPeriodId")} filtered`);
      if (views.includes("kona_player_info")) return byLabel.get(`kona_player_info FA ${espnPos[slotOf(headers) as number]} limit 500`);
      if (views.includes("kona_playercard")) {
        const ids = idsOf(headers);
        return JSON.stringify({ players: cards.filter((p) => ids.has(p.id)) });
      }
      return undefined;
    },
    publicData: (url) => (url.includes("proTeamSchedules_wl") ? JSON.stringify(readEspn(LABELS.proSchedule)) : undefined),
    resolver: () => espnResolver(),
    now: new Date("2026-09-29T20:00:00.000Z"),
  };
}

const APP_DIR = path.join(ROOT, ".cache", "app");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** A cached response's body by its cache key, read straight from its file (never through FileCache), or undefined. */
function cachedBody(key: string): string | undefined {
  const file = path.join(APP_DIR, `${sha(key)}.json`);
  if (!existsSync(file)) return undefined;
  try {
    const env = JSON.parse(readFileSync(file, "utf8")) as { value?: { text?: unknown; status?: unknown } };
    return env.value && env.value.status === 200 && typeof env.value.text === "string" ? env.value.text : undefined;
  } catch {
    return undefined;
  }
}

/** The league id and season of the newest saved dump of Parker's league (data-local/parker-league-*), never printed. */
function newestDumpLeague(): { leagueId: string; season: number } | undefined {
  const base = path.join(ROOT, "data-local");
  let best: { at: number; leagueId: string; season: number } | undefined;
  for (const name of existsSync(base) ? readdirSync(base) : []) {
    const file = path.join(base, name, "snapshot.json");
    if (!/^parker-league/.test(name) || !existsSync(file)) continue;
    try {
      const at = statSync(file).mtimeMs;
      const s = JSON.parse(readFileSync(file, "utf8")) as { leagueId?: unknown; season?: unknown; platform?: unknown };
      if (s.platform === "espn" && typeof s.leagueId === "string" && typeof s.season === "number" && (!best || at > best.at)) best = { at, leagueId: s.leagueId, season: s.season };
    } catch {
      // a dump that doesn't read is left out
    }
  }
  return best;
}

/** An ESPN league whose public read .cache/app still holds (its league view at least), or undefined. */
function cachedEspn(label: string, leagueId: string, season: number): League | undefined {
  const base = `espn:public:${season}:${leagueId}`;
  if (!cachedBody(`${base}:league`)) return undefined;
  const cardKey = (ids: Set<number>) => `${base}:cards:${sha([...ids].join(",")).slice(0, 16)}`;
  return {
    label,
    platform: "espn",
    body: { leagueId, season },
    league(url, headers) {
      const u = new URL(url);
      const views = u.searchParams.getAll("view");
      if (views.includes("mSettings")) return cachedBody(`${base}:league`);
      if (views.includes("mTransactions2")) return cachedBody(`${base}:tx:${u.searchParams.get("scoringPeriodId")}`);
      if (views.includes("kona_player_info")) return cachedBody(`${base}:fa:${u.searchParams.get("scoringPeriodId")}:${slotOf(headers)}`);
      if (views.includes("kona_playercard")) return cachedBody(cardKey(idsOf(headers)));
      return undefined;
    },
    publicData: (url) => (url.includes("proTeamSchedules_wl") ? cachedBody(`espn:proTeamSchedules:${season}`) : undefined),
    resolver: () => espnResolver(),
    now: new Date(),
  };
}

/** The Sleeper public test league: data-local's full sanitized copy when it's there, else the committed minimized one. */
function sleeperLeague(): League {
  const t = loadTestLeague();
  const id = String(t.league.league_id);
  const local = path.join(ROOT, "data-local", "fixtures-sanitized", "sleeper");
  const byLabel = new Map<string, string>();
  if (existsSync(path.join(local, "index.json"))) {
    for (const [file, meta] of Object.entries(JSON.parse(readFileSync(path.join(local, "index.json"), "utf8")) as Record<string, { label: string }>)) {
      try {
        byLabel.set(meta.label, readFileSync(path.join(local, file), "utf8"));
      } catch {
        // a file that doesn't read is left out
      }
    }
  }
  const full = byLabel.has("public-test-league/league/{leagueId}") && byLabel.has("public-test-league/league/{leagueId}/rosters");
  const fromLocal = (sub: string) => byLabel.get(`public-test-league/league/{leagueId}${sub}`);
  const bodies = new Map<string, string>([
    [sleeperUrls.state(), JSON.stringify(t.state)],
    [sleeperUrls.league(id), full ? (fromLocal("") as string) : JSON.stringify(t.league)],
    [sleeperUrls.users(id), (full && fromLocal("/users")) || JSON.stringify(t.users)],
    [sleeperUrls.rosters(id), (full && fromLocal("/rosters")) || JSON.stringify(t.rosters)],
    [sleeperUrls.tradedPicks(id), (full && fromLocal("/traded_picks")) || JSON.stringify(t.tradedPicks)],
    [sleeperUrls.drafts(id), (full && fromLocal("/drafts")) || JSON.stringify(t.drafts)],
    // Checkpoint 7c: the winners bracket (the 3rd-place game), read in the browser like the rest of the league.
    [sleeperUrls.winnersBracket(id), (full && fromLocal("/winners_bracket")) || JSON.stringify(t.winnersBracket)],
  ]);
  for (let w = 1; w <= 14; w++) bodies.set(sleeperUrls.matchups(id, w), (full && fromLocal(`/matchups/${w}`)) || JSON.stringify(t.matchups[w] ?? []));
  for (let leg = 1; leg <= 4; leg++) bodies.set(sleeperUrls.transactions(id, leg), (full && fromLocal(`/transactions/${leg}`)) || JSON.stringify(t.transactions[leg] ?? []));
  const projections = new Map<string, string>();
  for (const w of [4, 5, 6]) projections.set(sleeperUrls.projections(2026, w, ["QB", "RB", "WR", "TE", "K", "DEF"]), JSON.stringify(t.projections.map((r: Record<string, unknown>) => ({ ...r, week: w }))));
  return {
    label: `Sleeper, the public test league (${full ? "data-local's full sanitized copy" : "the committed minimized copy"}, week 4)`,
    platform: "sleeper",
    body: { season: 2026, leagueId: id },
    // The browser reads Sleeper's NFL state too (it decides the weeks to read); the server reads its own copy.
    league: (url) => bodies.get(url),
    publicData: (url) => (url === sleeperUrls.state() ? bodies.get(url) : projections.get(url)),
    resolver: () => sleeperResolver(t.players),
    now: new Date("2026-09-29T18:00:00Z"),
  };
}

async function main(): Promise<void> {
  // Offline by construction (the header): every client here is a fake; refuse the real network anyway.
  globalThis.fetch = (() => Promise.reject(new Error("measure-upload is offline"))) as typeof fetch;
  const leagues: League[] = [parkerFixtures()];
  const raw = parkerRawCaptures();
  if (raw) leagues.push(raw);
  const dump = newestDumpLeague();
  const parkerCached = dump ? cachedEspn("ESPN, Parker's league (.cache/app)", dump.leagueId, dump.season) : undefined;
  if (parkerCached) leagues.push(parkerCached);
  const publicCached = cachedEspn("ESPN, the public test league (.cache/app)", "899513", 2026);
  if (publicCached) leagues.push(publicCached);
  leagues.push(sleeperLeague());
  console.log("Browser fetching, offline (track BF): sizes, CPU and the two paths compared. No network.");
  if (!parkerCached && !publicCached) console.log("(.cache/app holds no ESPN league's data right now: it's kept 10 minutes; import a league and run this again for live-size bodies.)");
  for (const l of leagues) {
    try {
      for (const line of await measure(l)) console.log(line);
    } catch (err) {
      console.log(`${l.label}: couldn't be measured (${err instanceof Error ? err.name : "error"})`);
    }
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(`measure-upload stopped: ${err instanceof Error ? err.name : "error"}`);
    process.exit(1);
  });
}
