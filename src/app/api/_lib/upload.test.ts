/**
 * The gzip bodies the browser sends (track BF; ./upload.ts): caps before and while unpacking, the strict shape of a league
 * upload and of a signed import, the platform's own addresses, the parts' ages, and SWIDs pseudonymized before anything
 * is parsed. Made-up data only. No network.
 */
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ESPN_READS_BASE } from "@/adapters/espn/leagueData";
import { swidPseudonym } from "@/adapters/espn/swid";
import { SLEEPER_API } from "@/adapters/sleeper/leagueData";
import type { LeagueUpload } from "@/adapters/upload";
import { browserFetchLimits, signedUploadLimits, uploadLimits, uploadShapeLimits, workLimits } from "@/server/limits";
import { gzipRequest, jsonRequest } from "./testFakes";
import { isGzipRequest, readGzipText, readLeagueUpload, readSignedModelUpload, uploadPartsProblem } from "./upload";

const URL = "http://localhost:3000/api/import/espn";
const SWID = "{00000000-0000-4000-8000-0000000000AB}";

function espnUpload(over: Partial<LeagueUpload> = {}): LeagueUpload {
  return {
    v: 1,
    platform: "espn",
    request: { leagueId: "4242", season: 2026 },
    sentAt: 2_000_000,
    parts: [{ url: `${ESPN_READS_BASE}/seasons/2026/segments/0/leagues/4242?view=mSettings`, status: 200, json: { members: [{ id: SWID, displayName: "Zorblax" }] }, at: 1_999_000 }],
    ...over,
  };
}

describe("readGzipText", () => {
  it("unpacks a gzip body; refuses other types, bodies over the caps (before and while unpacking), non-gzip and non-UTF-8", async () => {
    expect(isGzipRequest(gzipRequest(URL, { a: 1 }))).toBe(true);
    expect(isGzipRequest(jsonRequest(URL, { a: 1 }))).toBe(false);
    expect(await readGzipText(gzipRequest(URL, { a: 1 }))).toEqual({ ok: true, value: '{"a":1}' });
    expect(await readGzipText(jsonRequest(URL, { a: 1 }))).toEqual({ ok: false, why: "not gzip" });
    // Over the compressed cap: refused unread.
    const big = gzipRequest(URL, "x".repeat(1000));
    expect(await readGzipText(big, { compressedBytes: 10, unpackedBytes: 1_000_000 })).toEqual({ ok: false, why: "too large" });
    // A zip bomb: small packed, huge unpacked.
    const bomb = new Request(URL, { method: "POST", headers: { "content-type": "application/gzip" }, body: gzipSync(Buffer.alloc(5_000_000)) });
    expect(await readGzipText(bomb, { compressedBytes: 3_000_000, unpackedBytes: 1_000_000 })).toEqual({ ok: false, why: "not gzip, or too large unpacked" });
    const notGzip = new Request(URL, { method: "POST", headers: { "content-type": "application/gzip" }, body: "plain text" });
    expect((await readGzipText(notGzip)).ok).toBe(false);
    const latin1 = new Request(URL, { method: "POST", headers: { "content-type": "application/gzip" }, body: gzipSync(Buffer.from([0x7b, 0xff, 0x7d])) });
    expect(await readGzipText(latin1)).toEqual({ ok: false, why: "not UTF-8" });
  });

  it("charges a body's unpacked size past what its compressed size paid on arrival, before anything reads it; refused, it names the limit (B4 security review)", async () => {
    expect(workLimits.unpackedUnitBytes).toBe(500_000);
    const sized = (text: string) => {
      const packed = gzipSync(Buffer.from(text), { level: 9 });
      return () => new Request(URL, { method: "POST", headers: { "content-type": "application/gzip", "content-length": String(packed.length) }, body: packed });
    };
    // 3.9 MB of one letter (under both kinds' caps): about 4 KB gzipped (1 unit on arrival), 8 units unpacked.
    const flat = sized(JSON.stringify({ junk: "x".repeat(3_900_000) }));
    const charges: number[] = [];
    const read = await readGzipText(flat(), uploadLimits, { charge: (units) => (charges.push(units), "ok") });
    expect(read.ok).toBe(true);
    expect(charges).toEqual([8 - 1]);
    // Refused: no text comes back, only the limit (the routes answer BUSY, not BAD_UPLOAD).
    expect(await readGzipText(flat(), uploadLimits, { charge: () => "client" })).toEqual({ ok: false, why: "past the day's work", refused: "client" });
    expect(await readLeagueUpload(flat(), "espn", { charge: async () => "day" as const })).toEqual({ ok: false, why: "past the day's work", refused: "day" });
    expect(await readSignedModelUpload(flat(), "espn", { charge: () => "group" })).toEqual({ ok: false, why: "past the day's work", refused: "group" });
    // A body that compresses as real uploads do owes nothing more, and a body without Content-Length paid for its cap.
    const never = (): "ok" => {
      throw new Error("not charged");
    };
    expect((await readLeagueUpload(sized(JSON.stringify(espnUpload()))(), "espn", { charge: never })).ok).toBe(true);
    expect((await readGzipText(gzipRequest(URL, { junk: "x".repeat(5_800_000) }), uploadLimits, { charge: never })).ok).toBe(true);
    // Outside a request, or off Vercel, the default charge (src/server/budget.ts chargeWork) is free.
    expect((await readGzipText(flat())).ok).toBe(true);
  });
});

describe("readLeagueUpload", () => {
  it("reads an ESPN upload, its SWIDs pseudonymized before it's parsed (as the server's own read does)", async () => {
    const read = await readLeagueUpload(gzipRequest(URL, espnUpload()), "espn");
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(JSON.stringify(read.value)).not.toContain("0000000000AB");
    expect((read.value.parts[0]?.json as { members: Array<{ id: string }> }).members[0]?.id).toBe(swidPseudonym(SWID));
  });

  it("refuses anything but the expected shape: unknown fields, another platform's addresses, too many parts, stale or future parts", async () => {
    const bad = async (u: unknown, platform: "espn" | "sleeper" = "espn") => (await readLeagueUpload(gzipRequest(URL, u), platform)).ok;
    expect(await bad(espnUpload())).toBe(true);
    expect(await bad({ ...espnUpload(), extra: 1 })).toBe(false);
    expect(await bad({ ...espnUpload(), v: 2 })).toBe(false);
    expect(await bad(espnUpload(), "sleeper")).toBe(false);
    expect(await bad(espnUpload({ request: { leagueId: "not-a-league", season: 2026 } }))).toBe(false);
    expect(await bad(espnUpload({ parts: [{ url: "https://evil.example/x", status: 200, at: 1_999_000 }] }))).toBe(false);
    expect(await bad(espnUpload({ parts: [{ url: `${SLEEPER_API}/state/nfl`, status: 200, at: 1_999_000 }] }))).toBe(false);
    const part = { url: `${ESPN_READS_BASE}/seasons/2026/segments/0/leagues/4242?view=mTransactions2&scoringPeriodId=1`, status: 200, at: 1_999_000 };
    expect(await bad(espnUpload({ parts: Array.from({ length: browserFetchLimits.maxParts + 1 }, () => part) }))).toBe(false);
    expect(await bad(espnUpload({ parts: [{ ...part, at: 2_000_000 - browserFetchLimits.maxPartAgeMs - 1 }] }))).toBe(false);
    expect(await bad(espnUpload({ parts: [{ ...part, at: 2_000_001 }] }))).toBe(false);
    expect(await bad("not json")).toBe(false);
    // Sleeper: a league ID as a bare number, and a username checked as everywhere else.
    const sleeper = { v: 1, platform: "sleeper", request: { leagueId: "123456789012345678", season: 2026, username: "@zorblax_q" }, sentAt: 10, parts: [{ url: `${SLEEPER_API}/state/nfl`, status: 200, json: { week: 4 }, at: 9 }] };
    const read = await readLeagueUpload(gzipRequest(URL, sleeper), "sleeper");
    expect(read.ok && read.value.request).toEqual({ leagueId: "123456789012345678", season: 2026, username: "zorblax_q" });
    expect(await bad({ ...sleeper, request: { leagueId: "https://sleeper.com/leagues/123456789012345678", season: 2026 } }, "sleeper")).toBe(false);
    expect(await bad({ ...sleeper, request: { leagueId: "123456789012345678", season: 2026, username: "zorblax q" } }, "sleeper")).toBe(false);
  });
});

describe("what an upload may hold (final review SEC-1)", () => {
  it("only the league-data reads a browser makes, each once: anything else the server reads itself, a repeat, a stranger's address", () => {
    const league = `${ESPN_READS_BASE}/seasons/2026/segments/0/leagues/4242?view=mSettings&view=mTeam`;
    const freeAgents = `${ESPN_READS_BASE}/seasons/2026/segments/0/leagues/4242?view=kona_player_info&scoringPeriodId=4`;
    expect(uploadPartsProblem([{ url: league }, { url: freeAgents, filter: '{"players":{"filterSlotIds":{"value":[0]}}}' }, { url: freeAgents, filter: '{"players":{"filterSlotIds":{"value":[2]}}}' }])).toBeNull();
    expect(uploadPartsProblem([{ url: `${SLEEPER_API}/league/123456789012345678` }, { url: `${SLEEPER_API}/league/123456789012345678/rosters` }, { url: `${SLEEPER_API}/state/nfl` }])).toBeNull();
    expect(uploadPartsProblem([{ url: league }, { url: league }])).toBe("the same response twice");
    expect(uploadPartsProblem([{ url: freeAgents, filter: "{}" }, { url: freeAgents, filter: "{}" }])).toBe("the same response twice");
    for (const url of [
      `${ESPN_READS_BASE}/seasons/2026/segments/0/leaguedefaults/3?view=kona_player_info`, // projections: the server's to read
      `${ESPN_READS_BASE}/seasons/2026?view=proTeamSchedules_wl`, // the NFL schedule
      "https://api.sleeper.app/projections/nfl/2026/4?season_type=regular&position=QB",
      "https://api.sleeper.app/v1/players/nfl",
      "https://evil.example/v1/league/1",
    ])
      expect(uploadPartsProblem([{ url }]), url).toBe("a response the browser doesn't read");
  });

  it("readLeagueUpload refuses an upload with such a part, and the caps are the final review's (6 MB unpacked, 2 MB packed; a model build 60,000)", async () => {
    const league = { url: `${ESPN_READS_BASE}/seasons/2026/segments/0/leagues/4242?view=mSettings`, status: 200, json: {}, at: 1_999_000 };
    expect((await readLeagueUpload(gzipRequest(URL, espnUpload({ parts: [league, league] })), "espn")).ok).toBe(false);
    const schedule = { url: `${ESPN_READS_BASE}/seasons/2026?view=proTeamSchedules_wl`, status: 200, json: {}, at: 1_999_000 };
    expect(await readLeagueUpload(gzipRequest(URL, espnUpload({ parts: [league, schedule] })), "espn")).toEqual({ ok: false, why: "a response the browser doesn't read" });
    expect(uploadLimits).toEqual({ compressedBytes: 2_000_000, unpackedBytes: 6_000_000 });
    expect(signedUploadLimits).toEqual({ compressedBytes: 1_000_000, unpackedBytes: 4_000_000 });
    expect(uploadShapeLimits.modelWork).toBe(60_000);
    // A bomb that unpacks past the cap (7 MB of an empty list's commas) is refused while unpacking.
    const bomb = `{"v":1,"platform":"espn","request":{"leagueId":"4242","season":2026},"sentAt":2000000,"parts":[{"url":"${league.url}","status":200,"at":1999000,"json":[${"[],".repeat(2_333_333)}[]]}]}`;
    expect(await readLeagueUpload(gzipRequest(URL, bomb), "espn")).toEqual({ ok: false, why: "not gzip, or too large unpacked" });
  });

  it("a signed import has its own, smaller caps (its signature's check hashes the whole snapshot)", async () => {
    const snapshot = { platform: "sleeper", leagueId: "123456789012345678", season: 2026, pad: "x".repeat(signedUploadLimits.unpackedBytes) };
    const body = { v: 1, leagueId: "123456789012345678", season: 2026, import: { snapshot, modelPart: {} }, signed: { issuedAt: 5, token: "t" } };
    expect(await readSignedModelUpload(gzipRequest(URL, body), "sleeper")).toEqual({ ok: false, why: "not gzip, or too large unpacked" });
    const fits = { ...body, import: { snapshot: { ...snapshot, pad: "x".repeat(signedUploadLimits.unpackedBytes - 1_000) }, modelPart: {} } };
    expect((await readSignedModelUpload(gzipRequest(URL, fits), "sleeper")).ok).toBe(true);
  });
});

describe("readSignedModelUpload", () => {
  it("hands back the import exactly as parsed (its signature covers that object), and refuses other shapes", async () => {
    const snapshot = { platform: "sleeper", leagueId: "123456789012345678", season: 2026, b: { z: 1, a: 2 } };
    const body = { v: 1, leagueId: "123456789012345678", season: 2026, username: "zorblax_q", import: { snapshot, modelPart: {} }, signed: { issuedAt: 5, token: "t" } };
    const read = await readSignedModelUpload(gzipRequest(URL, body), "sleeper");
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value).toEqual({ leagueId: "123456789012345678", season: 2026, username: "zorblax_q", import: { snapshot, modelPart: {} }, signed: { issuedAt: 5, token: "t" } });
    expect(Object.keys(read.value.import.snapshot.b as object)).toEqual(["z", "a"]);
    expect((await readSignedModelUpload(gzipRequest(URL, { ...body, username: undefined, leagueId: "4242" }), "espn")).ok).toBe(true);
    expect((await readSignedModelUpload(gzipRequest(URL, { ...body, username: undefined, leagueId: "4242", extra: true }), "espn")).ok).toBe(false);
    expect((await readSignedModelUpload(gzipRequest(URL, { ...body, signed: { issuedAt: 1.5, token: "t" } }), "sleeper")).ok).toBe(false);
    expect((await readSignedModelUpload(gzipRequest(URL, { ...body, import: { snapshot: [], modelPart: {} } }), "sleeper")).ok).toBe(false);
  });
});
